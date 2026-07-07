"""Fasa 0 deliverable: confirm YAMNet loads and classifies audio locally.

Usage:
    python test_yamnet.py                 # classify a generated 440 Hz test tone
    python test_yamnet.py path/to.wav     # classify a real WAV file

Prints top-5 classes overall and per 0.96s window, mirroring how the
backend will store per-window results in the `classifications` table.
"""
import sys

import numpy as np
import tensorflow as tf
import tensorflow_hub as hub

YAMNET_HANDLE = "https://tfhub.dev/google/yamnet/1"
SAMPLE_RATE = 16000  # YAMNet requirement: 16 kHz mono float32 in [-1, 1]


def load_audio(path: str) -> np.ndarray:
    import librosa

    waveform, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    return waveform.astype(np.float32)


def synth_test_tone(seconds: float = 3.0) -> np.ndarray:
    """440 Hz sine — YAMNet should rank it as Sine wave / Tuning fork / Music."""
    t = np.linspace(0, seconds, int(SAMPLE_RATE * seconds), endpoint=False)
    return (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)


def main() -> None:
    if len(sys.argv) > 1:
        source = sys.argv[1]
        waveform = load_audio(source)
    else:
        source = "generated 440 Hz test tone (3s)"
        waveform = synth_test_tone()

    print(f"Input   : {source}")
    print(f"Samples : {len(waveform)} @ {SAMPLE_RATE} Hz "
          f"({len(waveform) / SAMPLE_RATE:.2f}s)")

    print("Loading YAMNet from TensorFlow Hub (cached after first run)...")
    model = hub.load(YAMNET_HANDLE)

    class_map_path = model.class_map_path().numpy().decode()
    class_names = [
        line.split(",")[2].strip().strip('"')
        for line in tf.io.gfile.GFile(class_map_path).read().splitlines()[1:]
    ]
    print(f"Classes : {len(class_names)} AudioSet classes loaded")

    scores, embeddings, spectrogram = model(waveform)
    scores = scores.numpy()

    print(f"\nOutput shapes — scores: {scores.shape}, "
          f"embeddings: {embeddings.shape}, spectrogram: {spectrogram.shape}")

    mean_scores = scores.mean(axis=0)
    top5 = mean_scores.argsort()[-5:][::-1]
    print("\nTop-5 classes (mean over all windows):")
    for i in top5:
        print(f"  {class_names[i]:<30} {mean_scores[i]:.4f}")

    # Per-window top-1 — same granularity the backend stores in `classifications`
    print("\nPer-window top class (window = 0.96s, hop = 0.48s):")
    for w, window_scores in enumerate(scores):
        top = window_scores.argmax()
        start = w * 0.48
        print(f"  [{start:5.2f}s - {start + 0.96:5.2f}s] "
              f"{class_names[top]:<30} {window_scores[top]:.4f}")

    print("\nOK — YAMNet loaded and classified successfully.")


if __name__ == "__main__":
    main()
