#!/usr/bin/env python3
"""Independent stdlib-only evaluator of the exported integer model artifact."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MASKED = -(1 << 120)


def evaluate(features, artifact):
    if len(features) != 8 or any(type(n) is not int for n in features):
        raise ValueError("InvalidFeatureVector")
    if (any(abs(n) > 10000 for n in features[:4]) or not 0 <= features[4] <= 10000
            or not 0 <= features[5] <= 86400 or features[6] not in (1, 2, 3)
            or not 0 <= features[7] < 32):
        raise ValueError("InvalidFeatureVector")
    scores = [MASKED for _ in range(6)]
    if features[7] & 7 != 7 or features[7] & 8:
        scores[5] = 0
        return 5, scores
    kind = features[6]
    if kind == 1:
        x, active = [abs(features[0]), 0, 0, 0], [0, 1]
    elif kind == 2:
        x, active = [0, abs(features[0]), 0, 0], [0, 2]
    else:
        x, active = [0, 0, abs(features[2]), abs(features[3])], [0, 3, 4]
    for label in active:
        scores[label] = artifact["biases"][label]
        for column, value in enumerate(x):
            scores[label] += artifact["weights"][label][column] * value
    maximum = max(scores)
    return scores.index(maximum), scores


def main():
    weights_bytes = (ROOT / "weights.json").read_bytes()
    manifest_bytes = (ROOT / "training-manifest.json").read_bytes()
    artifact = json.loads(weights_bytes)
    manifest = json.loads(manifest_bytes)
    vectors = json.loads((ROOT / "parity-vectors.json").read_bytes())
    weights_hash = hashlib.sha256(weights_bytes).hexdigest()
    manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
    assert vectors["weightsHash"] == "0x" + weights_hash
    assert manifest["weightsHash"] == weights_hash
    assert vectors["trainingManifestHash"] == "0x" + manifest_hash
    model_id = hashlib.sha256(b"S0UL_INTEL_OBSERVATION_V1" + bytes.fromhex(weights_hash) + bytes.fromhex(manifest_hash)).hexdigest()
    assert vectors["modelId"] == "0x" + model_id
    for case in vectors["vectors"]:
        label, scores = evaluate(case["features"], artifact)
        assert label == case["label"]
        assert scores == [int(n) for n in case["scores"]]
    for features in vectors["invalidVectors"]:
        try:
            evaluate(features, artifact)
        except ValueError as error:
            assert str(error) == "InvalidFeatureVector"
        else:
            raise AssertionError("Invalid vector accepted")
    print(json.dumps({"result": "PASS", "modelId": "0x" + model_id,
                      "integerVectors": len(vectors["vectors"]), "invalidVectors": len(vectors["invalidVectors"])}))


if __name__ == "__main__":
    main()
