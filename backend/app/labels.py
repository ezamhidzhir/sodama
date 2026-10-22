"""Deriving one file-level label from YAMNet's per-window predictions.

YAMNet scores every 0.96 s window and we keep the top-k of each, so a 20 s clip
carries ~120 prediction rows. Collapsing those into a single label is a judgement
call, and the review panel and the dataset export MUST make it the same way —
otherwise a trainer approves "Pump (liquid)" and the manifest ships something
else. Both call through here.

The rule is mean confidence over **every** window of the file, counting a
window where the class was not among the kept predictions as 0. A class
therefore scores high only when it is both confident and present for most of
the file. (Averaging only over the windows a class appears in — the earlier
rule — let one loud dog bark in a 60 s car recording outrank the car.)
`GET /audio` ranks by peak confidence instead — that column is a browsing
hint, not the label of record.
"""
from collections import defaultdict

CHUNK = 200  # keep the PostgREST `in.(...)` filter inside URL length limits


LABEL_SOURCES = ("human_annotated", "human_confirmed", "human_corrected", "auto")


def class_ranking(rows: list[dict]) -> list[dict]:
    """Classes of one file, best first: mean confidence over all of its windows,
    plus how many windows each class was predicted in."""
    windows = {r["window_start"] for r in rows}
    if not windows:
        return []
    by_class: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        by_class[r["class_name"]].append(r["confidence"])
    ranked = [{"class_name": name, "mean_confidence": round(sum(v) / len(windows), 4),
               "windows": len(v)} for name, v in by_class.items()]
    return sorted(ranked, key=lambda x: (-x["mean_confidence"], x["class_name"]))


def predicted_labels(client, audio_ids: list[str]) -> dict[str, tuple[str, float]]:
    """Map audio_file_id -> (top class by `class_ranking`, its score).

    Files with no classification rows are simply absent from the result.
    """
    if not audio_ids:
        return {}

    per_file: dict[str, list[dict]] = defaultdict(list)
    for i in range(0, len(audio_ids), CHUNK):
        rows = (client.table("classifications")
                .select("audio_file_id, class_name, confidence, window_start")
                .in_("audio_file_id", audio_ids[i:i + CHUNK]).execute().data)
        for r in rows:
            per_file[r["audio_file_id"]].append(r)

    out: dict[str, tuple[str, float]] = {}
    for file_id, rows in per_file.items():
        top = class_ranking(rows)[0]
        out[file_id] = (top["class_name"], top["mean_confidence"])
    return out


def final_label(row: dict, predicted: tuple[str, float] | None) -> tuple[str | None, str]:
    """The label a trainer should actually train on, plus where it came from.

    Provenance mirrors the convention in published datasets (NVIDIA's
    Nemotron audio set records `human` vs `llm_jury` per label), but splits the
    human case so a reader can tell a rubber-stamped prediction from a real
    correction:

      human_annotated — the recordist named the sound while recording it
      human_corrected — a reviewer typed a different label
      human_confirmed — a reviewer agreed with YAMNet
      auto            — nobody has looked at it yet

    `human_annotated` is kept apart from `human_corrected` on purpose: a person
    who recorded a Honda and typed "Honda" did not *correct* YAMNet's "Vehicle"
    — they never saw it. Calling that a correction would inflate the apparent
    error rate of the model in every export.
    """
    pred_name = predicted[0] if predicted else None
    verified = row.get("verified_label")
    if not verified:
        return pred_name, "auto"
    if row.get("label_origin") == "capture":
        return verified, "human_annotated"
    return verified, "human_confirmed" if verified == pred_name else "human_corrected"


def canonical_label(label: str, known: list[str]) -> str:
    """Reuse the existing spelling of a class if one matches case-insensitively.

    "honda", "Honda " and "HONDA" must not become three classes in a training
    set — a model would learn them as three different sounds.
    """
    clean = " ".join(label.split())
    for k in known:
        if k.casefold() == clean.casefold():
            return k
    return clean
