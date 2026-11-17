from pathlib import Path
import os,subprocess,shutil,time,json,hashlib,sys
root=Path("/root/future-fixture-compile");root.mkdir(exist_ok=True)
out=root/"evidence";out.mkdir(exist_ok=True)
src=root/"nitro";kit=Path("/root/future-fixture-kit")
if not src.exists():shutil.copytree("/root/full-lifecycle/nitro",src,ignore=shutil.ignore_patterns(".git","node_modules"))
for name in ["gl3_terminal_fixture_test.go","gl3_terminal_challenge_test.go"]:shutil.copy2(kit/name,src/"system_tests"/name)
go=Path("/root/bounded-restore/toolchain/go/bin/go")
env={**os.environ,"GOTOOLCHAIN":"local","GOMAXPROCS":"4","PATH":str(go.parent)+":"+os.environ["PATH"]};env.pop("GL3_LIFECYCLE_RUN_ID",None)
t=time.monotonic()
with (out/"build.log").open("w") as f:r=subprocess.run([str(go),"test","-c","-tags","gl3_acceptance,challengetest","-p","4","-mod=mod","-ldflags=-extldflags=-Wl,-z,noexecstack","-o",str(root/"fixture.test"),"./system_tests"],cwd=src,env=env,stdout=f,stderr=subprocess.STDOUT)
(out/"build-exit.json").write_text(json.dumps({"exitCode":r.returncode,"seconds":time.monotonic()-t})+"\n");assert r.returncode==0
sys.path.insert(0,str(kit));from acceptance_guards import validate_named_test,AcceptanceError
results=[]
for label,pattern,expected in [("missing-run-id","^TestGL3TerminalResultBoLDLifecycle$",1),("no-matching-test","^NO_MATCHING_LIFECYCLE_CASE$",0)]:
 t=time.monotonic();p=subprocess.run([str(root/"fixture.test"),"-test.run",pattern,"-test.v"],cwd=src,env=env,capture_output=True,text=True,timeout=15)
 (out/(label+".log")).write_text(p.stdout+p.stderr)
 assert p.returncode==expected
 if label=="missing-run-id":assert "explicit fresh lifecycle run ID required" in p.stdout
 rejected=False
 try:validate_named_test(p.returncode,p.stdout+p.stderr)
 except AcceptanceError:rejected=True
 assert rejected
 results.append({"case":label,"actualExit":p.returncode,"expectedExit":expected,"controllerRejected":True,"seconds":time.monotonic()-t,"engineNotInvoked":True})
report={"passed":True,"scope":"Cloud compile of future nonce fixture and two real ELF entrypoint refusal regressions; no engine or chain run","cases":results,"fixtureBinarySHA256":hashlib.sha256((root/"fixture.test").read_bytes()).hexdigest(),"sourceSHA256":{n:hashlib.sha256((src/"system_tests"/n).read_bytes()).hexdigest() for n in ["gl3_terminal_fixture_test.go","gl3_terminal_challenge_test.go"]},"allExecutionOnRunpod":True,"publicDeployment":False}
(out/"result.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report),flush=True)
