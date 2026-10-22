"""In-app recording — capture a sound on a phone and label it on the spot.

The recordist knows what the sound is ("that was a Honda Civic"), which is a far
better label than anything YAMNet can offer for a fine-grained class. So a
recording arrives already labelled and approved, with `label_origin = capture`.
YAMNet still runs on it: its coarse class ("Vehicle", "Car") is a useful sanity
check — a "Honda" clip that YAMNet hears as "Speech" is worth a second listen.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import audio, clips, config, labels
from ..auth import User, current_user
from ..db import get_client
from .datasets import attach_to_dataset, get_owned_dataset

router = APIRouter(tags=["recordings"])

MIN_SECONDS = 0.5


def _parse_time(value: str | None) -> str:
    """The phone's capture time, trusted only if it is plausible."""
    now = datetime.now(timezone.utc)
    if not value:
        return now.isoformat()
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "recorded_at must be an ISO timestamp")
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    # A skewed phone clock can be a few minutes ahead; a day is not a skew.
    if (t - now).total_seconds() > 600 or (now - t).days > 30:
        return now.isoformat()
    return t.isoformat()


@router.post("/recordings", status_code=201,
             summary="Save a clip recorded in the app, with its label and capture metadata")
async def create_recording(
    file: UploadFile = File(..., description="The recording (WAV preferred)"),
    label: str | None = Form(None, max_length=60, description="What the sound is, e.g. Honda"),
    dataset_id: str | None = Form(None, description="Folder (dataset) to save it into"),
    recorded_at: str | None = Form(None, description="ISO time the recording started"),
    latitude: float | None = Form(None, ge=-90, le=90),
    longitude: float | None = Form(None, ge=-180, le=180),
    location_accuracy: float | None = Form(None, ge=0),
    location_name: str | None = Form(None, max_length=200),
    notes: str | None = Form(None, max_length=500),
    recording_device: str | None = Form(None, max_length=80,
                                        description="e.g. 'Android phone · Chrome'"),
    user: User = Depends(current_user),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty recording")
    if len(raw) > clips.MAX_BYTES:
        raise HTTPException(413, "recording exceeds 50 MB")
    try:
        waveform = await run_in_threadpool(audio.decode_to_standard, raw)
    except Exception:
        raise HTTPException(400, "could not decode the recording")
    if waveform.size < MIN_SECONDS * audio.SAMPLE_RATE:
        raise HTTPException(400, f"recording is shorter than {MIN_SECONDS} s")
    clips.check_length(waveform.size / audio.SAMPLE_RATE, config.MAX_RECORDING_SECONDS,
                       "this recording")
    if (latitude is None) != (longitude is None):
        raise HTTPException(400, "send latitude and longitude together")

    client = get_client()
    dataset = get_owned_dataset(client, dataset_id, user) if dataset_id else None

    clean_label = None
    if label and label.strip():
        clean_label = labels.canonical_label(label, (dataset or {}).get("labels") or [])

    captured = _parse_time(recorded_at)
    stamp = datetime.fromisoformat(captured).strftime("%Y%m%d_%H%M%S")
    extra = {
        "recorded_at": captured,
        "latitude": latitude,
        "longitude": longitude,
        "location_accuracy": location_accuracy,
        "location_name": (location_name or "").strip() or None,
    }
    if clean_label:
        extra.update({
            "verified_label": clean_label,
            "label_origin": "capture",
            "review_status": "approved",
            "reviewed_by": user.email,
            "reviewed_at": clips.now_iso(),
        })

    row = await run_in_threadpool(
        clips.create_clip, client, waveform=waveform, user_id=user.id,
        filename=f"{clips.safe_stem(clean_label or '', 'recording')}_{stamp}.wav",
        source="recording", folder=f"recordings/{user.id}", extra=extra,
        reject_mostly_speech=True)

    meta = {"notes": (notes or "").strip(), "recording_device": (recording_device or "").strip()}
    meta_rows = [{"audio_file_id": row["id"], "key": k, "value": v} for k, v in meta.items() if v]
    if meta_rows:
        client.table("metadata").insert(meta_rows).execute()

    if dataset is not None:
        attach_to_dataset(client, user, dataset["id"], [row["id"]])
        # A new class typed while recording joins the folder's class list, so the
        # next recording offers it as a one-tap choice. Only once the clip is
        # saved — a recording refused by the privacy filter adds nothing.
        if clean_label and clean_label not in dataset["labels"]:
            client.table("datasets").update({"labels": dataset["labels"] + [clean_label]}) \
                .eq("id", dataset["id"]).execute()

    return {**row, "dataset": {"id": dataset["id"], "name": dataset["name"]} if dataset else None}
