import os
import uuid

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from .. import audio, config, tasks
from ..db import get_client

router = APIRouter(tags=["upload"])

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # matches bucket file_size_limit


@router.post("/upload", status_code=201,
             summary="Upload an audio file (WAV/MP3/FLAC/OGG)")
async def upload_audio(background: BackgroundTasks, file: UploadFile = File(...)):
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
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file exceeds 50 MB limit")

    try:
        waveform = audio.decode_to_standard(raw)
    except Exception:
        raise HTTPException(400, "could not decode audio — file corrupt or not audio")
    if waveform.size == 0:
        raise HTTPException(400, "audio contains no samples")

    wav_bytes = audio.to_wav_bytes(waveform)
    file_id = str(uuid.uuid4())
    storage_path = f"uploads/{file_id}.wav"

    client = get_client()
    client.storage.from_(config.AUDIO_BUCKET).upload(
        storage_path, wav_bytes, {"content-type": "audio/wav"})

    row = client.table("audio_files").insert({
        "id": file_id,
        "filename": file.filename,
        "storage_path": storage_path,
        "duration": round(waveform.size / audio.SAMPLE_RATE, 3),
        "sample_rate": audio.SAMPLE_RATE,
        "file_size": len(wav_bytes),
        "source": "upload",
        "status": "pending",
        "waveform": audio.waveform_peaks(waveform),
    }).execute().data[0]

    background.add_task(tasks.run_classification, file_id, waveform)
    return row
