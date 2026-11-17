"""Future selected-865 geometry-2pow43 private lifecycle: explicit compile-only or gated launch.

All execution stays on Runpod; no mainnet authority or live-prover changes.
"""
from pathlib import Path
import argparse,fcntl,hashlib,json,os,platform,shutil,subprocess,time,uuid,signal
from bounded_log_markers import scan_named_markers
from acceptance_guards import (require,validate_acceptance,validate_reuse,
    validate_launch_prerequisites,SELECTED_ROOT,SELECTED_MACHINE,SELECTED_GUEST,
    SELECTED_COMPANION,SELECTED_PROVER)

require(platform.system()=="Linux" and platform.machine()=="x86_64","Run on Linux x86_64 Runpod only")
kit=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group(required=True)
mode.add_argument("--compile-only",action="store_true");mode.add_argument("--launch",action="store_true")
parser.add_argument("--reuse-build",action="store_true")
parser.add_argument("--work-root",type=Path,default=Path("/root/future-lifecycle-865-largeinput"))
parser.add_argument("--audit-runner",type=Path,required=True)
parser.add_argument("--interpreter-result",type=Path);parser.add_argument("--geometry-review",type=Path);parser.add_argument("--root-authorization",type=Path);parser.add_argument("--offset-cap-boundary",type=Path)
args=parser.parse_args();support=args.audit_runner.with_name("terminal-transition.mjs")
require(args.audit_runner.is_file() and args.audit_runner.suffix==".mjs" and support.is_file(),"Stage strict auditor and terminal-transition module first")
root=args.work_root.resolve();require(root.parent==Path("/root") and root.name.startswith("future-lifecycle-865-largeinput"),"Use an isolated /root/future-lifecycle-865-largeinput* directory")
root.mkdir(exist_ok=True);lock=(root/"runner.lock").open("w");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
def sha(p):return hashlib.file_digest(Path(p).open("rb"),"sha256").hexdigest()
def read(p):return json.loads(Path(p).read_text())
selected=Path("/root/bounded-restore/fast-comparison/C-combined");machine_source=selected/"machine";machine=read(selected/"machine-manifest.json")
require(machine["moduleRoot"]==SELECTED_ROOT and machine["machineSHA256"]==SELECTED_MACHINE and machine["guestWasmSHA256"]==SELECTED_GUEST and machine["companionSHA256"]==SELECTED_COMPANION and machine["proverSHA256"]==SELECTED_PROVER,"Selected manifest changed")
require((machine_source/"module-root.txt").read_text().strip()==SELECTED_ROOT and sha(machine_source/"machine.v2.wavm.br")==SELECTED_MACHINE and sha(selected/"replay.wasm")==SELECTED_GUEST and sha(Path("/root/bounded-restore/machine-inputs/gl3aot.wasm"))==SELECTED_COMPANION,"Selected bytes changed")
launch=None
if args.launch:
    require(all(p and p.is_file() for p in [args.interpreter_result,args.geometry_review,args.root_authorization,args.offset_cap_boundary]),"Accepted interpreter, reviewed geometry and root authorization receipts required; no lifecycle launched")
    launch=validate_launch_prerequisites(read(args.interpreter_result),read(args.geometry_review),read(args.root_authorization),interpreter_sha256=sha(args.interpreter_result),geometry_sha256=sha(args.geometry_review),boundary=read(args.offset_cap_boundary),boundary_sha256=sha(args.offset_cap_boundary))
    launch.update(interpreterResultSHA256=sha(args.interpreter_result),geometryReviewSHA256=sha(args.geometry_review),rootAuthorizationSHA256=sha(args.root_authorization))
run_id=uuid.uuid4().hex;out=root/"runs"/run_id/"evidence";out.mkdir(parents=True,exist_ok=False)
def save(name,value):
    p=out/name;p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_name(p.name+".tmp");tmp.write_text(json.dumps(value,indent=2)+"\n");tmp.replace(p)
def phase(name,**extra):save("phase.json",{"phase":name,"runID":run_id,**extra});print(name,flush=True)
source=root/"nitro";base=selected/"native";require(base.is_dir(),"Selected-C native source missing")
phase("COPYING_SELECTED_NATIVE_SOURCE")
if not source.exists():shutil.copytree(base,source,symlinks=True,ignore=shutil.ignore_patterns(".git","node_modules"))
# Never silently reuse a native tree from a different candidate. Only our tagged
# test seams may differ from the sealed selected-C tree.
owned_paths={"system_tests/"+n for n in ["gl3_terminal_fixture_test.go","gl3_terminal_challenge_test.go","gl3_terminal_binding_test.go","gl3_mint_controls_test.go", "gl3_large_input_transport_test.go", "gl3_large_validation_node_test.go"]}|{"precompiles/gl3_acceptance.go", "validator/client/validation_client.go", "validator/client/gl3_upload_admission.go"}
for directory_path,dirs,names in os.walk(base):
    dirs[:]=sorted(d for d in dirs if d not in {".git","node_modules","target"})
    for n in sorted(names):
        p=Path(directory_path)/n;rel=p.relative_to(base)
        if p.suffix in {".go",".mod",".sum",".c",".cc",".h",".s",".S"} and str(rel) not in owned_paths:
            require((source/rel).is_file() and sha(source/rel)==sha(p),"Isolated native source differs from sealed selected-C: "+str(rel))
