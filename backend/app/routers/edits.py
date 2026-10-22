"""Editing sounds — the editor's workflow on top of the library.

A sound editor's job (the supervisor's example): find a Porsche in Community,
keep the 10 s that matter, label it, and if the scene needs 40 s, extend it.

  trim    a stretch of your own audio  -> a virtual clip (POST /audio/{id}/clips)
  loop    repeat a stretch to a length -> a new stored file, edit_kind = loop
  merge   several clips end to end     -> a new stored file, edit_kind = merge
  save    a stretch of someone else's public clip into your library
          (optionally looped)          -> a new stored file, edit_kind = copy|loop,
                                          with the author and licence kept

Looped and merged audio is synthetic — the same seconds repeated or stitched —
so it is flagged and left out of dataset exports unless asked for: training on
it would make a dataset look bigger than the sound it really holds.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .. import audio, clips, config, labels, media, segments
from ..auth import User, current_user
from ..db import get_client
from .audio_files import get_owned_audio
from .datasets import LICENSES, attach_to_dataset

router = APIRouter(tags=["edit"])

PER_PAGE = 24


class Stretch(BaseModel):
    start: float | None = Field(None, ge=0, description="Seconds into the sound; default 0")
    end: float | None = Field(None, gt=0, description="Default: the end of the sound")


class LoopBody(Stretch):
    seconds: float = Field(gt=0, le=config.MAX_UPLOAD_SECONDS, description="Target length")
    crossfade: float = Field(0.3, ge=0, le=2)
    label: str | None = Field(None, max_length=60)
    dataset_id: str | None = None


class MergeBody(BaseModel):
    audio_ids: list[str] = Field(min_length=2, max_length=50, description="In playing order")
    crossfade: float = Field(0.3, ge=0, le=2)
    label: str | None = Field(None, max_length=60)
    dataset_id: str | None = None


class SaveBody(Stretch):
    label: str = Field(min_length=1, max_length=60)
    loop_to: float | None = Field(None, gt=0, le=config.MAX_UPLOAD_SECONDS,
                                  description="Also extend it to this many seconds")
    crossfade: float = Field(0.3, ge=0, le=2)
    dataset_id: str | None = None


def _stretch(samples, body: Stretch, duration: float):
    start = body.start or 0.0
    end = min(body.end or duration, duration)
    (start, end), = segments.validate([(start, end)], duration)
    return samples[int(start * audio.SAMPLE_RATE):int(end * audio.SAMPLE_RATE)], start, end


def _label_fields(user: User, label: str | None, source: dict | None) -> dict:
    """A label typed in the editor is a reviewed label; otherwise the source's
    verdict carries over."""
    if label and label.strip():
        return {"verified_label": label.strip(), "label_origin": "review",
                "review_status": "approved", "reviewed_by": user.email,
                "reviewed_at": clips.now_iso()}
    if source and source.get("verified_label"):
        return {k: source.get(k) for k in ("verified_label", "label_origin", "review_status",
                                           "reviewed_by", "reviewed_at")}
    return {}


def _store(client, user: User, waveform, *, filename: str, kind: str, derived_from: list[str],
           label_fields: dict, attribution: dict | None, dataset_id: str | None) -> dict:
    clips.check_length(waveform.size / audio.SAMPLE_RATE, config.MAX_UPLOAD_SECONDS,
                       "the edited sound")
    row = clips.create_clip(
        client, waveform=waveform, user_id=user.id, filename=filename, source="upload",
        folder=f"edits/{user.id}",
        extra={"edit_kind": kind, "derived_from": derived_from, "attribution": attribution,
               **label_fields})
    if dataset_id:
        attach_to_dataset(client, user, dataset_id, [row["id"]])
    return row


@router.post("/audio/{audio_id}/loop", status_code=201,
             summary="Extend a stretch of your audio to a length by looping it")
async def loop_audio(audio_id: str, body: LoopBody, user: User = Depends(current_user)):
    client = get_client()
    row = get_owned_audio(client, audio_id, user)
    samples = await run_in_threadpool(media.samples, client, row)
    piece, start, end = _stretch(samples, body, row["duration"])
    if body.seconds <= end - start:
        raise HTTPException(400, "the target length must be longer than the selection — "
                                 "to shorten a sound, cut a clip instead")
    looped = audio.loop_to(piece, body.seconds, body.crossfade)
    stem = clips.safe_stem(body.label or row.get("verified_label") or row["filename"], "loop")
    return await run_in_threadpool(
        _store, client, user, looped, filename=f"{stem}_loop_{body.seconds:.0f}s.wav",
        kind="loop", derived_from=[audio_id], label_fields=_label_fields(user, body.label, row),
        attribution=row.get("attribution"), dataset_id=body.dataset_id)


@router.post("/audio/merge", status_code=201, summary="Join several of your clips into one sound")
async def merge_audio(body: MergeBody, user: User = Depends(current_user)):
    client = get_client()
    rows = (client.table("audio_files").select("*").in_("id", body.audio_ids)
            .eq("user_id", user.id).execute().data)
    by_id = {r["id"]: r for r in rows}
    missing = [i for i in body.audio_ids if i not in by_id]
    if missing:
        raise HTTPException(404, f"audio files not found: {missing}")
    total = sum(by_id[i]["duration"] for i in body.audio_ids)
    clips.check_length(total, config.MAX_UPLOAD_SECONDS, "the merged sound")

    pieces = [await run_in_threadpool(media.samples, client, by_id[i]) for i in body.audio_ids]
    merged = audio.join(pieces, body.crossfade)
    first = by_id[body.audio_ids[0]]
    stem = clips.safe_stem(body.label or first.get("verified_label") or "merged", "merged")
    credits = [r["attribution"] for r in rows if r.get("attribution")]
    return await run_in_threadpool(
        _store, client, user, merged, filename=f"{stem}_merged_{len(pieces)}.wav",
        kind="merge", derived_from=body.audio_ids,
        label_fields=_label_fields(user, body.label, first),
        attribution=credits[0] if len(credits) == 1 else ({"sources": credits} if credits else None),
        dataset_id=body.dataset_id)


# ---------------------------------------------------------------- Community clips

def _public_items(client, audio_ids: list[str] | None = None):
    """dataset_items of listed public datasets, with the audio and the dataset."""
    q = (client.table("dataset_items")
         .select("audio_file_id, datasets!inner(id, name, license, user_id, visibility, hidden_at), "
                 "audio_files!inner(id, filename, duration, source, verified_label, label_origin, "
                 "review_status, storage_path, parent_id, clip_start, clip_end, edit_kind, "
                 "uploaded_at, recorded_at, location_name, waveform)")
         .eq("datasets.visibility", "public").is_("datasets.hidden_at", "null")
         .neq("audio_files.review_status", "rejected"))
    if audio_ids is not None:
        q = q.in_("audio_file_id", audio_ids)
    return q.execute().data


@router.get("/community/clips", summary="Search single sounds across public datasets")
def search_clips(q: str | None = Query(None, max_length=100),
                 min_duration: float | None = Query(None, ge=0),
                 max_duration: float | None = Query(None, ge=0),
                 page: int = Query(1, ge=1),
                 user: User = Depends(current_user)):
    """Finds individual sounds by label, so an editor looking for "Porsche" gets
    the clips themselves rather than the datasets that hold them."""
    client = get_client()
    items = _public_items(client)
    term = (q or "").strip().lower()

    seen, rows = set(), []
    for it in items:
        a, d = it["audio_files"], it["datasets"]
        if a["id"] in seen or a.get("edit_kind") in ("loop", "merge"):
            continue
        rows.append((a, d))
        seen.add(a["id"])

    predicted = labels.predicted_labels(client, [a["id"] for a, _ in rows])
    hits = []
    for a, d in rows:
        label, source = labels.final_label(a, predicted.get(a["id"]))
        if not label:
            continue
        if term and term not in label.lower() and term not in (d["name"] or "").lower():
            continue
        if min_duration is not None and a["duration"] < min_duration:
            continue
        if max_duration is not None and a["duration"] > max_duration:
            continue
        hits.append((a, d, label, source))

    # Newest first, then human-labelled sounds ahead of unverified guesses.
    hits.sort(key=lambda h: h[0]["recorded_at"] or h[0]["uploaded_at"] or "", reverse=True)
    hits.sort(key=lambda h: h[3] == "auto")
    total = len(hits)
    page_hits = hits[(page - 1) * PER_PAGE: page * PER_PAGE]

    owners = {p["id"]: p["username"] for p in client.table("profiles").select("id, username")
              .in_("id", list({d["user_id"] for _, d, _, _ in page_hits}) or [""]).execute().data}
    out = []
    for a, d, label, source in page_hits:
        out.append({
            "id": a["id"], "label": label, "label_source": source, "duration": a["duration"],
            "dataset": {"id": d["id"], "name": d["name"]},
            "author": owners.get(d["user_id"], "unknown"),
            "license": d["license"], "license_name": LICENSES.get(d["license"] or ""),
            "is_mine": d["user_id"] == user.id,
            "url": media.playback_url(client, a),
            "waveform": a.get("waveform") or [],
        })
    return {"items": out, "total": total, "page": page, "per_page": PER_PAGE}


def public_clip(client, audio_id: str) -> tuple[dict, dict, str]:
    """(audio row, dataset, author username) for a clip in a listed public dataset."""
    items = _public_items(client, [audio_id])
    if not items:
        raise HTTPException(404, "sound not found in any public dataset")
    a, d = items[0]["audio_files"], items[0]["datasets"]
    owner = client.table("profiles").select("username").eq("id", d["user_id"]).execute().data
    return a, d, owner[0]["username"] if owner else "unknown"


@router.get("/community/clips/{audio_id}", summary="One public sound, for the editor")
def get_public_clip(audio_id: str, user: User = Depends(current_user)):
    client = get_client()
    a, d, author = public_clip(client, audio_id)
    label, source = labels.final_label(
        a, labels.predicted_labels(client, [audio_id]).get(audio_id))
    return {"id": a["id"], "label": label, "label_source": source, "duration": a["duration"],
            "waveform": a.get("waveform") or [], "url": media.playback_url(client, a),
            "dataset": {"id": d["id"], "name": d["name"]}, "author": author,
            "license": d["license"], "license_name": LICENSES.get(d["license"] or "")}


@router.post("/community/clips/{audio_id}/save", status_code=201,
             summary="Save a stretch of a public sound into your library")
async def save_public_clip(audio_id: str, body: SaveBody, user: User = Depends(current_user)):
    """The copy keeps who made the sound and under which licence (`attribution`),
    and exports credit them. Every licence SODAMA offers allows edits, provided
    the author is credited."""
    client = get_client()
    a, d, author = public_clip(client, audio_id)
    samples = await run_in_threadpool(media.samples, client, a)
    piece, start, end = _stretch(samples, body, a["duration"])
    kind = "copy"
    if body.loop_to:
        if body.loop_to <= end - start:
            raise HTTPException(400, "the target length must be longer than the selection")
        piece = audio.loop_to(piece, body.loop_to, body.crossfade)
        kind = "loop"
    attribution = {"author": author, "license": d["license"], "dataset_id": d["id"],
                   "dataset_name": d["name"], "audio_id": audio_id,
                   "start": round(start, 3), "end": round(end, 3)}
    stem = clips.safe_stem(body.label, "sound")
    suffix = f"_loop_{body.loop_to:.0f}s" if body.loop_to else ""
    return await run_in_threadpool(
        _store, client, user, piece, filename=f"{stem}{suffix}.wav", kind=kind,
        derived_from=[audio_id], label_fields=_label_fields(user, body.label, None),
        attribution=attribution, dataset_id=body.dataset_id)
