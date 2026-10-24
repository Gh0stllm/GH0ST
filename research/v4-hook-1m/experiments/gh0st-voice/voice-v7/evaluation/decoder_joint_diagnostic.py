#!/usr/bin/env python3
"""Unchanged V6: compare hierarchical and true-joint decoding, offline only."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]/'voice-v6/evaluation'))
from sample_fp32 import Adaptive, metrics


def generate(model, method, temperature, seed, count):
    w = model.weights
    state = np.zeros(224, dtype=np.float32)
    previous = 8192
    features = np.array([.125, .25, .125, .5, -1., -1.], dtype=np.float32)
    ids, saturation, retained = [], [], []
    for index in range(count):
        state = model.step(previous, state, features, 0)
        group_logits = (w['groups.weight']@state+w['group_bias.weight'][:, 0]).astype(np.float64)
        group_logp = group_logits-np.logaddexp.reduce(group_logits)
        if method == 'hierarchical':
            group = model.choose(group_logits, seed, index, 0, temperature)
            start = group*64
            logits = w['words.weight'][start:start+64]@state+w['word_bias.weight'][start:start+64, 0]
            within = model.choose(logits, seed, index, 1, temperature)
            previous = start+within
            retained.append(1.)
        else:
            if method == 'joint_global':
                groups = np.arange(128)
            elif method == 'joint_top2':
                groups = np.argsort(-group_logits, kind='stable')[:2]
            else:
                raise ValueError(method)
            retained.append(float(np.exp(group_logp[groups]).sum()))
            token_ids = (groups[:, None]*64+np.arange(64)[None, :]).reshape(-1)
            conditional = (w['words.weight'][token_ids]@state+w['word_bias.weight'][token_ids, 0]).astype(np.float64).reshape(-1, 64)
            conditional -= np.logaddexp.reduce(conditional, axis=1, keepdims=True)
            joint = (group_logp[groups, None]+conditional).reshape(-1)
            selected = model.choose(joint, seed, index, 1, temperature)
            previous = int(token_ids[selected])
        ids.append(int(previous))
        saturation.append(float(np.mean(np.abs(state)>=.999)))
    text = [model.vocab[t] for t in ids]
    return {'status': 'GENERATED', 'method': method, 'temperature_q10': round(temperature*1024),
            'seed': seed, 'token_ids': ids, 'text': ' '.join(text),
            'retained_untempered_group_mass_mean': float(np.mean(retained)),
            'retained_untempered_group_mass_min': float(min(retained)),
            'metrics': metrics(text, {'mean_saturated_fraction': float(np.mean(saturation)),
                                      'final_min': float(state.min()), 'final_max': float(state.max())})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists()
    args.output.mkdir(parents=True)
    model = Adaptive(args.checkpoint, args.data)
    rows = []
    for method, temperature in [('hierarchical', .5), ('joint_global', 1.), ('joint_global', .5), ('joint_top2', .5)]:
        for seed in [0, 42]:
            rows.append(generate(model, method, temperature, seed, 128))
    report = {'status': 'OFFLINE_DIAGNOSTIC_REQUIRES_HUMAN_REVIEW', 'source': model.provenance,
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'entropy': 'Keccak(seed,index,stage): hierarchical uses stages0/1; joint uses stage1 once. Neither words nor seeds are rejected.',
              'joint': 'logP(group)+logP(word|group), divide complete joint log probability by temperature, renormalize over all8192 or selected128 words.',
              'top2_limit': 'Drops every word outside the two highest untempered-probability groups; not exact global sampling. Retained mass is reported.',
              'runtime': 'Global mode is offline only and computes every8192 word logit. No gas claim. Top2 is only a proposal until separately benchmarked.',
              'outputs': rows}
    (args.output/'raw-outputs.json').write_text(json.dumps(report, indent=2)+'\n')
    (args.output/'raw-outputs.txt').write_text('\n\n'.join(f"{r['method']} T{r['temperature_q10']} seed{r['seed']} mass{r['retained_untempered_group_mass_mean']:.4f}\n{r['text']}"for r in rows)+'\n')
    print(json.dumps({'output': str(args.output), 'summary': [{k: r[k] for k in ['method','temperature_q10','seed','retained_untempered_group_mass_mean']}|{'ends':r['metrics']['natural_sentence_ends']} for r in rows]}))


if __name__ == '__main__':
    main()
