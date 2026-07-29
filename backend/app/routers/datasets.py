import csv
import io
import json
import random
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import config, labels
from ..db import get_client

router = APIRouter(tags=["datasets"])

# Column order for metadata.csv. `file_name` must keep that exact name and lead
# the file: HuggingFace's `audiofolder` loader looks for it by name to pair each
# row with its audio, and silently loads nothing if it is missing.
BASE_COLUMNS = [
    "file_name", "audio_id", "original_filename",
    "label", "label_source", "split",
    "predicted_label", "predicted_confidence",
    "verified_label", "review_status", "reviewed_by", "reviewed_at",
    "duration_seconds", "sample_rate", "channels", "bit_depth", "audio_format",
    "file_size_bytes", "source", "device", "recorded_at",
]


class DatasetCreate(BaseModel):
    name: str
    description: str | None = None


class DatasetItemsAdd(BaseModel):
    audio_file_ids: list[str]


def _get_dataset_or_404(client, dataset_id: str) -> dict:
    rows = client.table("datasets").select("*").eq("id", dataset_id).execute().data
    if not rows:
        raise HTTPException(404, "dataset not found")
    return rows[0]


@router.post("/datasets", status_code=201, summary="Create a dataset")
def create_dataset(body: DatasetCreate):
    client = get_client()
    return client.table("datasets").insert({
        "name": body.name, "description": body.description,
    }).execute().data[0]


@router.get("/datasets", summary="List datasets with item counts")
def list_datasets():
    client = get_client()
    rows = client.table("datasets").select("*, dataset_items(count)") \
        .order("created_at", desc=True).execute().data
    for r in rows:
        counts = r.pop("dataset_items", [])
        r["item_count"] = counts[0]["count"] if counts else 0
    return rows


@router.get("/datasets/{dataset_id}", summary="Dataset detail + items")
def get_dataset(dataset_id: str):
    client = get_client()
    dataset = _get_dataset_or_404(client, dataset_id)
    items = (client.table("dataset_items")
             .select("added_at, audio_files(id, filename, duration, source, status, "
                     "uploaded_at, review_status, verified_label)")
             .eq("dataset_id", dataset_id).execute().data)
    rows = [{**i["audio_files"], "added_at": i["added_at"]}
            for i in items if i.get("audio_files")]

    # Resolve each row's effective label so the UI can show export readiness
    # without re-deriving the rule the export uses.
    predicted = labels.predicted_labels(client, [r["id"] for r in rows])
    for r in rows:
        r["label"], r["label_source"] = labels.final_label(r, predicted.get(r["id"]))

    dataset["items"] = rows
    dataset["review_summary"] = dict(Counter(r["review_status"] for r in rows))
    dataset["exportable"] = sum(
        1 for r in rows if r["review_status"] != "rejected" and r["label"])
    return dataset


@router.post("/datasets/{dataset_id}/items", status_code=201,
             summary="Add audio files to a dataset")
def add_items(dataset_id: str, body: DatasetItemsAdd):
    client = get_client()
    _get_dataset_or_404(client, dataset_id)
    if not body.audio_file_ids:
        raise HTTPException(400, "audio_file_ids is empty")

    found = client.table("audio_files").select("id") \
        .in_("id", body.audio_file_ids).execute().data
    found_ids = {r["id"] for r in found}
    missing = [i for i in body.audio_file_ids if i not in found_ids]
    if missing:
        raise HTTPException(404, f"audio files not found: {missing}")

    client.table("dataset_items").upsert(
        [{"dataset_id": dataset_id, "audio_file_id": i} for i in found_ids],
        on_conflict="dataset_id,audio_file_id",
    ).execute()
    return {"dataset_id": dataset_id, "added": len(found_ids)}


@router.delete("/datasets/{dataset_id}/items/{audio_id}", status_code=204,
               summary="Remove an audio file from a dataset")
def remove_item(dataset_id: str, audio_id: str):
    client = get_client()
    client.table("dataset_items").delete() \
        .eq("dataset_id", dataset_id).eq("audio_file_id", audio_id).execute()


