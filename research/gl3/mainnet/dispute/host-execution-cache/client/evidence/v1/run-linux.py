"""Run only tiny mock client-pool tests on the existing Runpod, never an engine."""
from pathlib import Path
import fcntl,hashlib,json,os,platform,shutil,subprocess,time

if platform.system()!="Linux" or platform.machine()!="x86_64":raise SystemExit("Runpod Linux x86_64 only")
root=Path("/root/gl3-host-execution-cache-client");root.mkdir(exist_ok=True)
lock=(root/"runner.lock").open("w");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
kit=Path(__file__).resolve().parent;source=root/"nitro";out=root/"evidence";out.mkdir(exist_ok=True)
base=Path("/root/future-lifecycle-865-geometry43-build/nitro")
if not source.exists():shutil.copytree(base,source,symlinks=True,ignore=shutil.ignore_patterns(".git","node_modules"))
identity=source/"validator/hostcacheidentity";identity.mkdir(exist_ok=True)
frozen=Path("/root/gl3-host-cache-identity-v1/evidence/identity.go")
def sha(path):
    with Path(path).open("rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
if sha(frozen)!="d674b66890d9f6047ab45fa1f38dadb9b77b73b43d9a318b8e014b8eb3cac6ec":raise SystemExit("frozen identity mismatch")
shutil.copy2(frozen,identity/"identity.go")
files=["experimental_run_cache.go","experimental_run_cache_test.go"]
for name in files:shutil.copy2(kit/name,source/"validator/client"/name)
go=Path("/root/bounded-restore/toolchain/go/bin/go")
env={**os.environ,"GOTOOLCHAIN":"local","GOMAXPROCS":"2","PATH":str(go.parent)+":"+os.environ["PATH"]}
subprocess.run([str(go.parent/"gofmt"),"-w",*[str(source/"validator/client"/n) for n in files]],check=True)
before={name:sha(source/"validator/client"/name) for name in files}
before.update({"identitySHA256":sha(identity/"identity.go"),"baselineSDKGlueSHA256":sha(source/"validator/client/validation_client.go"),"controllerSHA256":sha(kit/"run-linux.py"),"allExecutionOnRunpod":True,"GOMAXPROCS":2,"mockOnly":True,"engineOrReplayStarted":False})
(out/"source-manifest.json").write_text(json.dumps(before,indent=2)+"\n")
for name in files:shutil.copy2(source/"validator/client"/name,out/name)
shutil.copy2(kit/"run-linux.py",out/"run-linux.py")
for mode,extra in [("normal",[]),("race",["-race"])]:
    args=[str(go),"test",*extra,"-v","-count=1","-p","2","-mod=readonly","-run","^TestGL3Pool","./validator/client"]
    started=time.monotonic()
    with (out/(mode+".log")).open("w") as log:
        process=subprocess.Popen(args,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        (out/(mode+"-process.json")).write_text(json.dumps({"pid":process.pid,"command":args},indent=2)+"\n")
        pid,status,usage=os.wait4(process.pid,0);code=os.waitstatus_to_exitcode(status);process.returncode=code
    result={"exitCode":code,"rawWaitStatus":status,"seconds":time.monotonic()-started,"maxRSSKiB":usage.ru_maxrss,"actualPID":pid}
    (out/(mode+"-exit.json")).write_text(json.dumps(result,indent=2)+"\n")
    if code:raise SystemExit(code)
if any(sha(source/"validator/client"/n)!=before[n] for n in files):raise SystemExit("source changed during tests")
(out/"result.json").write_text(json.dumps({"passed":True,"normalAndRace":True,"mockOnly":True,"engineOrReplayStarted":False},indent=2)+"\n")
