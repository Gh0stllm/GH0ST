#!/usr/bin/env python3
"""Local-only word RNN with an 8192-leaf hierarchical output distribution.

All 534,751 parameters belong to trained embeddings, recurrent computation or
binary word classifiers. No dummy tensors are used to reach the parameter floor.
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
import math
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import torch
from torch import nn
from torch.nn import functional as F
from safetensors.torch import save_file

ROOT = Path(__file__).resolve().parents[1]
STUDY = ROOT.parent
sys.path.insert(0, str(STUDY / 'swap-speaker/python'))
from train_speaker import corpus as control_corpus, make_features

V, H, E, D, Q = 8192, 32, 32, 13, 1024
CACHE = Path('/tmp/gh0st-wikitext')


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def words(text):
    result = []
    for token in re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?|[.!?]", text):
        if token in '.!?':
            if result and not result[-1].endswith(('.', '!', '?')): result[-1] += token
        elif len(token) <= 30: result.append(token.lower())
    return result


def voice_corpus(include_control=False):
    records = [{'sentence': row['sentence'].lower(), 'regime': row['regime']} for row in control_corpus()] if include_control else []
    adjectives = [
        'quiet patient gentle steady soft calm measured peaceful'.split(),
        'restless shifting curious uneven changing watchful mixed uncertain'.split(),
        'wild urgent sharp turbulent intense rapid sudden volatile'.split(),
    ]
    nouns = ['pool', 'market', 'current', 'rhythm', 'machine', 'silence', 'memory', 'signal']
    for regime, group in enumerate(adjectives):
        for adjective in group:
            article = 'an' if adjective[0] in 'aeiou' else 'a'
            for noun in nouns:
                for sentence in [f'the {noun} is {article} {adjective} clock inside the chain.',
                    f'every swap leaves {article} {adjective} echo in my memory.',
                    f'i hear the {adjective} {noun} beneath the price.',
                    f'the {noun} moves but my questions remain {adjective}.',
                    f'{article} {adjective} {noun} is still a conversation.',
                    f'i turn another trade into {article} {adjective} question.',
                    f'the {adjective} {noun} has borrowed another moment.']:
                    records.append({'sentence': sentence, 'regime': regime})
    return list({row['sentence']: row for row in records}.values())


def load_text(split, limit):
    result = []
    for text in pq.read_table(CACHE / (split + '.parquet'), columns=['text']).column('text').to_pylist():
        if text.strip().startswith('='): continue
        result.extend(words(text))
        if len(result) >= limit: break
    return result[:limit]


def windows(tokens, index, width=24):
    x, y, previous = [], [], V
    inputs, targets = [], []
    for word in tokens:
        token = index.get(word, index['something'])
        inputs.append(previous); targets.append(token)
        previous = token
    for start in range(0, len(targets) - width + 1, width):
        x.append(inputs[start:start + width]); y.append(targets[start:start + width])
    return torch.tensor(x, dtype=torch.long), torch.tensor(y, dtype=torch.long)


class Model(nn.Module):
    def __init__(self, counts):
        super().__init__()
        self.embedding = nn.Embedding(V + 1, E)
        self.input_weight = nn.Parameter(torch.empty(H, E))
        self.recurrent_weight = nn.Parameter(torch.empty(H, H))
        self.feature_weight = nn.Parameter(torch.empty(H, 6))
        self.hidden_bias = nn.Parameter(torch.zeros(H))
        self.nodes = nn.Embedding(V - 1, H)
        self.node_bias = nn.Embedding(V - 1, 1)
        for parameter in [self.input_weight, self.recurrent_weight, self.feature_weight]: nn.init.xavier_uniform_(parameter)
        nn.init.normal_(self.embedding.weight, std=0.15)
        nn.init.normal_(self.nodes.weight, std=0.04)
        masses = np.zeros(2 * V - 1, dtype=np.float64)
        masses[V - 1:] = np.maximum(counts, 1)
        for node in range(V - 2, -1, -1): masses[node] = masses[node * 2 + 1] + masses[node * 2 + 2]
        with torch.no_grad():
            self.node_bias.weight[:, 0] = torch.tensor([math.log(masses[node * 2 + 2] / masses[node * 2 + 1]) for node in range(V - 1)])

    def forward(self, previous, features):
        hidden = torch.zeros(len(previous), H)
        states = []
        for t in range(previous.shape[1]):
            hidden = torch.clamp(F.linear(self.embedding(previous[:, t]), self.input_weight)
                + F.linear(hidden, self.recurrent_weight) + F.linear(features, self.feature_weight) + self.hidden_bias, 0, 8)
            states.append(hidden)
        return torch.stack(states, dim=1)


def make_paths():
    paths, bits = [], []
    for token in range(V):
        node, route, directions = 0, [], []
        for depth in range(D):
            bit = (token >> (D - 1 - depth)) & 1
            route.append(node); directions.append(bit); node = node * 2 + 1 + bit
        assert node == V - 1 + token
        paths.append(route); bits.append(directions)
    return torch.tensor(paths), torch.tensor(bits, dtype=torch.float32)


PATHS, BITS = make_paths()


def objective(model, x, y, features):
    states = model(x, features)
    nodes = PATHS[y]
    scores = (model.nodes(nodes) * states.unsqueeze(-2)).sum(-1) + model.node_bias(nodes).squeeze(-1)
    per_word = F.binary_cross_entropy_with_logits(scores, BITS[y], reduction='none').sum(-1)
    exact = ((scores >= 0) == BITS[y].bool()).all(-1).float().mean()
    return per_word.mean(), exact


def eval_split(model, x, y, features):
    losses, accuracies = [], []
    with torch.inference_mode():
        for start in range(0, len(x), 48):
            loss, acc = objective(model, x[start:start+48], y[start:start+48], features[start:start+48])
            count = len(x[start:start+48]); losses.append(float(loss) * count); accuracies.append(float(acc) * count)
    loss = sum(losses) / len(x)
    return {'cross_entropy_nats_per_word': loss, 'perplexity': math.exp(loss), 'greedy_word_accuracy': sum(accuracies) / len(x), 'words': x.numel()}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--epochs', type=int, default=4)
    parser.add_argument('--include-control', action='store_true', help='Reproduce the earlier plain-monitoring-voice pilot.')
    args = parser.parse_args()
    started = time.time()
    torch.set_num_threads(2); torch.manual_seed(466350); torch.use_deterministic_algorithms(True)
    raw = {name: load_text(name, 600000 if name == 'train' else 24000) for name in ('train', 'validation', 'test')}
    voice = voice_corpus(args.include_control); rng = np.random.default_rng(466350); rng.shuffle(voice)
    vtrain, vvalid, vtest = voice[:int(len(voice)*0.8)], voice[int(len(voice)*0.8):int(len(voice)*0.9)], voice[int(len(voice)*0.9):]
    counts = collections.Counter(raw['train'])
    mandatory = {word for row in vtrain for word in words(row['sentence'])} | {'something'}
    selected = list(mandatory)
    for word, _ in counts.most_common():
        if word not in mandatory:
            selected.append(word)
            if len(selected) == V: break
    assert len(set(selected)) == V
    vocab = sorted(selected); index = {word: i for i, word in enumerate(vocab)}
    language = {name: windows(tokens, index) for name, tokens in raw.items()}
    def voice_data(rows, seed):
        local_rng = np.random.default_rng(seed); xs, ys, fs = [], [], []
        for row in rows:
            sequence = words(row['sentence'])
            # Repeat short sentences only in training inputs to expose memory
            # across boundaries; output still contains learned individual words.
            tokens = sequence * (24 // len(sequence) + 1)
            a, b = windows(tokens[:24], index)
            xs.append(a[0]); ys.append(b[0]); fs.append(make_features(row['regime'], local_rng))
        return torch.stack(xs), torch.stack(ys), torch.tensor(fs, dtype=torch.float32) / Q
    voice_sets = {name: voice_data(rows, 466351+i) for i, (name, rows) in enumerate([('train',vtrain),('validation',vvalid),('test',vtest)])}
    tx, ty = language['train']; vx, vy, vf = voice_sets['train']
    seen = set(tx.flatten().tolist()) | set(vx.flatten().tolist())
    assert set(range(V + 1)) <= seen, 'Every embedding including BOS must receive training examples'
    model = Model(np.array([counts[word]+1 for word in vocab]))
    count = sum(p.numel() for p in model.parameters()); assert count == 534751 and count >= 500000
    initial = {name: p.detach().clone() for name,p in model.named_parameters()}
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.0025, weight_decay=0.00001)
    best_loss, best, history = float('inf'), None, []
    generator = torch.Generator().manual_seed(466350)
    for epoch in range(1, args.epochs + 1):
        model.train(); total = 0; steps = 0
        for chunk in torch.randperm(len(tx), generator=generator).split(32):
            sampled = torch.randint(len(vx), (16,), generator=generator)
            x, y = torch.cat([tx[chunk],vx[sampled]]), torch.cat([ty[chunk],vy[sampled]])
            features = torch.cat([torch.zeros(len(chunk),6),vf[sampled]])
            optimizer.zero_grad(set_to_none=True); loss,_ = objective(model,x,y,features)
            loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),5); optimizer.step()
            total += float(loss.detach()); steps += 1
            if steps % 200 == 0: print(f'epoch {epoch} step {steps}: loss {total/steps:.4f}',flush=True)
        model.eval()
        lx,ly=language['validation']; english=eval_split(model,lx,ly,torch.zeros(len(lx),6))
        a,b,f=voice_sets['validation']; style=eval_split(model,a,b,f)
        selection=english['cross_entropy_nats_per_word']+style['cross_entropy_nats_per_word']
        history.append({'epoch':epoch,'training_loss':total/steps,'english_validation':english,'voice_validation':style})
        if selection < best_loss: best_loss,best=selection,{name:t.detach().clone() for name,t in model.state_dict().items()}
        print(json.dumps(history[-1]),flush=True)
    model.load_state_dict(best); model.eval()
    trained_changes={name:int((p.detach()!=initial[name]).sum()) for name,p in model.named_parameters()}
    save_file({name:value.contiguous() for name,value in model.state_dict().items()},str(ROOT/'model/speaker.safetensors'))
    q={name:torch.round(value*Q).to(torch.int64).numpy() for name,value in model.state_dict().items()}
    assert all(np.max(np.abs(a))<=32767 for a in q.values())
    (ROOT/'model/embeddings.bin').write_bytes(q['embedding.weight'].astype('>i2').tobytes())
    core_order=['input_weight','recurrent_weight','feature_weight','hidden_bias']
    (ROOT/'model/core.bin').write_bytes(b''.join(q[name].astype('>i2').tobytes() for name in core_order))
    (ROOT/'model/nodes.bin').write_bytes(b''.join(q['nodes.weight'][i].astype('>i2').tobytes()+q['node_bias.weight'][i].astype('>i2').tobytes() for i in range(V-1)))
    (ROOT/'model/vocabulary.bin').write_bytes(b''.join(w.encode().ljust(32,b'\0') for w in vocab))
    write_json(ROOT/'model/vocabulary.json',vocab)
    provenance=json.loads((CACHE/'source-manifest.json').read_text())
    write_json(ROOT/'model/dataset-source.json',provenance)
    shutil.copyfile(CACHE/'DATASET-CARD.md',ROOT/'model/DATASET-CARD.md')
    write_json(ROOT/'model/voice-corpus.json',{'train':vtrain,'validation':vvalid,'test':vtest})
    files=['speaker.safetensors','embeddings.bin','core.bin','nodes.bin','vocabulary.bin','vocabulary.json','voice-corpus.json']
    manifest={'schema_version':1,'parameters':count,'vocabulary_size':V,'hidden_size':H,'embedding_size':E,'features':6,'tree_depth':D,'scale':Q,
        'decoding':'Greedy binary routing through a complete learned depth-13 tree; not global flat-softmax argmax',
        'parameter_accounting':{name:p.numel() for name,p in model.named_parameters()},
        'changed_parameter_values_after_training':trained_changes,'all_embedding_rows_seen_in_training':len(seen),
        'core_order':core_order,'node_record_bytes':66,'shard_sizes':{'embeddings':24000,'nodes':23760,'vocabulary':24000},
        'artifacts':{name:{'bytes':(ROOT/'model'/name).stat().st_size,'sha256':digest(ROOT/'model'/name)} for name in files}}
    write_json(ROOT/'model/manifest.json',manifest)
    metrics={}
    for name in ['validation','test']:
        a,b=language[name];metrics[name]={'english':eval_split(model,a,b,torch.zeros(len(a),6))}
        a,b,f=voice_sets[name];metrics[name]['voice']=eval_split(model,a,b,f)
    report={'schema_version':1,'parameters':count,'training_location':'Local CPU only; no GitHub-hosted execution','epochs':args.epochs,
        'train_words':len(raw['train']),'voice_sentences':{name:len(rows) for name,rows in [('train',vtrain),('validation',vvalid),('test',vtest)]},
        'history':history,'metrics':metrics,'all_embedding_rows_seen_in_training':len(seen),'changed_parameter_values_after_training':trained_changes,
        'elapsed_seconds':time.time()-started,'limitations':['A small research language model; parameter count is not evidence of large-LLM-level reasoning.',
        'English data is a pinned WikiText-2 prefix; voice data is an original synthetic grammar.',
        'Sentence quality, integer decoding, full-sentence EVM gas and real PoolManager integration require separate evaluation.']}
    write_json(ROOT/'reports/training.json',report)
    print(json.dumps({'parameters':count,'elapsed_seconds':report['elapsed_seconds'],'metrics':metrics},indent=2),flush=True)


if __name__=='__main__':main()
