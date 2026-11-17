from pathlib import Path
import subprocess,os,time,json
base=Path('/root/gl3-host-execution-cache-health');out=base/'evidence';env=os.environ.copy();env['PATH']='/root/bounded-restore/toolchain/go/bin:'+env['PATH'];env['GOMAXPROCS']='2'
results=[]
for name,flags in [('normal',[]),('race',['-race'])]:
 cmd=['go','test','-p','2','-mod=readonly']+flags+['-count=1','-timeout=90s','-v','-run','^TestGL3Pool','./validator/client']
 t=time.time()
 with (out/(name+'.log')).open('w') as log:p=subprocess.run(cmd,cwd=base/'nitro',env=env,stdout=log,stderr=subprocess.STDOUT)
 result={'profile':name,'command':cmd,'exitCode':p.returncode,'seconds':time.time()-t};results.append(result);(out/'result.json').write_text(json.dumps({'results':results,'passed':len(results)==2 and all(x['exitCode']==0 for x in results)},indent=2)+'\n')
 if p.returncode:break
