"""YAMNet inference — lazy-loaded singleton, per-window top-k results.

YAMNet scores audio in 0.96s windows with a 0.48s hop; each window's top-k
classes are stored as rows in the `classifications` table.
"""
import logging
import shutil
import threading

import numpy as np

from . import config  # sets TFHUB_CACHE_DIR before TF Hub reads it

logger = logging.getLogger(__name__)

YAMNET_HANDLE = "https://tfhub.dev/google/yamnet/1"
WINDOW_SECONDS = 0.96
HOP_SECONDS = 0.48

_lock = threading.Lock()
_model = None
_class_names: list[str] | None = None


def load_model():
    """Load YAMNet + class map once (thread-safe). ~2-5s on first call."""
    global _model, _class_names
    with _lock:
        if _model is None:
            import tensorflow as tf
            import tensorflow_hub as hub

            try:
                _model = hub.load(YAMNET_HANDLE)
            except ValueError:
                # A half-finished download leaves a directory TF Hub accepts as
                # a cache but cannot load. Clear it and fetch the model again.
                logger.warning("YAMNet cache at %s is corrupt — re-downloading",
                               config.YAMNET_CACHE_DIR)
                shutil.rmtree(config.YAMNET_CACHE_DIR, ignore_errors=True)
                config.YAMNET_CACHE_DIR.mkdir(parents=True, exist_ok=True)
                _model = hub.load(YAMNET_HANDLE)
            class_map = _model.class_map_path().numpy().decode()
            _class_names = [
                line.split(",")[2].strip().strip('"')
                for line in tf.io.gfile.GFile(class_map).read().splitlines()[1:]
            ]
    return _model, _class_names


def classify(waveform: np.ndarray, top_k: int = 3,
             min_confidence: float = 0.1) -> list[dict]:
    """Run YAMNet over the waveform; return per-window top-k class dicts.

    The window's top-1 class is always kept; ranks 2..k only when they clear
    `min_confidence`, so silence/noise doesn't flood the table.
    """
    model, class_names = load_model()
    scores = model(waveform)[0].numpy()  # (n_windows, 521)

    results = []
    for w, window_scores in enumerate(scores):
        start = round(w * HOP_SECONDS, 3)
        end = round(start + WINDOW_SECONDS, 3)
        for rank, idx in enumerate(window_scores.argsort()[-top_k:][::-1]):
            confidence = float(window_scores[idx])
            if rank > 0 and confidence < min_confidence:
                break
            results.append({
                "class_name": class_names[idx],
                "confidence": round(confidence, 4),
                "window_start": start,
                "window_end": end,
            })
    return results
