from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Request

from .. import audio, clips
from ..db import get_client

router = APIRouter(tags=["ingest"])

MIN_PCM_BYTES = 3200          # 0.1s @ 16kHz 16-bit — reject obviously broken posts


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
    Resamples to 16kHz if needed, then runs the same pipeline as /upload.
    The clip belongs to whoever registered the device."""
    client = get_client()

    devices = client.table("devices").select("*").eq("api_key", x_api_key).execute().data
    if not devices:
        raise HTTPException(401, "invalid API key")
    device = devices[0]

    raw = await request.body()
    if len(raw) < MIN_PCM_BYTES:
        raise HTTPException(400, f"PCM payload too small ({len(raw)} bytes)")
    if len(raw) > clips.MAX_BYTES:
        raise HTTPException(413, "payload exceeds 50 MB limit")
    if len(raw) % 2:
        raw = raw[:-1]  # drop trailing odd byte from a truncated chunk

    waveform = audio.pcm16_to_standard(raw, sample_rate)
    now = datetime.now(timezone.utc)
    name = clips.safe_stem(device["device_name"], "device")

    row = clips.create_clip(
        client, background, waveform=waveform, user_id=device.get("user_id"),
        filename=f"{name}_{now.strftime('%Y%m%d_%H%M%S')}.wav",
        source="esp32", folder=f"esp32/{name}",
        extra={"device_id": device["id"], "recorded_at": now.isoformat()})

    client.table("devices").update({"last_seen": now.isoformat()}) \
        .eq("id", device["id"]).execute()
    return row
