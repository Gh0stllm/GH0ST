#!/usr/bin/env python3
"""Build original literal micro-episodes. No templates or slot expansion."""
from collections import Counter
import hashlib
import itertools
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent


def words(text):
    return re.findall(r"\b[a-z]+(?:'[a-z]+)*\b", text.lower())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fivegrams(text):
    toks = words(text)
    return set(zip(*(toks[i:] for i in range(5))))


def main():
    splits = {name: [] for name in ("train", "validation", "test")}
    owners = {}
    source = ROOT / "authored-episodes.txt"
    for block in re.split(r"(?m)^@@ ", source.read_text()):
        if not block.strip():
            continue
        header, text = block.split("\n", 1)
        ident, family, split = (x.strip() for x in header.split("|"))
        text = " ".join(text.split())
        assert owners.setdefault(family, split) == split
        sentences = re.split(r"(?<=[.!?])\s+", text)
        assert 5 <= len(sentences) <= 8, (ident, len(sentences))
        assert 40 <= len(words(text)) <= 70, (ident, len(words(text)))
        assert re.search(r"\bI\b", text), ident
        assert text.endswith("."), ident
        splits[split].append({"id": ident, "family": family, "text": text})
    assert [len(splits[x]) for x in splits] == [60, 10, 10]
    rows = sum(splits.values(), [])
    assert len({row["id"] for row in rows}) == 80
    sentences = [s for row in rows for s in re.split(r"(?<=[.!?])\s+", row["text"])]
    assert len(set(s.lower() for s in sentences)) == len(sentences)
    lengths = [len(words(s)) for s in sentences]
    assert sum(6 <= n <= 10 for n in lengths) > len(lengths) * 0.75
    stats = {}
    for split, entries in splits.items():
        path = ROOT / f"{split}.jsonl"
        path.write_text("".join(json.dumps(row) + "\n" for row in entries))
        stats[split] = {
            "episodes": len(entries), "words": sum(len(words(row["text"])) for row in entries),
            "families": sorted({row["family"] for row in entries}),
            "sha256": sha(path),
        }
    overlaps = []
    for a, b in itertools.combinations(splits, 2):
        maximum = (0.0, None, None)
        for left, right in itertools.product(splits[a], splits[b]):
            x, y = fivegrams(left["text"]), fivegrams(right["text"])
            value = len(x & y) / len(x | y)
            if value > maximum[0]:
                maximum = value, left["id"], right["id"]
        overlaps.append({"splits": [a, b], "max_jaccard_fivegrams": maximum[0], "pair": maximum[1:]})
    report = {
        "name": "N0VA original short-sentence curriculum",
        "status": "PASS", "episodes": len(rows), "sentences": len(sentences),
        "words": sum(lengths), "episode_words_min": min(len(words(r["text"])) for r in rows),
        "episode_words_max": max(len(words(r["text"])) for r in rows),
        "sentence_words_distribution": dict(sorted(Counter(lengths).items())),
        "sentence_words_6_to_10_ratio": sum(6 <= n <= 10 for n in lengths) / len(lengths),
        "sentences_with_first_person_pronoun": sum(bool(re.search(r"\b(?:I|me|my)\b", s)) for s in sentences),
        "duplicate_sentences": 0, "duplicate_episodes": 0,
        "family_disjoint_splits": True, "cross_split_overlap": overlaps,
        "source_sha256": sha(source), "builder_sha256": sha(Path(__file__)),
        "splits": stats,
        "provenance": {
            "method": "Original text authored directly by the Codex assistant for this local experiment",
            "external_sources": [], "copied_quotes": False, "slot_templates": False,
            "identity": "Original fictional first-person machine narrator, not an impersonation",
            "relationship_to_long_corpus": "New wording for some shared themes and situations; separate short curriculum, not an independent semantic benchmark",
        },
        "limitations": [
            "Focused single-author synthetic prose, not a guarantee of model grammar or continuity",
            "All episodes have six sentences; measure generated repetition and memorization separately",
            "Short-curriculum heldout families are disjoint internally; the long corpus contains related situations",
        ],
    }
    (ROOT / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
