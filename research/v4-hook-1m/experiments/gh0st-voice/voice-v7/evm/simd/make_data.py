"""Generate exact full-int16 microbenchmark matrices and packed row sums."""
from pathlib import Path
import hashlib,json,numpy as np

HERE=Path(__file__).resolve().parent
OUT=HERE/'data';OUT.mkdir(exist_ok=False)
rng=np.random.default_rng(728103)
report={'seed':728103,'kind':'Random full-int16 microbenchmark data, not trained parameters','cases':[]}
for dim,rows in [(128,1152),(256,2304),(512,4608)]:
    matrix=rng.integers(-32768,32768,size=(rows,dim),dtype=np.int64)
    # Include every extreme sign combination in the leading16 columns/rows.
    for row in range(min(16,rows)):
        matrix[row,:]=32767 if row%2 else -32768
    vector=rng.integers(-1024,1025,size=dim,dtype=np.int64);vector[:8]=[-1024,1024,0,-1,1,1024,-1024,0]
    scalar=matrix.astype('>i2').tobytes();blocks=(matrix.reshape(rows,-1,4)+32768)[:,:,::-1]
    packed=bytearray()
    for row in range(rows):
        for values in blocks[row]:packed.extend(sum(int(v)<<(64*i)for i,v in enumerate(values)).to_bytes(32,'big'))
        packed.extend((int(matrix[row].sum())%(2**256)).to_bytes(32,'big'))
    expected=matrix@vector
    outputs=b''.join((int(v)%(2**256)).to_bytes(32,'big')for v in expected)
    stem=f'h{dim}-r{rows}'
    for suffix,raw in [('scalar',scalar),('packed',packed),('expected',outputs)]:
        (OUT/f'{stem}-{suffix}.bin').write_bytes(raw)
    row={'name':stem,'dim':dim,'rows':rows,'macs':dim*rows,'vector':vector.tolist(),'scalar_bytes':len(scalar),'packed_bytes':len(packed),'files':{}}
    for suffix in ('scalar','packed','expected'):
        p=OUT/f'{stem}-{suffix}.bin';row['files'][suffix]={'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    report['cases'].append(row)
(OUT/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps([{k:r[k]for k in ('name','dim','rows','macs','scalar_bytes','packed_bytes')}for r in report['cases']],indent=2))
