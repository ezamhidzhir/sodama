"""Device ingest — one upload contract for every recording client.

Any client holding a device API key (an ESP32, a script on a laptop, ...)
follows the same loop:

    record -> POST /ingest -> receipt -> delete the local copy -> record again

The receipt carries the SHA-256 of the bytes the server stored. The client
deletes its own copy only when that hash matches the one it computed, so a
recording is never lost to a dropped connection: no matching receipt, no
delete, send it again. Sending it again is safe because the client tags each
recording with its own `X-Client-Id`; a repeat is answered with the original
receipt instead of being stored twice.

Stream mode sends short chunks (~10 s) as they are recorded, under a
`session_id` with a `chunk_index`. With `join=true` the chunks are held back
from the Library and stitched into one recording when the client closes the
session; otherwise each chunk becomes a clip of its own.
"""
import hashlib
import logging
import uuid
from datetime import datetime, timezone

import numpy as np
from fastapi import (APIRouter, BackgroundTasks, Header, HTTPException, Path, Query,
                     Request, Response)
from postgrest.exceptions import APIError

from .. import audio, clips, config
from ..db import get_client

router = APIRouter(tags=["ingest"])
logger = logging.getLogger(__name__)

MIN_PCM_BYTES = 3200          # 0.1s @ 16kHz 16-bit — reject obviously broken posts
UNIQUE_VIOLATION = "23505"
# Containers decode_to_standard understands; anything else is raw PCM.
FILE_MAGIC = (b"RIFF", b"fLaC", b"OggS", b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")


def _device(client, api_key: str) -> dict:
    rows = client.table("devices").select("*").eq("api_key", api_key).execute().data
    if not rows:
        raise HTTPException(401, "invalid API key")
    return rows[0]


def _uuid(value: str | None, name: str) -> str | None:
    if value is None:
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(400, f"{name} must be a UUID")


def _recorded_at(value: str | None) -> datetime:
    """When the sound was captured, by the client's clock; arrival time if absent."""
    if not value:
        return datetime.now(timezone.utc)
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "X-Recorded-At must be an ISO 8601 timestamp")
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _decode(raw: bytes, content_type: str, sample_rate: int) -> np.ndarray:
    """An audio file (WAV/FLAC/MP3/OGG) or headerless 16-bit mono PCM."""
    if content_type.startswith("audio/") or raw.startswith(FILE_MAGIC):
        try:
            return audio.decode_to_standard(raw)
        except Exception:
            raise HTTPException(400, "could not decode audio — file corrupt or not audio")
    if len(raw) % 2:
        raw = raw[:-1]  # drop trailing odd byte from a truncated chunk
    return audio.pcm16_to_standard(raw, sample_rate)


def _receipt(response: Response, *, duplicate: bool, sha256: str, client_id: str | None,
             audio_id: str | None = None, session_id: str | None = None,
             chunk_index: int | None = None, duration: float | None = None) -> dict:
    """What the client checks before deleting its copy: `sha256` must equal the
    hash it computed itself. A repeat upload gets 200 instead of 201."""
    if duplicate:
        response.status_code = 200
    return {
        "status": "duplicate" if duplicate else "stored",
        "sha256": sha256,
        "client_id": client_id,
        "audio_id": audio_id,          # null for a chunk still waiting to be joined
        "session_id": session_id,
        "chunk_index": chunk_index,
        "duration": duration,
    }


def _existing_clip(client, device_id: str, client_id: str) -> dict | None:
    rows = (client.table("audio_files").select("id, sha256, duration, session_id, chunk_index")
            .eq("device_id", device_id).eq("client_id", client_id).execute().data)
    return rows[0] if rows else None


def _existing_session_clip(client, session_id: str, chunk_index: int) -> dict | None:
    rows = (client.table("audio_files").select("id, sha256, duration")
            .eq("session_id", session_id).eq("chunk_index", chunk_index).execute().data)
    return rows[0] if rows else None


def _existing_chunk(client, session_id: str, chunk_index: int) -> dict | None:
    rows = (client.table("ingest_chunks").select("*")
            .eq("session_id", session_id).eq("chunk_index", chunk_index).execute().data)
    return rows[0] if rows else None


def _same_or_conflict(stored_sha: str | None, sha256: str, what: str) -> None:
    if stored_sha != sha256:
        raise HTTPException(409, f"{what} was already used for different audio")


