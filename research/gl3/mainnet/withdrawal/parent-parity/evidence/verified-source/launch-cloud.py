"""Freeze and launch the actual-parent observed-state parity fixture on Linux."""
from pathlib import Path
import hashlib,json,os,platform,shutil,subprocess,time
assert platform.system()=='Linux'
root=Path('/root/withdrawal-parent');scripts=root/'scripts';assert (root/'BASE_READY').exists()
for p in scripts.rglob('*'):
 if p.is_file() and p.suffix in ['.mjs','.cjs']:
  c=subprocess.run(['node','--check',str(p)],capture_output=True,text=True);assert c.returncode==0,c.stderr
attempt=root/('attempt-'+str(time.time_ns()));attempt.mkdir(mode=0o700);shutil.copytree(scripts,attempt/'src')
env={**os.environ,'GL3_NODE_PACKAGE':str(root/'bridge/package.json'),'GL3_PARITY_BASE':str(root),'GL3_PRIVATE_OUTPUT':str(attempt)}
with (attempt/'runner.log').open('w') as log:p=subprocess.Popen(['node',str(attempt/'src/run.mjs')],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
record={'pid':p.pid,'directory':str(attempt),'runnerSHA256':hashlib.sha256((attempt/'src/run.mjs').read_bytes()).hexdigest(),'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'allExecutionOnRunpod':True};(root/'active-attempt.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
