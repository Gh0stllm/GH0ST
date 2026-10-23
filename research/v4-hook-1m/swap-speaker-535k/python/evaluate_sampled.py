#!/usr/bin/env python3
"""Reproduce a saved sampled-decoder audit; never trains or filters outputs."""
import argparse
import json
from pathlib import Path
from finetune_composition import audit
from quality_eval import ROOT, write_json
from sampled_reference import SampledIntegerModel

parser = argparse.ArgumentParser()
parser.add_argument('--model', type=Path, default=ROOT/'composition-candidate-v2')
parser.add_argument('--seed', type=int, default=792461)
parser.add_argument('--sampling-seed', type=int, default=823114)
parser.add_argument('--rounds', type=int, default=50)
parser.add_argument('--out', type=Path, default=ROOT/'reports/composition-v2-sampled-keccak.json')
args = parser.parse_args()
data = json.loads((args.model/'composition-corpus.json').read_text())
model = SampledIntegerModel(args.model, temperature_q10=256, audit_seed=args.sampling_seed)
result = audit(model, data, seed=args.seed, rounds=args.rounds)
result.update(temperature_q10=256, sampling_seed=args.sampling_seed,
              seed_policy='Keccak(audit_seed,call_index,stream_index); reproducible synthetic audit seeds')
write_json(args.out, result)
print(json.dumps(result['metrics'], indent=2))
