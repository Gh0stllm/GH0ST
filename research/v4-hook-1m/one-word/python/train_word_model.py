#!/usr/bin/env python3
"""Train a small categorical neural policy and export a complete integer graph.

Words label synthetic future tick-movement regimes. They are not natural-language
reasoning, trading advice or evidence of real-market predictive value.
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import save_file

STUDY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(STUDY / 'python'))
from model_experiment import create_head, fit_head, metrics, write_json

ROOT = Path(__file__).resolve().parents[1]
SCALE = 1024
WORDS = ['CALM', 'WATCH', 'DEFEND']


def dataset(count: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    regimes = rng.integers(0, 3, count)
    scale = np.array([4.0, 19.0, 65.0])[regimes]
    past = np.minimum(np.rint(np.abs(rng.normal(size=(count, 9))) * scale[:, None]), 1024).astype(np.int64)
    # Reproduce the contract's integer EWMA update over eight previous moves.
    ewma = np.zeros(count, dtype=np.int64)
    for index in range(8): ewma = (7 * ewma + past[:, index]) // 8
    current = past[:, -1]
    elapsed = np.minimum(rng.exponential(30, count).astype(np.int64), 300)
    direction = rng.integers(0, 2, count)
    exact_input = rng.integers(0, 2, count)
    features = np.stack([4 * current, 4 * ewma,
                         4 * np.abs(current - past[:, -2]), elapsed * SCALE // 300,
                         np.where(direction, SCALE, -SCALE), np.where(exact_input, SCALE, -SCALE)], axis=1)
    future_scale = scale.copy()
    transitions = rng.random(count) < 0.07
    future_scale[transitions] = np.array([4.0, 19.0, 65.0])[rng.integers(0, 3, transitions.sum())]
    future = np.abs(rng.normal(size=(count, 8))) * future_scale[:, None]
    labels = np.digitize(future.mean(axis=1), [10.0, 35.0]).astype(np.int64)
    return features, labels


def trunc_div(value: int, divisor: int) -> int:
    return value // divisor if value >= 0 else -((-value) // divisor)


def integer_predict(features: list[int], weights: list[int]) -> tuple[int, list[int]]:
    hidden = []
    for row in range(16):
        value = weights[96 + row] * SCALE
        for column in range(6): value += features[column] * weights[row * 6 + column]
        hidden.append(max(0, trunc_div(value, SCALE)))
    logits = []
    for row in range(3):
        value = weights[160 + row] * SCALE
        for column in range(16): value += hidden[column] * weights[112 + row * 16 + column]
        logits.append(trunc_div(value, SCALE))
    return max(range(3), key=lambda index: logits[index]), logits


def main() -> None:
    torch.set_num_threads(2)
    torch.manual_seed(466320)
    torch.use_deterministic_algorithms(True)
    splits = {name: dataset(count, seed) for name, count, seed in [
        ('train', 4096, 466321), ('validation', 1024, 466322), ('test', 2048, 466323)]}
    head = create_head(6, 16)
    train, validation, test = (splits[name] for name in ('train', 'validation', 'test'))
    head, training = fit_head(head, (train[0] / SCALE).astype(np.float32), train[1],
                              (validation[0] / SCALE).astype(np.float32), validation[1],
                              {'learning_rate': 0.003, 'weight_decay': 0.001, 'seed': 466320,
                               'epochs': 180, 'batch_size': 128, 'patience': 24})
    with torch.inference_mode():
        logits = head(torch.from_numpy((test[0] / SCALE).astype(np.float32))).numpy()
    weights = []
    for name in ['0.weight', '0.bias', '2.weight', '2.bias']:
        values = torch.round(head.state_dict()[name].detach() * SCALE).to(torch.int64).flatten().tolist()
        assert all(-32768 <= value <= 32767 for value in values)
        weights.extend(values)
    assert len(weights) == 163
    payload = b''.join(struct.pack('>h', value) for value in weights)
    integer_outputs = [integer_predict(row.tolist(), weights) for row in test[0]]
    integer_classes = np.array([row[0] for row in integer_outputs])
    save_file({name: tensor.detach().contiguous() for name, tensor in head.state_dict().items()}, str(ROOT / 'model/word-head.safetensors'))
    export = {'schema_version': 1, 'architecture': [6, 16, 3], 'parameters': 163,
              'scale': SCALE, 'weight_encoding': 'signed int16 big endian, Q1024; layer1 weights, layer1 biases, layer2 weights, layer2 biases',
              'division': 'signed truncation toward zero after each affine layer', 'activation': 'ReLU after layer1',
              'argmax': 'first index wins ties', 'words': WORDS, 'weights_hex': payload.hex(),
              'weights_sha256': hashlib.sha256(payload).hexdigest(), 'weights': weights,
              'features': ['min(abs(post_tick-pre_tick),1024)*4', 'previous_integer_ewma_move*4',
                           'abs(current_clipped_move-previous_clipped_move)*4', 'min(seconds_since_previous_swap,300)*1024//300',
                           'zeroForOne ? 1024 : -1024', 'amountSpecified < 0 ? 1024 : -1024'],
              'state_update': 'ewma=(7*previous_ewma+current_clipped_move)//8; retain current tick, move, timestamp, increment sequence'}
    write_json(ROOT / 'model/integer-model.json', export)
    vectors = []
    for index in range(96):
        features = test[0][index].tolist()
        category, scores = integer_predict(features, weights)
        vectors.append({'features': features, 'class': category, 'word': WORDS[category], 'logits': scores})
    for features in [[0, 0, 0, 0, -1024, -1024], [4096] * 6, [-4096] * 6,
                     [4096, 0, 4096, 1024, 1024, -1024]]:
        category, scores = integer_predict(features, weights)
        vectors.append({'features': features, 'class': category, 'word': WORDS[category], 'logits': scores})
    write_json(ROOT / 'reports/integer-fixtures.json', vectors)
    summary = {'schema_version': 1, 'scope': 'Small synthetic categorical model; full integer graph exported, no real-market validation',
               'architecture': [6, 16, 3], 'parameters': 163, 'linear_multiply_accumulates': 144,
               'words': WORDS, 'training': {key: value for key, value in training.items() if key != 'history'},
               'split_sizes': {name: len(value[1]) for name, value in splits.items()},
               'target': 'mean absolute tick movement over eight future simulated observations; thresholds 10 and 35 ticks',
               'float32': metrics(test[1], logits.argmax(axis=1)),
               'integer': metrics(test[1], integer_classes),
               'float_integer_class_agreement': float(np.mean(integer_classes == logits.argmax(axis=1))),
               'fixtures': len(vectors), 'weights_sha256': export['weights_sha256'],
               'limitations': ['Finite three-word vocabulary; not generated natural-language reasoning.',
                               'Synthetic regime labels are not optimal fees, trading signals or demonstrated real pool predictions.',
                               'Same word can repeat across swaps with similar features.',
                               'The 163-parameter candidate is separate from the 812,195-parameter TTM experiment.']}
    write_json(ROOT / 'reports/model-training.json', summary)
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
