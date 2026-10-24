"""Offline export-format test for train-only UNK and fixed domain0 folding."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file,save_file

HERE=Path(__file__).resolve().parent
RESEARCH=HERE.parents[4]
source=RESEARCH/'experiments/gh0st-voice/recurrent-v1/gru-h224/training/smoke-mps/checkpoint-00015920'
fixture=HERE/'fixture'
with tempfile.TemporaryDirectory(prefix='adaptive-export-test-')as directory:
    root=Path(directory);checkpoint=root/'checkpoint';checkpoint.mkdir();out=root/'out'
    old=load_file(source/'model.safetensors')
    tensors={k:v for k,v in old.items()if k not in {'nodes.weight','bias.weight'}}
    tensors['embedding.weight']=np.concatenate([old['embedding.weight'],np.zeros((1,224),dtype=np.float32)])
    for name,prefix,count in [('groups.bin','group',128),('words.bin','word',8192)]:
        values=np.frombuffer((fixture/name).read_bytes(),dtype='>i2').astype(np.float32).reshape(count,225)/1024
        tensors['groups.weight'if prefix=='group'else'words.weight']=values[:,:224].copy()
        tensors[prefix+'_bias.weight']=values[:,224:].copy()
    tensors['domain.weight']=np.stack([np.full(672,1/1024,dtype=np.float32),np.full(672,-2/1024,dtype=np.float32)])
    save_file({k:np.ascontiguousarray(v)for k,v in tensors.items()},checkpoint/'model.safetensors')
    subprocess.run([sys.executable,str(HERE/'export_checkpoint.py'),'--checkpoint',str(checkpoint),'--data',str(RESEARCH/'experiments/gh0st-voice/recurrent-v1/training/data-v3'),'--out',str(out)],check=True,capture_output=True)
    report=json.loads((out/'manifest.json').read_text());assert report['parameters']==4014560
    assert report['training_only_unk_row'] and report['training_only_unk_parameters']==224 and report['domain_parameters']==1344
    e=np.frombuffer((out/'original-embedding.bin').read_bytes(),dtype='>i2').astype(np.int64).reshape(8193,224)
    wx=np.frombuffer((out/'original-wx.bin').read_bytes(),dtype='>i2').astype(np.int64).reshape(672,224)
    bh=np.frombuffer((out/'original-bh.bin').read_bytes(),dtype='>i2').astype(np.int64)
    domain=np.frombuffer((out/'original-domain.bin').read_bytes(),dtype='>i2').astype(np.int64).reshape(2,672)
    b=np.frombuffer((out/'fused.bin').read_bytes(),dtype=np.uint8).astype(np.int64).reshape(8193,672,5)
    fused=(b*np.array([2**32,2**24,2**16,2**8,1])).sum(-1);fused=np.where(fused>=2**39,fused-2**40,fused)
    assert np.array_equal(fused,e@wx.T+(bh+domain[0])*1024)
    assert np.all(domain[0]==1)and np.all(domain[1]==-2)
    assert 'SOURCE_MODEL_PARAMETERS = 4014560' in (out/'AdaptiveGRUWordModel.sol').read_text()
    result={'status':'PASS','scope':'Offline synthetic export adapter test; no EVM gas or trained-quality claim',
            'training_only_unk_omitted_from_runtime':True,'domain0_quantized_separately_then_folded_exactly':True,
            'all5505696_fused_values_match':True,'source_parameter_count_includes_extra_training_rows':True,
            'exporter_sha256':hashlib.sha256((HERE/'export_checkpoint.py').read_bytes()).hexdigest()}
    (HERE/'exporter-self-test.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