go_files=["gl3_terminal_fixture_test.go","gl3_terminal_challenge_test.go","gl3_terminal_binding_test.go","gl3_mint_controls_test.go","gl3_large_input_transport_test.go","gl3_large_validation_node_test.go"]
for n in go_files:shutil.copy2(kit/n,source/"system_tests"/n)
shutil.copy2(kit/"gl3_acceptance.go",source/"precompiles/gl3_acceptance.go")
# Host-only before-conversion admission; every selected STF/machine stays frozen.
client_source=source/"validator/client/validation_client.go"
client_base=(base/"validator/client/validation_client.go").read_text()
launch_needle='\t\tinput := server_api.ValidationInputToJson(entry)'
create='\t\tvar res uint64\n\t\terr := c.client.CallContext(ctx, &res, server_api.Namespace+"_createExecutionRun"'
require(client_base.count(launch_needle)==1 and client_base.count(create)==1,"Pinned host client shape changed")
patched=client_base.replace(launch_needle,'\t\trelease, err := gl3AcquireValidationUpload(ctx)\n\t\tif err != nil { return validator.GoGlobalState{}, err }\n\t\tdefer release()\n\t\tinput := server_api.ValidationInputToJson(entry)',1)
patched=patched.replace('err := c.client.CallContext(ctx, &res, server_api.Namespace+"_validate"','err = c.client.CallContext(ctx, &res, server_api.Namespace+"_validate"',1)
patched=patched.replace(create,'\t\trelease, err := gl3AcquireValidationUpload(ctx)\n\t\tif err != nil { return nil, err }\n\t\tdefer release()\n\t\tvar res uint64\n\t\terr = c.client.CallContext(ctx, &res, server_api.Namespace+"_createExecutionRun"',1)
client_source.write_text(patched)
shutil.copy2(kit/"gl3_upload_admission.go",source/"validator/client/gl3_upload_admission.go")
shutil.copy2(kit/"gl3_upload_admission_test.go",source/"validator/client/gl3_upload_admission_test.go")
go=Path("/root/bounded-restore/toolchain/go/bin/go");binary=root/"system_tests.test"
env={**os.environ,"GOTOOLCHAIN":"local","GOMAXPROCS":"4","PATH":str(go.parent)+":"+os.environ["PATH"]}
subprocess.run([str(go.parent/"gofmt"),"-w",*[str(source/"system_tests"/n) for n in go_files],str(client_source),str(source/"validator/client/gl3_upload_admission.go"),str(source/"validator/client/gl3_upload_admission_test.go")],check=True)
machines=root/"machines";machines.mkdir(exist_ok=True)
for n,target in [(SELECTED_ROOT,machine_source),("latest",machines/SELECTED_ROOT)]:
    p=machines/n
    if p.is_symlink():require(p.resolve()==target.resolve(),"Machine link changed")
    else:require(not p.exists(),"Unexpected non-symlink machine view");p.symlink_to(target,target_is_directory=True)
suffixes={".go",".c",".cc",".cpp",".h",".hpp",".s",".S",".a",".syso",".wasm",".nnue",".mod",".sum"}
def compiled_inputs():
    result={}
    for label,directory in [("nitro",source),("engine",Path("/root/bounded-restore/chess"))]:
        for directory_path,dirs,names in os.walk(directory):
            dirs[:]=sorted(d for d in dirs if d not in {".git","node_modules"})
            for n in sorted(names):
                p=Path(directory_path)/n
                if p.suffix in suffixes:result[label+"/"+str(p.relative_to(directory))]=sha(p)
    for n in ["libstylus.a","libbrotlienc-static.a","libbrotlidec-static.a","libbrotlicommon-static.a"]:
        p=source/"target/lib"/n
        if p.exists():result["nativeLink/"+n]=sha(p)
    for n in ["go","../pkg/tool/linux_amd64/compile","../pkg/tool/linux_amd64/link"]:
        p=go.parent/n
        if p.exists():result["toolchain/"+n]=sha(p)
    result["buildOptions"]="tags=gl3_acceptance,challengetest;mod=readonly;noexecstack;linux/amd64"
    for n in ["CGO_ENABLED","CC","CXX","CGO_CFLAGS","CGO_CPPFLAGS","CGO_CXXFLAGS","CGO_LDFLAGS","GOAMD64","GOEXPERIMENT","GOOS","GOARCH","GOFLAGS","GOTOOLCHAIN","GOROOT","GOWORK","PKG_CONFIG","AR","PATH"]:result["env/"+n]=env.get(n,"")
    return result
