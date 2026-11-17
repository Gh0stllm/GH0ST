"""Tiny native allocator only: isolated cold cache, bounded scratch, no engine."""
from pathlib import Path
import fcntl,hashlib,json,os,platform,shutil,signal,subprocess,time

if platform.system()!="Linux" or platform.machine()!="x86_64":raise SystemExit("existing Runpod Linux only")
root=Path('/root/gl3-fixed-bank-retention');root.mkdir(exist_ok=True);lock=(root/'runner.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
kit=Path(__file__).resolve().parent;source=root/'native';out=root/'evidence';out.mkdir(exist_ok=True)
base=Path('/root/future-lifecycle-865-geometry43-build/nitro')
if not source.exists():subprocess.run(['cp','-al',str(base),str(source)],check=True)
package=source/'internal/gl3bankprototype';package.mkdir(parents=True,exist_ok=True)
for name in ['bank.go','bank_test.go']:
    p=package/name
    if p.exists():p.unlink()
    shutil.copy2(kit/name,p)
cache=root/'go-cache';temp=root/'go-tmp';cache.mkdir(exist_ok=True);temp.mkdir(exist_ok=True)
go=Path('/root/bounded-restore/toolchain/go/bin/go')
env={**os.environ,'GOTOOLCHAIN':'local','GOMAXPROCS':'2','GOCACHE':str(cache),'GOTMPDIR':str(temp),'GOPROXY':'off','PATH':str(go.parent)+':'+os.environ['PATH'],'GL3_BANK_FIXTURE':str(root/'fixture'),'GL3_BANK_OUT':str(out)}
subprocess.run([str(go.parent/'gofmt'),'-w',str(package/'bank.go'),str(package/'bank_test.go')],check=True)
def sha(p):return hashlib.file_digest(Path(p).open('rb'),'sha256').hexdigest()
def save(name,value):(out/name).write_text(json.dumps(value,indent=2)+'\n')
binary=root/'fixed-bank.test'
def used(p):
    total=0
    for directory,dirs,names in os.walk(p):
        for name in names:
            try:total+=(Path(directory)/name).stat().st_blocks*512
            except FileNotFoundError:pass
    return total
def scratch():return used(cache)+used(temp)+(binary.stat().st_blocks*512 if binary.exists() else 0)
def free():s=os.statvfs('/root');return s.f_bavail*s.f_frsize
def guarded(name,args):
    started=time.monotonic();guard=None;peak=0;minimum=free()
    with (out/(name+'.log')).open('w') as log:
        p=subprocess.Popen(args,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        save(name+'-process.json',{'pid':p.pid,'command':args,'GOMAXPROCS':2,'GOCACHE':str(cache),'GOTMPDIR':str(temp)})
        while True:
            pid,status,usage=os.wait4(p.pid,os.WNOHANG)
            if pid:break
            current=scratch();remaining=free();peak=max(peak,current);minimum=min(minimum,remaining)
            if current>1_000_000_000 or remaining<6*1024**3:
                guard={'reason':'scratch>1GB' if current>1_000_000_000 else 'diskfree<6GiB','scratchBytes':current,'freeBytes':remaining}
                os.killpg(p.pid,signal.SIGTERM)
                deadline=time.monotonic()+5
                while time.monotonic()<deadline:
                    pid,status,usage=os.wait4(p.pid,os.WNOHANG)
                    if pid:break
                    time.sleep(.1)
                if not pid:os.killpg(p.pid,signal.SIGKILL);pid,status,usage=os.wait4(p.pid,0)
                break
            time.sleep(1)
        code=os.waitstatus_to_exitcode(status);p.returncode=code
    save(name+'-exit.json',{'exitCode':code,'rawWaitStatus':status,'seconds':time.monotonic()-started,'maxRSSKiB':usage.ru_maxrss,'peakOwnedScratchBytes':max(peak,scratch()),'minimumDiskFreeBytes':minimum,'resourceGuard':guard})
    if code or guard:raise SystemExit('native allocator '+name+' failed; full test left untouched')
manifest={'bankSHA256':sha(package/'bank.go'),'testSHA256':sha(package/'bank_test.go'),'controllerSHA256':sha(kit/'run-linux.py'),'fixtureManifestSHA256':sha(root/'fixture/fixture.json'),'goModuleSHA256':sha(source/'go.mod'),'allExecutionOnRunpod':True,'selectedSourceOrGuestChanged':False,'engineSearchExecuted':False,'inMemoryStateDBOnly':True}
save('source-manifest.json',manifest)
for n in ['bank.go','bank_test.go']:shutil.copy2(package/n,out/n)
shutil.copy2(kit/'run-linux.py',out/'run-linux.py');shutil.copy2(kit/'extract-fixture.py',out/'extract-fixture.py')
guarded('compile',[str(go),'test','-c','-p','2','-mod=readonly','-o',str(binary),'./internal/gl3bankprototype'])
manifest['binarySHA256']=sha(binary);save('source-manifest.json',manifest)
guarded('test',[str(binary),'-test.v','-test.timeout','2m'])
save('result.json',{'passed':True,'prototypeOnly':True,'inMemoryStateDB':True,'engineSearchExecuted':False,'wholeVMOrGuestTested':False,'twentyGameCapacityAccepted':False,'ownedCacheAndTempAndBinaryBytes':scratch()})
