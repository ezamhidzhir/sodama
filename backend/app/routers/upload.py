import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import audio, clips, config
from ..auth import User, current_user
from ..db import get_client
from .datasets import attach_to_dataset

router = APIRouter(tags=["upload"])

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}


@router.post("/upload", status_code=201,
             summary="Upload an audio file (WAV/MP3/FLAC/OGG, up to 10 min)")
async def upload_audio(file: UploadFile = File(...),
                       dataset_id: str | None = Form(None, description="Also add it to this dataset"),
                       user: User = Depends(current_user)):
    """Checks the length from the file header before decoding, standardizes to
    16 kHz mono, mutes human speech, stores it as FLAC and classifies it with
    YAMNet — all before answering, so the file is `done` on arrival."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, f"unsupported file type '{ext}' — "
                                 f"allowed: {sorted(ALLOWED_EXTENSIONS)}")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    if len(raw) > clips.MAX_BYTES:
        raise HTTPException(413, "file exceeds 50 MB limit")

    client = get_client()
    declared = audio.duration_of(raw)
    if declared is not None:
        clips.check_length(declared, config.MAX_UPLOAD_SECONDS, "this file")
        await run_in_threadpool(clips.ensure_quota, client, user.id, declared)

    try:
        waveform = await run_in_threadpool(audio.decode_to_standard, raw)
    except Exception:
        raise HTTPException(400, "could not decode audio — file corrupt or not audio")
    clips.check_length(waveform.size / audio.SAMPLE_RATE, config.MAX_UPLOAD_SECONDS, "this file")

    # YAMNet runs here; keep it off the event loop so other requests carry on.
    row = await run_in_threadpool(
        clips.create_clip, client, waveform=waveform, user_id=user.id,
        filename=file.filename, source="upload", folder="uploads",
        reject_mostly_speech=True)
    if dataset_id:
        attach_to_dataset(client, user, dataset_id, [row["id"]])
    return row