inputs=compiled_inputs();frozen=out/"frozen";frozen.mkdir()
for n in go_files:shutil.copy2(source/"system_tests"/n,frozen/n)
for n in ["run-linux.py","acceptance_guards.py","bounded_log_markers.py","gl3_upload_admission.go"]:shutil.copy2(kit/n,frozen/n)
shutil.copy2(source/"validator/client/validation_client.go",frozen/"validation_client.go")
shutil.copy2(source/"validator/client/gl3_upload_admission_test.go",frozen/"gl3_upload_admission_test.go")
shutil.copy2(source/"precompiles/gl3_acceptance.go",frozen/"gl3_acceptance.go")
auditor_frozen=frozen/"strict-audit.mjs";shutil.copy2(args.audit_runner,auditor_frozen);shutil.copy2(support,frozen/"terminal-transition.mjs")
save("selected-artifacts.json",machine)
if launch:
    launch["runID"]=run_id;save("launch-prerequisites.json",launch)
    for n,p in [("accepted-interpreter.json",args.interpreter_result),("reviewed-geometry.json",args.geometry_review),("root-authorization.json",args.root_authorization),("offset-cap-boundary.json",args.offset_cap_boundary)]:shutil.copy2(p,frozen/n)
phase("BUILDING_OR_REUSING_EXACT_FIXTURE")
with (out/"upload-admission-tests.log").open("w") as log:
    gate_test=subprocess.run([str(go),"test","-v","-p","4","-mod=readonly","-run","^TestGL3SharedValidationUploadAdmission$","./validator/client"],cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT)
save("upload-admission-tests-exit.json",{"exitCode":gate_test.returncode})
require(gate_test.returncode==0,"Host admission regression failed; no fixture launched")
build_manifest=root/"native-build-manifest.json";start=time.monotonic()
with (out/"build.log").open("w") as log:
    if args.reuse_build:
        validate_reuse(read(build_manifest),inputs,sha(binary));result=subprocess.CompletedProcess([],0);log.write("Reused exact successful compiled inputs and binary.\n")
    else:result=subprocess.run([str(go),"test","-c","-tags","gl3_acceptance,challengetest","-p","4","-mod=readonly","-ldflags=-extldflags=-Wl,-z,noexecstack","-o",str(binary),"./system_tests"],cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT)
save("build-exit.json",{"exitCode":result.returncode,"seconds":time.monotonic()-start,"reused":args.reuse_build})
require(result.returncode==0,"Compiler failed; no fixture launched");require(compiled_inputs()==inputs,"Source/dependencies changed during build; no fixture launched")
manifest={"buildCompleted":True,"buildExitCode":0,"binarySHA256":sha(binary),"compiledInputs":inputs,"selectedMachine":machine,"auditRunnerSHA256":sha(auditor_frozen),"auditSupportSHA256":sha(frozen/"terminal-transition.mjs"),"controllerSHA256":sha(frozen/"run-linux.py"),"acceptanceGuardsSHA256":sha(frozen/"acceptance_guards.py"),"allExecutionOnRunpod":True,"enginePolicyChanged":False,"publicDeployment":False}
if not args.reuse_build:build_manifest.write_text(json.dumps(manifest,indent=2)+"\n")
save("source-manifest.json",manifest)
if args.compile_only:
    save("compile-only-result.json",{"compiled":True,"fixtureLaunched":False,"lifecycleAccepted":False,"runID":run_id,"moduleRoot":SELECTED_ROOT,"scope":"Build preflight only; actual interpreter/geometry/root launch receipts still required"});phase("COMPILE_ONLY_NO_LIFECYCLE_LAUNCHED")
