#!/usr/bin/env python3
"""Export the unchanged recurrent tensor layout to nearest-even signed Q10."""
import argparse,hashlib,json,re
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file
from model import V,H,D,Q,PARAMETERS

HERE=Path(__file__).resolve().parent
RESEARCH=HERE.parents[3]

def sha(data):return hashlib.sha256(data).hexdigest()

def export(checkpoint,data,out,temperature=1024):
    if out.exists():raise ValueError('New output directory required')
    assert 64<=temperature<=4096
    tensors=load_file(checkpoint/'model.safetensors')
    shapes={'embedding.weight':(V+1,H),'wx':(H,H),'wh':(H,H),'wf':(H,6),'bh':(H,),
            'nodes.weight':(V-1,H),'bias.weight':(V-1,1)}
    assert set(tensors)==set(shapes)
    arrays={};ranges={}
    for name,shape in shapes.items():
        value=tensors[name];assert value.shape==shape and np.isfinite(value).all()
        quant=np.rint(value.astype(np.float64)*Q).astype(np.int64)
        assert quant.min()>=-32768 and quant.max()<=32767,(name,'Q10 overflow')
        arrays[name]=quant;ranges[name]={'shape':list(shape),'min_q10':int(quant.min()),'max_q10':int(quant.max()),'nonzero':int(np.count_nonzero(quant))}
    vocabulary=json.loads((data/'vocabulary.json').read_text())
    assert len(vocabulary)==V and len(set(vocabulary))==V
    vocabulary_bin=(data/'vocabulary.bin').read_bytes()
    assert len(vocabulary_bin)==32*V
    assert all(re.fullmatch(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?",word) and 1<=len(word.encode('ascii'))<=32 for word in vocabulary)
    assert vocabulary_bin==b''.join(word.encode('ascii').ljust(32,b'\0') for word in vocabulary)
    source_table=RESEARCH/'experiments/four-point-five-million/model/sigmoid-delta.bin'
    table=source_table.read_bytes();assert len(table)==514
    payloads={'embeddings.bin':arrays['embedding.weight'].astype('>i2').tobytes(),
              'core.bin':b''.join(arrays[name].astype('>i2').tobytes() for name in ['wx','wh','wf','bh']),
              'nodes.bin':np.concatenate([arrays['nodes.weight'],arrays['bias.weight']],axis=1).astype('>i2').tobytes(),
              'vocabulary.bin':vocabulary_bin,'vocabulary.json':(data/'vocabulary.json').read_bytes(),
              'sigmoid-delta.bin':table}
    assert [len(payloads[x]) for x in ['core.bin','embeddings.bin','nodes.bin']]==[284610,4342290,4357612]
    out.mkdir(parents=True)
    for filename,payload in payloads.items():(out/filename).write_bytes(payload)
    report={'schema_version':1,'experiment':'recurrent-v1-grammar-voice','parameters':PARAMETERS,
            'vocabulary_size':V,'hidden_size':H,'embedding_size':H,'features':6,'tree_depth':D,'scale':Q,
            'temperature_q10':temperature,'model_domain':'GH0ST_RECURRENT_WORD_H265_Q10_LOCAL_V1',
            'core_order':['wx','wh','wf','bh'],'core_value_offsets':{'wx':0,'wh':H*H,'wf':2*H*H,'bh':2*H*H+H*6},
            'node_record_bytes':(H+1)*2,'embedding_row_bytes':H*2,'shard_sizes':{k:24000 for k in ['core','embeddings','nodes','vocabulary']},
            'checkpoint_sha256':sha((checkpoint/'model.safetensors').read_bytes()),'data_manifest_sha256':sha((data/'manifest.json').read_bytes()),
            'exporter_sha256':sha(Path(__file__).read_bytes()),'rounding':'nearest even, reject int16 overflow; no export clipping',
            'ranges':ranges,'artifacts':{name:{'bytes':len(payload),'sha256':sha(payload)} for name,payload in payloads.items()},
            'forced_punctuation':False,'continuity':'one natural word token each step, no reset at punctuation',
            'limitations':['Local export only; no EVM parity, gas or language-quality claim follows from export.']}
    (out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--temperature-q10',type=int,default=1024);a=p.parse_args()
    report=export(a.checkpoint,a.data,a.output,a.temperature_q10)
    print(json.dumps({'output':str(a.output),'checkpoint_sha256':report['checkpoint_sha256'],'parameters':report['parameters']}))
if __name__=='__main__':main()
