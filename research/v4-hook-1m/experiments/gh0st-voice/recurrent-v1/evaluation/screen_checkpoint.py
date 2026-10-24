#!/usr/bin/env python3
"""Independent FP32 free-run screen for the H265 hierarchical recurrent model.

Consumes immutable safetensors checkpoints, uses the on-chain branch draw
convention, and never resets state or fabricates terminal punctuation.
"""
import argparse
import hashlib
import json
import math
import os
import re
import subprocess
from collections import Counter
from pathlib import Path

os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')
os.environ.setdefault('OMP_NUM_THREADS', '2')
import numpy as np
try:
    from Crypto.Hash import keccak
except ImportError:
    keccak = None
from safetensors.numpy import load_file

V, H, DEPTH, Q = 8192, 265, 13, 1024
ENTROPY = {}


def random_bits(seed, index):
    if keccak is not None:
        return int.from_bytes(keccak.new(digest_bits=256, data=seed.to_bytes(32,'big')+index.to_bytes(32,'big')).digest(), 'big')
    block = index//256
    if (seed,block) not in ENTROPY:
        node = os.environ.get('NODE_BINARY','/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
        script = "import{keccak256,concat,zeroPadValue,toBeHex}from'ethers';process.stdout.write(JSON.stringify(Array.from({length:256},(_,i)=>keccak256(concat([process.argv[1],zeroPadValue(toBeHex(Number(process.argv[2])+i),32)])))));"
        values = subprocess.check_output([node,'--input-type=module','-e',script,'0x'+seed.to_bytes(32,'big').hex(),str(block*256)],cwd=Path(__file__).resolve().parents[4])
        ENTROPY[(seed,block)] = [int(v,16) for v in json.loads(values)]
    return ENTROPY[(seed,block)][index%256]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(word):
    return re.sub(r'[^a-z\']', '', word.lower())


def ngrams(words, n):
    return [tuple(words[i:i+n]) for i in range(max(0, len(words)-n+1))]


def metrics(words, hidden_stats):
    norm = [canonical(w) for w in words]
    n4 = ngrams(norm, 4)
    counts = Counter(n4)
    return {
        'words': len(words), 'unique_normalized_words': len(set(norm)),
        'natural_sentence_ends': sum(w.endswith(('.', '!', '?')) for w in words),
        'trailing_fragment': bool(words and not words[-1].endswith(('.', '!', '?'))),
        'first_person_tokens': sum(w in {'i', "i'm", "i've", "i'd", "i'll", 'me', 'my', 'mine', 'we', 'our'} for w in norm),
        'repeated_4gram_occurrences': len(n4)-len(counts),
        'repeated_4gram_fraction': (len(n4)-len(counts))/max(1, len(n4)),
        'most_frequent_normalized_words': Counter(norm).most_common(12),
        'repeated_4grams': [{'words': list(k), 'count': v} for k, v in counts.most_common() if v > 1],
        'hidden': hidden_stats,
    }


class Model:
    def __init__(self, checkpoint, data):
        weights_path = checkpoint/'model.safetensors'
        self.weights = load_file(str(weights_path))
        self.vocab = json.loads((data/'vocabulary.json').read_text())
        self.index = {s: i for i, s in enumerate(self.vocab)}
        self.source = {'checkpoint': str(checkpoint), 'weights_sha256': sha(weights_path),
                       'vocabulary_sha256': sha(data/'vocabulary.json')}
        assert len(self.vocab) == V
        expected = {'embedding.weight': (V+1,H), 'wx': (H,H), 'wh': (H,H),
                    'wf': (H,6), 'bh': (H,), 'nodes.weight': (V-1,H), 'bias.weight': (V-1,1)}
        for key, shape in expected.items():
            assert self.weights[key].shape == shape, (key, self.weights[key].shape, shape)

    def step(self, previous, hidden, features):
        w = self.weights
        # Sequential expression mirrors the trained architecture. This is FP32,
        # not a claim of exact parity with the separately checked Q10 kernel.
        return np.clip(w['wx'] @ w['embedding.weight'][previous] + w['wh'] @ hidden
                       + w['wf'] @ features + w['bh'], 0, 8).astype(np.float32)

    def sample(self, hidden, seed, index, temperature):
        entropy = random_bits(seed,index)
        node = 0
        for depth in range(DEPTH):
            score = float(self.weights['nodes.weight'][node] @ hidden + self.weights['bias.weight'][node,0]) / temperature
            probability = 1 / (1+math.exp(-min(80., max(-80., score))))
            threshold = int(probability*65536)
            right = ((entropy >> (16*depth)) & 65535) < threshold
            node = 2*node+1+int(right)
        return node-(V-1)

    def generate(self, seed, count, temperature, prompt='', features=None):
        hidden = np.zeros(H, dtype=np.float32)
        features = np.asarray(features if features is not None else [.125,.25,.125,.5,-1.,-1.], dtype=np.float32)
        assert features.shape == (6,) and np.max(np.abs(features))<=4
        previous = V
        prompt_words = prompt.split()
        for word in prompt_words:
            assert word in self.index, f'Prompt word outside vocabulary: {word}'
            hidden = self.step(previous, hidden, features)
            previous = self.index[word]
        words, token_ids, trace, zeros, saturated = [], [], [], [], []
        for index in range(count):
            hidden = self.step(previous, hidden, features)
            previous = self.sample(hidden, seed, index, temperature)
            words.append(self.vocab[previous]); token_ids.append(previous)
            zeros.append(float(np.mean(hidden == 0))); saturated.append(float(np.mean(hidden == 8)))
            trace.append(hashlib.sha256(hidden.astype('<f4').tobytes()).hexdigest())
        hidden_stats = {'mean_zero_fraction': float(np.mean(zeros)), 'mean_saturated_fraction': float(np.mean(saturated)),
                        'final_zero_fraction': zeros[-1], 'final_saturated_fraction': saturated[-1],
                        'final_l2_norm': float(np.linalg.norm(hidden)), 'final_min': float(hidden.min()), 'final_max': float(hidden.max())}
        return {'seed': seed, 'temperature_q10': round(temperature*Q), 'prompt': prompt,
                'text': ' '.join(words), 'token_ids': token_ids, 'hidden_sha256_per_word': trace,
                'metrics': metrics(words, hidden_stats)}


def copy_matches(rows, data):
    candidates = {}
    sentences = {}
    for ri, row in enumerate(rows):
        norm = [canonical(w) for w in row['text'].split()]
        for span in ngrams(norm,12): candidates.setdefault(span, set()).add(ri)
        sent = []
        for word in row['text'].split():
            sent.append(canonical(word))
            if word.endswith(('.', '!', '?')):
                if len(sent)>=5: sentences.setdefault(tuple(sent), set()).add(ri)
                sent=[]
    found = [dict(spans={}, sentences={}) for _ in rows]
    train = data/'train.jsonl'
    for line in train.open():
        record=json.loads(line); raw=record['text'].split(); norm=[canonical(w) for w in raw]
        for span in set(ngrams(norm,12)) & candidates.keys():
            for ri in candidates[span]:
                entry=found[ri]['spans'].setdefault(' '.join(span), {'count':0,'sources':[]})
                entry['count']+=1
                if len(entry['sources'])<3: entry['sources'].append({'id':record['id'],'kind':record['source_kind']})
        sent=[]
        for word in raw:
            sent.append(canonical(word))
            if word.endswith(('.', '!', '?')):
                key=tuple(sent)
                for ri in sentences.get(key, []):
                    entry=found[ri]['sentences'].setdefault(' '.join(key), {'count':0,'sources':[]})
                    entry['count']+=1
                    if len(entry['sources'])<3: entry['sources'].append({'id':record['id'],'kind':record['source_kind']})
                sent=[]
    for row, match in zip(rows,found):
        row['copy_check']={'train_sha256':sha(train), 'normalized_12word_matches':match['spans'],
                           'complete_sentence_matches_5plus_words':match['sentences'],
                           'scope':'Only supplied retained training split; punctuation/case normalized; no semantic paraphrase test.'}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--checkpoint',type=Path,required=True)
    ap.add_argument('--data',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--seeds',default='0,42,7,123')
    ap.add_argument('--words',type=int,default=128)
    ap.add_argument('--temperatures-q10',default='1024')
    ap.add_argument('--prompt',default='')
    ap.add_argument('--features',default='0.125,0.25,0.125,0.5,-1,-1')
    args=ap.parse_args()
    assert args.words>0 and not args.output.exists(), 'Output path must be new'
    args.output.mkdir(parents=True)
    model=Model(args.checkpoint,args.data)
    features=list(map(float,args.features.split(',')))
    rows=[model.generate(seed,args.words,t/Q,args.prompt,features) for t in map(int,args.temperatures_q10.split(',')) for seed in map(int,args.seeds.split(','))]
    copy_matches(rows,args.data)
    report={'status':'GENERATED_REQUIRES_HUMAN_QUALITY_REVIEW','method':'FP32 recurrent inference with contract Keccak word-index branch draws',
            'source':model.source,'script_sha256':sha(Path(__file__)), 'features':features,
            'state_policy':'Zero state and BOS once, then every emitted word conditions the next step; no EOS/reset/forced punctuation; terminal flag is observational only.',
            'outputs':rows}
    (args.output/'raw-outputs.json').write_text(json.dumps(report,indent=2)+'\n')
    text=[]
    for r in rows:
        text.append(f"SEED {r['seed']} / TEMPERATURE Q10 {r['temperature_q10']} / PROMPT {r['prompt']!r}\n{r['text']}\n")
    (args.output/'raw-outputs.txt').write_text('\n'.join(text))
    print(json.dumps({'path':str(args.output), 'outputs':len(rows), 'source':model.source}))


if __name__=='__main__':main()
