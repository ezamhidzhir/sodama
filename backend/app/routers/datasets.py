import csv
import io
import json
import random
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from .. import config, labels
from ..auth import User, current_user
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
    "file_size_bytes", "source", "device", "recorded_at", "uploaded_at",
    "location_name", "latitude", "longitude",
]

LICENSES = {
    "CC-BY-4.0": "Creative Commons Attribution 4.0",
    "CC-BY-SA-4.0": "Creative Commons Attribution-ShareAlike 4.0",
    "CC-BY-NC-4.0": "Creative Commons Attribution-NonCommercial 4.0",
    "CC0-1.0": "Public domain (CC0 1.0)",
}
License = Literal["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC0-1.0"]

MAX_CLASSES = 50


def _clean_labels(v: list[str] | None) -> list[str]:
    """Trim, collapse whitespace and de-duplicate case-insensitively, keeping order."""
    out: list[str] = []
    for raw in v or []:
        name = " ".join(str(raw).split())[:60]
        if name and not any(o.casefold() == name.casefold() for o in out):
            out.append(name)
    if len(out) > MAX_CLASSES:
        raise ValueError(f"at most {MAX_CLASSES} classes per dataset")
    return out


class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    labels: list[str] = Field(default_factory=list,
                              description="Classes this dataset collects, e.g. Honda, Toyota")

    @field_validator("labels")
    @classmethod
    def _labels(cls, v):
        return _clean_labels(v)


class DatasetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    labels: list[str] | None = None
    visibility: Literal["private", "public"] | None = None
    license: License | None = None
    share_location: bool | None = None

    @field_validator("labels")
    @classmethod
    def _labels(cls, v):
        return None if v is None else _clean_labels(v)


class DatasetItemsAdd(BaseModel):
    audio_file_ids: list[str]


def get_owned_dataset(client, dataset_id: str, user: User) -> dict:
    rows = (client.table("datasets").select("*")
            .eq("id", dataset_id).eq("user_id", user.id).execute().data)
    if not rows:
        raise HTTPException(404, "dataset not found")
    return rows[0]


