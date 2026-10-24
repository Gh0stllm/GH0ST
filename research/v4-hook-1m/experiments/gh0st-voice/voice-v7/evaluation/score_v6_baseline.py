#!/usr/bin/env python3
"""Score frozen grammatical minimal pairs with the unchanged V6 checkpoint."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]/'voice-v6/evaluation'))
from sample_fp32 import Adaptive


def score(model, text, temperature):
    words = model.normalize(text)
    missing = [w for w in words if w not in model.index]
    if missing:
        return {'status': 'UNSUPPORTED', 'unknown_words': missing}
    state = np.zeros(224, dtype=np.float32)
    previous = 8192
    features = np.array([.125, .25, .125, .5, -1., -1.], dtype=np.float32)
    logp = 0.
    for word in words:
        state = model.step(previous, state, features, 0)
        token = model.index[word]
        group = token//64
        weights = model.weights
        logits = (weights['groups.weight']@state+weights['group_bias.weight'][:, 0]).astype(np.float64)/temperature
        logp += float(logits[group]-np.logaddexp.reduce(logits))
        start = group*64
        logits = (weights['words.weight'][start:start+64]@state+weights['word_bias.weight'][start:start+64, 0]).astype(np.float64)/temperature
        logp += float(logits[token%64]-np.logaddexp.reduce(logits))
        previous = token
    return {'status': 'SCORED', 'words': len(words), 'log_probability': logp,
            'mean_nll': -logp/len(words)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    assert not a.output.exists()
    model = Adaptive(a.checkpoint, a.data)
    pairs = json.loads((HERE/'v7-gates.json').read_text())['development']['grammar_pairs']
    rows = []
    for pair in pairs:
        for temperature in [1., .5]:
            yes, no = (score(model, pair[key], temperature) for key in ['preferred', 'dispreferred'])
            comparable = yes['status'] == no['status'] == 'SCORED'
            rows.append(pair | {'hierarchical_stage_temperature': temperature,
                                'preferred_score': yes, 'dispreferred_score': no,
                                'preferred_wins': yes['log_probability'] > no['log_probability'] if comparable else None})
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    report = {'status': 'COMPLETE_BASELINE_NOT_QUALITY_PASS', 'source': model.provenance,
              'gate_sha256': sha(HERE/'v7-gates.json'), 'script_sha256': sha(Path(__file__)),
              'method': 'Full teacher-forced probability from zero/BOS, joint group and word conditional normalization. Same-length minimal pair preferences. Temperatures apply to both hierarchical stages, not global word temperature.',
              'rows': rows}
    a.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'output': str(a.output), 'summary': {
        str(t): {'scored': sum(r['preferred_wins'] is not None for r in rows if r['hierarchical_stage_temperature'] == t),
                 'preferred_wins': sum(r['preferred_wins'] is True for r in rows if r['hierarchical_stage_temperature'] == t)}
        for t in [1., .5]}}))


if __name__ == '__main__':
    main()
