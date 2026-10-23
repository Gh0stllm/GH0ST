#!/usr/bin/env python3
"""Audit saved model outputs without training, changing weights, or accepting nonsense as novelty.

Coverage is limited to the supplied corpora. This does not prove a sentence was
absent from the original WikiText training prefix, which is unavailable locally.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import random
import re
from pathlib import Path

try:
    import numpy as np
except ImportError:
    np = None

BASE = Path(__file__).resolve().parents[1]
TRACK = BASE / "swap-speaker-535k"
ADJECTIVES = set("quiet calm gentle steady soft measured peaceful patient restless shifting curious uneven changing watchful mixed uncertain wild urgent sharp turbulent intense rapid sudden volatile".split())
NOUNS = set("pool market current rhythm signal machine silence memory".split())


def evidence_path(path):
    try:
        return str(path.relative_to(BASE))
    except ValueError:
        return str(path)


def tokens(text):
    return tuple(re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower()))


def normalize(text):
    return " ".join(re.findall(r"[a-z]+(?:'[a-z]+)?|[.!?]", text.lower()))


def skeleton(text):
    # A deliberately generous diagnostic for the known voice's slot substitutions.
    # A new skeleton is not evidence of grammatical or semantic quality.
    return tuple("<adjective>" if word in ADJECTIVES else "<noun>" if word in NOUNS else word
                 for word in tokens(text))


def distance(left, right):
    row = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        following = [i]
        for j, b in enumerate(right, 1):
            following.append(min(following[-1] + 1, row[j] + 1, row[j - 1] + (a != b)))
        row = following
    return row[-1]


def ngrams(words, size):
    return {words[i:i+size] for i in range(len(words)-size+1)}


class NearestSentences:
    """Exact word-level edit distance, vectorized across equal-length references."""

    def __init__(self, rows):
        self.rows = rows
        self.exact = {}
        self.groups = {}
        self.word_ids = {word: i for i, word in enumerate(sorted({word for row in rows for word in row}))}
        for index, row in enumerate(rows):
            self.exact.setdefault(row, index)
            self.groups.setdefault(len(row), []).append(index)
        if np is not None:
            self.groups = {length: (np.asarray(indices), np.asarray(
                [[self.word_ids[word] for word in rows[index]] for index in indices], dtype=np.int32))
                for length, indices in self.groups.items()}

    def find(self, query):
        if query in self.exact:
            return 0, self.exact[query]
        if np is None:
            return min((distance(query, row), i) for i, row in enumerate(self.rows))
        best, best_index = distance(query, self.rows[0]), 0
        encoded = [self.word_ids.get(word, -1) for word in query]
        for length in sorted(self.groups, key=lambda size: abs(size-len(query))):
            if abs(length-len(query)) > best:
                continue
            indices, references = self.groups[length]
            previous = np.repeat(np.arange(length+1, dtype=np.int32)[:, None], len(indices), axis=1)
            for i, word in enumerate(encoded, 1):
                following = np.empty_like(previous)
                following[0] = i
                for j in range(1, length+1):
                    following[j] = np.minimum(np.minimum(following[j-1]+1, previous[j]+1),
                                              previous[j-1]+(references[:, j-1] != word))
                previous = following
            location = int(np.argmin(previous[-1]))
            result = int(previous[-1, location]), int(indices[location])
            if result < (best, best_index):
                best, best_index = result
        return best, best_index


def audit(output_path, corpus_paths):
    saved = json.loads(output_path.read_text())
    outputs = saved["outputs"]
    train, known, corpus_evidence = set(), set(), []
    for path in corpus_paths:
        document = json.loads(path.read_text())
        assert isinstance(document, dict) and "train" in document, f"No explicit train split: {path}"
        corpus_evidence.append({"path": evidence_path(path),
                                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                "split_sizes": {split: len(rows) for split, rows in document.items()}})
        for split, rows in document.items():
            for item in rows:
                phrase = normalize(item["sentence"])
                known.add(phrase)
                if split == "train":
                    train.add(phrase)
    train_ordered = sorted(train)
    assert train_ordered, "At least one known training sentence is required"
    training_tokens = [tokens(phrase) for phrase in train_ordered]
    nearest_sentences = NearestSentences(training_tokens)
    training_skeletons = {skeleton(phrase) for phrase in train}
    training_ngrams = {size: set().union(*(ngrams(row, size) for row in training_tokens)) for size in [2, 3, 4]}
    counts = collections.Counter(normalize(row["text"]) for row in outputs)
    unique = {}
    for phrase in counts:
        phrase_tokens = tokens(phrase)
        best_distance, best_index = nearest_sentences.find(phrase_tokens)
        nearest = training_tokens[best_index]
        row = {"normalized_text": phrase, "occurrences": counts[phrase],
               "exact_known_train": phrase in train, "exact_any_known_split": phrase in known,
               "known_voice_skeleton": skeleton(phrase) in training_skeletons,
               "nearest_training_sentence": train_ordered[best_index], "word_edit_distance": best_distance,
               "normalized_word_edit_distance": best_distance / max(1, len(phrase_tokens), len(nearest))}
        for size, seen in training_ngrams.items():
            observed = ngrams(phrase_tokens, size)
            row[f"novel_{size}gram_count"] = len(observed-seen)
            row[f"total_{size}gram_count"] = len(observed)
        unique[phrase] = row
    reviewed = []
    for index, output in enumerate(outputs):
        diagnostic = unique[normalize(output["text"])]
        reviewed.append({"sample": index, "text": output["text"],
                         "regime": output.get("regime"), "features": output.get("features"),
                         "stream": output.get("stream"), "step": output.get("step"),
                         "ended_naturally": output.get("ended_naturally"),
                         "controlled_grammar": output.get("controlled_grammar"),
                         "regime_consistent": output.get("regime_consistent"),
                         "repeated_bigram": output.get("repeated_bigram"), **diagnostic})
    count = len(reviewed)
    entropy = -sum((n/count)*math.log(n/count) for n in counts.values()) if count else 0.
    outside = [row for row in reviewed if not row["exact_known_train"]]
    narrow_pass = [row for row in outside if row["ended_naturally"] and row["controlled_grammar"]
                   and row["regime_consistent"] and row["repeated_bigram"] is False]
    groups = collections.defaultdict(list)
    for row in reviewed:
        novelty = "copy" if row["exact_known_train"] else "near_or_slot_variant" if (
            row["known_voice_skeleton"] or row["word_edit_distance"] <= 2) else "new_structure_candidate"
        row["novelty_diagnostic"] = novelty
        fs = row["features"] or [None]*6
        groups[(str(row["regime"]), str(fs[4:6]), novelty)].append(row)
    rng = random.Random(640271)
    for group in groups.values():
        rng.shuffle(group)
    sample = []
    while len(sample) < min(48, count) and any(groups.values()):
        for key in sorted(groups):
            if groups[key] and len(sample) < min(48, count):
                sample.append(groups[key].pop())
    return {
        "schema_version": 1,
        "nearest_distance_backend": "NumPy exact batched Levenshtein" if np is not None else "Python exact Levenshtein",
        "coverage": "All supplied voice-training sentences; original WikiText train prefix is absent and not checked.",
        "output_evidence": {"path": evidence_path(output_path),
                            "sha256": hashlib.sha256(output_path.read_bytes()).hexdigest()},
        "corpora": corpus_evidence,
        "metrics": {"samples": count, "distinct_outputs": len(counts), "effective_output_diversity": math.exp(entropy),
                    "known_train_unique_sentences": len(train),
                    "exact_known_train_outputs": sum(row["exact_known_train"] for row in reviewed),
                    "exact_any_known_split_outputs": sum(row["exact_any_known_split"] for row in reviewed),
                    "nonexact_outputs": len(outside),
                    "nonexact_outputs_passing_reported_narrow_checks": len(narrow_pass),
                    "known_voice_skeleton_outputs": sum(row["known_voice_skeleton"] for row in reviewed),
                    "within_one_word_edit_of_training": sum(row["word_edit_distance"] <= 1 for row in reviewed),
                    "within_two_word_edits_of_training": sum(row["word_edit_distance"] <= 2 for row in reviewed)},
        "interpretation": [
            "Exact training matches measure reproduction; unique output strings do not establish novelty.",
            "Nonexact text can be a held-out slot substitution, fragment, or incoherent blend.",
            "Nearest edit distance, new ngrams, and new skeletons are diagnostics, never quality passes.",
            "Reported controlled-grammar checks share the corpus grammar and do not establish independent coherence.",
            "Credible novelty needs both low training overlap and independent human coherence and grounding review.",
        ],
        "human_review_sample": {
            "selection": "48 or fewer observations, seed 640271, balanced round-robin over regime, metadata flags and novelty class. Diagnostic sample, not an unbiased prevalence estimator.",
            "required_labels": ["complete grammatical sentence", "coherent meaning", "grounded in supplied inputs", "meaningfully new structure rather than copy/slot substitution"],
            "joint_pass_rule": "All four labels must pass. A new but incoherent string is a failure. Review cannot establish absence from missing pretraining data.",
            "samples": sample,
        },
        "most_frequent_outputs": [unique[phrase] for phrase, _ in counts.most_common(15)],
        "nonexact_samples": outside,
        "unique_outputs": sorted(unique.values(), key=lambda row: (-row["occurrences"], row["normalized_text"])),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--outputs", type=Path, default=TRACK/"reports/quality-confirmation-candidate.json")
    parser.add_argument("--corpus", type=Path, action="append")
    parser.add_argument("--out", type=Path, default=TRACK/"reports/novelty-audit.json")
    args = parser.parse_args()
    corpora = args.corpus or [TRACK/"model/voice-corpus.json", TRACK/"quality-candidate-final/quality-corpus.json"]
    report = audit(args.outputs.resolve(), [path.resolve() for path in corpora])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report["metrics"], indent=2))


if __name__ == "__main__":
    main()
