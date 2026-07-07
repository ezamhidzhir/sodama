"""Audio decoding and standardization — everything becomes 16kHz mono float32."""
import io

import numpy as np
import soundfile as sf

SAMPLE_RATE = 16000  # project standard (YAMNet requirement)
WAVEFORM_POINTS = 600  # peaks stored for dashboard waveform rendering


def decode_to_standard(data: bytes) -> np.ndarray:
    """Decode WAV/MP3/FLAC/OGG bytes to 16kHz mono float32 in [-1, 1]."""
    import librosa

    waveform, _ = librosa.load(io.BytesIO(data), sr=SAMPLE_RATE, mono=True)
    return waveform.astype(np.float32)


def pcm16_to_standard(data: bytes, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Raw 16-bit LE mono PCM (ESP32 ingest) to 16kHz float32."""
    waveform = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
    if sample_rate != SAMPLE_RATE:
        import librosa

        waveform = librosa.resample(waveform, orig_sr=sample_rate, target_sr=SAMPLE_RATE)
    return waveform


def to_wav_bytes(waveform: np.ndarray) -> bytes:
    """Encode float32 waveform as WAV 16kHz mono 16-bit PCM."""
    buf = io.BytesIO()
    sf.write(buf, waveform, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def waveform_peaks(waveform: np.ndarray, points: int = WAVEFORM_POINTS) -> list[float]:
    """Downsample |waveform| to at most `points` peak values for UI rendering."""
    if waveform.size == 0:
        return []
    chunks = np.array_split(np.abs(waveform), min(points, waveform.size))
    return [round(float(c.max()), 4) for c in chunks]
