"""Exact Q10 compact GRU export; original inputs stay reference-only."""
import argparse,hashlib,json,re
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file

H,V,Q=224,8192,1024
sha=lambda b:hashlib.sha256(b).hexdigest()
p=argparse.ArgumentParser();p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
assert not a.out.exists();raw=load_file(a.checkpoint/'model.safetensors')
shapes={'embedding.weight':(V+1,H),'wx':(3*H,H),'wh':(3*H,H),'wf':(3*H,6),'bh':(3*H,),'nodes.weight':(V-1,H),'bias.weight':(V-1,1)}
assert set(raw)==set(shapes);q={};ranges={}
for name,shape in shapes.items():
    values=raw[name];assert values.shape==shape and np.isfinite(values).all()
    quant=np.rint(values.astype(np.float64)*Q).astype(np.int64);assert quant.min()>=-32768 and quant.max()<=32767
    q[name]=quant;ranges[name]={'min':int(quant.min()),'max':int(quant.max()),'shape':shape}
fused=q['embedding.weight']@q['wx'].T+q['bh'][None,:]*Q
assert fused.min()>=-(2**39) and fused.max()<2**39
fused_bytes=((fused.astype(np.uint64)[...,None]>>np.array([32,24,16,8,0],dtype=np.uint64))&255).astype(np.uint8).tobytes()
vocab=json.loads((a.data/'vocabulary.json').read_text());assert len(set(vocab))==V
assert all(re.fullmatch(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?",w) and len(w.encode())<=32 for w in vocab)
vocab_bytes=b''.join(w.encode().ljust(32,b'\0')for w in vocab);assert vocab_bytes==(a.data/'vocabulary.bin').read_bytes()
research=Path(__file__).resolve().parents[5]
payloads={'core.bin':q['wh'].astype('>i2').tobytes()+q['wf'].astype('>i2').tobytes(),
    'nodes.bin':np.concatenate([q['nodes.weight'],q['bias.weight']],axis=1).astype('>i2').tobytes(),
    'fused.bin':fused_bytes,'vocabulary.bin':vocab_bytes,'vocabulary.json':(a.data/'vocabulary.json').read_bytes(),
    'sigmoid-delta.bin':(research/'experiments/four-point-five-million/model/sigmoid-delta.bin').read_bytes()}
assert len(payloads['core.bin'])==309120 and len(payloads['nodes.bin'])==3685950 and len(fused_bytes)==27528480
a.out.mkdir(parents=True)
for name,value in payloads.items():(a.out/name).write_bytes(value)
sources={}
for name,key in [('original-embedding.bin','embedding.weight'),('original-wx.bin','wx'),('original-bh.bin','bh')]:
    value=q[key].astype('>i2').tobytes();(a.out/name).write_bytes(value);sources[name]={'bytes':len(value),'sha256':sha(value),'deployment':'REFERENCE_ONLY_NOT_RESIDENT'}
manifest={'scope':'Local compact fused GRU H224; export is not language or EVM evidence','parameters':3983967,'hidden_size':H,'vocabulary_size':V,'scale':Q,
    'model_domain':'GH0ST_GRU_H224_FUSED_Q10_LOCAL_V1','checkpoint_sha256':sha((a.checkpoint/'model.safetensors').read_bytes()),
    'data_manifest_sha256':sha((a.data/'manifest.json').read_bytes()),'exporter_sha256':sha(Path(__file__).read_bytes()),
    'gate_order':['r','z','n'],'recurrent_bias':False,'weight_rounding':'nearest_even_no_clipping','hidden_range':[-1024,1024],
    'fused_shape':list(fused.shape),'fused_min':int(fused.min()),'fused_max':int(fused.max()),'fused_format':'signed40_bigendian_before_any_division',
    'equations':'X=trunc((fused+Wf*f)/Q);R=trunc(Wh*h/Q);r=S(Xr+Rr);z=S(Xz+Rz);n=2*S(2*(Xn+trunc(r*Rn/Q)))-Q;h=trunc((z*h+(Q-z)*n)/Q)',
    'ranges':ranges,'artifacts':{name:{'bytes':len(value),'sha256':sha(value)}for name,value in payloads.items()},'reference_only_sources':sources,
    'resident_parameter_claim':'Compiled from3983967 learned source parameters; fused scalars are derived, not independent learned parameters.'}
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'out':str(a.out),'checkpoint_sha256':manifest['checkpoint_sha256'],'fused_bytes':len(fused_bytes)}))
