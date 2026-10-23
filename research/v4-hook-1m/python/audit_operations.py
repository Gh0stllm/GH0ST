#!/usr/bin/env python3
"""Count executed Linear MACs and selected nonlinear operations for one input.

This is an architecture audit, not gas extrapolation or a full FLOP count.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import torch
from torch import nn
from model_experiment import ROOT, sha256, write_json
from predict_model import ResearchPredictor


def main() -> None:
    predictor = ResearchPredictor()
    fixture = np.load(ROOT / 'model-data/adapted/heldout-fixtures.npz')['history'][:1]
    rows, handles = [], []
    def hook(name, module):
        def record(_module, inputs, output):
            row = {'module': name, 'type': type(module).__name__,
                   'input_shape': list(inputs[0].shape), 'output_shape': list(output.shape),
                   'output_elements': output.numel()}
            if isinstance(module, nn.Linear):
                row.update(in_features=module.in_features, out_features=module.out_features,
                           multiply_accumulates=output.numel() * module.in_features,
                           bias_additions=output.numel() if module.bias is not None else 0)
            rows.append(row)
        return record
    for prefix, model in (('base', predictor.base), ('head', predictor.head)):
        for name, module in model.named_modules():
            if isinstance(module, (nn.Linear, nn.LayerNorm, nn.GELU, nn.Softmax, nn.ReLU)):
                handles.append(module.register_forward_hook(hook(prefix + '.' + name, module)))
    try:
        output = predictor.predict(fixture)
    finally:
        for handle in handles: handle.remove()
    linear = [row for row in rows if row['type'] == 'Linear']
    assert len(linear) > 2 and all(row['multiply_accumulates'] > 0 for row in linear)
    report = {'schema_version': 1, 'scope': 'Single complete 512-observation CPU prediction through saved FP32 base and head',
              'script_sha256': sha256(Path(__file__)), 'batch_size': 1, 'parameters': 812195,
              'linear_multiply_accumulates': sum(row['multiply_accumulates'] for row in linear),
              'linear_bias_additions': sum(row['bias_additions'] for row in linear),
              'linear_calls': len(linear), 'selected_module_calls': rows,
              'output_class': int(output['classes'][0]),
              'limitations': ['MAC count is not gas, and does not include all arithmetic.',
                             'Functional scaling, reductions, residuals, gating and tensor manipulation are not fully counted.',
                             'Integer normalization, GELU and softmax require separate faithful specifications.',
                             'Weights are reused across patches; parameter count alone does not determine inference work.']}
    write_json(ROOT / 'reports/operation-audit.json', report)
    print(json.dumps({key: value for key, value in report.items() if key != 'selected_module_calls'}, indent=2))


if __name__ == '__main__':
    main()
