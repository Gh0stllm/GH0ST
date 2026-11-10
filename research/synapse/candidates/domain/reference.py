#!/usr/bin/env python3
"""Exact integer inference and fixture validation for SYNAPSE model schema v2."""
import argparse
import hashlib
import json
from pathlib import Path


def trunc_div(value, denominator):
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    return (1 if value >= 0 else -1) * (abs(value) // denominator)


def validate(model):
    width, context, count = model["hiddenSize"], model["contextSize"], len(model["vocab"])
    if model["schema"] != "gh0st-synapse-model-v2" or len(model["experts"]) != 2:
        raise ValueError("unsupported model schema")
    if len(model["embeddings"]) != context * count * width:
        raise ValueError("embedding dimensions do not match")
    if len(model["headWeights"]) != count * width or len(model["headBias"]) != count:
        raise ValueError("head dimensions do not match")
    for expert in model["experts"]:
        if len(expert["weights"]) != width * width or len(expert["bias"]) != width:
            raise ValueError("expert dimensions do not match")


def forward(model, tokens, expert_overrides=None):
    width, context, count = model["hiddenSize"], model["contextSize"], len(model["vocab"])
    scale, maximum = model["scale"], model["activationMax"]
    if len(tokens) != context or any(type(token) is not int or not 0 <= token < count for token in tokens):
        raise ValueError("context must have the model's exact number of valid integer token IDs")
    overrides = expert_overrides or {}
    if any(index not in (0, 1) for index in overrides):
        raise ValueError("expert override index must be zero or one")
    clip = lambda value: max(0, min(maximum, value))
    hidden = [clip(sum(model["embeddings"][(position * count + token) * width + j]
                       for position, token in enumerate(tokens))) for j in range(width)]
    activations = []
    for index, original in enumerate(model["experts"]):
        expert = overrides.get(index, original)
        activations.append([clip(trunc_div(sum(expert["weights"][o * width + j] * hidden[j]
                                              for j in range(width)), scale) + expert["bias"][o])
                            for o in range(width)])
    merged = [trunc_div(activations[0][j] + activations[1][j], 2) for j in range(width)]
    logits = [trunc_div(sum(model["headWeights"][o * width + j] * merged[j]
                            for j in range(width)), scale) + model["headBias"][o] for o in range(count)]
    return {"hidden": hidden, "expertActivations": activations, "merged": merged, "logits": logits,
            "token": max(range(count), key=logits.__getitem__)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    root = args.directory
    for name, expected in json.loads((root / "manifest.json").read_text()).items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
    model = json.loads((root / "model.json").read_text())
    alternate = json.loads((root / "alternate-expert.json").read_text())
    fixture_set = json.loads((root / "fixtures.json").read_text())
    validate(model)
    model_hash = hashlib.sha256((root / "model.json").read_bytes()).hexdigest()
    assert fixture_set["modelSha256"] == model_hash == alternate["compatibleModelSha256"]
    for fixture in fixture_set["fixtures"]:
        overrides = {1: alternate} if fixture["variant"] == "alternate" else None
        assert forward(model, fixture["tokens"], overrides) == fixture["expected"], fixture["id"]
    print(f"PASS: dimensions, SHA-256 manifest, alternate compatibility, {len(fixture_set['fixtures'])} exact integer traces")


if __name__ == "__main__":
    main()