def _session(client, session_id: str, device: dict, join: bool) -> dict:
    """The stream session, created by its first chunk. Chunks may arrive out of
    order or concurrently, hence the insert-if-absent."""
    client.table("ingest_sessions").upsert({
        "id": session_id, "device_id": device["id"], "user_id": device.get("user_id"),
        "join_chunks": join,
    }, on_conflict="id", ignore_duplicates=True).execute()
    session = (client.table("ingest_sessions").select("*")
               .eq("id", session_id).execute().data[0])
    if session["device_id"] != device["id"]:
        raise HTTPException(409, "session_id belongs to another device")
    if session["join_chunks"] != join:
        raise HTTPException(409, f"session was started with join={str(session['join_chunks']).lower()}")
    return session


def _device_folder(device: dict) -> str:
    return f"devices/{clips.safe_stem(device['device_name'], 'device')}"


def _touch(client, device: dict) -> None:
    client.table("devices").update({"last_seen": clips.now_iso()}) \
        .eq("id", device["id"]).execute()


@router.post("/ingest", status_code=201,
             summary="Upload one recording or stream chunk from a device (API-key auth)")
async def ingest(
    request: Request,
    response: Response,
    background: BackgroundTasks,
    x_api_key: str = Header(..., description="Device api_key from the devices table"),
    x_client_id: str | None = Header(
        None, description="UUID the client gave this recording — makes retries safe"),
    x_content_sha256: str | None = Header(
        None, description="Hex SHA-256 of the body; a mismatch means it was corrupted in transit"),
    x_recorded_at: str | None = Header(
        None, description="ISO 8601 capture time by the device clock (default: arrival)"),
    sample_rate: int = Query(16000, ge=8000, le=48000,
                             description="Only for a raw PCM body"),
    session_id: str | None = Query(None, description="Stream mode: UUID shared by a recording's chunks"),
    chunk_index: int | None = Query(None, ge=0, description="Stream mode: 0, 1, 2, ..."),
    join: bool = Query(False, description="Stream mode: stitch the chunks into one recording on close"),
):
    """Body: an audio file (`Content-Type: audio/wav`, FLAC, MP3, OGG) or raw
    little-endian 16-bit mono PCM (`application/octet-stream`, chunked POST
    supported). Returns a receipt; delete the local copy only once its
    `sha256` matches yours. 201 = stored now, 200 = already had it."""
    client = get_client()
    device = _device(client, x_api_key)
    client_id = _uuid(x_client_id, "X-Client-Id")
    session_id = _uuid(session_id, "session_id")
    if (session_id is None) != (chunk_index is None):
        raise HTTPException(400, "session_id and chunk_index go together")

    raw = await request.body()
    if len(raw) < MIN_PCM_BYTES:
        raise HTTPException(400, f"payload too small ({len(raw)} bytes)")
    if len(raw) > clips.MAX_BYTES:
        raise HTTPException(413, "payload exceeds 50 MB limit")

    sha256 = hashlib.sha256(raw).hexdigest()
    if x_content_sha256 and x_content_sha256.strip().lower() != sha256:
        raise HTTPException(422, "checksum mismatch — the body was corrupted in transit; "
                                 "keep the local copy and send it again")
    receipt = dict(sha256=sha256, client_id=client_id, session_id=session_id,
                   chunk_index=chunk_index)

    joining = session_id is not None and join
    if client_id and not joining:
        prior = _existing_clip(client, device["id"], client_id)
        if prior:
            _same_or_conflict(prior["sha256"], sha256, "X-Client-Id")
            return _receipt(response, duplicate=True, audio_id=prior["id"],
                            duration=prior["duration"], **receipt)

    session = _session(client, session_id, device, join) if session_id else None
    if session and session["status"] != "open":
        raise HTTPException(409, "session is already closed")
    if joining:
        prior = _existing_chunk(client, session_id, chunk_index)
        if prior:
            _same_or_conflict(prior["sha256"], sha256, "chunk_index")
            return _receipt(response, duplicate=True, duration=prior["duration"], **receipt)
    elif session:
        prior = _existing_session_clip(client, session_id, chunk_index)
        if prior:
            _same_or_conflict(prior["sha256"], sha256, "chunk_index")
            return _receipt(response, duplicate=True, audio_id=prior["id"],
                            duration=prior["duration"], **receipt)

    waveform = _decode(raw, request.headers.get("content-type", ""), sample_rate)
    if waveform.size == 0:
        raise HTTPException(400, "audio contains no samples")
    recorded_at = _recorded_at(x_recorded_at)
    duration = round(waveform.size / audio.SAMPLE_RATE, 3)

    if joining:
        receipt_out = _store_chunk(client, session_id, chunk_index, client_id, sha256,
                                   waveform, duration, recorded_at, device, response, receipt)
        _touch(client, device)
        return receipt_out

    name = clips.safe_stem(device["device_name"], "device")
    stamp = recorded_at.strftime("%Y%m%d_%H%M%S")
    part = f"_part{chunk_index:03d}" if session else ""
    try:
        row = clips.create_clip(
            client, background, waveform=waveform, user_id=device.get("user_id"),
            filename=f"{name}_{stamp}{part}.wav", source="device", folder=_device_folder(device),
            extra={"device_id": device["id"], "recorded_at": recorded_at.isoformat(),
                   "client_id": client_id, "sha256": sha256,
                   "session_id": session_id, "chunk_index": chunk_index})
    except APIError as e:
        # Two copies of the same recording raced past the duplicate check.
        if e.code != UNIQUE_VIOLATION:
            raise
        prior = (_existing_clip(client, device["id"], client_id) if client_id
                 else _existing_session_clip(client, session_id, chunk_index))
        _same_or_conflict(prior["sha256"], sha256, "X-Client-Id")
        return _receipt(response, duplicate=True, audio_id=prior["id"],
                        duration=prior["duration"], **receipt)

    _touch(client, device)
    return _receipt(response, duplicate=False, audio_id=row["id"], duration=row["duration"],
                    **receipt)


