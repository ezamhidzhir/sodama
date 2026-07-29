from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import config, labels
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
    review_status: str | None = Query(
        None, pattern="^(unreviewed|approved|rejected)$",
        description="Human verdict — filter the review queue"),
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
    if review_status:
        q = q.eq("review_status", review_status)
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

    # top_classes is already ranked by mean confidence, which is exactly the rule
    # labels.predicted_labels applies — reuse it instead of re-querying.
    predicted = ((top_classes[0]["class_name"], top_classes[0]["mean_confidence"])
                 if top_classes else None)
    label, label_source = labels.final_label(row, predicted)

    return {
        **row,
        "download_url": signed.get("signedURL") or signed.get("signedUrl"),
        "top_classes": top_classes,
        "classifications": classifications,
        "metadata": {m["key"]: m["value"] for m in metadata},
        "predicted_label": predicted[0] if predicted else None,
        "predicted_confidence": predicted[1] if predicted else None,
        "label": label,
        "label_source": label_source,
    }


class ReviewUpdate(BaseModel):
    review_status: Literal["unreviewed", "approved", "rejected"]
    verified_label: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)
    reviewed_by: str | None = Field(
        default=None, max_length=320,
        description="Reviewer's email. Sent by the client — see the auth caveat in the decision log.")


class BulkReview(ReviewUpdate):
    audio_file_ids: list[str]


def _review_patch(body: ReviewUpdate, predicted: tuple[str, float] | None) -> dict:
    """Build the column update for one file's verdict."""
    if body.review_status == "unreviewed":
        # Reopening a file clears the human verdict, so the export falls back to
        # YAMNet's guess and label_source honestly reads "auto" again.
        return {"review_status": "unreviewed", "verified_label": None,
                "reviewed_by": None, "reviewed_at": None, "review_note": None}

    chosen = (body.verified_label or "").strip() or None
    if body.review_status == "approved" and not chosen:
        # Approving without typing a label means "YAMNet got it right" — store the
        # prediction explicitly so the manifest never has to guess later.
        chosen = predicted[0] if predicted else None

    return {
        "review_status": body.review_status,
        "verified_label": chosen,          # stays NULL on a reject with no label
        "reviewed_by": body.reviewed_by,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "review_note": (body.note or "").strip() or None,
    }


@router.patch("/audio/{audio_id}/review", summary="Approve, correct or reject a label")
def review_audio(audio_id: str, body: ReviewUpdate):
    """Records the human verdict on a file's label — the review step between
    auto-classification and export."""
    client = get_client()
    rows = client.table("audio_files").select("id").eq("id", audio_id).execute().data
    if not rows:
        raise HTTPException(404, "audio file not found")

    predicted = labels.predicted_labels(client, [audio_id]).get(audio_id)
    patch = _review_patch(body, predicted)
    return client.table("audio_files").update(patch).eq("id", audio_id).execute().data[0]


@router.post("/audio/review", summary="Review many files at once")
def review_audio_bulk(body: BulkReview):
    """Bulk verdict for the Library's selection. Approving in bulk resolves each
    file's own prediction, so a mixed selection still gets per-file labels."""
    if not body.audio_file_ids:
        raise HTTPException(400, "audio_file_ids is empty")

    client = get_client()
    found = client.table("audio_files").select("id") \
        .in_("id", body.audio_file_ids).execute().data
    found_ids = [r["id"] for r in found]
    if not found_ids:
        raise HTTPException(404, "none of the given audio files exist")

    predicted = labels.predicted_labels(client, found_ids)
    if body.review_status == "unreviewed" or body.verified_label:
        # One identical patch for every row — a single round-trip covers it.
        patch = _review_patch(body, None)
        client.table("audio_files").update(patch).in_("id", found_ids).execute()
    else:
        for file_id in found_ids:
            client.table("audio_files") \
                .update(_review_patch(body, predicted.get(file_id))) \
                .eq("id", file_id).execute()

    return {"updated": len(found_ids), "review_status": body.review_status,
            "skipped": len(body.audio_file_ids) - len(found_ids)}


@router.delete("/audio/{audio_id}", status_code=204, summary="Delete audio file")
def delete_audio(audio_id: str):
    client = get_client()
    rows = client.table("audio_files").select("storage_path").eq("id", audio_id).execute().data
    if not rows:
        raise HTTPException(404, "audio file not found")
    client.storage.from_(config.AUDIO_BUCKET).remove([rows[0]["storage_path"]])
    client.table("audio_files").delete().eq("id", audio_id).execute()