@router.delete("/datasets/{dataset_id}", status_code=204, summary="Delete a dataset")
def delete_dataset(dataset_id: str):
    client = get_client()
    _get_dataset_or_404(client, dataset_id)
    client.table("datasets").delete().eq("id", dataset_id).execute()


def _stratified_split(labelled: list[tuple[str, str]], train_ratio: float,
                      val_ratio: float, seed: str) -> dict[str, str]:
    """Assign every audio id to train / validation / test, balanced per class.

    Stratified so a rare class does not land entirely in one split. Seeded from
    the dataset id, so exporting the same dataset twice gives the same split —
    without that, re-running an experiment silently changes the test set and the
    accuracy numbers stop being comparable.
    """
    by_label: dict[str, list[str]] = defaultdict(list)
    for audio_id, label in labelled:
        by_label[label].append(audio_id)

    test_ratio = max(0.0, 1.0 - train_ratio - val_ratio)
    val_share = val_ratio / (val_ratio + test_ratio) if (val_ratio + test_ratio) else 0.0

    out: dict[str, str] = {}
    for label, ids in sorted(by_label.items()):
        ids = sorted(ids)                       # stable order before shuffling
        random.Random(f"{seed}:{label}").shuffle(ids)

        n = len(ids)
        n_train = min(n, max(1, round(n * train_ratio)))  # a lone example goes to train
        n_val = round((n - n_train) * val_share)
        for i, audio_id in enumerate(ids):
            out[audio_id] = ("train" if i < n_train
                             else "validation" if i < n_train + n_val
                             else "test")
    return out


