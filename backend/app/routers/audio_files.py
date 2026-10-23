import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from .. import audio, clips, config, labels, media, segments
from ..auth import User, current_user
from ..db import get_client

router = APIRouter(tags=["audio"])


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
    source: str | None = Query(None, pattern="^(upload|device|recording)$"),
    status: str | None = Query(None, pattern="^(pending|processing|done|error)$"),
    review_status: str | None = Query(
        None, pattern="^(unreviewed|approved|rejected)$",
        description="Human verdict — filter the review queue"),
    dataset_id: str | None = Query(None, description="Only files in this dataset (folder)"),
    date_from: str | None = Query(None, description="ISO date, inclusive"),
    date_to: str | None = Query(None, description="ISO date, exclusive"),
    kind: Literal["all", "recordings", "clips"] = Query(
        "all", description="recordings = stored originals, clips = cut from a recording"),
    parent_id: str | None = Query(None, description="Only the clips cut from this recording"),
    device_id: str | None = Query(None, description="Only audio sent by this device"),
    min_duration: float | None = Query(None, ge=0, description="Seconds, inclusive"),
    max_duration: float | None = Query(None, ge=0, description="Seconds, inclusive"),
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
    if kind == "recordings":
        q_ = q_.is_("parent_id", "null")
    elif kind == "clips":
        q_ = q_.not_.is_("parent_id", "null")
    if parent_id:
        q_ = q_.eq("parent_id", parent_id)
    if device_id:
        q_ = q_.eq("device_id", device_id)
    if min_duration is not None:
        q_ = q_.gte("duration", min_duration)
    if max_duration is not None:
        q_ = q_.lte("duration", max_duration)

    start = (page - 1) * per_page
    res = q_.order("uploaded_at", desc=True).range(start, start + per_page - 1).execute()

    items = res.data
    parent_ids = list({i["parent_id"] for i in items if i.get("parent_id")})
    parents = ({r["id"]: r["filename"] for r in client.table("audio_files")
                .select("id, filename").in_("id", parent_ids).execute().data}
               if parent_ids else {})
    for item in items:
        item["parent_filename"] = parents.get(item.get("parent_id"))
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

    top_classes = labels.class_ranking(classifications)[:5]

    metadata = (client.table("metadata").select("key, value")
                .eq("audio_file_id", audio_id).execute().data)

    datasets = (client.table("dataset_items").select("datasets(id, name, labels)")
                .eq("audio_file_id", audio_id).execute().data)

    parent = None
    if row.get("parent_id"):
        p = media.parent_of(client, row)
        parent = {"id": p["id"], "filename": p["filename"], "duration": p["duration"]}
    children = (client.table("audio_files")
                .select("id, clip_start, clip_end, duration, review_status, verified_label, "
                        "label_origin")
                .eq("parent_id", audio_id).order("clip_start").execute().data)
    child_pred = labels.predicted_labels(client, [c["id"] for c in children])
    for c in children:
        c["label"], c["label_source"] = labels.final_label(c, child_pred.get(c["id"]))

    # top_classes is already ranked by mean confidence, which is exactly the rule
    # labels.predicted_labels applies — reuse it instead of re-querying.
    predicted = ((top_classes[0]["class_name"], top_classes[0]["mean_confidence"])
                 if top_classes else None)
    label, label_source = labels.final_label(row, predicted)

    return {
        **row,
        "download_url": media.playback_url(client, row),     # for the player
        "file_url": media.file_link(audio_id, download=True),  # always a WAV
        "parent": parent,
        "clips": children,
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
    if row["storage_path"]:            # a clip has no object of its own
        client.storage.from_(config.AUDIO_BUCKET).remove([row["storage_path"]])
        media.forget(row["storage_path"])
    # Clips cut from this recording cascade with it (parent_id ON DELETE CASCADE).
    client.table("audio_files").delete().eq("id", audio_id).execute()


# ---------------------------------------------------------------- file access

@router.get("/audio/{audio_id}/file", summary="Audio as WAV, through a signed link",
            response_class=Response)
def audio_file(audio_id: str, exp: int, sig: str, download: bool = False):
    """The link comes from `GET /audio/{id}` (`download_url` for clips,
    `file_url` for every item). No Authorization header — an <audio> element
    cannot send one — the signature is the authorisation."""
    media.verify_link(audio_id, exp, sig)
    client = get_client()
    rows = (client.table("audio_files")
            .select("id, filename, storage_path, parent_id, clip_start, clip_end")
            .eq("id", audio_id).execute().data)
    if not rows:
        raise HTTPException(404, "audio file not found")
    row = rows[0]
    stem = clips.safe_stem(re.sub(r"\.[A-Za-z0-9]+$", "", row["filename"]), "audio")
    disposition = "attachment" if download else "inline"
    return Response(media.wav_bytes(client, row), media_type="audio/wav", headers={
        "Content-Disposition": f'{disposition}; filename="{stem}.wav"',
        "Cache-Control": "private, max-age=3600",
    })


# ---------------------------------------------------------------- split into clips

class SplitPreview(BaseModel):
    mode: Literal["auto", "fixed"]
    length: float = Field(5.0, ge=segments.MIN_CLIP_SECONDS, le=600,
                          description="fixed: seconds per clip")
    min_length: float = Field(1.0, ge=0.5, le=60,
                              description="auto: shorter stretches fold into a neighbour")
    skip_silence: bool = Field(True, description="auto: leave out stretches YAMNet hears as silence")
    keep_short_last: bool = Field(False, description="fixed: keep a final clip shorter than length")


class Segment(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class ClipCreate(BaseModel):
    segments: list[Segment] = Field(min_length=1, max_length=segments.MAX_CLIPS)
    inherit_label: bool = Field(False, description=(
        "Give every clip the recording's human label, approved. Right for a "
        "recording of one sound chopped into equal parts; leave off when the "
        "clips may hold different sounds."))
    replace_in_folders: bool = Field(True, description=(
        "Clips take the recording's place in its folders, so an export never "
        "holds the same audio twice"))
    dataset_id: str | None = Field(None, description="Also add the clips to this folder")


def _classification_rows(client, audio_id: str) -> list[dict]:
    return (client.table("classifications")
            .select("class_name, confidence, window_start, window_end")
            .eq("audio_file_id", audio_id).execute().data)


@router.post("/audio/{audio_id}/segments",
             summary="Preview where a recording would be cut into clips")
def preview_segments(audio_id: str, body: SplitPreview, user: User = Depends(current_user)):
    client = get_client()
    row = get_owned_audio(client, audio_id, user, "id, duration")
    rows = _classification_rows(client, audio_id)
    if body.mode == "auto":
        segs = segments.auto(rows, row["duration"], body.min_length, body.skip_silence)
    else:
        segs = segments.fixed(rows, row["duration"], body.length, body.keep_short_last)
    return {"duration": row["duration"], "segments": segs}


def _overlap(ranges: list[list[float]], start: float, end: float) -> list[list[float]]:
    """Redacted stretches inside [start, end), shifted to start at 0."""
    out = []
    for s, e in ranges or []:
        a, b = max(s, start), min(e, end)
        if b > a:
            out.append([round(a - start, 2), round(b - start, 2)])
    return out


@router.post("/audio/{audio_id}/clips", status_code=201,
             summary="Cut a recording (or a clip) into clips")
def create_clips(audio_id: str, body: ClipCreate, user: User = Depends(current_user)):
    """Each clip is virtual — a pointer to a stretch of the stored recording —
    so splitting costs no storage and no quota. Its classifications are the
    recording's windows that fall inside it, so no audio is re-analysed;
    every clip starts unreviewed unless `inherit_label` is set."""
    from .datasets import attach_to_dataset

    client = get_client()
    row = get_owned_audio(client, audio_id, user)
    ranges = segments.validate([(s.start, s.end) for s in body.segments], row["duration"])

    # A clip of a clip still points at the stored recording, with absolute times.
    root_id = row["parent_id"] or row["id"]
    offset = row["clip_start"] or 0.0
    waveform = media.samples(client, row)
    rows = _classification_rows(client, audio_id)

    stem = clips.safe_stem(re.sub(r"\.[A-Za-z0-9]+$", "", row["filename"]), "clip")
    inherit = bool(body.inherit_label and row.get("verified_label"))
    recorded = row.get("recorded_at")
    new_rows, class_rows, created = [], [], []
    for start, end in ranges:
        clip_id = str(uuid.uuid4())
        piece = waveform[int(start * audio.SAMPLE_RATE):int(end * audio.SAMPLE_RATE)]
        redacted = _overlap(row.get("privacy_redactions"), start, end)
        new_rows.append({
            "id": clip_id, "user_id": user.id, "parent_id": root_id,
            "clip_start": round(offset + start, 3), "clip_end": round(offset + end, 3),
            "filename": f"{stem}_{start:.1f}-{end:.1f}s.wav",
            "storage_path": None, "duration": round(end - start, 3),
            "sample_rate": audio.SAMPLE_RATE, "file_size": 0,
            "source": row["source"], "status": "done",
            "waveform": audio.waveform_peaks(piece),
            "device_id": row.get("device_id"),
            "recorded_at": ((datetime.fromisoformat(recorded) + timedelta(seconds=start)).isoformat()
                            if recorded else None),
            "latitude": row.get("latitude"), "longitude": row.get("longitude"),
            "location_accuracy": row.get("location_accuracy"),
            "location_name": row.get("location_name"),
            "privacy_redactions": redacted,
            "speech_removed_seconds": round(sum(b - a for a, b in redacted), 2),
            **({"verified_label": row["verified_label"], "label_origin": row["label_origin"],
                "review_status": "approved", "reviewed_by": user.email,
                "reviewed_at": clips.now_iso()} if inherit else {}),
        })
        for r in segments.windows_in(rows, start, end):
            class_rows.append({
                "audio_file_id": clip_id, "class_name": r["class_name"],
                "confidence": r["confidence"],
                "window_start": round(max(0.0, r["window_start"] - start), 3),
                "window_end": round(min(end - start, r["window_end"] - start), 3),
            })
        created.append({"id": clip_id, "start": start, "end": end})

    for i in range(0, len(new_rows), clips.INSERT_BATCH):
        client.table("audio_files").insert(new_rows[i:i + clips.INSERT_BATCH]).execute()
    for i in range(0, len(class_rows), clips.INSERT_BATCH):
        client.table("classifications").insert(class_rows[i:i + clips.INSERT_BATCH]).execute()

    ids = [c["id"] for c in created]
    folders = [d["dataset_id"] for d in client.table("dataset_items").select("dataset_id")
               .eq("audio_file_id", audio_id).execute().data]
    if body.replace_in_folders and folders:
        for dataset_id in folders:
            attach_to_dataset(client, user, dataset_id, ids)
        client.table("dataset_items").delete().eq("audio_file_id", audio_id).execute()
    if body.dataset_id and not (body.replace_in_folders and body.dataset_id in folders):
        attach_to_dataset(client, user, body.dataset_id, ids)

    predicted = labels.predicted_labels(client, ids)
    for c in created:
        c["label"] = row["verified_label"] if inherit else (predicted.get(c["id"]) or (None,))[0]
    return {"created": len(created), "clips": created,
            "replaced_in": folders if body.replace_in_folders else []}
