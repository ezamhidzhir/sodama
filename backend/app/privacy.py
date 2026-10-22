"""Privacy filter — human speech is muted before any audio is stored.

SODAMA collects sounds, not people. Every recording, upload and device clip
passes through here first: YAMNet scores each 0.96 s window, any window where a
speech class is likely is muted (with a little padding either side), and only
the muted version is ever written to storage. The original with the voice in it
never leaves the request's memory.

Muted rather than cut, so a clip keeps its length and every timestamp in the
classification timeline still lines up with the sound.

This is best effort: it is only as good as YAMNet's speech detection. A whisper
under loud machinery can slip through, which is why Community also has a
Report button.
"""
from dataclasses import dataclass, field

import numpy as np

from . import audio, classifier, config

# YAMNet classes that carry words. Singing, laughter, crying and screaming are
# left alone: they are non-verbal or musical, and muting them would gut music
# and animal-adjacent recordings for little privacy gain. Names are as
# classifier.class_names() gives them (the class map's text before any comma:
# "Child speech, kid speaking" is "Child speech").
SPEECH_CLASSES = {
    "Speech", "Child speech", "Conversation", "Narration", "Babbling",
    "Speech synthesizer", "Shout", "Bellow", "Whoop", "Yell", "Children shouting",
    "Whispering", "Rapping", "Chatter", "Hubbub",
}
FADE_SECONDS = 0.02   # short ramps so a muted stretch does not start with a click


@dataclass
class Result:
    waveform: np.ndarray            # what may be stored
    scores: np.ndarray              # YAMNet scores of that waveform
    redactions: list[list[float]] = field(default_factory=list)   # [[start, end], ...] seconds

    @property
    def removed_seconds(self) -> float:
        return round(sum(e - s for s, e in self.redactions), 2)

    def speech_share(self, duration: float) -> float:
        return self.removed_seconds / duration if duration else 0.0


def _speech_columns() -> list[int]:
    names = classifier.class_names()
    return [i for i, n in enumerate(names) if n in SPEECH_CLASSES]


def speech_ranges(scores: np.ndarray, duration: float) -> list[list[float]]:
    """Stretches (seconds) where speech is likely, padded and merged."""
    if not scores.size:
        return []
    speech = scores[:, _speech_columns()].max(axis=1) >= config.PRIVACY_SPEECH_THRESHOLD
    pad = config.PRIVACY_PADDING_SECONDS
    ranges: list[list[float]] = []
    for w in np.flatnonzero(speech):
        start = max(0.0, w * classifier.HOP_SECONDS - pad)
        end = min(duration, w * classifier.HOP_SECONDS + classifier.WINDOW_SECONDS + pad)
        if ranges and start <= ranges[-1][1]:
            ranges[-1][1] = max(ranges[-1][1], end)
        else:
            ranges.append([start, end])
    return [[round(float(s), 2), round(float(e), 2)] for s, e in ranges if e > s]


def merge_ranges(ranges: list[list[float]]) -> list[list[float]]:
    out: list[list[float]] = []
    for s, e in sorted(ranges):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [[round(float(s), 2), round(float(e), 2)] for s, e in out]


def mute(waveform: np.ndarray, ranges: list[list[float]]) -> np.ndarray:
    out = waveform.copy()
    ramp = int(FADE_SECONDS * audio.SAMPLE_RATE)
    for start, end in ranges:
        a, b = int(start * audio.SAMPLE_RATE), int(end * audio.SAMPLE_RATE)
        out[a:b] = 0.0
        if ramp and a - ramp >= 0:
            out[a - ramp:a] *= np.linspace(1, 0, ramp, dtype=np.float32)
        if ramp and b + ramp <= out.size:
            out[b:b + ramp] *= np.linspace(0, 1, ramp, dtype=np.float32)
    return out


def filter_speech(waveform: np.ndarray) -> Result:
    """Mute speech; return the safe waveform and YAMNet's view of it."""
    duration = waveform.size / audio.SAMPLE_RATE
    scores = classifier.scores(waveform)
    ranges = speech_ranges(scores, duration)
    if not ranges:
        return Result(waveform, scores)
    muted = mute(waveform, ranges)
    # Classify what is actually stored, so the timeline shows silence where the
    # voice was rather than a "Speech" label pointing at nothing.
    return Result(muted, classifier.scores(muted), ranges)
