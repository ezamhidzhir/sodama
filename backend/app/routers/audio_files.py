import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import config, labels
from ..auth import User, current_user
from ..db import get_client

router = APIRouter(tags=["audio"])

SIGNED_URL_TTL = 3600  # seconds


def get_owned_audio(client, audio_id: str, user: User, columns: str = "*") -> dict:
    """The file, if it belongs to `user`. Someone else's file is a 404, not a
    403 — its existence is none of the caller's business."""
    rows = (client.table("audio_files").select(columns)
            .eq("id", audio_id).eq("user_id", user.id).execute().data)
    if not rows:
        raise HTTPException(404, "audio file not found")
    return rows[0]


@router.get("/audio", summary="List your audio files (paginated, filterable)")
def list_audio(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, max_length=100, description="Search filename or label"),
    class_name: str | None = Query(None, description="Filter: YAMNet class, e.g. 'Speech'"),
    min_confidence: float | None = Query(None, ge=0, le=1),
    source: str | None = Query(None, pattern="^(upload|esp32|recording)$"),
    status: str | None = Query(None, pattern="^(pending|processing|done|error)$"),
    review_status: str | None = Query(
        None, pattern="^(unreviewed|approved|rejected)$",
        description="Human verdict — filter the review queue"),
    dataset_id: str | None = Query(None, description="Only files in this dataset (folder)"),
    date_from: str | None = Query(None, description="ISO date, inclusive"),
    date_to: str | None = Query(None, description="ISO date, exclusive"),
    user: User = Depends(current_user),
):
    client = get_client()
    embeds = []
    if class_name or min_confidence is not None:
        # inner join so only files with matching classification rows survive
        embeds.append("classifications!inner(class_name, confidence)")
    else:
        embeds.append("classifications(class_name, confidence)")
    if dataset_id:
        embeds.append("dataset_items!inner(dataset_id)")

    q_ = client.table("audio_files").select("*, " + ", ".join(embeds), count="exact") \
        .eq("user_id", user.id)
    if class_name:
        q_ = q_.eq("classifications.class_name", class_name)
    if min_confidence is not None:
        q_ = q_.gte("classifications.confidence", min_confidence)
    if dataset_id:
        q_ = q_.eq("dataset_items.dataset_id", dataset_id)
    # embed only the single highest-confidence row -> becomes top_class below
    q_ = q_.order("confidence", desc=True, foreign_table="classifications") \
           .limit(1, foreign_table="classifications")

    if q:
        # PostgREST's or=() syntax treats , ( ) and * as structure — strip them
        term = re.sub(r'[,()*%\\"]', " ", q).strip()
        if term:
            q_ = q_.or_(",".join(f'{col}.ilike."*{term}*"'
                                 for col in ("filename", "verified_label", "location_name")))
    if source:
        q_ = q_.eq("source", source)
    if status:
        q_ = q_.eq("status", status)
    if review_status:
        q_ = q_.eq("review_status", review_status)
    if date_from:
        q_ = q_.gte("uploaded_at", date_from)
    if date_to:
        q_ = q_.lt("uploaded_at", date_to)

    start = (page - 1) * per_page
    res = q_.order("uploaded_at", desc=True).range(start, start + per_page - 1).execute()

    items = res.data
    for item in items:
        top = item.pop("classifications", None)
        item["top_class"] = top[0] if top else None
        item.pop("waveform", None)  # keep list responses light
        item.pop("dataset_items", None)
    return {"items": items, "total": res.count, "page": page, "per_page": per_page}


@router.get("/audio/{audio_id}", summary="Audio detail + waveform + classifications")
def get_audio(audio_id: str, user: User = Depends(current_user)):
    client = get_client()
    row = get_owned_audio(client, audio_id, user)

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

    datasets = (client.table("dataset_items").select("datasets(id, name, labels)")
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
        "datasets": [d["datasets"] for d in datasets if d.get("datasets")],
        "predicted_label": predicted[0] if predicted else None,
        "predicted_confidence": predicted[1] if predicted else None,
        "label": label,
        "label_source": label_source,
    }


class ReviewUpdate(BaseModel):
    review_status: Literal["unreviewed", "approved", "rejected"]
    verified_label: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)


class BulkReview(ReviewUpdate):
    audio_file_ids: list[str]


def _review_patch(body: ReviewUpdate, current: dict, predicted: tuple[str, float] | None,
                  reviewer: str) -> dict:
    """Build the column update for one file's verdict."""
    if body.review_status == "unreviewed":
        # Reopening a file clears the human verdict, so the export falls back to
        # YAMNet's guess and label_source honestly reads "auto" again.
        return {"review_status": "unreviewed", "verified_label": None, "label_origin": None,
                "reviewed_by": None, "reviewed_at": None, "review_note": None}

    typed = (body.verified_label or "").strip() or None
    patch = {
        "review_status": body.review_status,
        "reviewed_by": reviewer,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "review_note": (body.note or "").strip() or current.get("review_note"),
    }
    if typed:
        patch["verified_label"] = typed
        # Typing the same label a recording already carries keeps its origin;
        # anything else is now a reviewer's decision.
        same = typed == current.get("verified_label")
        patch["label_origin"] = current.get("label_origin") if same else "review"
    elif body.review_status == "approved" and not current.get("verified_label"):
        # Approving without typing a label means "YAMNet got it right" — store the
        # prediction explicitly so the manifest never has to guess later.
        patch["verified_label"] = predicted[0] if predicted else None
        patch["label_origin"] = "review" if predicted else None
    # Otherwise an existing human label is kept: approving a recording labelled
    # "Honda" must not overwrite it with YAMNet's "Vehicle".
    return patch


@router.patch("/audio/{audio_id}/review", summary="Approve, correct or reject a label")
def review_audio(audio_id: str, body: ReviewUpdate, user: User = Depends(current_user)):
    """Records the human verdict on a file's label — the review step between
    auto-classification and export."""
    client = get_client()
    current = get_owned_audio(client, audio_id, user,
                              "id, verified_label, label_origin, review_note")
    predicted = labels.predicted_labels(client, [audio_id]).get(audio_id)
    patch = _review_patch(body, current, predicted, user.email)
    return client.table("audio_files").update(patch).eq("id", audio_id).execute().data[0]


@router.post("/audio/review", summary="Review many files at once")
def review_audio_bulk(body: BulkReview, user: User = Depends(current_user)):
    """Bulk verdict for the Library's selection. Approving in bulk resolves each
    file's own label, so a mixed selection still gets per-file labels."""
    if not body.audio_file_ids:
        raise HTTPException(400, "audio_file_ids is empty")

    client = get_client()
    found = (client.table("audio_files").select("id, verified_label, label_origin, review_note")
             .in_("id", body.audio_file_ids).eq("user_id", user.id).execute().data)
    if not found:
        raise HTTPException(404, "none of the given audio files exist")

    predicted = labels.predicted_labels(client, [r["id"] for r in found])
    for row in found:
        client.table("audio_files") \
            .update(_review_patch(body, row, predicted.get(row["id"]), user.email)) \
            .eq("id", row["id"]).execute()

    return {"updated": len(found), "review_status": body.review_status,
            "skipped": len(body.audio_file_ids) - len(found)}


@router.delete("/audio/{audio_id}", status_code=204, summary="Delete audio file")
def delete_audio(audio_id: str, user: User = Depends(current_user)):
    client = get_client()
    row = get_owned_audio(client, audio_id, user, "storage_path")
    client.storage.from_(config.AUDIO_BUCKET).remove([row["storage_path"]])
    client.table("audio_files").delete().eq("id", audio_id).execute()
