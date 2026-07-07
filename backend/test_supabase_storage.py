"""Fasa 1 deliverable: round-trip test of Supabase Storage + database.

Uploads a generated WAV to the `audio-files` bucket, inserts a row into
`audio_files`, reads both back, then cleans up.

Requires backend/.env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
"""
import io
import os
import struct
import wave

import numpy as np
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BUCKET = os.environ.get("AUDIO_BUCKET", "audio-files")
SAMPLE_RATE = 16000


def make_test_wav(seconds: float = 1.0) -> bytes:
    """1s 440 Hz tone as WAV 16kHz mono 16-bit (the project standard format)."""
    t = np.linspace(0, seconds, int(SAMPLE_RATE * seconds), endpoint=False)
    pcm = (0.5 * np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def main() -> None:
    client = create_client(SUPABASE_URL, SERVICE_KEY)
    wav_bytes = make_test_wav()
    storage_path = "tests/roundtrip_test.wav"

    print(f"1. Uploading {len(wav_bytes)} bytes -> {BUCKET}/{storage_path}")
    client.storage.from_(BUCKET).upload(
        storage_path, wav_bytes,
        {"content-type": "audio/wav", "upsert": "true"},
    )

    print("2. Inserting row into audio_files")
    row = client.table("audio_files").insert({
        "filename": "roundtrip_test.wav",
        "storage_path": storage_path,
        "duration": 1.0,
        "sample_rate": SAMPLE_RATE,
        "file_size": len(wav_bytes),
        "source": "upload",
    }).execute().data[0]
    print(f"   id = {row['id']}")

    print("3. Downloading file back")
    downloaded = client.storage.from_(BUCKET).download(storage_path)
    assert downloaded == wav_bytes, "downloaded bytes != uploaded bytes"
    print(f"   {len(downloaded)} bytes — matches upload")

    print("4. Querying row back")
    fetched = (client.table("audio_files").select("*")
               .eq("id", row["id"]).single().execute().data)
    assert fetched["storage_path"] == storage_path
    print(f"   filename={fetched['filename']}, sr={fetched['sample_rate']}")

    print("5. Cleaning up")
    client.table("audio_files").delete().eq("id", row["id"]).execute()
    client.storage.from_(BUCKET).remove([storage_path])

    print("\nOK — Supabase Storage + database round-trip successful.")


if __name__ == "__main__":
    main()
