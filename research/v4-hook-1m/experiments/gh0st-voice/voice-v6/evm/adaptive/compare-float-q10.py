#!/usr/bin/env python3
"""Measure float/Q10 drift on identical token histories; show native float prose separately."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
import torch
from safetensors.torch import load_file
from reference import Reference

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'training'))
from model import VoiceModel
from engine import sample


@torch.no_grad()
def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--model-dir', type=Path, required=True)
    p.add_argument('--q10-streams', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    torch.set_num_threads(2)
    manifest = json.loads((a.model_dir/'manifest.json').read_text())
    source_hash = hashlib.sha256((a.checkpoint/'model.safetensors').read_bytes()).hexdigest()
    assert manifest['checkpoint_sha256'] == source_hash
    quant = Reference(a.model_dir)
    model = VoiceModel(np.ones(8192))
    model.load_state_dict(load_file(a.checkpoint/'model.safetensors'))
    model.eval()
    streams = json.loads(a.q10_streams.read_text())
    assert streams['checkpoint_sha256'] == source_hash
    features = streams['featuresQ10']
    tensor_features = torch.tensor([features], dtype=torch.float32)/1024
    drift = []
    for row in streams['streams']:
        hidden = [0]*224
        state = torch.zeros(1, 224)
        previous = 8192
        values = []
        for index, token in enumerate(row['tokens']):
            result = quant.step(previous, hidden, features, row['seed_bytes32'], index,
                                streams['temperatureQ10'], scalar=False)
            assert result['token'] == token
            state = model.step(torch.tensor([previous]), state, tensor_features, domain=0)
            group_scores = model.logits(state)[0].numpy()
            word_scores = model.logits(state, result['group'])[0].numpy()
            fp_scores = np.concatenate((group_scores, word_scores))
            q_scores = np.asarray(result['scores'])/1024
            hidden_error = np.abs(state[0].numpy()-np.asarray(result['hidden'])/1024)
            score_error = np.abs(fp_scores-q_scores)
            values.append({'step': index+1, 'hidden_mae': float(hidden_error.mean()),
                           'hidden_max_error': float(hidden_error.max()),
                           'logit_mae': float(score_error.mean()), 'logit_max_error': float(score_error.max()),
                           'group_argmax_same': bool(int(group_scores.argmax()) == int(np.asarray(result['scores'][:128]).argmax())),
                           'selected_group_word_argmax_same': bool(int(word_scores.argmax()) == int(np.asarray(result['scores'][128:]).argmax()))})
            previous, hidden = token, result['hidden']
        drift.append({'seed': row['seed'], 'steps': len(values),
                      'mean_hidden_mae': float(np.mean([v['hidden_mae'] for v in values])),
                      'max_hidden_error': max(v['hidden_max_error'] for v in values),
                      'mean_logit_mae': float(np.mean([v['logit_mae'] for v in values])),
                      'max_logit_error': max(v['logit_max_error'] for v in values),
                      'group_argmax_agreement': float(np.mean([v['group_argmax_same'] for v in values])),
                      'selected_word_argmax_agreement': float(np.mean([v['selected_group_word_argmax_same'] for v in values])),
                      'per_step': values})
    float_streams = sample(model, quant.vocab, seeds=tuple(r['seed'] for r in streams['streams']),
                           words=streams['words_per_seed'], temperature=streams['temperatureQ10']/1024)
    result = {'status': 'COMPLETE', 'checkpoint_sha256': source_hash, 'quality_approval': False,
              'comparison': 'Float32 and Q10 driven by identical Q10 token history and features; native float examples use a different sampler',
              'native_float_sampling': 'PyTorch multinomial with true floating softmax; not a paired random trajectory with Solidity Keccak',
              'teacher_forced_drift': drift, 'native_float_streams': float_streams,
              'mainnet_actions': 0}
    a.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('teacher_forced_drift', 'native_float_streams')}, indent=2))
    for row in drift:
        print(json.dumps({k: v for k, v in row.items() if k != 'per_step'}))
    for row in float_streams:
        print(f"float seed {row['seed']}: {row['text']}")


if __name__ == '__main__':
    main()
