from pathlib import Path
import subprocess,os,time,json
b=Path('/root/gl3-host-execution-cache-orphans-v3');o=b/'final-compile';env=os.environ.copy();env['PATH']='/root/bounded-restore/toolchain/go/bin:'+env['PATH'];env['GOMAXPROCS']='2'
cmd=['go','test','-c','-p','2','-mod=readonly','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(o/'valnode.test'),'./validator/valnode'];t=time.time()
with (o/'build.log').open('w') as log:p=subprocess.run(cmd,cwd=b/'nitro',env=env,stdout=log,stderr=subprocess.STDOUT)
(o/'result.json').write_text(json.dumps({'command':cmd,'exitCode':p.returncode,'seconds':time.time()-t,'scope':'compile only'},indent=2)+'\n')
