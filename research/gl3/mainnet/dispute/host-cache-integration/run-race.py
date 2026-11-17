"""Existing Runpod only; immutable attempt03 SDK, separate race binaries/logs."""
import hashlib,json,os,pathlib,subprocess,time
BASE=pathlib.Path('/root/gl3-host-cache-integration');OUT=BASE/'race-01';SDK=BASE/'attempt-03/nitro';OUT.mkdir(exist_ok=False)
env=os.environ.copy();env.update({'PATH':'/root/bounded-restore/toolchain/go/bin:'+env['PATH'],'GOMAXPROCS':'2','GOTOOLCHAIN':'local','GOPROXY':'off','GORACE':'halt_on_error=1','GL3_INTEGRATION_EVIDENCE':str(OUT)})
results=[]
for package in ['server_arb','client']:
 binary=OUT/(package+'.test');cmd=['go','test','-race','-c','-p','2','-mod=readonly','-buildvcs=false','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(binary),'./validator/'+package];start=time.monotonic()
 with(OUT/(package+'-compile.log')).open('w')as log:p=subprocess.run(cmd,cwd=SDK,env=env,stdout=log,stderr=subprocess.STDOUT)
 item={'phase':'compile','package':package,'exitCode':p.returncode,'seconds':time.monotonic()-start,'command':cmd};results.append(item);(OUT/'results.json').write_text(json.dumps({'complete':False,'results':results},indent=2)+'\n')
 if p.returncode:continue
 item['binarySHA256']=hashlib.sha256(binary.read_bytes()).hexdigest();cmd=[str(binary),'-test.v','-test.timeout=90s','-test.run=^TestGL3Integration'];start=time.monotonic()
 with(OUT/(package+'-tests.log')).open('w')as log:p=subprocess.run(cmd,cwd=SDK,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append({'phase':'tests','package':package,'exitCode':p.returncode,'seconds':time.monotonic()-start,'command':cmd,'binarySHA256':item['binarySHA256']});(OUT/'results.json').write_text(json.dumps({'complete':False,'results':results},indent=2)+'\n')
(OUT/'results.json').write_text(json.dumps({'complete':True,'results':results,'passed':all(x['exitCode']==0 for x in results),'nativeRustCDataRacesCovered':False},indent=2)+'\n')
