"""One path into the library for every source — upload, device and recording.

Every new piece of audio goes through the same steps, in this order:

    quota check -> privacy filter (mute speech) -> FLAC -> storage -> row ->
    classifications

The privacy filter runs *before* anything is stored, so a voice never reaches
Supabase. It needs YAMNet's scores anyway, so classification happens in the
same pass and a clip is `done` the moment it is saved — there is no background
job left to wait for.
"""
import re
import uuid
from datetime import datetime, timezone

import numpy as np
from fastapi import HTTPException

from . import audio, classifier, config, privacy

MAX_BYTES = 50 * 1024 * 1024  # matches the bucket's file_size_limit
INSERT_BATCH = 500


def safe_stem(text: str, fallback: str = "clip") -> str:
    """A filename-safe version of a label or device name."""
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", text or "").strip("-")[:40]
    return stem or fallback


# ---------------------------------------------------------------- quota

def quota(client, user_id: str | None) -> dict:
    """Seconds of stored audio a user keeps, and may keep. Virtual clips are
    free: they point into a recording that is already counted."""
    if not user_id:
        return {"used_seconds": 0.0, "quota_seconds": None}
    rows = (client.table("audio_files").select("duration").eq("user_id", user_id)
            .not_.is_("storage_path", "null").execute().data)
    prof = client.table("profiles").select("quota_seconds").eq("id", user_id).execute().data
    limit = prof[0]["quota_seconds"] if prof else config.DEFAULT_QUOTA_SECONDS
    return {"used_seconds": round(sum(r["duration"] or 0 for r in rows), 1),
            "quota_seconds": limit}


def ensure_quota(client, user_id: str | None, seconds: float) -> None:
    q = quota(client, user_id)
    if q["quota_seconds"] is None:
        return
    left = q["quota_seconds"] - q["used_seconds"]
    if seconds > left + 0.5:   # half a second of slack for rounding
        raise HTTPException(
            413, f"storage quota reached — this audio is {seconds / 60:.1f} min but only "
                 f"{max(0, left) / 60:.1f} of your {q['quota_seconds'] / 60:.0f} min are left. "
                 "Delete files you no longer need, or split long recordings into clips.")


def check_length(seconds: float, limit: int, what: str) -> None:
    if seconds > limit + 0.5:
        raise HTTPException(413, f"{what} is {seconds / 60:.1f} min — the limit is "
                                 f"{limit / 60:.0f} min. Trim it first, or split it into parts.")


# ---------------------------------------------------------------- storing

def create_clip(client, *, waveform: np.ndarray, user_id: str | None, filename: str,
                source: str, folder: str, extra: dict | None = None,
                reject_mostly_speech: bool = False,
                muted_before: list[list[float]] | None = None) -> dict:
    """Filter speech, store `waveform` as 16 kHz mono FLAC, insert its row and
    its classifications. Returns the row.

    `folder` is the storage prefix (`uploads`, `recordings/<user>` ...);
    `extra` carries source-specific columns such as location or a label.
    `reject_mostly_speech` refuses audio that is nearly all voice — right for
    a person uploading or recording, who sees the message; a device keeps the
    muted version instead, so its receipt and stream timeline stay intact.
    `muted_before` lists stretches already muted upstream (stream chunks are
    filtered as they arrive), so the record of what was removed is complete.
    """
    if waveform.size == 0:
        raise HTTPException(400, "audio contains no samples")
    duration = waveform.size / audio.SAMPLE_RATE
    ensure_quota(client, user_id, duration)

    safe = privacy.filter_speech(waveform)
    if muted_before:
        safe.redactions = privacy.merge_ranges(safe.redactions + muted_before)
    if reject_mostly_speech and safe.speech_share(duration) >= config.PRIVACY_MAX_SPEECH_SHARE:
        raise HTTPException(422, f"this audio is mostly human speech "
                                 f"({safe.removed_seconds:.0f} of {duration:.0f} s) — SODAMA "
                                 "collects sounds, not voices, so it was not saved.")

    data = audio.to_flac_bytes(safe.waveform)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "audio exceeds the 50 MB limit once standardized")

    file_id = str(uuid.uuid4())
    storage_path = f"{folder}/{file_id}.flac"
    bucket = client.storage.from_(config.AUDIO_BUCKET)
    bucket.upload(storage_path, data, {"content-type": "audio/flac"})

    try:
        row = client.table("audio_files").insert({
            "id": file_id,
            "user_id": user_id,
            "filename": filename,
            "storage_path": storage_path,
            "duration": round(duration, 3),
            "sample_rate": audio.SAMPLE_RATE,
            "file_size": len(data),
            "source": source,
            "status": "done",
            "waveform": audio.waveform_peaks(safe.waveform),
            "speech_removed_seconds": safe.removed_seconds,
            "privacy_redactions": safe.redactions,
            **(extra or {}),
        }).execute().data[0]
    except Exception:
        # No row points at the object, so nothing would ever delete it. A device
        # retrying the same recording hits this on the unique client-id index.
        bucket.remove([storage_path])
        raise

    save_classifications(client, file_id, classifier.rows_from_scores(
        safe.scores, config.YAMNET_TOP_K, config.YAMNET_MIN_CONFIDENCE))
    return row


def save_classifications(client, audio_id: str, rows: list[dict]) -> None:
    rows = [{**r, "audio_file_id": audio_id} for r in rows]
    for i in range(0, len(rows), INSERT_BATCH):
        client.table("classifications").insert(rows[i:i + INSERT_BATCH]).execute()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
