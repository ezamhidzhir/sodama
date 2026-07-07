"""Background classification pipeline: pending -> processing -> done/error."""
import logging

import numpy as np

from . import classifier, config
from .db import get_client

logger = logging.getLogger(__name__)

INSERT_BATCH = 500


def run_classification(audio_file_id: str, waveform: np.ndarray) -> None:
    client = get_client()
    try:
        client.table("audio_files").update({"status": "processing"}) \
            .eq("id", audio_file_id).execute()

        results = classifier.classify(
            waveform,
            top_k=config.YAMNET_TOP_K,
            min_confidence=config.YAMNET_MIN_CONFIDENCE,
        )
        rows = [{**r, "audio_file_id": audio_file_id} for r in results]
        for i in range(0, len(rows), INSERT_BATCH):
            client.table("classifications").insert(rows[i:i + INSERT_BATCH]).execute()

        client.table("audio_files").update({"status": "done"}) \
            .eq("id", audio_file_id).execute()
        logger.info("classified %s: %d rows", audio_file_id, len(rows))
    except Exception:
        logger.exception("classification failed for %s", audio_file_id)
        client.table("audio_files").update({"status": "error"}) \
            .eq("id", audio_file_id).execute()
