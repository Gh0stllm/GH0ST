"""Existing Runpod only: one real minute cadence, bounded RPC engine double."""
import hashlib,json,os,pathlib,subprocess,time
BASE=pathlib.Path('/root/gl3-host-cache-integration');OUT=BASE/'candidate03-minute-01';OUT.mkdir(exist_ok=False);binary=BASE/'candidate03-attempt-01/valnode.test'
env=os.environ.copy();env.update({'GOMAXPROCS':'2','GL3_INTEGRATION_REAL_MINUTE':'1','GL3_INTEGRATION_EVIDENCE':str(OUT)})
cmd=[str(binary),'-test.v','-test.timeout=85s','-test.run=^TestGL3IntegrationActualRPCMinuteKeepAlive$'];start=time.monotonic()
with(OUT/'test.log').open('w')as log:p=subprocess.run(cmd,env=env,cwd=BASE/'candidate03-attempt-01/nitro',stdout=log,stderr=subprocess.STDOUT)
(OUT/'exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-start,'command':cmd,'binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'engineExecuted':False,'allExecutionOnRunpod':True},indent=2)+'\n')
