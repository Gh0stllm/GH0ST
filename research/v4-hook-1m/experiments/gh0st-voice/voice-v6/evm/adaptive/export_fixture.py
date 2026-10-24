"""Untrained adaptive-head fixture over the frozen GRU smoke recurrence."""
import argparse,hashlib,json,math
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
assert not a.out.exists();a.out.mkdir(parents=True)
source=json.loads((a.base/'manifest.json').read_text());manifest=dict(source);artifacts={}
for name in ['core.bin','fused.bin','vocabulary.bin','vocabulary.json','sigmoid-delta.bin']:
    raw=(a.base/name).read_bytes();assert hashlib.sha256(raw).hexdigest()==source['artifacts'][name]['sha256']
    (a.out/name).symlink_to((a.base/name).resolve());artifacts[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
for name in ['original-embedding.bin','original-wx.bin','original-bh.bin']:(a.out/name).symlink_to((a.base/name).resolve())
rng=np.random.default_rng(128064)
for name,count in [('groups.bin',128),('words.bin',8192)]:
    weights=np.rint(rng.normal(0,.05,(count,224))*1024).astype(np.int64)
    bias=np.rint(rng.normal(0,.1,(count,1))*1024).astype(np.int64)
    rows=np.concatenate([weights,bias],axis=1);assert rows.min()>=-32768 and rows.max()<=32767
    raw=rows.astype('>i2').tobytes();(a.out/name).write_bytes(raw);artifacts[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
raw=b''.join(round(math.exp(-i/16)*(2**32)).to_bytes(8,'big')for i in range(257))
(a.out/'exp-q32.bin').write_bytes(raw);artifacts['exp-q32.bin']={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
manifest.update(scope='Untrained two-stage output head fixture; numerical/gas experiment, not language-quality evidence',parameters=4012992,
    model_domain='GH0ST_GRU_H224_ADAPTIVE_Q10_LOCAL_V1',fixture_random_seed=128064,artifacts=artifacts,
    source_gru_manifest_sha256=hashlib.sha256((a.base/'manifest.json').read_bytes()).hexdigest(),
    head_math='P(group|h)*P(word|group,h);128group logits+64selected-cluster logits; id=group*64+within',
    exp_format='uint64BE Q32 round(exp(-i/16)*2^32),i=0..256',
    input_only_unknown='Future8194-row training embeddings export only first8193rows; runtimeBOS8192; noUNKoutput')
(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'out':str(a.out),'head_parameters':(128+8192)*225,'extra_parameters':29025}))
