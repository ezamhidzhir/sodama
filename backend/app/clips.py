"""One path into the library for every source — upload, device and recording.

Each source used to repeat the same five steps (encode, store, insert, queue
YAMNet). Keeping them in one place means a recording made on a phone lands in
exactly the same shape as an uploaded file: same WAV standard, same waveform
peaks, same classification pipeline.
"""
import re
import uuid
from datetime import datetime, timezone

import numpy as np
from fastapi import BackgroundTasks, HTTPException

from . import audio, config, tasks

MAX_BYTES = 50 * 1024 * 1024  # matches the bucket's file_size_limit


def safe_stem(text: str, fallback: str = "clip") -> str:
    """A filename-safe version of a label or device name."""
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", text or "").strip("-")[:40]
    return stem or fallback


def create_clip(client, background: BackgroundTasks, *, waveform: np.ndarray,
                user_id: str | None, filename: str, source: str, folder: str,
                extra: dict | None = None) -> dict:
    """Store `waveform` as WAV 16 kHz mono, insert its row, queue classification.

    `folder` is the storage prefix (`uploads`, `recordings/<user>` ...);
    `extra` carries source-specific columns such as location or a label.
    """
    if waveform.size == 0:
        raise HTTPException(400, "audio contains no samples")

    wav_bytes = audio.to_wav_bytes(waveform)
    if len(wav_bytes) > MAX_BYTES:
        raise HTTPException(413, "audio exceeds the 50 MB limit once standardized")

    file_id = str(uuid.uuid4())
    storage_path = f"{folder}/{file_id}.wav"
    client.storage.from_(config.AUDIO_BUCKET).upload(
        storage_path, wav_bytes, {"content-type": "audio/wav"})

    try:
        row = client.table("audio_files").insert({
            "id": file_id,
            "user_id": user_id,
            "filename": filename,
            "storage_path": storage_path,
            "duration": round(waveform.size / audio.SAMPLE_RATE, 3),
            "sample_rate": audio.SAMPLE_RATE,
            "file_size": len(wav_bytes),
            "source": source,
            "status": "pending",
            "waveform": audio.waveform_peaks(waveform),
            **(extra or {}),
        }).execute().data[0]
    except Exception:
        # No row points at the object, so nothing would ever delete it. A device
        # retrying the same recording hits this on the unique client-id index.
        client.storage.from_(config.AUDIO_BUCKET).remove([storage_path])
        raise

    background.add_task(tasks.run_classification, file_id, waveform)
    return row


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
