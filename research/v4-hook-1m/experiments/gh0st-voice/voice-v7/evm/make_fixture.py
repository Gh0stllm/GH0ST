#!/usr/bin/env python3
"""Deterministic bounded random weights for gas/parity only; not a trained voice model."""
import json,re
from pathlib import Path
import numpy as np
from safetensors.numpy import save_file

HERE=Path(__file__).resolve().parent
assert not (HERE/'fixture-source').exists()
rng=np.random.default_rng(7107)
shapes={'embedding.weight':(8194,128),'punct_embedding.weight':(5,128),'wx1':(384,128),'wh1':(384,128),'wf':(384,6),'bh1':(384,),
        'wx2':(384,128),'wh2':(384,128),'bh2':(384,),'domain.weight':(2,384),'groups.weight':(128,128),'group_bias.weight':(128,1),
        'words.weight':(8192,128),'word_bias.weight':(8192,1),'punct_head.weight':(5,128),'punct_bias':(5,),'word_punct_bias.weight':(8192,5)}
weights={name:rng.normal(0,.025,size=shape).astype(np.float32)for name,shape in shapes.items()}
weights['wf'][:]=0
for name in ('bh1','bh2'):
    weights[name][:]=0;weights[name][128:256]=1
(HERE/'fixture-source').mkdir();save_file(weights,HERE/'fixture-source/model.safetensors')
counts=json.loads((HERE.parent.parent/'voice-v6/data/train-lexical-counts.json').read_text());vocab=[];seen=set()
for word,_ in counts:
    word=word.rstrip('.!?')
    if re.fullmatch(r"[a-z]+(?:'[a-z]+)*",word) and len(word)<=32 and word not in seen:vocab.append(word);seen.add(word)
    if len(vocab)==8192:break
assert len(vocab)==8192
(HERE/'fixture-data').mkdir();(HERE/'fixture-data/vocabulary.json').write_text(json.dumps(vocab)+'\n')
(HERE/'fixture-data/vocabulary.bin').write_bytes(b''.join(w.encode().ljust(32,b'\0')for w in vocab))
(HERE/'fixture-data/manifest.json').write_text(json.dumps({'scope':'Real lexical entries with deterministic RANDOM weights; gas/parity fixture only','source':'V6 training lexical counts, first8192 distinct barewords'})+'\n')
print(sum(x.size for x in weights.values()))
