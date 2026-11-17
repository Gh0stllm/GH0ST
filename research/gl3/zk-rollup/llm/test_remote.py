"""Isolated real Nitro fixture. Never changes the shared pristine Nitro tree."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,time
HERE=Path(__file__).resolve().parent;cache=HERE/'.cache';evidence=HERE/'evidence'
allowed=sorted(os.sched_getaffinity(0));os.sched_setaffinity(0,allowed[-2:])
source=Path('/workspace/gl3/durable/nitro-clean');overlay=cache/'nitro'
overlay.mkdir(exist_ok=True)
for item in source.iterdir():
    dest=overlay/item.name
    if dest.exists() or dest.is_symlink():continue
    if item.name=='precompiles':shutil.copytree(item,dest)
    elif item.name in {'go.mod','go.sum'}:shutil.copy2(item,dest)
    else:dest.symlink_to(item,target_is_directory=item.is_dir())
shutil.copy2(HERE/'GH0STFullStylusLLM_test.go',overlay/'precompiles/GH0STFullStylusLLM_test.go')
env={**os.environ,'GOTOOLCHAIN':'local','GOMAXPROCS':'2','GOMEMLIMIT':'512MiB','GOGC':'40','GH0ST_FULL_STYLUS_LLM_DIR':str(HERE)}
go='/workspace/gl3/durable/toolchain/go/bin/go'
cmd=[go,'test','-p=1','-vet=off','./precompiles','-run','^TestGH0STFullOrdinaryStylusLLM$','-count=1','-v','-timeout=12m']
started=time.time()
with (evidence/'native-stylus.log').open('w') as log:p=subprocess.run(cmd,cwd=overlay,env=env,stdout=log,stderr=subprocess.STDOUT,text=True,timeout=780)
output=(evidence/'native-stylus.log').read_text()
report={'command':cmd,'sourcePathReadOnly':str(source),'isolatedOverlayPath':str(overlay),'returnCode':p.returncode,'wallSeconds':time.time()-started,'cpuAffinity':sorted(os.sched_getaffinity(0)),'GOMEMLIMIT':'512MiB','GOMAXPROCS':2,'actualFullModelTestPassed':p.returncode==0 and '--- PASS: TestGH0STFullOrdinaryStylusLLM' in output,'financialAction':False}
(evidence/'native-test-run.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));print(output[-6000:]);raise SystemExit(p.returncode)
