"""Runpod only: actual RPC transport-first shutdown and fast static server TTL."""
import hashlib,json,os,pathlib,shutil,subprocess,time
BASE=pathlib.Path('/root/gl3-host-cache-integration');OUT=BASE/'candidate03-stoporder-01';SDK=OUT/'nitro';SOURCE=BASE/'candidate03-attempt-01/nitro';OUT.mkdir(exist_ok=False)
shutil.copytree(SOURCE,SDK,symlinks=False)
shutil.copy2(BASE/'candidate02-tests/stop_order_test.go',SDK/'validator/valnode/gl3_stop_order_test.go')
env=os.environ.copy();env.update({'PATH':'/root/bounded-restore/toolchain/go/bin:'+env['PATH'],'GOMAXPROCS':'2','GOTOOLCHAIN':'local','GOPROXY':'off','GORACE':'halt_on_error=1','GL3_INTEGRATION_EVIDENCE':str(OUT)})
f=SDK/'validator/valnode/gl3_stop_order_test.go';subprocess.run(['gofmt','-w',str(f)],env=env,check=True)
(OUT/'source-manifest.json').write_text(json.dumps({str(q.relative_to(SDK)):hashlib.sha256(q.read_bytes()).hexdigest()for q in SDK.glob('validator/*/gl3_*test.go')},indent=2)+'\n')
results=[]
for race in [False,True]:
 tag='race'if race else'normal';binary=OUT/(tag+'.test');cmd=['go','test','-c','-p','2','-mod=readonly','-buildvcs=false','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(binary),'./validator/valnode']
 if race:cmd.insert(2,'-race')
 start=time.monotonic()
 with(OUT/(tag+'-compile.log')).open('w')as log:p=subprocess.run(cmd,cwd=SDK,env=env,stdout=log,stderr=subprocess.STDOUT)
 result={'phase':'compile','race':race,'exitCode':p.returncode,'seconds':time.monotonic()-start,'command':cmd};results.append(result)
 if p.returncode:continue
 result['binarySHA256']=hashlib.sha256(binary.read_bytes()).hexdigest();cmd=[str(binary),'-test.v','-test.timeout=10s','-test.run=^TestGL3IntegrationActualRPCSpawnerStopBeforePoolIdleFallback$'];start=time.monotonic()
 with(OUT/(tag+'-tests.log')).open('w')as log:p=subprocess.run(cmd,cwd=SDK,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append({'phase':'tests','race':race,'exitCode':p.returncode,'seconds':time.monotonic()-start,'command':cmd,'binarySHA256':result['binarySHA256']})
 (OUT/'results.json').write_text(json.dumps({'complete':False,'results':results},indent=2)+'\n')
(OUT/'results.json').write_text(json.dumps({'complete':True,'results':results,'passed':all(x['exitCode']==0 for x in results)},indent=2)+'\n')
