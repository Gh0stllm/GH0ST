#!/usr/bin/env python3
"""Evaluate saved, frozen candidates on new seeds and explicit simulator shifts."""
from __future__ import annotations

import gzip
import json
import math
from pathlib import Path

import numpy as np
from safetensors.torch import load_file

from model_experiment import (
    ROOT, array_hash, create_head, evaluate_head, history_features,
    metrics, sha256, synthetic_split, write_json,
)
from predict_model import ResearchPredictor


def shifted_split(count: int, seed: int, config: dict, condition: dict) -> dict:
    rng = np.random.default_rng(seed)
    context, horizon = config['context_length'], config['forecast_length']
    regimes = rng.integers(0, 3, size=count)
    means = np.array([3.0, 8.0, 18.0], dtype=np.float64)
    log_volatility, shock = np.log(means[regimes]), np.zeros(count)
    values = np.empty((count, context + horizon), dtype=np.float32)
    for step in range(context + horizon):
        switches = rng.random(count) < condition['switch_probability']
        regimes = np.where(switches, rng.integers(0, 3, size=count), regimes)
        log_volatility = 0.92 * log_volatility + 0.08 * np.log(means[regimes]) + rng.normal(0, 0.045, count)
        impulse = np.where(rng.random(count) < condition['shock_probability'], rng.uniform(0.4, 1.1, count), 0.0)
        shock = 0.90 * shock + impulse
        values[:, step] = np.clip(np.exp(log_volatility + shock + rng.normal(0, condition['observation_noise'], count)), 0.1, 100.0)
    history, future = values[:, :context].copy(), values[:, context:].copy()
    labels = np.digitize(future.mean(axis=1), config['synthetic_target_thresholds_bps']).astype(np.int64)
    return {'history': history, 'future': future, 'labels': labels}


def wilson(correct: int, total: int) -> list[float]:
    z = 1.959963984540054
    p, d = correct / total, 1 + z * z / total
    centre = (p + z * z / (2 * total)) / d
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return [centre - half, centre + half]


def paired(first: np.ndarray, second: np.ndarray, labels: np.ndarray) -> dict:
    a, b = first == labels, second == labels
    first_only, second_only = int(np.sum(a & ~b)), int(np.sum(b & ~a))
    n, k = first_only + second_only, min(first_only, second_only)
    tail = sum(math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) - n * math.log(2)) for i in range(k + 1))
    return {'pretrained_only_correct': first_only, 'history_only_correct': second_only,
            'accuracy_difference_pretrained_minus_history': float(a.mean() - b.mean()),
            'exact_mcnemar_two_sided_p': min(1.0, 2 * tail) if n else 1.0}


def main() -> None:
    experiment_path = ROOT / 'configs/generalization-experiment.json'
    experiment = json.loads(experiment_path.read_text())
    predictor = ResearchPredictor()
    config, scaler = predictor.config, predictor.preprocessing
    # Verify the parameterized simulator matches the original implementation
    # exactly when all original settings are supplied.
    check = synthetic_split(17, 466309, config)
    matching = shifted_split(17, 466309, config, experiment['conditions'][0])
    assert np.array_equal(check['history'], matching['history'])
    assert np.array_equal(check['future'], matching['future'])
    assert all(0 <= wilson(c, 10)[0] <= wilson(c, 10)[1] <= 1 + 1e-15 for c in range(11))
    assert paired(np.array([0, 1]), np.array([1, 0]), np.array([0, 1]))['exact_mcnemar_two_sided_p'] == 0.5
    artifact = ROOT / 'model-data/adapted/history-only-head.safetensors'
    initial = json.loads((ROOT / 'reports/model-benchmark.json').read_text())
    assert sha256(artifact) == initial['artifact_hashes'][str(artifact.relative_to(ROOT))]['sha256']
    history_head = create_head(8, config['head_hidden_width'])
    history_head.load_state_dict(load_file(str(artifact)), strict=True)
    history_head.eval()
    mean, std = np.array(scaler['feature_mean'], dtype=np.float32), np.array(scaler['feature_std'], dtype=np.float32)
    condition_reports, sample_rows = [], []
    for condition in experiment['conditions']:
        aggregate = {name: [] for name in ('labels', 'pretrained', 'history', 'trailing', 'quantized')}
        seeds = []
        for seed in condition['seeds']:
            split = shifted_split(experiment['samples_per_seed'], seed, config, condition)
            value, labels = split['history'], split['labels']
            pred = predictor.predict(value)['classes']
            quantized = predictor.predict(value, quantized=True)['classes']
            features = ((history_features(value) - mean[-8:]) / std[-8:]).astype(np.float32)
            control, _ = evaluate_head(history_head, features)
            trailing = np.digitize(value[:, -32:].mean(axis=1), config['synthetic_target_thresholds_bps']).astype(np.int64)
            values = {'labels': labels, 'pretrained': pred, 'history': control, 'trailing': trailing, 'quantized': quantized}
            for name, array in values.items(): aggregate[name].append(array)
            seeds.append({'seed': seed, 'history_sha256': array_hash(value), 'future_sha256': array_hash(split['future']),
                          'accuracy': {name: float(np.mean(array == labels)) for name, array in values.items() if name != 'labels'}})
            sample_rows.extend({'condition': condition['name'], 'seed': seed, 'index': i,
                                **{name: int(array[i]) for name, array in values.items()}} for i in range(len(labels)))
        joined = {name: np.concatenate(arrays) for name, arrays in aggregate.items()}
        labels = joined['labels']
        results = {}
        for name in ('pretrained', 'history', 'trailing', 'quantized'):
            results[name] = metrics(labels, joined[name])
            results[name]['wilson_95_ci'] = wilson(int(np.sum(labels == joined[name])), len(labels))
        condition_reports.append({'condition': condition, 'samples': len(labels), 'metrics': results,
                                  'paired_comparison': paired(joined['pretrained'], joined['history'], labels),
                                  'quantized_action_agreement': float(np.mean(joined['pretrained'] == joined['quantized'])), 'per_seed': seeds})
        print(condition['name'], json.dumps({name: round(result['accuracy'], 6) for name, result in results.items()}), flush=True)
    sample_path = ROOT / 'reports/generalization-predictions.jsonl.gz'
    payload = ''.join(json.dumps(row, sort_keys=True) + '\n' for row in sample_rows).encode()
    sample_path.write_bytes(gzip.compress(payload, mtime=0))
    report = {'schema_version': 1, 'scope': 'Frozen models; new independent synthetic histories; no real market data or EVM inference',
              'configuration_sha256': sha256(experiment_path), 'script_sha256': sha256(Path(__file__)),
              'initial_artifacts': initial['artifact_hashes'], 'total_samples': len(sample_rows), 'conditions': condition_reports,
              'predictions_file': sample_path.name, 'predictions_sha256': sha256(sample_path),
              'checks': {'default_generator_matches_original_exactly': True, 'no_retraining_or_scaler_refit': True},
              'limitations': ['Confidence intervals condition on the simulator and frozen models, not real pools.',
                             'Stress conditions are selected scenarios, not an exhaustive distribution-shift evaluation.',
                             'Primary paired test is same_generator; stress comparisons are exploratory.',
                             'Classification accuracy is not a measure of economically optimal fees or LP returns.']}
    write_json(ROOT / 'reports/generalization-benchmark.json', report)


if __name__ == '__main__':
    main()
