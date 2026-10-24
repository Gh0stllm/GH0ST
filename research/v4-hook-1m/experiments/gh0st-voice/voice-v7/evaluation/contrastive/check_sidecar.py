#!/usr/bin/env python3
"""Exercise sparse training-label authentication and chunk coordinates."""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import numpy as np


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--training',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists()
    def load(name,path):
        spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec)
        sys.modules[name]=m;spec.loader.exec_module(m);return m
    load('model',a.training/'model.py');engine=load('v8_engine_sidecar_check',a.training/'engine.py')
    checks={}
    with tempfile.TemporaryDirectory(prefix='v8-label-audit-')as tmp:
        base=Path(tmp);vocab=base/'vocabulary.json';vocab.write_text(json.dumps([f'w{i}'for i in range(8192)]))
        (base/'counts.json').write_text(json.dumps({'original':[1]*8192}))
        row={'id':'toy','kind':'original','domain':0,'token_ids':[10,11,12,13,14,8193,16],'punctuation':[0,2,0,1,0,3,4]}
        for split in ['train','validation','test']:(base/f'{split}.jsonl').write_text(json.dumps(row)+'\n'if split=='train'else'')
        manifest={'vocabulary_sha256':sha(vocab),'artifacts':{f'{split}.jsonl':{'sha256':sha(base/f'{split}.jsonl')}for split in ['train','validation','test']}}
        (base/'manifest.json').write_text(json.dumps(manifest))
        good={'schema_version':1,'training_only':True,'source_train_sha256':sha(base/'train.jsonl'),
              'allowed_rules':['first_person_auxiliary','plural_auxiliary','modal_base_verb'],
              'vocabulary_sha256':sha(vocab),'documents':{'toy':[[1,80],[2,81],[2,82],[3,83],[6,84]]}}
        sidecar=base/'pairs.json';sidecar.write_text(json.dumps(good))
        corpus=engine.Corpus(base,sidecar)
        stream=engine.Stream(corpus,np.random.default_rng(7341),1,3,{'original':1.})
        got=[]
        for _ in range(3):
            batch,_=stream.next('cpu')
            got.append({name:batch[name].tolist()for name in ['grammar_positions','grammar_good_tokens','grammar_bad_tokens']})
        expected=[{'grammar_positions':[1,2,2],'grammar_good_tokens':[11,12,12],'grammar_bad_tokens':[80,81,82]},
                  {'grammar_positions':[0],'grammar_good_tokens':[13],'grammar_bad_tokens':[83]},
                  {'grammar_positions':[0,2],'grammar_good_tokens':[16,11],'grammar_bad_tokens':[84,80]}]
        checks['labels_rebased_exactly_across_chunks_and_new_document']=got==expected
        variants={
            'wrong_source_hash':lambda x:x.update(source_train_sha256='0'*64),
            'wrong_vocab_hash':lambda x:x.update(vocabulary_sha256='0'*64),
            'non_training_scope':lambda x:x.update(training_only=False),
            'future_conditioned_rule':lambda x:x['allowed_rules'].append('article_sound'),
            'unknown_document':lambda x:x['documents'].update(other=[[1,80]]),
            'out_of_range_position':lambda x:x['documents'].update(toy=[[7,80]]),
            'unknown_good_target':lambda x:x['documents'].update(toy=[[5,80]]),
            'unknown_bad_target':lambda x:x['documents'].update(toy=[[1,8193]]),
            'same_good_and_bad':lambda x:x['documents'].update(toy=[[1,11]]),
            'duplicate_pair':lambda x:x['documents'].update(toy=[[1,80],[1,80]])}
        for name,mutate in variants.items():
            candidate=copy.deepcopy(good);mutate(candidate);sidecar.write_text(json.dumps(candidate))
            try:engine.Corpus(base,sidecar)
            except (AssertionError,ValueError):checks['reject_'+name]=True
            else:checks['reject_'+name]=False
    report={'status':'PASS'if all(checks.values())else'FAIL','checks':checks,'observed_chunk_labels':got,
            'source_sha256':{'model.py':sha(a.training/'model.py'),'engine.py':sha(a.training/'engine.py')},
            'script_sha256':sha(Path(__file__)),'scope':'Synthetic temporary training fixture only; no user datasets modified or model trained. Label grammar validity is a separate semantic audit.'}
    a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if __name__=='__main__':main()
