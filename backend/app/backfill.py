"""Repair class names stored before the class-map parsing fix (Oct 2026).

YAMNet's class map used to be split on plain commas, so a name such as
"Rodents, rats, mice" was stored as "Rodents". This runs once at startup, in
the background, and does nothing once no truncated name is left.

- A short name only one class could have produced is renamed in place.
- "Inside" (3 classes) and "Outside" (2) cannot be told apart by name, so
  those recordings are classified again from their stored audio, and their
  clips take the new windows exactly as they did when they were cut.

Human labels (`verified_label`) are left alone: a person approved or typed them.
"""
import logging
import threading
from collections import defaultdict

from postgrest.types import CountMethod, ReturnMethod

from . import classifier, clips, config, media, segments
from .db import get_client

logger = logging.getLogger(__name__)
FETCH = 1000   # PostgREST's default row cap per request


def truncated_names(names: list[str]) -> dict[str, list[str]]:
    """Short name the old parser stored -> the full names it could stand for."""
    by_short: dict[str, list[str]] = defaultdict(list)
    for name in names:
        if "," in name:
            by_short[name.split(",")[0].strip()].append(name)
    return dict(by_short)


def _rename(client, by_short: dict[str, list[str]]) -> int:
    renamed = 0
    for short, full in by_short.items():
        if len(full) == 1:
            res = (client.table("classifications")
                   .update({"class_name": full[0]}, count=CountMethod.exact,
                           returning=ReturnMethod.minimal)
                   .eq("class_name", short).execute())
            renamed += res.count or 0
    return renamed


def _replace_rows(client, audio_id: str, rows: list[dict]) -> None:
    """Swap a file's classifications for `rows`. New rows go in before the old
    ones are removed, so a failure never leaves a file with none."""
    newest = (client.table("classifications").select("created_at")
              .eq("audio_file_id", audio_id).order("created_at", desc=True)
              .limit(1).execute().data)
    clips.save_classifications(client, audio_id, rows)
    if newest:
        (client.table("classifications").delete(returning=ReturnMethod.minimal)
         .eq("audio_file_id", audio_id).lte("created_at", newest[0]["created_at"]).execute())


def _clip_rows(root_rows: list[dict], start: float, end: float) -> list[dict]:
    """A clip's windows, as create_clips derives them from its recording."""
    return [{
        "class_name": r["class_name"], "confidence": r["confidence"],
        "window_start": round(max(0.0, r["window_start"] - start), 3),
        "window_end": round(min(end - start, r["window_end"] - start), 3),
    } for r in segments.windows_in(root_rows, start, end)]


def _reclassify(client, root_id: str) -> int:
    root = (client.table("audio_files")
            .select("id, storage_path, parent_id, clip_start, clip_end")
            .eq("id", root_id).execute().data)
    if not root or not root[0].get("storage_path"):
        raise RuntimeError("recording or its stored audio is missing")
    root = root[0]
    try:
        waveform = media.samples(client, root)
    finally:
        media.forget(root["storage_path"])
    rows = classifier.rows_from_scores(classifier.scores(waveform),
                                       config.YAMNET_TOP_K, config.YAMNET_MIN_CONFIDENCE)
    _replace_rows(client, root_id, rows)

    kids = (client.table("audio_files").select("id, clip_start, clip_end")
            .eq("parent_id", root_id).execute().data)
    for kid in kids:
        _replace_rows(client, kid["id"], _clip_rows(rows, kid["clip_start"], kid["clip_end"]))
    return 1 + len(kids)


def _fix_ambiguous(client, shorts: list[str]) -> tuple[int, int]:
    fixed, failed = 0, set()
    while True:
        ids = {r["audio_file_id"] for r in
               client.table("classifications").select("audio_file_id")
               .in_("class_name", shorts).limit(FETCH).execute().data}
        if not ids:
            break
        roots = {r["parent_id"] or r["id"] for r in
                 client.table("audio_files").select("id, parent_id")
                 .in_("id", list(ids)).execute().data} - failed
        if not roots:
            break   # only files that already failed are left
        for root_id in roots:
            try:
                fixed += _reclassify(client, root_id)
            except Exception:
                logger.exception("class-name backfill: could not reclassify %s", root_id)
                failed.add(root_id)
    return fixed, len(failed)


def fix_truncated_class_names() -> None:
    client = get_client()
    by_short = truncated_names(classifier.class_names())
    if not client.table("classifications").select("id").in_(
            "class_name", list(by_short)).limit(1).execute().data:
        return
    renamed = _rename(client, by_short)
    ambiguous = [s for s, full in by_short.items() if len(full) > 1]
    files, failed = _fix_ambiguous(client, ambiguous)
    logger.info("class-name backfill: renamed %d rows, reclassified %d files (%d failed)",
                renamed, files, failed)


def start_in_background() -> None:
    def run():
        try:
            fix_truncated_class_names()
        except Exception:
            logger.exception("class-name backfill failed; it runs again on the next start")
    threading.Thread(target=run, name="class-name-backfill", daemon=True).start()
