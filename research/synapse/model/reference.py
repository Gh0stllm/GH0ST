#!/usr/bin/env python3
"""Exact, dependency-free integer reference for the SYNAPSE toy network."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def trunc_div(numerator: int, denominator: int) -> int:
    """Signed integer division toward zero, matching Solidity."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    return (1 if numerator >= 0 else -1) * (abs(numerator) // denominator)


def _activation(value: int, maximum: int) -> int:
    return max(0, min(maximum, value))


def forward(model: dict, tokens: list[int], expert_overrides: dict[int, dict] | None = None) -> dict:
    """Evaluate exactly two token IDs; overrides replace complete expert modules."""
    width = int(model["hiddenSize"])
    scale = int(model["scale"])
    maximum = int(model["activationMax"])
    vocab_size = len(model["vocab"])
    if len(tokens) != 2 or any(type(t) is not int or t < 0 or t >= vocab_size for t in tokens):
        raise ValueError("tokens must be exactly two valid integer token IDs")
    if model["contextSize"] != 2 or len(model["experts"]) != 2:
        raise ValueError("reference requires context size two and two experts")
    overrides = expert_overrides or {}
    if any(i not in (0, 1) for i in overrides):
        raise ValueError("expert override index must be zero or one")
    hidden = [_activation(int(model["embedding0"][tokens[0] * width + j]) +
                          int(model["embedding1"][tokens[1] * width + j]), maximum)
              for j in range(width)]
    activations = []
    for index, original in enumerate(model["experts"]):
        expert = overrides.get(index, original)
        activations.append([
            _activation(trunc_div(sum(int(expert["weights"][o * width + j]) * hidden[j]
                                      for j in range(width)), scale) + int(expert["bias"][o]), maximum)
            for o in range(width)
        ])
    merged = [trunc_div(activations[0][j] + activations[1][j], 2) for j in range(width)]
    logits = [trunc_div(sum(int(model["headWeights"][o * width + j]) * merged[j]
                            for j in range(width)), scale) + int(model["headBias"][o])
              for o in range(vocab_size)]
    token = max(range(vocab_size), key=logits.__getitem__)
    return {"hidden": hidden, "expertActivations": activations, "merged": merged,
            "logits": logits, "token": token}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path(__file__).with_name("model.json"))
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).with_name("fixtures.json"))
    parser.add_argument("--alternate", type=Path, default=Path(__file__).with_name("alternate-expert.json"))
    args = parser.parse_args()
    model = json.loads(args.model.read_text())
    fixture_set = json.loads(args.fixtures.read_text())
    alternate = json.loads(args.alternate.read_text())
    assert fixture_set["modelSha256"] == sha256_file(args.model), "model digest mismatch"
    assert fixture_set["alternateExpertSha256"] == sha256_file(args.alternate), "expert digest mismatch"
    for fixture in fixture_set["fixtures"]:
        override = {alternate["replaceExpertIndex"]: alternate} if fixture["variant"] == "alternate" else None
        actual = forward(model, fixture["tokens"], override)
        assert actual == fixture["expected"], f"fixture failed: {fixture['id']}"
    print(f"PASS: {len(fixture_set['fixtures'])} exact integer fixtures; model and alternate SHA-256 verified")


if __name__ == "__main__":
    main()
