#!/usr/bin/env python3
"""Q10 export for two GRU128 layers, lexical words and a learned punctuation head."""
import argparse, hashlib, json, math, re
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file

H,V,Q=128,8192,1024
sha=lambda b:hashlib.sha256(b).hexdigest()
def packed40(x):
    assert x.min()>=-(2**39) and x.max()<2**39
    return ((x.astype(np.uint64)[...,None]>>np.array([32,24,16,8,0],dtype=np.uint64))&255).astype(np.uint8).tobytes()
def main():
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    assert not a.out.exists();raw=load_file(a.checkpoint/'model.safetensors')
    shapes={'embedding.weight':(8194,H),'punct_embedding.weight':(5,H),'wx1':(384,H),'wh1':(384,H),'wf':(384,6),'bh1':(384,),
            'wx2':(384,H),'wh2':(384,H),'bh2':(384,),'domain.weight':(2,384),'groups.weight':(128,H),'group_bias.weight':(128,1),
            'words.weight':(V,H),'word_bias.weight':(V,1),'punct_head.weight':(5,H),'punct_bias':(5,),'word_punct_bias.weight':(V,5)}
    assert set(raw)==set(shapes),(set(raw)-set(shapes),set(shapes)-set(raw));q={};ranges={}
    for name,shape in shapes.items():
        assert raw[name].shape==shape,(name,raw[name].shape,shape);assert np.isfinite(raw[name]).all()
        x=np.rint(raw[name].astype(np.float64)*Q).astype(np.int64);assert x.min()>=-32768 and x.max()<=32767,(name,'Q10 overflow')
        q[name]=x;ranges[name]={'shape':list(shape),'min':int(x.min()),'max':int(x.max())}
    fused=q['embedding.weight'][:8193]@q['wx1'].T+(q['bh1']+q['domain.weight'][0])[None,:]*Q
    punct_fused=q['punct_embedding.weight']@q['wx1'].T
    i16=lambda x:x.astype('>i2').tobytes()
    vocab=json.loads((a.data/'vocabulary.json').read_text());assert len(set(vocab))==V and all(re.fullmatch(r"[a-z]+(?:'[a-z]+)*",w) and len(w.encode())<=32 for w in vocab)
    vb=b''.join(w.encode().ljust(32,b'\0')for w in vocab);assert vb==(a.data/'vocabulary.bin').read_bytes()
    research=Path(__file__).resolve().parents[4]
    payloads={'core.bin':b''.join(i16(q[n])for n in ('wh1','wx2','wh2','wf','bh2')),
              'groups.bin':i16(np.concatenate([q['groups.weight'],q['group_bias.weight']],axis=1)),
              'words.bin':i16(np.concatenate([q['words.weight'],q['word_bias.weight']],axis=1)),
              'punctuation.bin':i16(np.concatenate([q['punct_head.weight'],q['punct_bias'][:,None]],axis=1))+i16(q['word_punct_bias.weight'])+packed40(punct_fused),
              'fused.bin':packed40(fused),'vocabulary.bin':vb,'vocabulary.json':(a.data/'vocabulary.json').read_bytes(),
              'sigmoid-delta.bin':(research/'experiments/four-point-five-million/model/sigmoid-delta.bin').read_bytes(),
              'exp-q32.bin':b''.join(round(math.exp(-i/16)*2**32).to_bytes(8,'big')for i in range(257))}
    for name,size in {'core.bin':300288,'groups.bin':33024,'words.bin':2113536,'punctuation.bin':92810,'fused.bin':15730560}.items():assert len(payloads[name])==size,(name,len(payloads[name]))
    a.out.mkdir(parents=True)
    for name,b in payloads.items():(a.out/name).write_bytes(b)
    refs={}
    for name in ('embedding.weight','punct_embedding.weight','wx1','bh1','domain.weight'):
        x=q[name][:8193] if name=='embedding.weight' else q[name];filename='original-'+name.replace('.','-')+'.bin';b=i16(x);(a.out/filename).write_bytes(b);refs[filename]={'bytes':len(b),'sha256':sha(b),'shape':list(x.shape)}
    count=sum(x.size for x in raw.values());source=Path(__file__).with_name('contracts').joinpath('GRU2WordPunctModel.sol').read_text()
    source=re.sub(r'SOURCE_MODEL_PARAMETERS=\d+',f'SOURCE_MODEL_PARAMETERS={count}',source);(a.out/'GRU2WordPunctModel.sol').write_text(source)
    report={'schema':1,'scope':'Local only, export is not language approval','parameters':count,'checkpoint_sha256':sha((a.checkpoint/'model.safetensors').read_bytes()),
            'data_manifest_sha256':sha((a.data/'manifest.json').read_bytes()),'source_sha256':sha(source.encode()),'model_domain':'GH0ST_GRU2_H128_WORD_PUNCT_Q10_LOCAL_V1',
            'runtime_embedding_rows':8193,'training_only_unk_parameters':128,'fixed_runtime_domain':0,'punctuation_classes':['none',',','.','!','?'],
            'state_order':'h1[0:128],h2[128:256]','fused_min':int(fused.min()),'fused_max':int(fused.max()),'ranges':ranges,'clipped_weights':0,
            'artifacts':{n:{'bytes':len(b),'sha256':sha(b)}for n,b in payloads.items()},'reference_only_sources':refs,
            'math':'Layer1 folded word+domain+bh1 plus folded previous punctuation plus Wf features; Layer2 Wx2 new h1+bh2 and Wh2 old h2. Reset-after GRU. Three independent Keccak stages for group,word,punctuation.'}
    (a.out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'out':str(a.out),'parameters':count,'fused_bytes':len(payloads['fused.bin'])}))
if __name__=='__main__':main()
