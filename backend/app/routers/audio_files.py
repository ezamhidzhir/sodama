from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query

from .. import config
from ..db import get_client

router = APIRouter(tags=["audio"])

SIGNED_URL_TTL = 3600  # seconds


@router.get("/audio", summary="List audio files (paginated, filterable)")
def list_audio(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    class_name: str | None = Query(None, description="Filter: YAMNet class, e.g. 'Speech'"),
    min_confidence: float | None = Query(None, ge=0, le=1),
    source: str | None = Query(None, pattern="^(upload|esp32)$"),
    status: str | None = Query(None, pattern="^(pending|processing|done|error)$"),
    date_from: str | None = Query(None, description="ISO date, inclusive"),
    date_to: str | None = Query(None, description="ISO date, exclusive"),
):
    client = get_client()

    if class_name or min_confidence is not None:
        # inner join so only files with matching classification rows survive
        q = client.table("audio_files").select(
            "*, classifications!inner(class_name, confidence)", count="exact")
        if class_name:
            q = q.eq("classifications.class_name", class_name)
        if min_confidence is not None:
            q = q.gte("classifications.confidence", min_confidence)
    else:
        q = client.table("audio_files").select(
            "*, classifications(class_name, confidence)", count="exact")
    # embed only the single highest-confidence row -> becomes top_class below
    q = q.order("confidence", desc=True, foreign_table="classifications") \
         .limit(1, foreign_table="classifications")

    if source:
        q = q.eq("source", source)
    if status:
        q = q.eq("status", status)
    if date_from:
        q = q.gte("uploaded_at", date_from)
    if date_to:
        q = q.lt("uploaded_at", date_to)

    start = (page - 1) * per_page
    res = q.order("uploaded_at", desc=True).range(start, start + per_page - 1).execute()

    items = res.data
    for item in items:
        top = item.pop("classifications", None)
        item["top_class"] = top[0] if top else None
        item.pop("waveform", None)  # keep list responses light
    return {"items": items, "total": res.count, "page": page, "per_page": per_page}


@router.get("/audio/{audio_id}", summary="Audio detail + waveform + classifications")
def get_audio(audio_id: str):
    client = get_client()
    rows = client.table("audio_files").select("*").eq("id", audio_id).execute().data
    if not rows:
        raise HTTPException(404, "audio file not found")
    row = rows[0]

    classifications = (client.table("classifications")
                       .select("class_name, confidence, window_start, window_end")
                       .eq("audio_file_id", audio_id)
                       .order("window_start").order("confidence", desc=True)
                       .execute().data)

    # aggregate: mean confidence per class across windows, top 5
    by_class: dict[str, list[float]] = defaultdict(list)
    for c in classifications:
        by_class[c["class_name"]].append(c["confidence"])
    top_classes = sorted(
        ({"class_name": k, "mean_confidence": round(sum(v) / len(v), 4),
          "windows": len(v)} for k, v in by_class.items()),
        key=lambda x: x["mean_confidence"], reverse=True)[:5]

    metadata = (client.table("metadata").select("key, value")
                .eq("audio_file_id", audio_id).execute().data)

    signed = client.storage.from_(config.AUDIO_BUCKET) \
        .create_signed_url(row["storage_path"], SIGNED_URL_TTL)

    return {
        **row,
        "download_url": signed.get("signedURL") or signed.get("signedUrl"),
        "top_classes": top_classes,
        "classifications": classifications,
        "metadata": {m["key"]: m["value"] for m in metadata},
    }


@router.delete("/audio/{audio_id}", status_code=204, summary="Delete audio file")
def delete_audio(audio_id: str):
    client = get_client()
    rows = client.table("audio_files").select("storage_path").eq("id", audio_id).execute().data
    if not rows:
        raise HTTPException(404, "audio file not found")
    client.storage.from_(config.AUDIO_BUCKET).remove([rows[0]["storage_path"]])
    client.table("audio_files").delete().eq("id", audio_id).execute()