else:
    audit_out=out/"audit";completion=out/"audit-completed.json"
    env.update(GL3_RESTART_EVIDENCE=str(out),GL3_RESTART_CAPTURE_TERMINAL="1",GL3_LIFECYCLE_RUN_ID=run_id,GL3_LIFECYCLE_LAUNCH_RECEIPT=str(out/"launch-prerequisites.json"),GL3_STRICT_AUDIT_OUTPUT=str(audit_out),GL3_STRICT_AUDIT_COMPLETION=str(completion),GL3_SLICES_WASM_ROOT=str(machines),NITRO_TEST_L1_GETH="/root/terminal-acceptance/bin/geth")
    start=time.monotonic();audit_code=None;audit_recorded=False;child=None;auditor=None;owned={}
    def proc_identity(pid):
        try:
            raw=Path("/proc",str(pid),"stat").read_text();f=raw[raw.rfind(")")+2:].split()
            return {"pid":pid,"ppid":int(f[1]),"pgrp":int(f[2]),"session":int(f[3]),"startTicks":f[19]}
        except (OSError,ValueError,IndexError):return None
    def remember_owned():
        roots={p.pid for p in [child,auditor] if p};seen=set(roots)
        rows=[proc_identity(int(p.name)) for p in Path("/proc").iterdir() if p.name.isdigit()]
        rows=[p for p in rows if p]
        changed=True
        while changed:
            changed=False
            for p in rows:
                if p["ppid"] in seen and p["pid"] not in seen:seen.add(p["pid"]);changed=True
        for p in rows:
            if p["pid"] in seen:owned[p["pid"]]=p
    def cleanup_owned_descendants():
        # PID reuse must never turn failure cleanup into a signal to another job.
        victims=[p for p in owned.values() if p["pid"] not in {x.pid for x in [child,auditor] if x}]
        for sig in [signal.SIGTERM,signal.SIGKILL]:
            for old in victims:
                now=proc_identity(old["pid"])
                if now and now["startTicks"]==old["startTicks"] and now["session"]==old["session"]:
                    try:os.kill(old["pid"],sig)
                    except ProcessLookupError:pass
            if sig==signal.SIGTERM:time.sleep(.5)
        save("owned-process-cleanup.json",{"runID":run_id,"tracked":list(owned.values()),"stillAlive":[p for p in victims if (proc_identity(p["pid"]) or {}).get("startTicks")==p["startTicks"]]})
    try:
        with (out/"test.log").open("w") as log,(out/"audit.log").open("w") as audit_log:
            child=subprocess.Popen([str(binary),"-test.run","^TestGL3TerminalResultBoLDLifecycle$","-test.v=test2json","-test.timeout","4h"],cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            phase("EXPLICITLY_AUTHORIZED_PRIVATE_LIFECYCLE_RUNNING",testPID=child.pid)
            auditor=subprocess.Popen(["node",str(auditor_frozen),"--fixture-evidence",str(out),"--run-id",run_id,"--test-pid",str(child.pid),"--output-dir",str(audit_out)],stdout=audit_log,stderr=subprocess.STDOUT,start_new_session=True)
            remember_owned()
            while child.poll() is None:
                remember_owned()
                audit_code=auditor.poll()
                if audit_code is not None and not audit_recorded:
                    save("audit-exit.json",{"exitCode":audit_code,"runID":run_id,"beforeFixtureCleanup":True});audit_recorded=True
                    if audit_code==0:
                        a=read(audit_out/"strict-audit.json");require(a.get("passed") is True and a.get("runID")==run_id and a.get("moduleRoot")==SELECTED_ROOT,"Auditor exited without a fresh selected pass")
                        save("audit-completed.json",{"completed":True,"runID":run_id,"moduleRoot":SELECTED_ROOT,"auditExitCode":0,"strictAuditSHA256":sha(audit_out/"strict-audit.json")})
                    else:save("controller-failure.json",{"reason":"Strict auditor failed while fixture alive; no acceptance","auditExitCode":audit_code});child.terminate()
                time.sleep(.1)
            code=child.wait();save("test-exit.json",{"exitCode":code,"seconds":time.monotonic()-start})
            if not audit_recorded:
                if auditor.poll() is None:auditor.terminate()
                audit_code=auditor.wait();save("audit-exit.json",{"exitCode":audit_code,"runID":run_id,"beforeFixtureCleanup":False})
    finally:
        for proc in [auditor,child]:
            if proc and proc.poll() is None:
                proc.terminate()
                try:proc.wait(timeout=15)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()
        cleanup_owned_descendants()
    require(audit_recorded and audit_code==0,"Auditor did not complete successfully before fixture cleanup")
    # Only short, whole, Go test2json-framed lines can supply completion markers.
    # The scanner never allocates a giant log line or searches payload substrings.
    with (out/"test.log").open("rb") as raw_log:
        marker_scan=scan_named_markers(raw_log)
    require(marker_scan["oversizedFramedLines"]==0,"Oversized framework-framed line; no acceptance")
    named_log=marker_scan["markers"]
    save("named-test-markers.json",{"runID":run_id,**marker_scan})
    accepted=validate_acceptance(test_exit=code,test_log=named_log,report=read(out/"full-lifecycle-result.json"),audit_exit=audit_code,audit=read(audit_out/"strict-audit.json"),terminal=read(out/"terminal-input-manifest.json"),run_id=run_id,module_root=SELECTED_ROOT,completion=read(completion),audit_sha256=sha(audit_out/"strict-audit.json"))
    save("acceptance-result.json",accepted);phase("STRICT_TERMINAL_LIFECYCLE_PASSED")
