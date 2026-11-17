from pathlib import Path
import subprocess,json,os,time,hashlib
root=Path('/root/future-lifecycle-865-hostcache-v2');out=root/'batch-seal-test-v1';binary=root/'system_tests.test'
env={**os.environ,'GL3_GEOMETRY43_MACHINES':str(root/'machines'),'GL3_TERMINAL_SEAL_EVIDENCE':str(out),'NITRO_TEST_L1_GETH':'/root/terminal-acceptance/bin/geth','GOMAXPROCS':'4'}
cmd=[str(binary),'-test.v=test2json','-test.timeout=90s','-test.run=^TestGL3TerminalBatchSeal$']
start=time.monotonic()
with (out/'test.log').open('w') as log:r=subprocess.run(cmd,cwd=root/'nitro',env=env,stdout=log,stderr=subprocess.STDOUT)
(out/'exit.json').write_text(json.dumps({'exitCode':r.returncode,'seconds':time.monotonic()-start,'binarySHA256':hashlib.file_digest(binary.open('rb'),'sha256').hexdigest(),'command':cmd,'allExecutionOnRunpod':True,'engineExecuted':False},indent=2)+'\n')
