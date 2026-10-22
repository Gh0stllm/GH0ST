#!/usr/bin/env python3
"""Train a reproducible, synthetic observation router; never a market predictor.

This new 25-parameter head is independent of S0UL's original language model.
Its policy teacher scores *observed* changes, not future price or safety. The
runtime receives only features calculated by S0ULObservations on-chain.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent
LABELS = ["normal", "supply_change", "watched_balance_change", "pool_liquidity_change", "pool_price_change", "insufficient_history"]
INPUT_SCALE = 10_000
WEIGHT_SCALE = 1024
THRESHOLD_BPS = 250
MASKED = -(2**120)
TRAIN_SEED, HOLDOUT_SEED = 228104, 908311
TRAIN_COUNT, HOLDOUT_COUNT, STEPS = 8192, 4096, 2200


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def magnitudes(v):
    kind = v[6]
    return [abs(v[0]) if kind == 1 else 0, abs(v[0]) if kind == 2 else 0,
            abs(v[2]) if kind == 3 else 0, abs(v[3]) if kind == 3 else 0]


def eligible(kind):
    return [0, 1] if kind == 1 else [0, 2] if kind == 2 else [0, 3, 4]


def valid(v):
    return (len(v) == 8 and v[6] in (1, 2, 3)
            and all(-10000 <= n <= 10000 for n in v[:4])
            and 0 <= v[4] <= 10000 and 0 <= v[5] <= 86400
            and 0 <= v[7] <= 31)


def quality_ok(v):
    return v[7] & 7 == 7 and v[7] & 8 == 0


def teacher(v):
    if not valid(v):
        raise ValueError("InvalidFeatureVector")
    if not quality_ok(v):
        return 5
    latent = [THRESHOLD_BPS, *magnitudes(v)]
    return max(eligible(v[6]), key=lambda i: (latent[i], -i))


def sample(seed, count):
    rng = random.Random(seed)
    boundary = [-10000, -9999, -251, -250, -249, -1, 0, 1, 249, 250, 251, 9999, 10000]
    vectors = []
    for index in range(count):
        kind = 1 + index % 3
        if index % 4 == 0:
            delta = [rng.choice(boundary) for _ in range(4)]
        elif index % 4 == 1:
            delta = [rng.randint(-500, 500) for _ in range(4)]
        else:
            delta = [rng.randint(-10000, 10000) for _ in range(4)]
        vectors.append([*delta, rng.randint(0, 10000), rng.randint(1, 86400), kind, rng.choice([7, 23])])
    return vectors


def predict(v, weights, biases):
    if not valid(v):
        raise ValueError("InvalidFeatureVector")
    scores = [MASKED] * 6
    if not quality_ok(v):
        scores[5] = 0
        return 5, scores
    x = magnitudes(v)
    for row in eligible(v[6]):
        scores[row] = biases[row] + sum(w * n for w, n in zip(weights[row], x))
    label = max(range(6), key=lambda i: (scores[i], -i))
    return label, scores


def write_contract(model_id, manifest_hash, weights_hash, data_hash, weights, biases):
    flattened = [str(w) for row in weights for w in row]
    w_literal = ", ".join(["int16(" + flattened[0] + ")", *flattened[1:]])
    b_literal = ", ".join(["int64(" + str(biases[0]) + ")", *(str(b) for b in biases[1:])])
    source = f'''// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Independently trained numeric observation router, not S0UL's 984k LM.
/// @dev Synthetic policy routing is not a market forecast or a security verdict.
///      Every score is an uncalibrated integer discriminant, never confidence.
contract S0ULIntelModel {{
    error InvalidFeatureVector();
    bytes32 public constant modelId = hex"{model_id}";
    bytes32 public constant trainingManifestHash = hex"{manifest_hash}";
    bytes32 public constant weightsHash = hex"{weights_hash}";
    bytes32 public constant trainingDataHash = hex"{data_hash}";
    uint16 public constant learnedParameterCount = 25;
    uint16 public constant baselineObservationBps = {THRESHOLD_BPS};
    int256 public constant MASKED_SCORE = -int256(1 << 120);

    /// @return label 0 normal, 1 supply, 2 watched balance, 3 LP liquidity,
    ///         4 reserve-ratio price change, 5 insufficient/undefined history.
    /// @return scores Integer scores in label order. Inactive labels are masked.
    function classify(int32[8] calldata v) external pure returns (uint8 label, int256[6] memory scores) {{
        for (uint256 i; i < 4; ++i) if (v[i] < -10000 || v[i] > 10000) revert InvalidFeatureVector();
        if (v[4] < 0 || v[4] > 10000 || v[5] < 0 || v[5] > 86400
            || v[6] < 1 || v[6] > 3 || v[7] < 0 || v[7] > 31) revert InvalidFeatureVector();
        for (uint256 i; i < 6; ++i) scores[i] = MASKED_SCORE;
        uint8 flags = uint8(uint32(v[7]));
        // Eligibility is an explicit deterministic guard, not a learned score.
        if ((flags & 7) != 7 || (flags & 8) != 0) {{ scores[5] = 0; return (5, scores); }}
        int256[4] memory x;
        if (v[6] == 1) x[0] = _abs(v[0]);
        else if (v[6] == 2) x[1] = _abs(v[0]);
        else {{ x[2] = _abs(v[2]); x[3] = _abs(v[3]); }}
        // Actual quantized output of intel-model/train.py, not hand-set weights.
        int16[20] memory w = [{w_literal}];
        int64[5] memory b = [{b_literal}];
        for (uint256 row; row < 5; ++row) {{
            bool active = row == 0 || (v[6] == 1 && row == 1)
                || (v[6] == 2 && row == 2) || (v[6] == 3 && (row == 3 || row == 4));
            if (!active) continue;
            int256 score = int256(b[row]);
            for (uint256 col; col < 4; ++col) score += int256(w[row * 4 + col]) * x[col];
            scores[row] = score;
        }}
        // Strict greater-than preserves the lowest label on an exact tie.
        for (uint8 i = 1; i < 6; ++i) if (scores[i] > scores[label]) label = i;
    }}

    function _abs(int32 n) private pure returns (int256) {{ return n < 0 ? -int256(n) : int256(n); }}
}}
'''
    path = ROOT.parent / "contracts" / "intel" / "S0ULIntelModel.sol"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source)
    return sha(source.encode())


def main():
    torch.set_num_threads(2)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(TRAIN_SEED)
    vectors = sample(TRAIN_SEED, TRAIN_COUNT)
    heldout = sample(HOLDOUT_SEED, HOLDOUT_COUNT)
    train_rows = [{"vector": v, "policyScoresBps": [THRESHOLD_BPS, *magnitudes(v)], "label": teacher(v)} for v in vectors]
    data_hash = sha(encoded(train_rows))
    inputs = torch.tensor([magnitudes(v) for v in vectors], dtype=torch.float64) / INPUT_SCALE
    targets = torch.tensor([[THRESHOLD_BPS, *magnitudes(v)] for v in vectors], dtype=torch.float64) / INPUT_SCALE
    model = torch.nn.Linear(4, 5, dtype=torch.float64)
    optimizer = torch.optim.Adam(model.parameters(), lr=.04)
    initial_loss = float(torch.nn.functional.mse_loss(model(inputs), targets).detach())
    for _ in range(STEPS):
        optimizer.zero_grad(set_to_none=True)
        loss = torch.nn.functional.mse_loss(model(inputs), targets)
        loss.backward()
        optimizer.step()
    learned_weights = model.weight.detach()
    learned_biases = model.bias.detach()
    weights = torch.round(learned_weights * WEIGHT_SCALE).to(torch.int64).tolist()
    # One-bps output-bias quantization; applied identically to every learned row.
    biases = (torch.round(learned_biases * INPUT_SCALE) * WEIGHT_SCALE).to(torch.int64).tolist()
    if any(abs(w) > 32767 for row in weights for w in row):
        raise RuntimeError("Weight export exceeds int16")
    weight_artifact = {"format": "s0ul-intel-observation-linear-v1", "weights": weights, "biases": biases,
                       "inputScale": INPUT_SCALE, "weightScale": WEIGHT_SCALE, "labels": LABELS,
                       "learnedParameters": 25, "maskedScore": str(MASKED), "normalBaselineBps": THRESHOLD_BPS}
    weights_bytes = encoded(weight_artifact)
    (ROOT / "weights.json").write_bytes(weights_bytes)
    weights_hash = sha(weights_bytes)
    manifest = {"format": "s0ul-intel-training-manifest-v1", "modelFamily": "independent numeric linear observation router",
                "relationshipToLanguageModel": "New independent 25-parameter head; not a fine-tune, continuation, distillation, or replacement of the 984192-parameter S0UL language model.",
                "languageModelCheckpointContextOnly": "44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692",
                "dataSource": "Synthetic bounded feature vectors generated by train.py; no market, news, social, off-chain live analytics, or financial-outcome training data.",
                "policy": "Dominant eligible absolute on-chain change, normal baseline250bps; deterministic history/reader/freshness/zero-baseline guard abstains before scoring.",
                "trainingDataHash": data_hash, "trainSeed": TRAIN_SEED, "holdoutSeed": HOLDOUT_SEED,
                "trainCount": TRAIN_COUNT, "holdoutCount": HOLDOUT_COUNT, "steps": STEPS,
                "optimizer": "Adam", "learningRate": .04, "loss": "MSE of synthetic policy score vectors",
                "dtype": "float64 CPU", "torchVersion": str(torch.__version__), "weightsHash": weights_hash,
                "export": "int16 weights scale1024; learned biases round to1bps then multiply1024; integer inference has no division"}
    manifest_bytes = encoded(manifest)
    (ROOT / "training-manifest.json").write_bytes(manifest_bytes)
    manifest_hash = sha(manifest_bytes)
    model_id = sha(b"S0UL_INTEL_OBSERVATION_V1" + bytes.fromhex(weights_hash) + bytes.fromhex(manifest_hash))
    boundary = [-10000, -9999, -251, -250, -249, -1, 0, 1, 249, 250, 251, 9999, 10000]
    edges = [[x, 0, 0, 0, 0, 300, kind, 7] for kind in (1, 2) for x in boundary]
    edges += [[0, 0, x, y, 0, 300, 3, 7] for x, y in itertools.product(boundary, repeat=2)]
    edges += [[10000, 10000, 10000, -10000, 10000, 86400, kind, flags] for kind in (1, 2, 3) for flags in range(32)]
    evaluations = {}
    for name, cases in [("training", vectors), ("independentHoldout", heldout), ("boundaryAndQuality", edges)]:
        matched = sum(predict(v, weights, biases)[0] == teacher(v) for v in cases)
        evaluations[name] = {"count": len(cases), "matched": matched, "accuracy": matched / len(cases)}
        if matched != len(cases):
            raise RuntimeError(f"Quantized policy parity failed in {name}: {matched}/{len(cases)}")
    parity_cases = edges + heldout[:128]
    parity = {"format": "s0ul-intel-integer-parity-v1", "modelId": "0x" + model_id,
              "trainingManifestHash": "0x" + manifest_hash, "weightsHash": "0x" + weights_hash,
              "trainingDataHash": "0x" + data_hash, "labels": LABELS,
              "vectors": [{"features": v, "label": predict(v, weights, biases)[0],
                           "scores": [str(x) for x in predict(v, weights, biases)[1]]} for v in parity_cases],
              "invalidVectors": [[0] * 8, [10001, 0, 0, 0, 0, 300, 1, 7],
                                 [0, 0, 0, 0, 10001, 300, 1, 7], [0, 0, 0, 0, 0, 86401, 1, 7],
                                 [0, 0, 0, 0, 0, 300, 4, 7], [0, 0, 0, 0, 0, 300, 1, 32]]}
    (ROOT / "parity-vectors.json").write_bytes(encoded(parity))
    contract_hash = write_contract(model_id, manifest_hash, weights_hash, data_hash, weights, biases)
    report = {"format": "s0ul-intel-training-report-v1", "generatedUtc": datetime.now(timezone.utc).isoformat(),
              "result": "PASS", "modelId": "0x" + model_id, "trainingManifestHash": "0x" + manifest_hash,
              "weightsHash": "0x" + weights_hash, "trainingDataHash": "0x" + data_hash,
              "sourceSha256": contract_hash, "initialMSE": initial_loss, "finalMSE": float(loss.detach()),
              "evaluation": evaluations, "parityVectorCount": len(parity_cases),
              "limits": ["Synthetic policy parity is not market prediction, alpha, profitability, or security-audit accuracy.",
                         "This new head is independent of the original984192-parameter language model.",
                         "Label5 is a deterministic eligibility guard, not a calibrated model-uncertainty estimate.",
                         "No EVM execution is claimed here; separate EVM tests must establish Solidity integer parity.",
                         "Synthetic training is a predeployment activity; live features, scores, and reports are computed entirely on-chain."]}
    (ROOT / "training-report.json").write_bytes(encoded(report))
    print(json.dumps({"result": "PASS", "modelId": report["modelId"], "evaluation": evaluations,
                      "finalMSE": report["finalMSE"], "parityVectors": len(parity_cases)}))


if __name__ == "__main__":
    main()
