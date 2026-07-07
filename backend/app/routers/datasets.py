import csv
import io
import json
import zipfile
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import config
from ..db import get_client

router = APIRouter(tags=["datasets"])


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
             .select("added_at, audio_files(id, filename, duration, source, status, uploaded_at)")
             .eq("dataset_id", dataset_id).execute().data)
    dataset["items"] = [{**i["audio_files"], "added_at": i["added_at"]}
                        for i in items if i.get("audio_files")]
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


@router.get("/datasets/{dataset_id}/export",
            summary="Export dataset as ZIP (audio + CSV/JSON manifest)")
def export_dataset(dataset_id: str,
                   manifest_format: str = Query("both", pattern="^(csv|json|both)$")):
    """Bundles every audio file in the dataset plus a manifest with filename,
    duration, source and the file's top YAMNet label — ready for ML training."""
    client = get_client()
    dataset = _get_dataset_or_404(client, dataset_id)

    items = (client.table("dataset_items")
             .select("audio_files(id, filename, storage_path, duration, sample_rate, source, uploaded_at)")
             .eq("dataset_id", dataset_id).execute().data)
    files = [i["audio_files"] for i in items if i.get("audio_files")]
    if not files:
        raise HTTPException(400, "dataset has no items to export")

    # top label per file = class with highest mean confidence across windows
    file_ids = [f["id"] for f in files]
    all_cls = (client.table("classifications")
               .select("audio_file_id, class_name, confidence")
               .in_("audio_file_id", file_ids).execute().data)
    per_file: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for c in all_cls:
        per_file[c["audio_file_id"]][c["class_name"]].append(c["confidence"])

    manifest = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            data = client.storage.from_(config.AUDIO_BUCKET).download(f["storage_path"])
            arcname = f"audio/{f['id']}.wav"
            z.writestr(arcname, data)

            means = {k: sum(v) / len(v) for k, v in per_file.get(f["id"], {}).items()}
            top = max(means, key=means.get) if means else None
            manifest.append({
                "file": arcname,
                "original_filename": f["filename"],
                "duration": f["duration"],
                "sample_rate": f["sample_rate"],
                "source": f["source"],
                "uploaded_at": f["uploaded_at"],
                "label": top,
                "label_confidence": round(means[top], 4) if top else None,
            })

        if manifest_format in ("json", "both"):
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
        if manifest_format in ("csv", "both"):
            csv_buf = io.StringIO()
            writer = csv.DictWriter(csv_buf, fieldnames=list(manifest[0].keys()))
            writer.writeheader()
            writer.writerows(manifest)
            z.writestr("manifest.csv", csv_buf.getvalue())

    buf.seek(0)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in dataset["name"])
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'})
