"""Getting at the samples of any library item — a stored file or a virtual clip.

A clip owns no audio: it is "seconds 14-16 of recording X". Playing,
downloading or exporting it reads that stretch of the parent on demand.

Browsers cannot attach an Authorization header to an <audio src>, so the
backend hands out short-lived *signed* links to `GET /audio/{id}/file`: an
HMAC over the id and an expiry, keyed with the service-role secret. Anyone
holding the link can fetch that one file until it expires — the same contract
as a Supabase signed URL.
"""
import hashlib
import hmac
import threading
import time
from collections import OrderedDict

import numpy as np
from fastapi import HTTPException

from . import audio, config

LINK_TTL = 3600                   # seconds a playback/download link stays valid
CACHE_BYTES = 96 * 1024 * 1024    # recently read parents, so clip after clip of
                                  # one recording does not re-download it

_cache: OrderedDict[str, bytes] = OrderedDict()
_cache_lock = threading.Lock()


def _sign(audio_id: str, exp: int) -> str:
    msg = f"{audio_id}:{exp}".encode()
    return hmac.new(config.SUPABASE_SERVICE_ROLE_KEY.encode(), msg, hashlib.sha256).hexdigest()[:32]


def file_link(audio_id: str, download: bool = False) -> str:
    exp = int(time.time()) + LINK_TTL
    link = f"/audio/{audio_id}/file?exp={exp}&sig={_sign(audio_id, exp)}"
    return link + "&download=1" if download else link


def verify_link(audio_id: str, exp: int, sig: str) -> None:
    if exp < time.time() or not hmac.compare_digest(sig, _sign(audio_id, exp)):
        raise HTTPException(403, "link expired or invalid — reload the page")


def stored_bytes(client, storage_path: str) -> bytes:
    with _cache_lock:
        if storage_path in _cache:
            _cache.move_to_end(storage_path)
            return _cache[storage_path]
    data = client.storage.from_(config.AUDIO_BUCKET).download(storage_path)
    with _cache_lock:
        _cache[storage_path] = data
        while sum(map(len, _cache.values())) > CACHE_BYTES and len(_cache) > 1:
            _cache.popitem(last=False)
    return data


def forget(storage_path: str) -> None:
    with _cache_lock:
        _cache.pop(storage_path, None)


def parent_of(client, row: dict) -> dict:
    rows = (client.table("audio_files").select("id, storage_path, duration, filename, user_id")
            .eq("id", row["parent_id"]).execute().data)
    if not rows:
        raise HTTPException(404, "the recording this clip was cut from no longer exists")
    return rows[0]


def samples(client, row: dict, parent: dict | None = None) -> np.ndarray:
    """The item's audio as 16 kHz float32. `row` needs storage_path, parent_id,
    clip_start and clip_end."""
    if row.get("storage_path"):
        data = stored_bytes(client, row["storage_path"])
        return audio.decode_to_standard(data)
    parent = parent or parent_of(client, row)
    return audio.read_segment(stored_bytes(client, parent["storage_path"]),
                              row["clip_start"], row["clip_end"])


def wav_bytes(client, row: dict, parent: dict | None = None) -> bytes:
    """WAV for a download or an export. A stored WAV passes through untouched."""
    if (row.get("storage_path") or "").endswith(".wav"):
        return stored_bytes(client, row["storage_path"])
    return audio.to_wav_bytes(samples(client, row, parent))


def playback_url(client, row: dict) -> str:
    """Where the browser streams the item from: a Supabase signed URL for a
    stored file (supports seeking, no backend load), a signed backend link for
    a clip."""
    if row.get("storage_path"):
        signed = client.storage.from_(config.AUDIO_BUCKET).create_signed_url(
            row["storage_path"], LINK_TTL)
        return signed.get("signedURL") or signed.get("signedUrl")
    return file_link(row["id"])