def attach_to_dataset(client, user: User, dataset_id: str, audio_ids: list[str]) -> int:
    """Add the caller's own files to the caller's own dataset. Returns how many."""
    get_owned_dataset(client, dataset_id, user)
    found = (client.table("audio_files").select("id")
             .in_("id", audio_ids).eq("user_id", user.id).execute().data)
    found_ids = {r["id"] for r in found}
    missing = [i for i in audio_ids if i not in found_ids]
    if missing:
        raise HTTPException(404, f"audio files not found: {missing}")
    client.table("dataset_items").upsert(
        [{"dataset_id": dataset_id, "audio_file_id": i} for i in found_ids],
        on_conflict="dataset_id,audio_file_id",
    ).execute()
    client.table("datasets").update({"updated_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", dataset_id).execute()
    return len(found_ids)


def dataset_rows(client, dataset_id: str) -> list[dict]:
    """The dataset's files with their effective label resolved."""
    items = (client.table("dataset_items")
             .select("added_at, audio_files(id, filename, duration, source, status, "
                     "uploaded_at, recorded_at, review_status, verified_label, label_origin, "
                     "location_name)")
             .eq("dataset_id", dataset_id).execute().data)
    rows = [{**i["audio_files"], "added_at": i["added_at"]}
            for i in items if i.get("audio_files")]
    # Resolve each row's effective label so the UI can show export readiness
    # without re-deriving the rule the export uses.
    predicted = labels.predicted_labels(client, [r["id"] for r in rows])
    for r in rows:
        r["label"], r["label_source"] = labels.final_label(r, predicted.get(r["id"]))
    rows.sort(key=lambda r: r["added_at"], reverse=True)
    return rows


def exportable(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["review_status"] != "rejected" and r["label"]]


@router.post("/datasets", status_code=201, summary="Create a dataset (folder)")
def create_dataset(body: DatasetCreate, user: User = Depends(current_user)):
    client = get_client()
    return client.table("datasets").insert({
        "name": body.name.strip(), "description": (body.description or "").strip() or None,
        "labels": body.labels, "user_id": user.id,
    }).execute().data[0]


@router.get("/datasets", summary="List your datasets with item counts")
def list_datasets(user: User = Depends(current_user)):
    client = get_client()
    rows = client.table("datasets").select("*, dataset_items(count)") \
        .eq("user_id", user.id).order("updated_at", desc=True).execute().data
    for r in rows:
        counts = r.pop("dataset_items", [])
        r["item_count"] = counts[0]["count"] if counts else 0
    return rows


@router.get("/datasets/{dataset_id}", summary="Dataset detail + items")
def get_dataset(dataset_id: str, user: User = Depends(current_user)):
    client = get_client()
    dataset = get_owned_dataset(client, dataset_id, user)
    rows = dataset_rows(client, dataset_id)
    dataset["items"] = rows
    dataset["review_summary"] = dict(Counter(r["review_status"] for r in rows))
    dataset["exportable"] = len(exportable(rows))
    dataset["like_count"] = (client.table("dataset_likes").select("user_id", count="exact")
                             .eq("dataset_id", dataset_id).execute().count or 0)
    return dataset


@router.patch("/datasets/{dataset_id}", summary="Edit a dataset, or publish it to Community")
def update_dataset(dataset_id: str, body: DatasetUpdate, user: User = Depends(current_user)):
    """Publishing (`visibility: public`) is only allowed once the dataset can
    stand on its own for a stranger: it needs a description, a licence telling
    people what they may do with it, and at least one clip that would actually
    be in the download."""
    client = get_client()
    dataset = get_owned_dataset(client, dataset_id, user)

    patch = body.model_dump(exclude_unset=True)
    if "name" in patch:
        patch["name"] = patch["name"].strip()
    if "description" in patch:
        patch["description"] = (patch["description"] or "").strip() or None
    if not patch:
        raise HTTPException(400, "nothing to update")

    merged = {**dataset, **patch}
    if merged["visibility"] == "public":
        problems = []
        if not merged.get("description"):
            problems.append("add a description so others know what the sounds are")
        if not merged.get("license"):
            problems.append("choose a licence")
        if not exportable(dataset_rows(client, dataset_id)):
            problems.append("add at least one labelled, non-rejected clip")
        if problems:
            raise HTTPException(400, "Cannot publish yet: " + "; ".join(problems) + ".")
        if dataset["visibility"] != "public":
            patch["published_at"] = datetime.now(timezone.utc).isoformat()
    elif body.visibility == "private":
        patch["published_at"] = None

    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    return client.table("datasets").update(patch).eq("id", dataset_id).execute().data[0]


@router.post("/datasets/{dataset_id}/items", status_code=201,
             summary="Add audio files to a dataset")
def add_items(dataset_id: str, body: DatasetItemsAdd, user: User = Depends(current_user)):
    if not body.audio_file_ids:
        raise HTTPException(400, "audio_file_ids is empty")
    added = attach_to_dataset(get_client(), user, dataset_id, body.audio_file_ids)
    return {"dataset_id": dataset_id, "added": added}


@router.delete("/datasets/{dataset_id}/items/{audio_id}", status_code=204,
               summary="Remove an audio file from a dataset")
def remove_item(dataset_id: str, audio_id: str, user: User = Depends(current_user)):
    client = get_client()
    get_owned_dataset(client, dataset_id, user)
    client.table("dataset_items").delete() \
        .eq("dataset_id", dataset_id).eq("audio_file_id", audio_id).execute()


@router.delete("/datasets/{dataset_id}", status_code=204, summary="Delete a dataset")
def delete_dataset(dataset_id: str, user: User = Depends(current_user)):
    client = get_client()
    get_owned_dataset(client, dataset_id, user)
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
                  split: bool, only_approved: bool, author: str | None) -> str:
    """README.md for the ZIP — what is inside, how it was labelled, how to load it.

    A dataset without this is guesswork for whoever receives it; every published
    audio set (the NVIDIA Nemotron reference included) ships one.
    """
    classes = Counter(r["label"] for r in rows)
    sources = Counter(r["label_source"] for r in rows)
    total_sec = sum(r["duration_seconds"] or 0 for r in rows)
    n = len(rows)
    clips = f"{n} clip" + ("" if n == 1 else "s")
    lic = dataset.get("license")

    lines = [f"# {dataset['name']}", ""]
    if author:
        lines += [f"Shared by **@{author}** on the SODAMA community.", ""]
    lines += [
        (dataset.get("description") or "_No description._"), "",
        f"Exported from SODAMA on {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC.", "",
    ]
    if lic:
        lines += [f"**Licence:** {LICENSES.get(lic, lic)} (`{lic}`). "
                  "Credit the author when you use or redistribute this data.", ""]
    lines += [
        "## Contents", "",
        f"- **{clips}**, {total_sec / 60:.1f} minutes total",
        f"- **{len(classes)} class" + ("" if len(classes) == 1 else "es") + "**",
        "- Audio: WAV, 16 kHz, mono, 16-bit PCM (standardised on upload)",
        f"- Filter applied: {'approved clips only' if only_approved else 'all clips except rejected'}",
        "",
        "## Label provenance", "",
        "**Read this before training.** Labels come from very different places:",
        "",
        "| Source | Clips | Meaning |",
        "|---|---:|---|",
        f"| `human_annotated` | {sources['human_annotated']} | The person recording named the sound at capture time |",
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
        lines += [f"> All {clips} carry a human-given label.", ""]

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
        "| `label` | **The label to train on** — human-given where available, otherwise predicted |",
        "| `label_source` | `human_annotated` / `human_confirmed` / `human_corrected` / `auto` (see above) |",
        "| `split` | `train` / `validation` / `test` |",
        "| `predicted_label` | YAMNet's top class by mean confidence across windows |",
        "| `predicted_confidence` | That mean confidence, 0-1 |",
        "| `verified_label` | Label a person gave; empty if nobody has |",
        "| `review_status` | `approved` / `unreviewed` |",
        "| `reviewed_by`, `reviewed_at` | Who signed off, and when |",
        "| `duration_seconds`, `sample_rate`, `channels`, `bit_depth`, `audio_format`, `file_size_bytes` | Audio properties |",
        "| `source` | `upload`, `recording` (captured in the SODAMA app) or `device` (sent by a registered device) |",
        "| `device` | Recording device name, for device clips |",
        "| `recorded_at` | When the sound was captured (falls back to upload time) |",
        "| `uploaded_at` | When the clip entered the system |",
        "| `location_name`, `latitude`, `longitude` | Where it was recorded, when the recordist shared it |",
        "| `meta_*` | Any custom metadata attached to the clip, e.g. `meta_notes` |",
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
        'clean = df[df.label_source != "auto"]   # human-labelled rows only',
        "```", "",
    ]
    return "\n".join(lines)


