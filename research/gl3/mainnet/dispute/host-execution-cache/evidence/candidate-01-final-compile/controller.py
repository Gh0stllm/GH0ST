import subprocess,time,json,os
from pathlib import Path
out=Path('/root/gl3-host-execution-cache/candidate-01-final-compile')
env=os.environ.copy();env['GOMAXPROCS']='2';env['PATH']='/root/bounded-restore/toolchain/go/bin:'+env['PATH']
commands=[['go','test','-c','-p','2','-mod=readonly','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(out/'server_arb.test'),'./validator/server_arb'],['go','test','-c','-p','2','-mod=readonly','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(out/'client.test'),'./validator/client']]
results=[]
for i,cmd in enumerate(commands):
 t=time.time()
 with (out/f'compile-{i}.log').open('w') as log:p=subprocess.run(cmd,cwd='/root/gl3-host-execution-cache/nitro',env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append({'command':cmd,'exitCode':p.returncode,'seconds':time.time()-t})
 (out/'result.json').write_text(json.dumps({'results':results,'passed':all(r['exitCode']==0 for r in results)},indent=2)+'\n')
 if p.returncode:break
