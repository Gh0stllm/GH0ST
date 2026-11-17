"""Read-only closed-DB storage/cold-restore probe. All execution stays on Runpod."""
from pathlib import Path
import fcntl,hashlib,json,os,platform,shutil,subprocess,time

if platform.system()!="Linux" or platform.machine()!="x86_64":raise SystemExit("Runpod Linux x86_64 only")
root=Path("/root/gl3-twenty-game-capacity");root.mkdir(exist_ok=True)
lock=(root/"runner.lock").open("w");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
kit=Path(__file__).resolve().parent;source=root/"native";out=root/"evidence";out.mkdir(exist_ok=True)
base=Path("/root/future-lifecycle-865-geometry43-build/nitro")
if not source.exists():subprocess.run(["cp","-al",str(base),str(source)],check=True)
target=source/"precompiles/capacity_readonly_test.go"
if target.exists():target.unlink()
shutil.copy2(kit/"capacity_readonly_test.go",target)
go=Path("/root/bounded-restore/toolchain/go/bin/go")
env={**os.environ,"GOTOOLCHAIN":"local","GOMAXPROCS":"2","PATH":str(go.parent)+":"+os.environ["PATH"],"GL3_CAPACITY_DB":"/root/gl3-process-recovery/full/attempt-02/run/persistent-l2/test-stack-name/l2chaindata","GL3_CAPACITY_OUT":str(out),"GL3_CAPACITY_WORKER_MANIFEST":"/root/gl3-process-recovery/full/attempt-02/run/worker-manifest.json"}
subprocess.run([str(go.parent/"gofmt"),"-w",str(target)],check=True)
def sha(p):
    with Path(p).open("rb") as f:return hashlib.file_digest(f,"sha256").hexdigest()
def save(name,value):(out/name).write_text(json.dumps(value,indent=2)+"\n")
dbroot=Path(env["GL3_CAPACITY_DB"]).parent
def files():
    rows=[]
    for group in ["l2chaindata","arbitrumdata","wasm"]:
        for p in sorted((dbroot/group).rglob("*")):
            if p.is_file():
                st=p.stat();rows.append({"path":str(p.relative_to(dbroot)),"bytes":st.st_size,"allocated":st.st_blocks*512,"mtimeNS":st.st_mtime_ns,"inode":st.st_ino,"SHA256":sha(p)})
    return rows
before=files();save("database-files-before.json",before)
manifest={"probeSHA256":sha(target),"controllerSHA256":sha(kit/"run-linux.py"),"workerManifestSHA256":sha(env["GL3_CAPACITY_WORKER_MANIFEST"]),"inputFullDecisionReportSHA256":sha('/root/gl3-process-recovery/full/attempt-02/run/full-process-recovery.json'),"allExecutionOnRunpod":True,"GOMAXPROCS":2,"readOnly":True,"searchExecuted":False}
save("source-manifest.json",manifest);shutil.copy2(target,out/target.name);shutil.copy2(kit/"run-linux.py",out/"run-linux.py")
args=[str(go),"test","-v","-count=1","-p","2","-mod=readonly","-run","^TestGL3CapacityReadOnlyCompletedDatabase$","./precompiles"]
started=time.monotonic()
with (out/"probe.log").open("w") as log:
    process=subprocess.Popen(args,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    save("process.json",{"pid":process.pid,"command":args})
    pid,status,usage=os.wait4(process.pid,0);code=os.waitstatus_to_exitcode(status);process.returncode=code
save("exit.json",{"exitCode":code,"rawWaitStatus":status,"seconds":time.monotonic()-started,"maxRSSKiB":usage.ru_maxrss,"actualPID":pid})
after=files();save("database-files-after.json",after)
unchanged=before==after;save("database-immutability.json",{"exactFileHashesSizesInodesMtimesUnchanged":unchanged,"fileCount":len(before),"readOnly":True})
if code:raise SystemExit(code)
if not unchanged:raise SystemExit("read-only evidence DB files changed")
save("result.json",{"passed":True,"sourceAndEvidenceUnchanged":sha(target)==manifest['probeSHA256'],"databaseFilesUnchanged":unchanged,"twentyGameCapacityAccepted":False,"scope":"one real completed decision storage and cold restore, no search or transaction"})
