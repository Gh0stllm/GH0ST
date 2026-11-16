"""Reproduce the pinned INT8/Q12 fixture using NumPy, without importing Torch.

Only the exact SHA256-pinned checkpoint is accepted before the restricted
unpickler runs. The four permitted pickle symbols are data-only constructors.
No arbitrary checkpoint or remote Python model code is supported.
"""
import argparse
from collections import OrderedDict
from pathlib import Path
import hashlib
import io
import json
import math
import pickle
import zipfile
import numpy as np
from prepare_model import ARCHITECTURE, CHECKPOINT, REVISION, prepare

def load_pinned(path):
    if hashlib.sha256(path.read_bytes()).hexdigest()!=CHECKPOINT:
        raise ValueError("Checkpoint SHA256 mismatch; refusing to parse")
    archive=zipfile.ZipFile(path);names=archive.namelist()
    key=next(n for n in names if n.endswith('/data.pkl'));prefix=key[:-len('data.pkl')]
    def rebuild(storage,offset,size,stride,*ignored):
        dtype,payload=storage
        return np.ndarray(tuple(size),dtype=dtype,buffer=payload,
            offset=offset*dtype.itemsize,strides=tuple(x*dtype.itemsize for x in stride))
    class Restricted(pickle.Unpickler):
        def find_class(self,module,name):
            allowed={('collections','OrderedDict'):OrderedDict,
                ('torch','FloatStorage'):np.dtype('<f4'),('torch','BoolStorage'):np.dtype('?'),
                ('torch._utils','_rebuild_tensor_v2'):rebuild}
            if (module,name) not in allowed:raise pickle.UnpicklingError("Unsupported checkpoint symbol")
            return allowed[module,name]
        def persistent_load(self,pid):
            kind,dtype,key,device,count=pid
            # The pinned checkpoint labels storage cuda:0. Decode its bytes on
            # CPU; this label never initializes or invokes a GPU runtime.
            if kind!='storage' or device not in ['cpu','cuda:0'] or not str(key).isdigit():
                raise pickle.UnpicklingError("Unsupported storage")
            payload=archive.read(prefix+'data/'+str(key))
            if len(payload)!=count*dtype.itemsize:raise ValueError("Bad storage size")
            return dtype,payload
    return Restricted(io.BytesIO(archive.read(key))).load()

def export(checkpoint,output):
    state=load_pinned(checkpoint);output.mkdir(parents=True,exist_ok=True)
    data=output/'data';(data/'tensors').mkdir(parents=True,exist_ok=True)
    used=set();parameters=0;tensors=[]
    def learned(name):
        nonlocal parameters
        if name in used:raise ValueError("Repeated learned tensor")
        used.add(name);value=state[name].astype(np.float64);parameters+=value.size;return value
    def save(name,kind,rows,width,row_bytes,payload):
        index=len(tensors);relative=f'tensors/{index:03d}-{name}.bin'
        if len(payload)!=rows*row_bytes:raise ValueError("Wrong encoded tensor length")
        (data/relative).write_bytes(payload)
        tensors.append({'id':index,'name':name,'kind':kind,'rows':rows,'width':width,
            'row_bytes':row_bytes,'file':relative,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()})
    def matrix(name,value,bias=None):
        rows,width=value.shape;scale=np.max(np.abs(value),axis=1)/127
        scale=np.where(scale==0,1/(1<<24),scale)
        fixed=np.maximum(1,np.rint(scale*(1<<24))).astype('>u4')
        weights=np.clip(np.rint(value/scale[:,None]),-127,127).astype(np.int8)
        extra=4 if bias is None else 8;raw=np.empty((rows,width+extra),dtype=np.uint8)
        if bias is not None:raw[:,:4]=np.rint(bias*4096).astype('>i4').view(np.uint8).reshape(rows,4)
        at=0 if bias is None else 4
        raw[:,at:at+4]=fixed.view(np.uint8).reshape(rows,4);raw[:,extra:]=weights.view(np.uint8)
        save(name,'embedding' if bias is None else 'linear',rows,width,width+extra,raw.tobytes())
    def norm(name,prefix):
        value=np.concatenate([learned(prefix+'.weight'),learned(prefix+'.bias')])
        save(name,'layernorm',1,64,512,np.rint(value*4096).astype('>i4').tobytes())
    matrix('wte',learned('transformer.wte.weight'))
    save('wpe','position',2048,64,256,np.rint(learned('transformer.wpe.weight')*4096).astype('>i4').tobytes())
    norm('lnf','transformer.ln_f')
    for layer in range(8):
        prefix=f'transformer.h.{layer}';norm(f'layer{layer}-ln1',prefix+'.ln_1');norm(f'layer{layer}-ln2',prefix+'.ln_2')
        value=np.concatenate([learned(prefix+f'.attn.attention.{x}_proj.weight') for x in ['q','k','v']])
        matrix(f'layer{layer}-qkv',value,np.zeros(192))
        for name,suffix in [('attnout','.attn.attention.out_proj'),('fc','.mlp.c_fc'),('proj','.mlp.c_proj')]:
            matrix(f'layer{layer}-{name}',learned(prefix+suffix+'.weight'),learned(prefix+suffix+'.bias'))
    omitted=set(state)-used
    if parameters!=3745984 or any(not(n.endswith('.attn.attention.bias') or n.endswith('.attn.attention.masked_bias')) for n in omitted):
        raise ValueError("Unexpected learned parameters or omitted tensors")
    save('exp','exp_lut',1,4097,16388,np.array([round(math.exp(-i/256)*(1<<24)) for i in range(4097)],dtype='>u4').tobytes())
    save('tanh','tanh_lut',1,2049,4098,np.array([round(math.tanh(i/256)*4096) for i in range(2049)],dtype='>u2').tobytes())
    manifest={'model_id':'roneneldan/TinyStories-1M','revision':REVISION,'checkpoint_sha256':CHECKPOINT,
        'unique_parameter_count':parameters,'architecture':ARCHITECTURE,'tensors':tensors}
    (data/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    prepare(output) # Independently pinned flat hash and exact tensor geometry.

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--output-dir',type=Path,default=Path(__file__).parent/'.cache/export')
    args=p.parse_args();export(args.checkpoint,args.output_dir)
