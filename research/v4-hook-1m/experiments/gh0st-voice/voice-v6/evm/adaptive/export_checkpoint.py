"""Export adaptive GRU with optional train-only UNK and fixed voice domain0."""
import argparse,hashlib,json,math,re
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file

H,V,Q=224,8192,1024
sha=lambda data:hashlib.sha256(data).hexdigest()
p=argparse.ArgumentParser();p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
assert not a.out.exists();raw=load_file(a.checkpoint/'model.safetensors')
shapes={'wx':(672,224),'wh':(672,224),'wf':(672,6),'bh':(672,),
        'groups.weight':(128,224),'group_bias.weight':(128,1),'words.weight':(8192,224),'word_bias.weight':(8192,1)}
assert raw['embedding.weight'].shape in [(8193,224),(8194,224)]
assert set(raw)==set(shapes)|{'embedding.weight'}|({'domain.weight'}if'domain.weight'in raw else set())
if 'domain.weight'in raw:assert raw['domain.weight'].shape==(2,672)
q={};ranges={}
for name,value in raw.items():
    if name in shapes:assert value.shape==shapes[name]
    assert np.isfinite(value).all();n=np.rint(value.astype(np.float64)*Q).astype(np.int64);assert n.min()>=-32768 and n.max()<=32767,(name,'Q10 overflow')
    q[name]=n;ranges[name]={'shape':list(n.shape),'min':int(n.min()),'max':int(n.max())}
domain=q.get('domain.weight',np.zeros((2,672),dtype=np.int64));embedding=q['embedding.weight'][:8193]
fused=embedding@q['wx'].T+(q['bh']+domain[0])[None,:]*Q
assert fused.min()>=-(2**39) and fused.max()<2**39
fb=((fused.astype(np.uint64)[...,None]>>np.array([32,24,16,8,0],dtype=np.uint64))&255).astype(np.uint8).tobytes()
vocab=json.loads((a.data/'vocabulary.json').read_text());assert len(set(vocab))==V and all(re.fullmatch(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?",w) and len(w.encode())<=32 for w in vocab)
vb=b''.join(w.encode().ljust(32,b'\0')for w in vocab);assert vb==(a.data/'vocabulary.bin').read_bytes()
research=Path(__file__).resolve().parents[5]
payloads={'core.bin':q['wh'].astype('>i2').tobytes()+q['wf'].astype('>i2').tobytes(),
    'groups.bin':np.concatenate([q['groups.weight'],q['group_bias.weight']],axis=1).astype('>i2').tobytes(),
    'words.bin':np.concatenate([q['words.weight'],q['word_bias.weight']],axis=1).astype('>i2').tobytes(),
    'fused.bin':fb,'vocabulary.bin':vb,'vocabulary.json':(a.data/'vocabulary.json').read_bytes(),
    'sigmoid-delta.bin':(research/'experiments/four-point-five-million/model/sigmoid-delta.bin').read_bytes(),
    'exp-q32.bin':b''.join(round(math.exp(-i/16)*2**32).to_bytes(8,'big')for i in range(257))}
for name,size in {'core.bin':309120,'groups.bin':57600,'words.bin':3686400,'fused.bin':27528480}.items():assert len(payloads[name])==size
a.out.mkdir(parents=True)
for name,value in payloads.items():(a.out/name).write_bytes(value)
originals={'original-embedding.bin':embedding,'original-wx.bin':q['wx'],'original-bh.bin':q['bh'],'original-domain.bin':domain}
reference={}
for name,value in originals.items():
    data=value.astype('>i2').tobytes();(a.out/name).write_bytes(data);reference[name]={'bytes':len(data),'sha256':sha(data),'deployment':'OFFCHAIN_REFERENCE_ONLY'}
count=sum(v.size for v in raw.values());template=Path(__file__).with_name('contracts')/'AdaptiveGRUWordModel.sol';source=template.read_text().replace('SOURCE_MODEL_PARAMETERS = 4012992',f'SOURCE_MODEL_PARAMETERS = {count}')
(a.out/'AdaptiveGRUWordModel.sol').write_text(source)
manifest={'scope':'Local adaptiveGRU export, no EVM or quality claim','parameters':count,'runtime_embedding_rows':8193,'output_vocabulary':8192,
    'training_only_unk_row':q['embedding.weight'].shape[0]==8194,'training_only_unk_parameters':224 if q['embedding.weight'].shape[0]==8194 else 0,
    'fixed_runtime_domain':0,'domain_parameters':1344 if 'domain.weight'in raw else 0,
    'domain_folding':'(nearest_even_Q10(bh)+nearest_even_Q10(domain0))*1024 folded before any division',
    'model_domain':'GH0ST_GRU_H224_ADAPTIVE_Q10_LOCAL_V1','checkpoint_sha256':sha((a.checkpoint/'model.safetensors').read_bytes()),
    'data_manifest_sha256':sha((a.data/'manifest.json').read_bytes()),'source_sha256':sha(source.encode()),
    'ranges':ranges,'fused_min':int(fused.min()),'fused_max':int(fused.max()),'clipped_weights':0,
    'artifacts':{name:{'bytes':len(v),'sha256':sha(v)}for name,v in payloads.items()},'reference_only_sources':reference,
    'input_only_unk':'Row8193 is training-only and cannot be a runtime input or output token.',
    'head_math':'128group softmax then64selectedword softmax; token=group*64+within; domain0fixed; no phrase bank'}
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'out':str(a.out),'parameters':count,'runtime_domain':0,'training_only_unk':manifest['training_only_unk_row']}))
