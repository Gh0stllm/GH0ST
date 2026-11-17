"""Isolated Runpod-only key/ownership regression; never starts a machine."""
from pathlib import Path
import fcntl, hashlib, json, os, platform, shutil, subprocess, time

if platform.system() != "Linux" or platform.machine() != "x86_64":
    raise SystemExit("Run on the existing Linux x86_64 Runpod only")
root=Path("/root/gl3-host-cache-identity-v1");root.mkdir(exist_ok=True)
lock=(root/"runner.lock").open("w");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
kit=Path(__file__).resolve().parent;source=root/"nitro";out=root/"evidence";out.mkdir(exist_ok=True)
base=Path("/root/bounded-restore/fast-comparison/C-combined/native")
if not source.exists():subprocess.run(["cp","-al",str(base),str(source)],check=True)
package=source/"validator/hostcacheidentity"
package.mkdir(exist_ok=True)
for name in ["identity.go","identity_test.go"]:
    target=package/name
    if target.exists():target.unlink()
    shutil.copy2(kit/name,target)
go=Path("/root/bounded-restore/toolchain/go/bin/go")
env={**os.environ,"GOTOOLCHAIN":"local","GOMAXPROCS":"2","PATH":str(go.parent)+":"+os.environ["PATH"],"GL3_IDENTITY_ORIGINAL_INPUT":"/root/terminal-acceptance/evidence/terminal-input.json","GL3_IDENTITY_ORIGINAL_OUTPUT":str(out/"original-input-key.json")}
subprocess.run([str(go.parent/"gofmt"),"-w",str(package/"identity.go"),str(package/"identity_test.go")],check=True)
def sha(path):
    with Path(path).open("rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
before={name:sha(package/name) for name in ["identity.go","identity_test.go"]}
before.update({"controllerSHA256":sha(kit/"run-linux.py"),"baseValidationInputSHA256":sha(base/"validator/validation_entry.go"),"goModuleSHA256":sha(source/"go.mod"),"goSumSHA256":sha(source/"go.sum"),"allExecutionOnRunpod":True,"GOMAXPROCS":2,"selectedMachineOrSTFChanged":False,"backendOrReplayStarted":False})
(out/"source-manifest.json").write_text(json.dumps(before,indent=2)+"\n")
for name in ["identity.go","identity_test.go"]:shutil.copy2(package/name,out/name)
shutil.copy2(kit/"run-linux.py",out/"run-linux.py")
args=[str(go),"test","-v","-count=1","-p","2","-mod=readonly","./validator/hostcacheidentity"]
started=time.monotonic()
with (out/"test.log").open("w") as log:
    process=subprocess.Popen(args,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    (out/"process.json").write_text(json.dumps({"pid":process.pid,"command":args,"startedUTC":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())},indent=2)+"\n")
    pid,status,usage=os.wait4(process.pid,0);code=os.waitstatus_to_exitcode(status);process.returncode=code
receipt={"exitCode":code,"rawWaitStatus":status,"seconds":time.monotonic()-started,"maxRSSKiB":usage.ru_maxrss,"userSeconds":usage.ru_utime,"systemSeconds":usage.ru_stime,"actualPID":pid}
(out/"exit.json").write_text(json.dumps(receipt,indent=2)+"\n")
if code:raise SystemExit(code)
if any(sha(package/name)!=before[name] for name in ["identity.go","identity_test.go"]):raise SystemExit("source changed during tests")
markers=[line for line in (out/"test.log").read_text().splitlines() if line.lstrip().startswith("--- PASS:")]
(out/"result.json").write_text(json.dumps({"passed":True,"namedTestsAndSubtests":len(markers),"allExecutionOnRunpod":True,"replayExecuted":False,"lifecycleExecuted":False},indent=2)+"\n")