def _dataset_card(dataset: dict, rows: list[dict], skipped: list[tuple[str, str]],
                  split: bool, only_approved: bool) -> str:
    """README.md for the ZIP — what is inside, how it was labelled, how to load it.

    A dataset without this is guesswork for whoever receives it; every published
    audio set (the NVIDIA Nemotron reference included) ships one.
    """
    classes = Counter(r["label"] for r in rows)
    sources = Counter(r["label_source"] for r in rows)
    total_sec = sum(r["duration_seconds"] or 0 for r in rows)
    verified = sources["human_confirmed"] + sources["human_corrected"]
    n = len(rows)
    clips = f"{n} clip" + ("" if n == 1 else "s")

    lines = [
        f"# {dataset['name']}", "",
        (dataset.get("description") or "_No description._"), "",
        f"Exported from SODAMA on {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC.", "",
        "## Contents", "",
        f"- **{clips}**, {total_sec / 60:.1f} minutes total",
        f"- **{len(classes)} class" + ("" if len(classes) == 1 else "es") + "**",
        "- Audio: WAV, 16 kHz, mono, 16-bit PCM (standardised on upload)",
        f"- Filter applied: {'approved clips only' if only_approved else 'all clips except rejected'}",
        "",
        "## Label provenance", "",
        "**Read this before training.** Labels come from two very different places:",
        "",
        "| Source | Clips | Meaning |",
        "|---|---:|---|",
        f"| `human_confirmed` | {sources['human_confirmed']} | A reviewer agreed with the model's prediction |",
        f"| `human_corrected` | {sources['human_corrected']} | A reviewer replaced the prediction |",
        f"| `auto` | {sources['auto']} | **Unverified YAMNet output — nobody has checked it** |",
        "",
    ]

    if sources["auto"]:
        one = sources["auto"] == 1
        lines += [f"> {sources['auto']} of {clips} ({100 * sources['auto'] / n:.0f}%) "
                  + ("carries an unverified label" if one else "carry unverified labels")
                  + ". YAMNet's predictions are frequently wrong on out-of-domain audio, so "
                  + ("treat that row as a weak label" if one else "treat those rows as weak labels")
                  + " — filter on `label_source != 'auto'` if you need clean ground truth.", ""]
    else:
        lines += [f"> All {clips} were reviewed by a human.", ""]

    lines += ["## Class distribution", "", "| Class | Clips |", "|---|---:|"]
    lines += [f"| {name} | {n} |" for name, n in classes.most_common()]
    lines.append("")

    if split:
        counts = Counter(r["split"] for r in rows)
        lines += ["## Splits", "",
                  "Stratified per class and seeded from the dataset id, so re-exporting "
                  "reproduces the same partition.", "",
                  "| Split | Clips |", "|---|---:|"]
        lines += [f"| {s} | {counts[s]} |" for s in ("train", "validation", "test")]
        lines += ["", "`metadata.csv` carries a `split` column; `train.csv`, "
                  "`validation.csv` and `test.csv` are the same rows pre-filtered.", ""]

    if skipped:
        lines += ["## Excluded clips", "",
                  "These were in the dataset but left out of the export:", "",
                  "| File | Reason |", "|---|---|"]
        lines += [f"| {name} | {why} |" for name, why in skipped]
        lines.append("")

    lines += [
        "## Columns", "",
        "| Column | Description |", "|---|---|",
        "| `file_name` | Path to the clip, relative to this file |",
        "| `audio_id` | SODAMA identifier |",
        "| `original_filename` | Name as uploaded, or as recorded by the device |",
        "| `label` | **The label to train on** — verified where available, otherwise predicted |",
        "| `label_source` | `human_confirmed` / `human_corrected` / `auto` (see above) |",
        "| `split` | `train` / `validation` / `test` |",
        "| `predicted_label` | YAMNet's top class by mean confidence across windows |",
        "| `predicted_confidence` | That mean confidence, 0-1 |",
        "| `verified_label` | Label a reviewer confirmed or typed; empty if unreviewed |",
        "| `review_status` | `approved` / `unreviewed` |",
        "| `reviewed_by`, `reviewed_at` | Who signed off, and when |",
        "| `duration_seconds`, `sample_rate`, `channels`, `bit_depth`, `audio_format`, `file_size_bytes` | Audio properties |",
        "| `source` | `upload` or `esp32` |",
        "| `device` | Recording device name, for ESP32 clips |",
        "| `recorded_at` | When the clip entered the system |",
        "| `meta_*` | Any custom metadata attached to the clip |",
        "",
        "## Loading", "",
        "```python",
        "from datasets import load_dataset",
        "",
        '# `file_name` + metadata.csv is the layout the audiofolder loader expects',
        'ds = load_dataset("audiofolder", data_dir="./")',
        "```", "",
        "```python",
        "import pandas as pd",
        'df = pd.read_csv("metadata.csv")',
        'clean = df[df.label_source != "auto"]   # human-verified rows only',
        "```", "",
    ]
    return "\n".join(lines)


@router.get("/datasets/{dataset_id}/export",
            summary="Export dataset as ZIP (audio + metadata.csv/json + README)")
