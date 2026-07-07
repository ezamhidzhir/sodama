import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Request

from .. import audio, config, tasks
from ..db import get_client

router = APIRouter(tags=["ingest"])

MIN_PCM_BYTES = 3200          # 0.1s @ 16kHz 16-bit — reject obviously broken posts
MAX_PCM_BYTES = 50 * 1024 * 1024


@router.post("/ingest", status_code=201,
             summary="ESP32 ingest — raw 16-bit mono PCM body, API-key auth")
async def ingest_pcm(
    request: Request,
    background: BackgroundTasks,
    x_api_key: str = Header(..., description="Device api_key from the devices table"),
    sample_rate: int = Query(16000, ge=8000, le=48000),
):
    """Receives a complete clip as raw little-endian 16-bit mono PCM
    (Content-Type: application/octet-stream, chunked POST supported).
    Resamples to 16kHz if needed, then runs the same pipeline as /upload."""
    client = get_client()

    devices = client.table("devices").select("*").eq("api_key", x_api_key).execute().data
    if not devices:
        raise HTTPException(401, "invalid API key")
    device = devices[0]

    raw = await request.body()
    if len(raw) < MIN_PCM_BYTES:
        raise HTTPException(400, f"PCM payload too small ({len(raw)} bytes)")
    if len(raw) > MAX_PCM_BYTES:
        raise HTTPException(413, "payload exceeds 50 MB limit")
    if len(raw) % 2:
        raw = raw[:-1]  # drop trailing odd byte from a truncated chunk

    waveform = audio.pcm16_to_standard(raw, sample_rate)
    wav_bytes = audio.to_wav_bytes(waveform)

    now = datetime.now(timezone.utc)
    file_id = str(uuid.uuid4())
    filename = f"{device['device_name']}_{now.strftime('%Y%m%d_%H%M%S')}.wav"
    storage_path = f"esp32/{device['device_name']}/{file_id}.wav"

    client.storage.from_(config.AUDIO_BUCKET).upload(
        storage_path, wav_bytes, {"content-type": "audio/wav"})

    row = client.table("audio_files").insert({
        "id": file_id,
        "filename": filename,
        "storage_path": storage_path,
        "duration": round(waveform.size / audio.SAMPLE_RATE, 3),
        "sample_rate": audio.SAMPLE_RATE,
        "file_size": len(wav_bytes),
        "source": "esp32",
        "status": "pending",
        "waveform": audio.waveform_peaks(waveform),
    }).execute().data[0]

    client.table("devices").update({"last_seen": now.isoformat()}) \
        .eq("id", device["id"]).execute()

    background.add_task(tasks.run_classification, file_id, waveform)
    return row
