"""Runpod only. Frozen candidate02; no full input/eager engine execution."""
import hashlib,json,os,pathlib,shutil,subprocess,time
BASE=pathlib.Path('/root/gl3-host-cache-integration');OUT=BASE/os.environ.get('GL3_INTEGRATION_ATTEMPT','candidate02-attempt-01');SDK=OUT/'nitro';FROZEN=pathlib.Path('/root/gl3-host-execution-cache-orphans/frozen-candidate-02');ACTIVE=pathlib.Path('/root/gl3-host-execution-cache-orphans/nitro')
OUT.mkdir(exist_ok=False);manifest=json.loads((FROZEN/'source-manifest.json').read_text())
for rel,sha in manifest['sourceFiles'].items():
 for base in [FROZEN/'source',ACTIVE]:assert hashlib.sha256((base/rel).read_bytes()).hexdigest()==sha,(base,rel)
shutil.copytree(ACTIVE,SDK,symlinks=False,ignore=shutil.ignore_patterns('.git','target','node_modules'))
for part in ['lib','include']:shutil.copytree(ACTIVE/'target'/part,SDK/'target'/part,symlinks=False)
for rel,sha in manifest['sourceFiles'].items():shutil.copy2(FROZEN/'source'/rel,SDK/rel)
shutil.copy2(FROZEN/'source-manifest.json',OUT/'candidate-source-manifest.json')
for src in(BASE/'tests').glob('*.go'):
 package='client'if src.name=='client_integration_test.go'else'server_arb';shutil.copy2(src,SDK/'validator'/package/('gl3_'+src.name))
for src in(BASE/'candidate02-tests').glob('*.go'):shutil.copy2(src,SDK/'validator/valnode'/('gl3_'+src.name))
env=os.environ.copy();env.update({'PATH':'/root/bounded-restore/toolchain/go/bin:'+env['PATH'],'GOMAXPROCS':'2','GOTOOLCHAIN':'local','GOPROXY':'off','GORACE':'halt_on_error=1','GL3_INTEGRATION_EVIDENCE':str(OUT)})
files=[str(p)for p in SDK.glob('validator/*/gl3_*test.go')];f=subprocess.run(['gofmt','-w',*files],env=env,capture_output=True,text=True);(OUT/'gofmt.json').write_text(json.dumps({'exitCode':f.returncode,'stderr':f.stderr},indent=2)+'\n');assert f.returncode==0
(OUT/'integration-source-manifest.json').write_text(json.dumps({str(p.relative_to(SDK)):hashlib.sha256(p.read_bytes()).hexdigest()for p in SDK.glob('validator/*/gl3_*test.go')},indent=2)+'\n')
results=[]
for package in os.environ.get('GL3_INTEGRATION_PACKAGES','server_arb,client,valnode').split(','):
 binary=OUT/(package+'.test');cmd=['go','test','-c','-p','2','-mod=readonly','-buildvcs=false','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(binary),'./validator/'+package];start=time.monotonic()
 with(OUT/(package+'-compile.log')).open('w')as log:p=subprocess.run(cmd,cwd=SDK,env=env,stdout=log,stderr=subprocess.STDOUT)
 item={'phase':'compile','package':package,'exitCode':p.returncode,'seconds':time.monotonic()-start,'command':cmd};results.append(item);(OUT/'results.json').write_text(json.dumps({'complete':False,'results':results},indent=2)+'\n')
 if p.returncode:continue
 item['binarySHA256']=hashlib.sha256(binary.read_bytes()).hexdigest();cmd=[str(binary),'-test.v','-test.timeout=90s','-test.run='+os.environ.get('GL3_INTEGRATION_TEST_REGEX','^TestGL3Integration')];start=time.monotonic()
 with(OUT/(package+'-tests.log')).open('w')as log:p=subprocess.run(cmd,cwd=SDK,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append({'phase':'tests','package':package,'exitCode':p.returncode,'seconds':time.monotonic()-start,'command':cmd,'binarySHA256':item['binarySHA256']});(OUT/'results.json').write_text(json.dumps({'complete':False,'results':results},indent=2)+'\n')
(OUT/'results.json').write_text(json.dumps({'complete':True,'results':results,'passed':all(x['exitCode']==0 for x in results)},indent=2)+'\n')