def _store_chunk(client, session_id, chunk_index, client_id, sha256, waveform, duration,
                 recorded_at, device, response, receipt) -> dict:
    """A chunk of a join session: stored as standard WAV, kept out of the Library."""
    path = f"{_device_folder(device)}/sessions/{session_id}/{chunk_index:05d}.wav"
    bucket = client.storage.from_(config.AUDIO_BUCKET)
    bucket.upload(path, audio.to_wav_bytes(waveform),
                  {"content-type": "audio/wav", "upsert": "true"})
    try:
        client.table("ingest_chunks").insert({
            "session_id": session_id, "chunk_index": chunk_index, "client_id": client_id,
            "sha256": sha256, "storage_path": path, "duration": duration,
            "recorded_at": recorded_at.isoformat(),
        }).execute()
    except APIError as e:
        if e.code != UNIQUE_VIOLATION:
            raise
        # A concurrent retry of this chunk won; same path, so the object is theirs too.
        prior = _existing_chunk(client, session_id, chunk_index)
        _same_or_conflict(prior["sha256"], sha256, "chunk_index")
        return _receipt(response, duplicate=True, duration=prior["duration"], **receipt)
    return _receipt(response, duplicate=False, duration=duration, **receipt)


@router.post("/ingest/sessions/{session_id}/close",
             summary="Finish a stream session; joins its chunks when it was started with join=true")