def export_dataset(
    dataset_id: str,
    manifest_format: str = Query("both", pattern="^(csv|json|both)$"),
    only_approved: bool = Query(False, description="Export only human-approved clips"),
    split: bool = Query(True, description="Assign train/validation/test"),
    train_ratio: float = Query(0.7, ge=0.1, le=0.98),
    val_ratio: float = Query(0.15, ge=0.0, le=0.5),
):
    """Bundles the audio with a HuggingFace-compatible `metadata.csv`, a dataset
    card, and optional train/validation/test splits.

    Rejected clips and clips with no label at all are always left out — a
    training bundle should not carry rows a trainer has to clean up again. The
    README lists what was excluded and why.
    """
    if train_ratio + val_ratio > 0.99:
        raise HTTPException(400, "train_ratio + val_ratio must leave room for a test split")

    client = get_client()
    dataset = _get_dataset_or_404(client, dataset_id)

    items = (client.table("dataset_items")
             .select("audio_files(id, filename, storage_path, duration, sample_rate, "
                     "file_size, source, uploaded_at, review_status, verified_label, "
                     "reviewed_by, reviewed_at, device_id)")
             .eq("dataset_id", dataset_id).execute().data)
    files = [i["audio_files"] for i in items if i.get("audio_files")]
    if not files:
        raise HTTPException(400, "dataset has no items to export")

    predicted = labels.predicted_labels(client, [f["id"] for f in files])
    devices = {d["id"]: d["device_name"]
               for d in client.table("devices").select("id, device_name").execute().data}

    custom_meta: dict[str, dict[str, str]] = defaultdict(dict)
    for m in (client.table("metadata").select("audio_file_id, key, value")
              .in_("audio_file_id", [f["id"] for f in files]).execute().data):
        custom_meta[m["audio_file_id"]][m["key"]] = m["value"]

    rows, skipped = [], []
    for f in files:
        label, label_source = labels.final_label(f, predicted.get(f["id"]))
        if f["review_status"] == "rejected":
            skipped.append((f["filename"], "rejected during review"))
            continue
        if only_approved and f["review_status"] != "approved":
            skipped.append((f["filename"], "not approved yet"))
            continue
        if not label:
            skipped.append((f["filename"], "no label — classification never produced a result"))
            continue

        pred = predicted.get(f["id"])
        rows.append({
            "file_name": f"audio/{f['id']}.wav",
            "audio_id": f["id"],
            "original_filename": f["filename"],
            "label": label,
            "label_source": label_source,
            "split": "",                      # filled in below
            "predicted_label": pred[0] if pred else "",
            "predicted_confidence": pred[1] if pred else "",
            "verified_label": f["verified_label"] or "",
            "review_status": f["review_status"],
            "reviewed_by": f["reviewed_by"] or "",
            "reviewed_at": f["reviewed_at"] or "",
            "duration_seconds": f["duration"],
            "sample_rate": f["sample_rate"],
            # Constant by construction: every clip is normalised on the way in
            # (see audio.to_wav_bytes), but a trainer should not have to probe
            # the files to find that out.
            "channels": 1,
            "bit_depth": 16,
            "audio_format": "wav",
            "file_size_bytes": f["file_size"],
            "source": f["source"],
            "device": devices.get(f["device_id"], ""),
            "recorded_at": f["uploaded_at"],
            **{f"meta_{k}": v for k, v in custom_meta.get(f["id"], {}).items()},
            "_storage_path": f["storage_path"],
        })

    if not rows:
        detail = ("no clips left to export — every item was rejected, unlabelled, "
                  "or still unapproved")
        if only_approved:
            detail = ("no approved clips in this dataset. Review the files first, or "
                      "turn off \"approved only\".")
        raise HTTPException(400, detail)

    if split:
        assignment = _stratified_split(
            [(r["audio_id"], r["label"]) for r in rows], train_ratio, val_ratio, dataset["id"])
        for r in rows:
            r["split"] = assignment[r["audio_id"]]

    columns = [c for c in BASE_COLUMNS if split or c != "split"]
    columns += sorted({k for r in rows for k in r if k.startswith("meta_")})

    def as_csv(subset: list[dict]) -> str:
        out = io.StringIO()
        w = csv.DictWriter(out, fieldnames=columns, extrasaction="ignore", restval="")
        w.writeheader()
        w.writerows(subset)
        return out.getvalue()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for r in rows:
            data = client.storage.from_(config.AUDIO_BUCKET).download(r.pop("_storage_path"))
            z.writestr(r["file_name"], data)

        if manifest_format in ("csv", "both"):
            z.writestr("metadata.csv", as_csv(rows))
            if split:
                for name in ("train", "validation", "test"):
                    subset = [r for r in rows if r["split"] == name]
                    if subset:
                        z.writestr(f"{name}.csv", as_csv(subset))
        if manifest_format in ("json", "both"):
            clean = [{c: r.get(c, "") for c in columns} for r in rows]
            z.writestr("metadata.json", json.dumps(clean, indent=2))

        z.writestr("README.md", _dataset_card(dataset, rows, skipped, split, only_approved))

    buf.seek(0)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in dataset["name"])
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'})
