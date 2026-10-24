#!/usr/bin/env python3
"""Independently verify the emitted short curriculum, without the builder."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent


def main():
    data = {}
    owners = {}
    for split, expected in (("train", 60), ("validation", 10), ("test", 10)):
        data[split] = [json.loads(line) for line in (ROOT / f"{split}.jsonl").read_text().splitlines()]
        assert len(data[split]) == expected
        for row in data[split]:
            assert set(row) == {"id", "family", "text"}
            assert owners.setdefault(row["family"], split) == split
            assert row["text"][0].isupper() and row["text"].endswith(".")
            assert re.search(r"\bI\b", row["text"])
    rows = sum(data.values(), [])
    assert len({row["id"] for row in rows}) == len(rows)
    assert len({row["text"].lower() for row in rows}) == len(rows)
    sentences = [s for row in rows for s in re.split(r"(?<=[.!?])\s+", row["text"])]
    assert len(set(s.lower() for s in sentences)) == len(sentences)
    words = lambda text: re.findall(r"\b[a-z]+(?:'[a-z]+)*\b", text.lower())
    assert all(40 <= len(words(row["text"])) <= 70 for row in rows)
    assert all(5 <= len(re.split(r"(?<=[.!?])\s+", row["text"])) <= 8 for row in rows)
    ratio = sum(6 <= len(words(s)) <= 10 for s in sentences) / len(sentences)
    assert ratio > 0.95
    frozen = ROOT.parent / "data" / "train.jsonl"
    frozen_sha = hashlib.sha256(frozen.read_bytes()).hexdigest()
    assert frozen_sha == "e60d4afb7bf6c44a146fb3103500f278722d5d2e51ce6b2b828f89c61a90e383"
    report = {
        "status": "PASS", "episodes": len(rows), "sentences": len(sentences),
        "word_count": sum(len(words(s)) for s in sentences),
        "sentence_6_to_10_word_ratio": ratio,
        "exact_duplicate_sentences": 0, "exact_duplicate_episodes": 0,
        "family_disjoint_within_short_curriculum": True,
        "original_long_training_corpus_unchanged": True,
        "original_long_training_sha256": frozen_sha,
        "input_sha256": {split: hashlib.sha256((ROOT / f"{split}.jsonl").read_bytes()).hexdigest() for split in data},
        "limits": "Structural audit only; not an automatic grammar or model quality judgment.",
    }
    (ROOT / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
