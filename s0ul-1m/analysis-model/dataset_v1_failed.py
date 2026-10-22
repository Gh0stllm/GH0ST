"""Offline authored fact-only labels. This generator is never used as inference."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import random

from analysis_codec import FIELDS, canonical_json, encode_features, encode_words, sha256, validate_features, write_specs


def label(features):
    c, n, m, o, p, i, a, s, r, d, w, t, e, complete = validate_features(features)
    if not c:
        return " ".join(("No runtime code observed.", "Native funds present." if n else "Native balance zero.",
                         "This snapshot cannot establish identity, history, value, or safety."))
    primary_tag = ""
    if p == 2:
        primary, primary_tag = "Paused state reported.", "pause"
    elif r:
        primary, primary_tag = ("Pool reports zero reserves." if r == 1 else "Pool reports positive reserves."), "pool"
    elif a == 2 and s == 2:
        primary, primary_tag = "Asset and positive supply reported.", "asset_supply"
    elif i == 2:
        primary, primary_tag = "Implementation address reported.", "implementation"
    elif m:
        primary, primary_tag = ("NFT interfaces claimed." if m & 2 and m & 4 else
                               "ERC721 interface claimed." if m & 2 else
                               "ERC1155 interface claimed." if m & 4 else
                               "Royalty interface claimed." if m & 8 else "ERC165 interface claimed."), "interface"
    elif o:
        primary, primary_tag = ("Owner address reported." if o == 2 else "Zero owner address reported."), "owner"
    elif s:
        primary, primary_tag = ("Positive supply reported." if s == 2 else "Zero supply reported."), "supply"
    else:
        primary, primary_tag = "Interface probes inconclusive.", "inconclusive"
    if i == 2 and primary_tag != "implementation":
        secondary = "Implementation address reported."
    elif o == 2:
        secondary = "Owner getter is unverified."
    elif o == 1:
        secondary = "Zero owner reported."
    elif a:
        secondary = "Asset address reported." if a == 2 else "Zero asset reported."
    elif i == 1:
        secondary = "Zero implementation reported."
    elif s:
        secondary = "Positive supply reported." if s == 2 else "Zero supply reported."
    elif p == 1:
        secondary = "Unpaused state reported."
    else:
        secondary = "Getter evidence is limited."
    if not complete:
        interaction = "Scan incomplete; detected patterns are partial."
    elif d and w:
        interaction = "Delegate execution with storage writes warrants review."
    elif d and i == 2:
        interaction = "Implementation and delegate patterns require inspection."
    elif t and e:
        interaction = "Origin checks with external calls warrant review."
    elif d:
        interaction = "Delegate execution pattern warrants review."
    elif w and e:
        interaction = "Storage writes with external calls warrant review."
    elif t:
        interaction = "Origin checks warrant review."
    elif e:
        interaction = "External calls warrant review."
    elif w:
        interaction = "Storage writes observed."
    else:
        interaction = "Selected scan patterns absent."
    result = " ".join(("Runtime code observed.", "Native funds present." if n else "Native balance zero.",
                       primary, secondary, interaction, "Safety and value remain unknown."))
    encode_words(result)
    return result


def split_of(features):
    # Exact full-vector membership is independently hash-partitioned. Additionally
    # hold out one three-field combination to test compositional generalization.
    if features[0] and features[3] == 2 and features[4] == 2 and features[11] == 1:
        return "combination_test"
    value = int(sha256(b"s0ul-analysis-split-v1:" + bytes(features))[:8], 16) % 100
    return "test" if value < 10 else "validation" if value < 20 else "train"


def make_data(root, train_size=24000, validation_size=512, test_size=512, combination_size=256, seed=20261022):
    root = Path(root)
    if root.exists() and any(root.iterdir()):
        raise ValueError("dataset destination must be fresh")
    root.mkdir(parents=True)
    rng, seen = random.Random(seed), set()
    desired = {"train": train_size, "validation": validation_size, "test": test_size, "combination_test": combination_size}
    rows = {k: [] for k in desired}
    attempts = 0
    while any(len(rows[k]) < v for k, v in desired.items()):
        attempts += 1
        # Broad independent combinations plus sparse getter views, never hidden
        # identities or off-chain prices. Code-free cases have only two states.
        v = [1, rng.randrange(2), rng.randrange(16),
             *(rng.choices((0, 1, 2), weights=(5, 2, 3), k=6)),
             *(rng.randrange(2) for _ in range(5))]
        if attempts % 4 == 0:
            v[3:9] = [rng.choice((0, 0, 0, 1, 2)) for _ in range(6)]
        v = tuple(v)
        if v in seen:
            continue
        seen.add(v)
        split = split_of(v)
        if len(rows[split]) >= desired[split]:
            continue
        response = label(v)
        rows[split].append({"features": list(v), "prompt_ids": encode_features(v),
                            "response": response, "response_ids": encode_words(response)})
    # These exhaustive no-code edge cases are training and separate regression
    # cases; they are NOT misrepresented as independent held-out examples.
    for n in (0, 1):
        v = (0, n, *(0 for _ in range(11)), 1)
        rows["train"].append({"features": list(v), "prompt_ids": encode_features(v),
                              "response": label(v), "response_ids": encode_words(label(v))})
    files, max_words = {}, 0
    for split, records in rows.items():
        rng.shuffle(records)
        for index, row in enumerate(records):
            row["id"] = f"analysis-v1-{split}-{index:06d}"
            max_words = max(max_words, len(row["response_ids"]) - 1)
        raw = b"".join(canonical_json(row) + b"\n" for row in records)
        path = root / f"{split}.jsonl"
        path.write_bytes(raw)
        files[split] = {"path": path.name, "examples": len(records), "sha256": sha256(raw)}
    manifest = {"format": "s0ul-analysis-dataset-v1", "seed": seed, "files": files,
                "label_source": "deterministic authored fact-only rules; no teacher, external feed, address history or financial labels",
                "generator_sha256": sha256(Path(__file__).read_bytes()),
                "feature_schema_sha256": sha256(canonical_json(__import__('analysis_codec').schema_spec())),
                "partition": "SHA256 of full feature vector; train/validation/test disjoint",
                "combination_holdout": "owner=nonzero AND pause=true AND origin=present is excluded from train/validation/ordinary test",
                "no_code_cases": "two exhaustive training cases; independently checked as regression, not test generalization",
                "maximum_response_words": max_words,
                "limitations": ["Authored labels measure agreement with this finite fact task, not real-world analyst expertise.",
                                "Feature combinations can include adversarial or inconsistent getter reports.",
                                "Output deliberately prioritizes observations; it does not enumerate every feature."]}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "data-v1")
    parser.add_argument("--train-size", type=int, default=24000)
    args = parser.parse_args()
    write_specs(Path(__file__).parent)
    print(json.dumps(make_data(args.output, train_size=args.train_size), indent=2))
