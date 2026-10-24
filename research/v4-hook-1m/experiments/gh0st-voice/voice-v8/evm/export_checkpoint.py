"""H384/H512 exact SIMD8 export; fully neural two-layer word/punctuation model."""
import argparse,hashlib,json,math,re
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file

sha=lambda b:hashlib.sha256(b).hexdigest()
def rows(matrix,bias=None):
    result=bytearray()
    for i,row in enumerate(matrix):
        result.extend((row+32768).astype('>u4').tobytes())
        result.extend(int(row.sum()).to_bytes(32,'big',signed=True))
        if bias is not None:result.extend(int(bias[i]).to_bytes(32,'big',signed=True))
    return bytes(result)
def pack40(array):
    assert array.min()>=-(2**39) and array.max()<2**39
    return ((array.astype(np.uint64)[...,None]>>np.array([32,24,16,8,0],dtype=np.uint64))&255).astype(np.uint8).tobytes()
def main():
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();assert not a.out.exists()
    raw=load_file(a.checkpoint/'model.safetensors');h=raw['embedding.weight'].shape[1];assert h in (384,512);q={}
    shapes={'embedding.weight':(8194,h),'punct_embedding.weight':(5,h),'wx1':(3*h,h),'wh1':(3*h,h),'wf':(3*h,6),'bh1':(3*h,),
            'wx2':(3*h,h),'wh2':(3*h,h),'bh2':(3*h,),'domain.weight':(2,3*h),'groups.weight':(128,h),'group_bias.weight':(128,1),
            'words.weight':(8192,h),'word_bias.weight':(8192,1),'punct_head.weight':(5,h),'punct_bias':(5,),'word_punct_bias.weight':(8192,5)}
    assert set(raw)==set(shapes)
    for name,shape in shapes.items():
        assert raw[name].shape==shape and np.isfinite(raw[name]).all(),name
        q[name]=np.rint(raw[name].astype(np.float64)*1024).astype(np.int64);assert q[name].min()>=-32768 and q[name].max()<=32767,name
    a.out.mkdir(parents=True);i16=lambda x:x.astype('>i2').tobytes();stride=h*4+32;headstride=stride+32
    core=rows(np.concatenate([q['wh1'],q['wx2'],q['wh2']]))+i16(q['wf'])+i16(q['bh2'])
    fused=bytearray()
    for start in range(0,8193,128):fused.extend(pack40(q['embedding.weight'][start:min(start+128,8193)]@q['wx1'].T+(q['bh1']+q['domain.weight'][0])[None,:]*1024))
    punct=rows(q['punct_head.weight'],q['punct_bias'])+i16(q['word_punct_bias.weight'])+pack40(q['punct_embedding.weight']@q['wx1'].T)
    vocabulary=json.loads((a.data/'vocabulary.json').read_text());assert len(set(vocabulary))==8192 and all(re.fullmatch(r"[a-z]+(?:'[a-z]+)*",w)and len(w)<=32 for w in vocabulary)
    vb=b''.join(w.encode().ljust(32,b'\0')for w in vocabulary);assert vb==(a.data/'vocabulary.bin').read_bytes()
    research=Path(__file__).resolve().parents[4]
    blobs={'core.bin':core,'groups.bin':rows(q['groups.weight'],q['group_bias.weight'][:,0]),'words.bin':rows(q['words.weight'],q['word_bias.weight'][:,0]),'fused.bin':bytes(fused),'punctuation.bin':punct,'vocabulary.bin':vb,'vocabulary.json':(a.data/'vocabulary.json').read_bytes(),'sigmoid-delta.bin':(research/'experiments/four-point-five-million/model/sigmoid-delta.bin').read_bytes(),'exp-q32.bin':b''.join(round(math.exp(-i/16)*2**32).to_bytes(8,'big')for i in range(257))}
    for name,data in blobs.items():(a.out/name).write_bytes(data)
    np.savez(a.out/'reference.npz',**{k:v.astype(np.int16)for k,v in q.items()})
    values={'H':h,'STATE':2*h,'SLOTS':2*h//16,'PARAMS':sum(v.size for v in raw.values()),'CORE':len(core),'GROUP':len(blobs['groups.bin']),'WORD':len(blobs['words.bin']),'FUSED':len(fused),'PUNCT':len(punct),'CSTRIDE':stride,'HSTRIDE':headstride,'CMAT':9*h*stride,'PFOLD':5*headstride+81920,'H4':h*4,'H4PLUS32':h*4+32,'H2':h*2,'H3':h*3,'H4M':h*4,'H5':h*5,'H6':h*6,'H7':h*7,'H8':h*8,'H18':h*18,'H19':h*19,'H20':h*20,'FROW':h*15,'AUX':h*42,'PHBYTES':5*headstride}
    for filename in ('GRU2SIMDModel.sol','GRU2SIMDHook.sol'):
        source=Path(__file__).with_name('contracts').joinpath(filename+'.in').read_text()
        for name,value in values.items():source=source.replace('@'+name+'@',str(value))
        assert not re.search(r'@[A-Z][A-Z0-9]*@',source)
        (a.out/filename).write_text(source)
    report={'scope':'Local SIMD8 model export, no language approval','hidden_per_layer':h,'state_values':2*h,'parameters':values['PARAMS'],'checkpoint_sha256':sha((a.checkpoint/'model.safetensors').read_bytes()),'data_manifest_sha256':sha((a.data/'manifest.json').read_bytes()),'model_domain':f'GH0ST_GRU2_SIMD8_H{h}_Q10_LOCAL_V1','source_sha256':sha((a.out/'GRU2SIMDModel.sol').read_bytes()),'hook_source_sha256':sha((a.out/'GRU2SIMDHook.sol').read_bytes()),'clipped_weights':0,'artifacts':{name:{'bytes':len(data),'sha256':sha(data)}for name,data in blobs.items()},'reference_sha256':sha((a.out/'reference.npz').read_bytes()),'packing':'8 unsigned32 lanes per EVMword, signed correction once per row, sums and headbias stored int256','catalog':'two-level code catalog,1024 data addresses per page','fixed_runtime_domain':0,'mainnet_actions':0}
    (a.out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k]for k in ('hidden_per_layer','parameters','checkpoint_sha256')}))
if __name__=='__main__':main()
