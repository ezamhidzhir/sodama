"""Audio decoding and standardization — everything becomes 16kHz mono float32."""
import io

import numpy as np
import soundfile as sf

SAMPLE_RATE = 16000  # project standard (YAMNet requirement)
WAVEFORM_POINTS = 600  # peaks stored for dashboard waveform rendering


def decode_to_standard(data: bytes) -> np.ndarray:
    """Decode WAV/MP3/FLAC/OGG bytes to 16kHz mono float32 in [-1, 1].

    Recordings made in the app already arrive as 16 kHz mono WAV, so those are
    read directly with soundfile — librosa's first import alone takes seconds,
    which a person holding a phone feels as a hung "Saving…". librosa is only
    loaded when there is real work: resampling, downmixing, or MP3/OGG decode.
    """
    try:
        waveform, rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception:
        waveform, rate = None, None
    if waveform is not None:
        mono = waveform.mean(axis=1) if waveform.shape[1] > 1 else waveform[:, 0]
        if rate == SAMPLE_RATE:
            return np.ascontiguousarray(mono, dtype=np.float32)
        import librosa

        return librosa.resample(mono, orig_sr=rate, target_sr=SAMPLE_RATE).astype(np.float32)

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


def to_flac_bytes(waveform: np.ndarray) -> bytes:
    """Same 16 kHz mono 16-bit samples as `to_wav_bytes`, losslessly compressed.

    This is how audio is stored: decoding gives back exactly the samples a WAV
    would hold, at roughly half the size — which doubles how much audio fits in
    the free Supabase storage tier. Downloads and exports are still WAV.
    """
    buf = io.BytesIO()
    sf.write(buf, waveform, SAMPLE_RATE, format="FLAC", subtype="PCM_16")
    return buf.getvalue()


def duration_of(data: bytes) -> float | None:
    """Seconds of audio, read from the file header without decoding the samples.

    Lets an upload be refused for being too long *before* it is decoded — a
    50 MB MP3 can hold an hour of audio, and decoding that takes over a gigabyte
    of memory. None when the header cannot be read (the caller decodes and
    checks the decoded length instead).
    """
    try:
        info = sf.info(io.BytesIO(data))
    except Exception:
        return None
    return info.frames / info.samplerate if info.samplerate and info.frames > 0 else None


def read_segment(data: bytes, start: float, end: float) -> np.ndarray:
    """Seconds `start`..`end` of a stored file (16 kHz WAV or FLAC) as float32,
    seeking instead of decoding the whole file."""
    with sf.SoundFile(io.BytesIO(data)) as f:
        first = max(0, int(round(start * f.samplerate)))
        f.seek(min(first, f.frames))
        frames = max(0, int(round(end * f.samplerate)) - first)
        segment = f.read(frames, dtype="float32", always_2d=True)
        rate = f.samplerate
    mono = segment.mean(axis=1) if segment.shape[1] > 1 else segment[:, 0]
    if rate != SAMPLE_RATE:
        import librosa

        mono = librosa.resample(mono, orig_sr=rate, target_sr=SAMPLE_RATE)
    return np.ascontiguousarray(mono, dtype=np.float32)


def _fade(n: int) -> np.ndarray:
    # Linear, so the two gains always sum to 1. Loops and merges join a sound
    # to itself or to a similar one; with an equal-power curve those correlated
    # overlaps would swell to ~1.4x and could clip.
    return np.linspace(0, 1, n, dtype=np.float32)


def join(pieces: list[np.ndarray], crossfade: float = 0.3) -> np.ndarray:
    """Pieces end to end, each seam blended over `crossfade` seconds so no click
    marks the join."""
    parts, tail = [], pieces[0].astype(np.float32)
    for piece in pieces[1:]:
        n = min(int(crossfade * SAMPLE_RATE), tail.size // 2, piece.size // 2)
        if n <= 0:
            parts.append(tail)
            tail = piece
            continue
        fade_in = _fade(n)
        parts += [tail[:-n], tail[-n:] * fade_in[::-1] + piece[:n] * fade_in]
        tail = piece[n:]
    parts.append(tail)
    return np.concatenate(parts).astype(np.float32)


def loop_to(waveform: np.ndarray, seconds: float, crossfade: float = 0.3) -> np.ndarray:
    """Repeat a sound until it lasts `seconds`, crossfading each repeat."""
    target = int(seconds * SAMPLE_RATE)
    overlap = min(int(crossfade * SAMPLE_RATE), waveform.size // 2)
    step = max(1, waveform.size - overlap)            # what each repeat adds
    repeats = 1 + max(0, -(-(target - waveform.size) // step))
    return join([waveform] * repeats, crossfade)[:target]


def waveform_peaks(waveform: np.ndarray, points: int = WAVEFORM_POINTS) -> list[float]:
    """Downsample |waveform| to at most `points` peak values for UI rendering."""
    if waveform.size == 0:
        return []
    chunks = np.array_split(np.abs(waveform), min(points, waveform.size))
    return [round(float(c.max()), 4) for c in chunks]
