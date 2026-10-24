#!/usr/bin/env python3
"""Independent FP32 adaptive-head probe with explicit coverage and fixed draws."""
import argparse,hashlib,importlib.util,json,sys
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file

HERE=Path(__file__).resolve().parent
PREVIOUS=HERE.parents[1]/'recurrent-v1/evaluation'
sys.path.insert(0,str(PREVIOUS))
from screen_checkpoint import copy_matches,metrics,sha


def module_at(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


class Adaptive:
    def __init__(self,checkpoint,data):
        self.weights=load_file(str(checkpoint/'model.safetensors'))
        self.vocab=json.loads((data/'vocabulary.json').read_text());self.index={w:i for i,w in enumerate(self.vocab)}
        self.normalize=module_at('v6_prepare_for_eval',HERE.parent/'training/prepare.py').tokens
        self.entropy=module_at('v6_entropy_for_eval',HERE.parent/'evm/adaptive/reference.py').entropy
        shapes={'embedding.weight':(8194,224),'wx':(672,224),'wh':(672,224),'wf':(672,6),'bh':(672,),
                'domain.weight':(2,672),'groups.weight':(128,224),'group_bias.weight':(128,1),'words.weight':(8192,224),'word_bias.weight':(8192,1)}
        for k,s in shapes.items():assert self.weights[k].shape==s,(k,s)
        self.provenance={'checkpoint':str(checkpoint),'weights_sha256':sha(checkpoint/'model.safetensors'),
                         'vocabulary_sha256':sha(data/'vocabulary.json'),'normalizer_sha256':sha(HERE.parent/'training/prepare.py')}

    def step(self,previous,hidden,features,domain):
        w=self.weights
        a=w['wx']@w['embedding.weight'][previous]+w['wf']@features+w['bh']+w['domain.weight'][domain]
        b=w['wh']@hidden;ir,iz,inn=np.split(a,3);hr,hz,hn=np.split(b,3)
        r=1/(1+np.exp(-np.clip(ir+hr,-80,80)));z=1/(1+np.exp(-np.clip(iz+hz,-80,80)))
        h=(z*hidden+(1-z)*np.tanh(inn+r*hn)).astype(np.float32)
        assert np.isfinite(h).all() and np.max(np.abs(h))<=1.00001
        return h

    def choose(self,logits,seed,index,stage,temperature):
        # Float exp rounded to Q32, without the EVM's quantized score/LUT grid.
        # Keep entropy domains identical; FP32 and Q10 outputs may still diverge.
        scaled=(logits.astype(np.float64)-float(logits.max()))/temperature
        weights=np.floor(np.exp(np.maximum(scaled,-80))*4294967296+.5).astype(np.int64)
        draw=self.entropy('0x'+seed.to_bytes(32,'big').hex(),index,stage)%int(weights.sum())
        return int(np.searchsorted(np.cumsum(weights),draw,side='right'))

    def generate(self,seed,count,temp,domain,prefix='',allow_unknown=False):
        words=self.normalize(prefix);unknown=[{'position':i,'word':w}for i,w in enumerate(words)if w not in self.index]
        if unknown and not allow_unknown:
            return {'seed':seed,'temperature_q10':temp,'domain':domain,'prompt':prefix,'status':'PREFIX_NOT_FULLY_REPRESENTABLE','unknown_inputs':unknown}
        h=np.zeros(224,dtype=np.float32);previous=8192;features=np.array([.125,.25,.125,.5,-1,-1],dtype=np.float32)
        for word in words:h=self.step(previous,h,features,domain);previous=self.index.get(word,8193)
        ids=[];texts=[];hashes=[];saturation=[];w=self.weights
        for index in range(count):
            h=self.step(previous,h,features,domain)
            group=self.choose(w['groups.weight']@h+w['group_bias.weight'][:,0],seed,index,0,temp/1024)
            start=group*64;within=self.choose(w['words.weight'][start:start+64]@h+w['word_bias.weight'][start:start+64,0],seed,index,1,temp/1024)
            previous=start+within;assert 0<=previous<8192
            ids.append(previous);texts.append(self.vocab[previous]);hashes.append(hashlib.sha256(h.astype('<f4').tobytes()).hexdigest())
            saturation.append(float(np.mean(np.abs(h)>=.999)))
        return {'status':'GENERATED','seed':seed,'temperature_q10':temp,'domain':domain,'prompt':prefix,'unknown_inputs':unknown,
                'runtime_prefix_representable':not unknown,'token_ids':ids,'text':' '.join(texts),'hidden_sha256_per_word':hashes,
                'metrics':metrics(texts,{'mean_saturated_fraction':float(np.mean(saturation)),'final_min':float(h.min()),'final_max':float(h.max())})}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--temperature-q10',type=int,default=512)
    p.add_argument('--domain',type=int,default=0);p.add_argument('--mode',choices=['quick','full','retention'],default='quick')
    p.add_argument('--allow-unknown-prefix',action='store_true');a=p.parse_args();assert not a.output.exists();a.output.mkdir(parents=True)
    model=Adaptive(a.checkpoint,a.data);rows=[]
    if a.mode=='retention':
        for pair in json.loads((HERE/'retention-pairs.json').read_text()):
            for side in ['a','b']:
                r=model.generate(42,96,a.temperature_q10,a.domain,pair['prefix_'+side],a.allow_unknown_prefix);r['case']=pair['id']+':'+side;rows.append(r)
    else:
        for seed in [0,42]:
            r=model.generate(seed,128 if a.mode=='quick' else 256,a.temperature_q10,a.domain);r['case']='unprompted';rows.append(r)
        cases=json.loads((HERE/'heldout-cases.json').read_text())
        for case in cases:
            if a.mode=='quick' and case['id'] not in {'v6-h01','v6-h04','v6-h07','v6-h10'}:continue
            for seed in ([42] if a.mode=='quick' else [0,42]):
                r=model.generate(seed,96 if a.mode=='quick' else 128,a.temperature_q10,a.domain,case['prefix'],a.allow_unknown_prefix)
                r['case']=case['id'];rows.append(r)
    generated=[r for r in rows if r['status']=='GENERATED'];copy_matches(generated,a.data)
    result={'status':'REQUIRES_HUMAN_QUALITY_REVIEW','source':model.provenance,'mode':a.mode,'script_sha256':sha(Path(__file__)),
            'cases_sha256':sha(HERE/'heldout-cases.json'),'decoder':'FP32 logits, float exp rounded to Q32; adaptive Keccak(seed,index,stage), inverse CDF. Q10 EVM scores/LUT checked separately.',
            'state_policy':'Initialize once, no terminal resets or forced punctuation. Input-only unknown allowed only with explicit flag and marked non-runtime-representable.',
            'outputs':rows}
    (a.output/'raw-outputs.json').write_text(json.dumps(result,indent=2)+'\n')
    (a.output/'raw-outputs.txt').write_text('\n\n'.join(f"{r['case']} / seed {r['seed']} / {r['status']} / {r['prompt']!r}\n{r.get('text',r.get('unknown_inputs'))}"for r in rows)+'\n')
    print(json.dumps({'output':str(a.output),'generated':len(generated),'unsupported_prefixes':len(rows)-len(generated)}))


if __name__=='__main__':main()