def close_session(
    background: BackgroundTasks,
    session_id: str = Path(..., description="The session's UUID"),
    x_api_key: str = Header(...),
    chunks: int | None = Query(None, ge=1, description=(
        "How many chunks the client sent. Recommended: lets the server spot "
        "chunks that never arrived instead of joining a recording with a gap")),
):
    """Safe to call again. If chunks are missing, answers 409 with their
    indexes — send those chunks, then close again."""
    client = get_client()
    device = _device(client, x_api_key)
    session_id = _uuid(session_id, "session_id")
    rows = (client.table("ingest_sessions").select("*")
            .eq("id", session_id).eq("device_id", device["id"]).execute().data)
    if not rows:
        raise HTTPException(404, "session not found — it starts with its first chunk")
    session = rows[0]

    if session["status"] == "closed":
        return _close_result(client, session)
    if session["status"] == "joining":
        raise HTTPException(409, "session is being joined right now — close it again shortly")

    if not session["join_chunks"]:
        indexes = [r["chunk_index"] for r in client.table("audio_files").select("chunk_index")
                   .eq("session_id", session_id).execute().data]
        _require_all(indexes, chunks)
        client.table("ingest_sessions").update({"status": "closed", "closed_at": clips.now_iso()}) \
            .eq("id", session_id).execute()
        session["status"] = "closed"
        return _close_result(client, session)

    parts = (client.table("ingest_chunks").select("*").eq("session_id", session_id)
             .order("chunk_index").execute().data)
    _require_all([p["chunk_index"] for p in parts], chunks)
    total = sum(p["duration"] for p in parts)
    if total * audio.SAMPLE_RATE * 2 > clips.MAX_BYTES:
        raise HTTPException(413, f"joined recording would be {total:.0f} s — over the 50 MB "
                                 "limit; close the session without join or use shorter sessions")

    # Claim the session so a concurrent close cannot join it a second time.
    claimed = (client.table("ingest_sessions").update({"status": "joining"})
               .eq("id", session_id).eq("status", "open").execute().data)
    if not claimed:
        raise HTTPException(409, "session is being joined right now — close it again shortly")

    bucket = client.storage.from_(config.AUDIO_BUCKET)
    try:
        waveform = np.concatenate(
            [audio.decode_to_standard(bucket.download(p["storage_path"])) for p in parts])
        first = _recorded_at(parts[0]["recorded_at"])
        name = clips.safe_stem(device["device_name"], "device")
        row = clips.create_clip(
            client, background, waveform=waveform, user_id=device.get("user_id"),
            filename=f"{name}_{first.strftime('%Y%m%d_%H%M%S')}.wav", source="device",
            folder=_device_folder(device),
            extra={"device_id": device["id"], "recorded_at": first.isoformat(),
                   "session_id": session_id})
    except Exception:
        client.table("ingest_sessions").update({"status": "open"}).eq("id", session_id).execute()
        raise

    client.table("ingest_sessions").update({
        "status": "closed", "closed_at": clips.now_iso(), "audio_file_id": row["id"],
    }).eq("id", session_id).execute()
    # The joined recording holds every sample now; the chunks are redundant.
    try:
        bucket.remove([p["storage_path"] for p in parts])
        client.table("ingest_chunks").delete().eq("session_id", session_id).execute()
    except Exception:
        logger.exception("joined session %s but could not clean up its chunks", session_id)

    _touch(client, device)
    session.update(status="closed", audio_file_id=row["id"])
    return _close_result(client, session, chunk_count=len(parts))


def _require_all(indexes: list[int], expected: int | None) -> None:
    """Every chunk 0..n-1 present; n is the client's count, else the highest index seen."""
    if not indexes:
        raise HTTPException(409, {"message": "session has no chunks", "missing": [0]})
    n = expected if expected is not None else max(indexes) + 1
    have = set(indexes)
    extra = sorted(i for i in have if i >= n)
    if extra:
        raise HTTPException(409, {"message": f"session has chunks beyond the {n} expected",
                                  "extra": extra})
    missing = [i for i in range(n) if i not in have]
    if missing:
        raise HTTPException(409, {"message": f"{len(missing)} chunk(s) never arrived — "
                                             "send them, then close again", "missing": missing})


def _close_result(client, session: dict, chunk_count: int | None = None) -> dict:
    if session["join_chunks"]:
        audio_ids = [session["audio_file_id"]] if session.get("audio_file_id") else []
    else:
        audio_ids = [r["id"] for r in client.table("audio_files").select("id")
                     .eq("session_id", session["id"]).order("chunk_index").execute().data]
    return {
        "session_id": session["id"],
        "status": session["status"],
        "joined": session["join_chunks"],
        "chunks": chunk_count if chunk_count is not None else len(audio_ids),
        "audio_ids": audio_ids,
    }


def discard_pending_chunks(client, device_ids: list[str]) -> None:
    """Storage objects of chunks never joined. Their rows cascade away with the
    device, but nothing else would ever delete the files."""
    if not device_ids:
        return
    sessions = [s["id"] for s in client.table("ingest_sessions").select("id")
                .in_("device_id", device_ids).execute().data]
    if not sessions:
        return
    paths = [c["storage_path"] for c in client.table("ingest_chunks").select("storage_path")
             .in_("session_id", sessions).execute().data]
    for i in range(0, len(paths), 100):
        client.storage.from_(config.AUDIO_BUCKET).remove(paths[i:i + 100])
