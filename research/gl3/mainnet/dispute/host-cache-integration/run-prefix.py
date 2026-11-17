"""Existing Runpod only: exact selected input, genuinely Running 200M prefix."""
import hashlib,json,os,pathlib,subprocess,time
BASE=pathlib.Path('/root/gl3-host-cache-integration');OUT=BASE/'actual-prefix-01';OUT.mkdir(exist_ok=False)
binary=BASE/'attempt-02/server_arb.test';env=os.environ.copy();env.update({'GOMAXPROCS':'2','GL3_INTEGRATION_REAL_PREFIX':'1','GL3_INTEGRATION_ORIGINAL_INPUT':'/root/terminal-acceptance/evidence/terminal-input.json','GL3_INTEGRATION_MACHINE_LOCATOR':'/root/gl3-selected865-boundary/machines','GL3_INTEGRATION_PREFIX_REFERENCE':str(BASE/'reference-v1/prefix-reference.json'),'GL3_INTEGRATION_EVIDENCE':str(OUT)})
cmd=['/usr/bin/time','-v',str(binary),'-test.v','-test.timeout=12m','-test.run=^TestGL3IntegrationSelectedOriginalInputPrefix$'];start=time.monotonic()
with(OUT/'test.log').open('w')as log:p=subprocess.run(cmd,cwd=BASE/'attempt-02/nitro',env=env,stdout=log,stderr=subprocess.STDOUT)
(OUT/'exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-start,'command':cmd,'binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'allExecutionOnRunpod':True,'fullReplayExecuted':False},indent=2)+'\n')
