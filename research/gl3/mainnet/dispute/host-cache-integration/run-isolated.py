"""Run on the existing Runpod only; never execute this controller locally."""
import hashlib,json,os,pathlib,shutil,subprocess,time
BASE=pathlib.Path('/root/gl3-host-cache-integration')
OUT=BASE/os.environ.get('GL3_INTEGRATION_ATTEMPT','attempt-01');SDK=OUT/'nitro';FROZEN=pathlib.Path('/root/gl3-host-execution-cache/frozen-candidate-01');ACTIVE=pathlib.Path('/root/gl3-host-execution-cache/nitro')
OUT.mkdir(exist_ok=False)
manifest=json.loads((FROZEN/'source-manifest.json').read_text())
for rel,sha in manifest['sourceFiles'].items():
 for base in [FROZEN/'source',ACTIVE]:
  assert hashlib.sha256((base/rel).read_bytes()).hexdigest()==sha,(base,rel)
shutil.copytree(ACTIVE,SDK,symlinks=False,ignore=shutil.ignore_patterns('.git','target','node_modules'))
shutil.copytree(ACTIVE/'target/lib',SDK/'target/lib',symlinks=False)
shutil.copytree(ACTIVE/'target/include',SDK/'target/include',symlinks=False)
for rel,sha in manifest['sourceFiles'].items():
 shutil.copy2(FROZEN/'source'/rel,SDK/rel)
 assert hashlib.sha256((SDK/rel).read_bytes()).hexdigest()==sha,rel
shutil.copy2(FROZEN/'source-manifest.json',OUT/'candidate-source-manifest.json')
for src in (BASE/'tests').glob('*.go'):
 package='client' if src.name=='client_integration_test.go' else 'server_arb'
 shutil.copy2(src,SDK/'validator'/package/('gl3_'+src.name))
env=os.environ.copy();env['PATH']='/root/bounded-restore/toolchain/go/bin:'+env['PATH'];env['GOMAXPROCS']='2';env['GOTOOLCHAIN']='local';env['GOPROXY']='off';env['GL3_INTEGRATION_EVIDENCE']=str(OUT)
files=[str(p)for p in SDK.glob('validator/*/gl3_*test.go')]
r=subprocess.run(['gofmt','-w',*files],env=env,cwd=SDK,capture_output=True,text=True)
(OUT/'gofmt.json').write_text(json.dumps({'exitCode':r.returncode,'stderr':r.stderr},indent=2)+'\n');assert r.returncode==0
source={str(p.relative_to(SDK)):hashlib.sha256(p.read_bytes()).hexdigest()for p in SDK.glob('validator/*/gl3_*test.go')}
(OUT/'integration-source-manifest.json').write_text(json.dumps(source,indent=2)+'\n')
results=[]
for package in ['server_arb','client']:
 binary=OUT/(package+'.test');cmd=['go','test','-c','-p','2','-mod=readonly','-buildvcs=false','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(binary),'./validator/'+package]
 start=time.monotonic()
 with(OUT/(package+'-compile.log')).open('w')as log:r=subprocess.run(cmd,cwd=SDK,env=env,stdout=log,stderr=subprocess.STDOUT)
 item={'phase':'compile','package':package,'exitCode':r.returncode,'seconds':time.monotonic()-start,'command':cmd};results.append(item)
 (OUT/'results.json').write_text(json.dumps({'results':results,'complete':False},indent=2)+'\n')
 if r.returncode:continue
 item['binarySHA256']=hashlib.sha256(binary.read_bytes()).hexdigest()
 cmd=[str(binary),'-test.v','-test.timeout=90s','-test.run=^TestGL3Integration']
 start=time.monotonic()
 with(OUT/(package+'-tests.log')).open('w')as log:r=subprocess.run(cmd,cwd=SDK,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append({'phase':'tests','package':package,'exitCode':r.returncode,'seconds':time.monotonic()-start,'command':cmd,'binarySHA256':item['binarySHA256']})
 (OUT/'results.json').write_text(json.dumps({'results':results,'complete':False},indent=2)+'\n')
(OUT/'results.json').write_text(json.dumps({'results':results,'complete':True,'passed':all(x['exitCode']==0 for x in results)},indent=2)+'\n')
