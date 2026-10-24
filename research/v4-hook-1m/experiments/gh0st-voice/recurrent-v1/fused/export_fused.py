"""Lossless integer precomputation for the local H265 recurrent prototype."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np

p=argparse.ArgumentParser();p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
assert not a.out.exists();a.out.mkdir(parents=True)
manifest=json.loads((a.model_dir/'manifest.json').read_text())
embedding=np.frombuffer((a.model_dir/'embeddings.bin').read_bytes(),dtype='>i2').astype(np.int64).reshape(8193,265)
core=np.frombuffer((a.model_dir/'core.bin').read_bytes(),dtype='>i2').astype(np.int64)
wx=core[:265*265].reshape(265,265);bias=core[-265:]
fused=embedding@wx.T+bias[None,:]*1024
assert fused.min()>=-(2**39) and fused.max()<2**39
# Exactly five bytes per signed two's-complement integer, before any Q10 division.
encoded=((fused.astype(np.uint64)[...,None]>>np.array([32,24,16,8,0],dtype=np.uint64))&255).astype(np.uint8).tobytes()
assert len(encoded)==10855725
decoded=np.frombuffer(encoded,dtype=np.uint8).reshape(8193,265,5).astype(np.int64)
decoded=(decoded*np.array([2**32,2**24,2**16,2**8,1])).sum(-1)
decoded=np.where(decoded>=2**39,decoded-2**40,decoded)
assert np.array_equal(fused,decoded)
rng=np.random.default_rng(20261024)
for previous in [0,40,8192,*rng.integers(0,8193,64).tolist()]:
    scalar=[sum(int(w)*int(x)for w,x in zip(row,embedding[previous]))+int(b)*1024 for row,b in zip(wx,bias)]
    assert scalar==fused[previous].tolist()
(a.out/'fused.bin').write_bytes(encoded)
for name in ['core.bin','embeddings.bin','nodes.bin','vocabulary.bin','vocabulary.json','sigmoid-delta.bin']:
    (a.out/name).symlink_to((a.model_dir/name).resolve())
manifest['artifacts']['fused.bin']={'bytes':len(encoded),'sha256':hashlib.sha256(encoded).hexdigest()}
manifest['fused_precomputation']={'formula':'wx @ embedding[token] + bh * 1024','representation':'signed40bigendian; no division or clipping',
    'entries':int(fused.size),'minimum':int(fused.min()),'maximum':int(fused.max()),'all_entries_roundtrip':True,'scalar_checked_rows':67,
    'learned_parameters':4492256,'original_parameter_blobs_retained':True,'derived_extra_scalar_entries':int(fused.size),
    'original_model_dir':str(a.model_dir.resolve()),'scope':'Local-only lossless inference optimization; not additional learned parameters'}
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest['fused_precomputation']))
