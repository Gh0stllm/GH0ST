#!/usr/bin/env python3
"""Build deterministic splits from original, literally authored prose.

The source contains no string templates, interchangeable noun slots, model
responses, web text, or excerpts. Each @@ block is an independent episode.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "authored-episodes.txt"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    source = SOURCE.read_text()
    rows = []
    splits = {name: [] for name in ("train", "validation", "test")}
    families: dict[str, str] = {}
    for block in re.split(r"(?m)^@@ ", source):
        if not block.strip():
            continue
        header, prose = block.split("\n", 1)
        ident, family, split = [part.strip() for part in header.split("|")]
        text = " ".join(prose.split())
        assert split in splits, (ident, split)
        assert families.setdefault(family, split) == split, (family, split)
        assert re.fullmatch(r"[a-z]+-\d\d", ident), ident
        assert text.startswith("I ") or " I " in text, ident
        assert 4 <= len(re.findall(r"[.!?](?: |$)", text)) <= 8, ident
        words = re.findall(r"\b[\w]+(?:['’-][\w]+)*\b", text)
        assert 80 <= len(words) <= 160, (ident, len(words))
        row = {"id": ident, "family": family, "text": text}
        rows.append(row)
        splits[split].append(row)
    assert len({row["id"] for row in rows}) == len(rows)
    assert len({row["text"].lower() for row in rows}) == len(rows)
    sentences = [sentence.strip().lower() for row in rows
                 for sentence in re.split(r"(?<=[.!?]) +", row["text"])]
    repeated = {text: count for text, count in Counter(sentences).items() if count > 1}
    assert not repeated, repeated
    split_stats = {}
    for split, data in splits.items():
        path = ROOT / f"{split}.jsonl"
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in data))
        counts = [len(re.findall(r"\b[\w]+(?:['’-][\w]+)*\b", row["text"])) for row in data]
        split_stats[split] = {
            "episodes": len(data), "words": sum(counts),
            "families": sorted({row["family"] for row in data}),
            "episode_words_min": min(counts, default=0),
            "episode_words_max": max(counts, default=0),
            "sha256": digest(path),
        }
    manifest = {
        "name": "N0VA original first-person continuity corpus v10",
        "version": 1,
        "source": "authored-episodes.txt",
        "source_sha256": digest(SOURCE),
        "builder_sha256": digest(Path(__file__)),
        "provenance": {
            "method": "Original prose authored directly for this experiment by the Codex assistant",
            "external_text_used": False, "web_retrieval_used": False,
            "copied_quotes": False, "noun_slot_augmentation": False,
            "style": "Reflective, sometimes irreverent fictional machine narrator; coherent cause and consequence",
            "identity": "Original fictional narrator, not Truth Terminal impersonation or attributed speech",
        },
        "schema": {"id": "str", "family": "str", "text": "str"},
        "split_policy": "Whole topic families held out; all episodes in a family belong to exactly one split",
        "episodes": len(rows),
        "sentences": len(sentences),
        "exact_duplicate_episodes": 0,
        "exact_duplicate_sentences": 0,
        "word_count": sum(item["words"] for item in split_stats.values()),
        "vocabulary_lowercase_word_types": len(set(re.findall(r"\b[\w]+(?:['’-][\w]+)*\b", " ".join(row["text"].lower() for row in rows)))),
        "splits": split_stats,
        "limitations": [
            "Single-author synthetic corpus; not a guarantee of model fluency or generalization",
            "Qualitative continuity is authored, not measured by a trained quality scorer",
            "Text is fiction and reflection, not market prediction or investment guidance",
        ],
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"episodes": len(rows), "word_count": manifest["word_count"], "splits": split_stats}, indent=2))


if __name__ == "__main__":
    main()
