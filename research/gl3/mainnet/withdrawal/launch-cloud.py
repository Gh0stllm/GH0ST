"""Launch one fresh, isolated withdrawal attempt on the assigned Linux worker."""
from pathlib import Path
import hashlib,json,os,platform,shutil,subprocess,time

assert platform.system()=='Linux'
root=Path('/root/withdrawal');assert (root/'BASE_READY').exists()
syntax=subprocess.run(['node','--check',str(root/'run.mjs')],capture_output=True,text=True)
assert syntax.returncode==0,syntax.stderr
kit=root/'kit/research/chess/l3/nitro'
attempt=root/('attempt-'+str(time.time_ns()));attempt.mkdir(mode=0o700)
frozen=attempt/'runner.mjs';shutil.copyfile(root/'run.mjs',frozen)
env={**os.environ,
 'GL3_NODE_PACKAGE':str(root/'package.json'),'GL3_PRIVATE_OUTPUT':str(attempt),
 'GL3_NITRO_BINARY':str(root/'bin/nitro'),'GL3_NITRO_SOURCE':str(root/'source-info'),
 'GL3_MACHINE_ROOT_DIR':str(root/'machines'),
 'GL3_ARTIFACTS':str(kit/'.cache/contracts-provenance/compiled-main/build/contracts'),
 'GL3_ARTIFACT_MANIFEST':str(kit/'evidence/contract-source-compilation.json'),
 'GL3_UPGRADE_ARCHIVE':str(kit/'.cache/contracts-provenance/deps/@offchainlabs__upgrade-executor/package.tgz'),
 'GL3_READER_ARTIFACT':str(root/'Reader4844.json')}
with (attempt/'runner.log').open('w') as log:
 process=subprocess.Popen(['node',str(frozen),'--native-genesis-bootstrap'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
record={'pid':process.pid,'directory':str(attempt),'frozenRunnerSHA256':hashlib.sha256(frozen.read_bytes()).hexdigest(),'allExecutionOnRunpod':True,'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
(root/'active-attempt.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
