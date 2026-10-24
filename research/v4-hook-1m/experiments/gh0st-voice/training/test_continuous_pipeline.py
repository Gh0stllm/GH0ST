#!/usr/bin/env python3
"""Check continuous preprocessing without training or touching a checkpoint."""
from pathlib import Path
import importlib.util,hashlib,json
import torch
from transformers import AutoTokenizer
import train_voice
BASE=Path(__file__).resolve().parents[1]
legacy_path=Path(__file__).with_name('train_voice_pilot_v1.py')
spec=importlib.util.spec_from_file_location('legacy_voice',legacy_path);legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)
tokenizer=AutoTokenizer.from_pretrained(train_voice.DEFAULT_CHECKPOINT,local_files_only=True,trust_remote_code=False)
a,_=legacy.load_corpus(BASE/'data',tokenizer,128,64)
b,_=train_voice.load_corpus(BASE/'data',tokenizer,128,64)
assert a==b
continuous,meta=train_voice.load_corpus(BASE/'data',tokenizer,128,64,True,20261024)
for split,blocks in continuous.items():
 assert blocks[0][0][0]==3
 assert meta['coverage'][split]['eos_tokens']==0
 assert all(len(tokens)<=128 and len(tokens)==len(labels) for tokens,labels in blocks)
 assert all(labels[:64]==[-100]*64 for _,labels in blocks[1:])
mask=train_voice.attention_mask(torch.ones((1,80),dtype=torch.bool),64,torch.float32,'cpu')
assert mask[0,0,64,0]<0 and mask[0,0,64,1]==0 and mask[0,0,63,0]==0 and mask[0,0,5,6]<0
report={'status':'PASS','default_pilot_blocks_identical':True,'continuous_quote_prefix':True,'no_automatic_eos':True,'overlap_labels_ignored':True,'causal_sliding64_mask':True,'coverage':meta['coverage'],'runner_sha256':hashlib.sha256(Path(train_voice.__file__).read_bytes()).hexdigest(),'legacy_runner_sha256':hashlib.sha256(legacy_path.read_bytes()).hexdigest()}
(BASE/'runs/continuous-sweep/preprocessing-proof.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='coverage'}))