def build_export(client, dataset: dict, *, manifest_format: str = "both",
                 only_approved: bool = False, split: bool = True,
                 train_ratio: float = 0.7, val_ratio: float = 0.15,
                 public_author: str | None = None) -> StreamingResponse:
    """Bundle a dataset as a HuggingFace-compatible ZIP.

    `public_author` switches on the Community download rules: reviewer emails
    are replaced by the author's username, and precise coordinates are dropped
    unless the owner chose to share them. A public download must never leak
    more about a person than their public profile does.
    """
    if train_ratio + val_ratio > 0.99:
        raise HTTPException(400, "train_ratio + val_ratio must leave room for a test split")

    items = (client.table("dataset_items")
             .select("audio_files(id, filename, storage_path, duration, sample_rate, "
                     "file_size, source, uploaded_at, recorded_at, review_status, "
                     "verified_label, label_origin, reviewed_by, reviewed_at, device_id, "
                     "latitude, longitude, location_name)")
             .eq("dataset_id", dataset["id"]).execute().data)
    files = [i["audio_files"] for i in items if i.get("audio_files")]
    if not files:
        raise HTTPException(400, "dataset has no items to export")

    ids = [f["id"] for f in files]
    predicted = labels.predicted_labels(client, ids)
    device_ids = list({f["device_id"] for f in files if f.get("device_id")})
    devices = ({d["id"]: d["device_name"] for d in client.table("devices")
                .select("id, device_name").in_("id", device_ids).execute().data}
               if device_ids else {})

    custom_meta: dict[str, dict[str, str]] = defaultdict(dict)
    for m in (client.table("metadata").select("audio_file_id, key, value")
              .in_("audio_file_id", ids).execute().data):
        custom_meta[m["audio_file_id"]][m["key"]] = m["value"]

    is_public = public_author is not None
    keep_coords = not is_public or dataset.get("share_location")

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
        reviewer = f["reviewed_by"] or ""
        if is_public and reviewer:
            reviewer = f"@{public_author}"
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
            "reviewed_by": reviewer,
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
            "recorded_at": f.get("recorded_at") or f["uploaded_at"],
            "uploaded_at": f["uploaded_at"],
            "location_name": f.get("location_name") or "",
            "latitude": f["latitude"] if keep_coords and f.get("latitude") is not None else "",
            "longitude": f["longitude"] if keep_coords and f.get("longitude") is not None else "",
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

        z.writestr("README.md", _dataset_card(dataset, rows, skipped, split, only_approved,
                                              public_author))

    buf.seek(0)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in dataset["name"])
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'})


@router.get("/datasets/{dataset_id}/export",
            summary="Export dataset as ZIP (audio + metadata.csv/json + README)")
def export_dataset(
    dataset_id: str,
    manifest_format: str = Query("both", pattern="^(csv|json|both)$"),
    only_approved: bool = Query(False, description="Export only human-approved clips"),
    split: bool = Query(True, description="Assign train/validation/test"),
    train_ratio: float = Query(0.7, ge=0.1, le=0.98),
    val_ratio: float = Query(0.15, ge=0.0, le=0.5),
    user: User = Depends(current_user),
):
    """Bundles the audio with a HuggingFace-compatible `metadata.csv`, a dataset
    card, and optional train/validation/test splits.

    Rejected clips and clips with no label at all are always left out — a
    training bundle should not carry rows a trainer has to clean up again. The
    README lists what was excluded and why.
    """
    client = get_client()
    dataset = get_owned_dataset(client, dataset_id, user)
    return build_export(client, dataset, manifest_format=manifest_format,
                        only_approved=only_approved, split=split,
                        train_ratio=train_ratio, val_ratio=val_ratio)
