"""Splitting a long recording into clips — where to cut.

Three ways, all producing [{start, end, label, confidence}] in seconds:

  auto   follow the sound: cut where YAMNet's top class changes, then fold
         stretches shorter than `min_length` into a neighbour so a single
         0.5 s blip does not become its own clip
  fixed  every `length` seconds — what most training pipelines want
  manual the ranges a person dragged on the waveform (validated here)

Only the stored per-window classifications are needed, never the audio, so a
preview is instant even for a ten-minute recording.
"""
from collections import defaultdict

from fastapi import HTTPException

from . import classifier

MIN_CLIP_SECONDS = 0.5
MAX_CLIPS = 500
SILENCE = {"Silence"}


def top_per_window(rows: list[dict]) -> list[tuple[float, str, float]]:
    """(window_start, class, confidence) of each window's best class, in time order."""
    best: dict[float, dict] = {}
    for r in rows:
        w = r["window_start"]
        if w not in best or r["confidence"] > best[w]["confidence"]:
            best[w] = r
    return [(w, best[w]["class_name"], best[w]["confidence"]) for w in sorted(best)]


def _summary(rows: list[dict], start: float, end: float) -> tuple[str | None, float | None]:
    """The clip's likely label: class with the highest mean confidence over the
    windows centred inside it (absent = 0, as in labels.class_ranking)."""
    inside = windows_in(rows, start, end)
    starts = {r["window_start"] for r in inside}
    if not starts:
        return None, None
    total: dict[str, float] = defaultdict(float)
    for r in inside:
        total[r["class_name"]] += r["confidence"]
    name = max(total, key=total.get)
    return name, round(total[name] / len(starts), 4)


def windows_in(rows: list[dict], start: float, end: float) -> list[dict]:
    """Classification rows whose window is centred inside [start, end)."""
    half = classifier.WINDOW_SECONDS / 2
    return [r for r in rows if start <= r["window_start"] + half < end]


def auto(rows: list[dict], duration: float, min_length: float = 1.0,
         skip_silence: bool = True) -> list[dict]:
    tops = top_per_window(rows)
    if not tops:
        raise HTTPException(400, "this recording has no classifications to split by")
    hop = classifier.HOP_SECONDS

    # 1. runs of the same top class; each window owns one hop of time
    runs: list[list] = []          # [start, end, class]
    for w, name, _ in tops:
        end = min(duration, w + hop)
        if runs and runs[-1][2] == name and abs(runs[-1][1] - w) < 1e-6:
            runs[-1][1] = end
        else:
            runs.append([w, end, name])
    if runs:
        runs[-1][1] = duration      # the last window's audio runs to the end

    # 2. fold runs that are too short into the longer neighbour, shortest first
    while len(runs) > 1:
        i = min(range(len(runs)), key=lambda k: runs[k][1] - runs[k][0])
        if runs[i][1] - runs[i][0] >= min_length:
            break
        left = runs[i - 1] if i > 0 else None
        right = runs[i + 1] if i + 1 < len(runs) else None
        target = (left if right is None else right if left is None
                  else left if (left[1] - left[0]) >= (right[1] - right[0]) else right)
        if target is left:
            left[1] = runs[i][1]
        else:
            right[0] = runs[i][0]
        del runs[i]
        # neighbours that now share a class become one run
        merged: list[list] = []
        for r in runs:
            if merged and merged[-1][2] == r[2]:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        runs = merged

    out = []
    for start, end, name in runs:
        if skip_silence and name in SILENCE:
            continue
        label, conf = _summary(rows, start, end)
        out.append({"start": round(start, 2), "end": round(end, 2),
                    "label": label or name, "confidence": conf})
    return out


def fixed(rows: list[dict], duration: float, length: float,
          keep_short_last: bool = False) -> list[dict]:
    if length < MIN_CLIP_SECONDS:
        raise HTTPException(400, f"clip length must be at least {MIN_CLIP_SECONDS} s")
    if duration / length > MAX_CLIPS:
        raise HTTPException(400, f"that would make more than {MAX_CLIPS} clips — use a longer length")
    out, start = [], 0.0
    while start < duration - 1e-6:
        end = min(duration, start + length)
        if end - start < length - 1e-6 and not keep_short_last:
            break                  # training wants equal lengths; drop the tail
        if end - start >= MIN_CLIP_SECONDS:
            label, conf = _summary(rows, start, end)
            out.append({"start": round(start, 3), "end": round(end, 3),
                        "label": label, "confidence": conf})
        start = end
    return out


def validate(ranges: list[tuple[float, float]], duration: float) -> list[tuple[float, float]]:
    if not ranges:
        raise HTTPException(400, "no segments given")
    if len(ranges) > MAX_CLIPS:
        raise HTTPException(400, f"at most {MAX_CLIPS} clips at a time")
    clean = []
    for start, end in ranges:
        start, end = max(0.0, start), min(duration, end)
        if end - start < MIN_CLIP_SECONDS:
            raise HTTPException(400, f"segment {start:.2f}-{end:.2f} s is shorter than "
                                     f"{MIN_CLIP_SECONDS} s")
        clean.append((round(start, 3), round(end, 3)))
    return clean
