from pathlib import Path
import json,importlib.util,numpy as np
P=Path(__file__).resolve().parent;V=P.parent.parent
s=importlib.util.spec_from_file_location('original',V/'voice-v8/evm/reference.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=m.Reference(V/'nova-optimization/selected');rng=np.random.default_rng(913713)
rows=[]
for i in range(16):
 if i==0:h=np.zeros(768,dtype=np.int64)
 elif i==1:h=np.full(768,-1024,dtype=np.int64)
 elif i==2:h=np.full(768,1024,dtype=np.int64)
 elif i==3:h=np.tile([-1024,1024],384)
 elif i==4:h=np.arange(768)-384
 else:h=rng.integers(-1024,1025,768)
 f=[4096,-4096,4096,-4096,4096,-4096]if i%3==0 else [0]*6 if i%3==1 else [68,0,68,54,1024,1024]
 seed=42+i;temp=[64,128,256,512,1024,2048,4096][i%7]
 expected=r.step(8192,0,h.tolist(),f,f'0x{seed:064x}',0,temp,scalar=i<4)
 rows.append({'seed':seed,'temp':temp,'hidden':h.tolist(),'features':f,'expected':expected})
(P/'wasm-probes.json').write_text(json.dumps(rows)+'\n');print('Saved16independentexactprobes')
