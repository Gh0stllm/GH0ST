#!/usr/bin/env python3
"""Reproducible tiny-domain training with NumPy backpropagation and Adam."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np

from reference import forward

ROOT = Path(__file__).resolve().parent
SEED = 5102026
SCALE = 256
WIDTH = 8
STEPS = 7000
ALT_STEPS = 5000
SENTENCES = [
    "ghost checks proof", "ghost builds models", "ghost routes tokens", "ghost swaps experts",
    "proof lives on chain", "models learn from tokens", "experts read two tokens",
    "experts share one head", "robinhood is home", "inference runs on icp",
    "chain keeps proof", "tokens guide inference", "one head predicts tokens",
    "two experts share proof", "ghost keeps proof on chain", "ghost runs inference on icp",
    "robinhood keeps ghost home", "icp runs models",
]


def write_json(path: Path, value: dict) -> str:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quantize(value: np.ndarray) -> list[int]:
    # Round to nearest, ties to even (NumPy rint), then export ordinary integers.
    return np.rint(value * SCALE).astype(np.int64).reshape(-1).tolist()


def evaluate(params: dict, x: np.ndarray) -> tuple[np.ndarray, tuple]:
    raw_h = params["e0"][x[:, 0]] + params["e1"][x[:, 1]]
    h = np.maximum(raw_h, 0)
    raw_z = np.stack([np.einsum("ni,oi->no", h, params[f"w{i}"]) + params[f"b{i}"] for i in range(2)])
    z = np.maximum(raw_z, 0)
    merged = z.mean(axis=0)
    logits = np.einsum("ni,oi->no", merged, params["head"]) + params["bias"]
    return logits, (raw_h, h, raw_z, z, merged)


def optimize(params: dict, x: np.ndarray, y: np.ndarray, steps: int,
             train_keys: list[str], lr: float) -> None:
    first = {key: np.zeros_like(params[key]) for key in train_keys}
    second = {key: np.zeros_like(params[key]) for key in train_keys}
    for step in range(1, steps + 1):
        logits, (raw_h, h, raw_z, _z, merged) = evaluate(params, x)
        exps = np.exp(logits - logits.max(axis=1, keepdims=True))
        probs = exps / exps.sum(axis=1, keepdims=True)
        loss = -np.log(probs[np.arange(len(y)), y] + 1e-30).mean()
        dlogits = probs
        dlogits[np.arange(len(y)), y] -= 1
        dlogits /= len(y)
        grads = {"head": np.einsum("no,ni->oi", dlogits, merged), "bias": dlogits.sum(axis=0)}
        dm = np.einsum("no,oi->ni", dlogits, params["head"])
        dh = np.zeros_like(h)
        for i in range(2):
            dz = dm * 0.5 * (raw_z[i] > 0)
            grads[f"w{i}"] = np.einsum("no,ni->oi", dz, h)
            grads[f"b{i}"] = dz.sum(axis=0)
            dh += np.einsum("no,oi->ni", dz, params[f"w{i}"])
        dh *= raw_h > 0
        grads["e0"] = np.zeros_like(params["e0"])
        grads["e1"] = np.zeros_like(params["e1"])
        np.add.at(grads["e0"], x[:, 0], dh)
        np.add.at(grads["e1"], x[:, 1], dh)
        for key in train_keys:
            grad = grads[key] + 1e-5 * params[key]
            first[key] = 0.9 * first[key] + 0.1 * grad
            second[key] = 0.999 * second[key] + 0.001 * grad * grad
            adjusted = (first[key] / (1 - 0.9 ** step)) / (np.sqrt(second[key] / (1 - 0.999 ** step)) + 1e-8)
            params[key] -= lr * adjusted
        if step in (1, steps):
            print(f"step={step} loss={loss:.6f} accuracy={float((logits.argmax(axis=1) == y).mean()):.4f}")


def metrics(model: dict, x: np.ndarray, y: np.ndarray, params: dict,
            overrides: dict | None = None) -> dict:
    predictions = np.array([forward(model, row.tolist(), overrides)["token"] for row in x])
    float_logits, _ = evaluate(params, x)
    float_predictions = float_logits.argmax(axis=1)
    counts = Counter(tuple(row) for row in x.tolist())
    labels = {}
    for row, label in zip(x.tolist(), y.tolist()):
        labels.setdefault(tuple(row), set()).add(label)
    unambiguous = np.array([len(labels[tuple(row)]) == 1 for row in x.tolist()])
    ceiling = sum(max(Counter(y[np.all(x == np.array(row), axis=1)].tolist()).values())
                  for row in counts) / len(y)
    return {"evaluationSplit": "training corpus (no held-out generalization claim)",
            "predictionExamples": len(y), "uniqueContexts": len(counts),
            "integerTop1Accuracy": round(float((predictions == y).mean()), 6),
            "floatTop1Accuracy": round(float((float_predictions == y).mean()), 6),
            "integerFloatTokenAgreement": round(float((predictions == float_predictions).mean()), 6),
            "deterministicContextAccuracy": round(float((predictions[unambiguous] == y[unambiguous]).mean()), 6),
            "contextOnlyMaximumAccuracy": round(ceiling, 6)}


def main() -> None:
    np.seterr(divide="raise", over="raise", invalid="raise")
    vocab = ["<bos>", "<eos>"] + sorted(set(" ".join(SENTENCES).split()))
    assert len(vocab) <= 32
    lookup = {word: i for i, word in enumerate(vocab)}
    x_rows, y_rows = [], []
    for sentence in SENTENCES:
        ids = [0, 0] + [lookup[word] for word in sentence.split()] + [1]
        for i in range(2, len(ids)):
            x_rows.append(ids[i - 2:i])
            y_rows.append(ids[i])
    x, y = np.array(x_rows, dtype=np.int64), np.array(y_rows, dtype=np.int64)
    provenance = {"title": "SYNAPSE original synthetic micro-corpus", "license": "CC0-1.0",
                  "creator": "GH0ST SYNAPSE project; original AI-assisted synthetic phrases",
                  "created": "2026-11-10", "externalTrainingData": False,
                  "statement": "These short phrases were authored for this prototype; no downloaded dataset or pretrained weights are used."}
    corpus_sha = write_json(ROOT / "corpus.json", {"provenance": provenance, "sentences": SENTENCES})
    rng = np.random.default_rng(SEED)
    params = {"e0": rng.normal(0, 0.45, (len(vocab), WIDTH)),
              "e1": rng.normal(0, 0.45, (len(vocab), WIDTH)),
              "head": rng.normal(0, 0.35, (len(vocab), WIDTH)), "bias": np.zeros(len(vocab))}
    for i in range(2):
        params[f"w{i}"] = rng.normal(0, 0.4, (WIDTH, WIDTH))
        params[f"b{i}"] = np.full(WIDTH, 0.1)
    optimize(params, x, y, STEPS, list(params), 0.025)
    model = {"schema": "gh0st-synapse-model-v1", "id": "synapse-micro-2x8-v1",
             "scale": SCALE, "contextSize": 2, "hiddenSize": WIDTH, "activationMax": 32767,
             "vocab": vocab, "embedding0": quantize(params["e0"]), "embedding1": quantize(params["e1"]),
             "experts": [{"id": f"synapse-expert-{i}-v1", "weights": quantize(params[f"w{i}"]),
                          "bias": quantize(params[f"b{i}"])} for i in range(2)],
             "headWeights": quantize(params["head"]), "headBias": quantize(params["bias"]),
             "training": {"method": "NumPy full-batch backpropagation with Adam", "seed": SEED,
                          "steps": STEPS, "learningRate": 0.025, "l2": 1e-5,
                          "quantization": "round-to-nearest ties-to-even at scale 256",
                          "corpusSha256": corpus_sha, "numpyVersion": np.__version__},
             "provenance": provenance}
    model["metrics"] = metrics(model, x, y, params)
    model_sha = write_json(ROOT / "model.json", model)

    # Freeze the exported backbone, other expert and head exactly; only expert 1 learns.
    alt_params = {"e0": np.array(model["embedding0"], dtype=float).reshape(-1, WIDTH) / SCALE,
                  "e1": np.array(model["embedding1"], dtype=float).reshape(-1, WIDTH) / SCALE,
                  "head": np.array(model["headWeights"], dtype=float).reshape(-1, WIDTH) / SCALE,
                  "bias": np.array(model["headBias"], dtype=float) / SCALE}
    for i, expert in enumerate(model["experts"]):
        alt_params[f"w{i}"] = np.array(expert["weights"], dtype=float).reshape(WIDTH, WIDTH) / SCALE
        alt_params[f"b{i}"] = np.array(expert["bias"], dtype=float) / SCALE
    alt_y = y.copy()
    swap_context = [lookup["ghost"], lookup["checks"]]
    swap_rows = np.all(x == swap_context, axis=1)
    alt_y[swap_rows] = lookup["models"]
    # Balance the tiny alternate task so a single changed context is learned reliably.
    alt_x = np.concatenate([x, np.repeat(x[swap_rows], 30, axis=0)])
    alt_targets = np.concatenate([alt_y, np.repeat(alt_y[swap_rows], 30)])
    optimize(alt_params, alt_x, alt_targets, ALT_STEPS, ["w1", "b1"], 0.01)
    alternate = {"schema": "gh0st-synapse-expert-v1", "id": "synapse-expert-1-models-v1",
                 "replaceExpertIndex": 1, "compatibleModelSha256": model_sha,
                 "scale": SCALE, "hiddenSize": WIDTH, "activationMax": 32767,
                 "weights": quantize(alt_params["w1"]), "bias": quantize(alt_params["b1"]),
                 "training": {"method": "NumPy Adam; only expert 1 weights and bias trained",
                              "steps": ALT_STEPS, "learningRate": 0.01, "seed": SEED,
                              "frozenComponents": ["embedding0", "embedding1", "expert0", "headWeights", "headBias"],
                              "changedTarget": {"context": ["ghost", "checks"], "from": "proof", "to": "models"},
                              "changedContextExtraRepeats": 30, "corpusSha256": corpus_sha},
                 "provenance": {"creator": "GH0ST SYNAPSE project", "independentAuthor": False,
                                "statement": "Both base experts and this alternate are trained by the same project; module compatibility is demonstrated, independent contributor authorship is not."}}
    override = {1: alternate}
    alternate["metrics"] = metrics(model, x, alt_y, alt_params, override)
    original = forward(model, swap_context)
    swapped = forward(model, swap_context, override)
    assert original["token"] == lookup["proof"], "base must learn the explicit swap demonstration context"
    assert swapped["token"] == lookup["models"], "alternate expert must change the supported demonstration context"
    alternate["demonstration"] = {"tokens": swap_context, "words": ["ghost", "checks"],
                                  "baseToken": original["token"], "baseWord": vocab[original["token"]],
                                  "alternateToken": swapped["token"], "alternateWord": vocab[swapped["token"]]}
    alternate_sha = write_json(ROOT / "alternate-expert.json", alternate)

    fixture_rows = list(dict.fromkeys(tuple(row) for row in x.tolist()))
    fixtures = []
    for i, row in enumerate(fixture_rows):
        fixtures.append({"id": f"base-{i:03d}", "variant": "base", "tokens": list(row),
                         "words": [vocab[t] for t in row], "expected": forward(model, list(row))})
    for i, row in enumerate([tuple(swap_context)] + fixture_rows[:7]):
        fixtures.append({"id": f"alternate-{i:03d}", "variant": "alternate", "tokens": list(row),
                         "words": [vocab[t] for t in row], "expected": forward(model, list(row), override)})
    fixtures_sha = write_json(ROOT / "fixtures.json", {"schema": "gh0st-synapse-fixtures-v1",
                             "modelSha256": model_sha, "alternateExpertSha256": alternate_sha,
                             "fixtures": fixtures})
    manifest = {"schema": "gh0st-synapse-artifacts-v1", "files": {"corpus.json": corpus_sha,
                "model.json": model_sha, "alternate-expert.json": alternate_sha,
                "fixtures.json": fixtures_sha}}
    write_json(ROOT / "manifest.json", manifest)
    print(json.dumps({"vocabSize": len(vocab), "modelSha256": model_sha,
                      "metrics": model["metrics"], "alternate": alternate["demonstration"],
                      "fixtureCount": len(fixtures)}, indent=2))


if __name__ == "__main__":
    main()
