import os

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from .. import audio, clips
from ..auth import User, current_user
from ..db import get_client
from .datasets import attach_to_dataset

router = APIRouter(tags=["upload"])

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}


@router.post("/upload", status_code=201,
             summary="Upload an audio file (WAV/MP3/FLAC/OGG)")
async def upload_audio(background: BackgroundTasks,
                       file: UploadFile = File(...),
                       dataset_id: str | None = Form(None, description="Also add it to this dataset"),
                       user: User = Depends(current_user)):
    """Validates and standardizes the file to WAV 16kHz mono 16-bit, stores it
    in Supabase Storage, inserts an `audio_files` row (status=pending), and
    queues YAMNet classification as a background task."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, f"unsupported file type '{ext}' — "
                                 f"allowed: {sorted(ALLOWED_EXTENSIONS)}")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    if len(raw) > clips.MAX_BYTES:
        raise HTTPException(413, "file exceeds 50 MB limit")

    try:
        waveform = audio.decode_to_standard(raw)
    except Exception:
        raise HTTPException(400, "could not decode audio — file corrupt or not audio")

    client = get_client()
    row = clips.create_clip(client, background, waveform=waveform, user_id=user.id,
                            filename=file.filename, source="upload", folder="uploads")
    if dataset_id:
        attach_to_dataset(client, user, dataset_id, [row["id"]])
    return row
