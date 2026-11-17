from pathlib import Path
import subprocess,json,time,os
root=Path('/root/future-lifecycle-865-largeinput-preflight');start=time.monotonic();os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:4])
with (root/'compile-02.log').open('w') as log:r=subprocess.run(['python3','/root/gl3-log-investigation/future-lifecycle/run-linux.py','--compile-only','--work-root','/root/future-lifecycle-865-largeinput-build','--audit-runner','/root/future-lifecycle-865-geometry43-preflight/kit/audit/strict-audit.mjs'],stdout=log,stderr=subprocess.STDOUT)
(root/'compile-02-exit.json').write_text(json.dumps({'exitCode':r.returncode,'seconds':time.monotonic()-start,'lifecycleLaunched':False},indent=2)+'\n')
