#!/usr/bin/env python3
"""Continuous fully-neural V7 lexical/punctuation sampling, no grammar masks."""
import argparse,collections,hashlib,json
from pathlib import Path
from reference import Reference

def main():
    p=argparse.ArgumentParser();p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--words',type=int,default=128);p.add_argument('--seeds',default='0,42');p.add_argument('--temperature',type=int,default=512);p.add_argument('--scalar',action='store_true');a=p.parse_args()
    assert 0<a.words<=10000 and 64<=a.temperature<=4096
    manifest=json.loads((a.model_dir/'manifest.json').read_text());ref=Reference(a.model_dir);rows=[]
    features=[128,256,128,512,-1024,-1024]
    for seed in map(int,a.seeds.split(',')):
        assert 0<=seed<2**256
        encoded='0x'+seed.to_bytes(32,'big').hex();previous=8192;previous_punct=0;state=[0]*256;generated=[]
        for index in range(a.words):
            item=ref.step(previous,previous_punct,state,features,encoded,index,a.temperature,a.scalar)
            assert len(item['hidden'])==256 and all(-1024<=v<=1024 for v in item['hidden'])
            assert 0<=item['token']<8192 and 0<=item['punct']<5 and item['text']
            generated.append(item);state=item['hidden'];previous=item['token'];previous_punct=item['punct']
        tokens=[i['token']for i in generated];grams=collections.Counter(tuple(tokens[i:i+4])for i in range(max(0,len(tokens)-3)))
        rows.append({'seed':seed,'tokens':tokens,'punctuation':[i['punct']for i in generated],'text':' '.join(i['text']for i in generated),'natural_terminals':sum(i['terminal']for i in generated),
                     'repeated_4gram_fraction':sum(max(0,c-1)for c in grams.values())/max(1,len(tokens)-3),'final_hidden':state,
                     'logit_sha256':[hashlib.sha256(json.dumps(i['scores'],separators=(',',':')).encode()).hexdigest()for i in generated]})
    result={'status':'COMPLETE','mode':'REFERENCE_ONLY_NO_EVM','quality_approval':False,'checkpoint_sha256':manifest['checkpoint_sha256'],'temperatureQ10':a.temperature,
            'words_per_seed':a.words,'featuresQ10':features,'runtime_domain':0,'state_resets':0,'forced_punctuation':False,'runtime_grammar_masks':False,'template_bank':False,'streams':rows,'mainnet_actions':0}
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items()if k!='streams'},indent=2))
    for row in rows:print('seed',row['seed'],row['text'])
if __name__=='__main__':main()
