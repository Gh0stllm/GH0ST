from pathlib import Path
import os,json,time,subprocess,signal,hashlib
b=Path('/workspace/gl3/zk-tests/evm-proof');out=b/'workload16';out.mkdir(exist_ok=True)
while not(b/'sp1-native-build-result.json').exists():time.sleep(.5)
build=json.loads((b/'sp1-native-build-result.json').read_text());assert build['actualExitCode']==0,build
binary=Path('/root/gl3-sp1-build/target/release/ethrex-replay');assert binary.is_file()
env=dict(os.environ,GL3_WORKLOAD_EXPORT_DIR=str(out),RAYON_NUM_THREADS='16',SP1_PROVER='cpu');args=[str(binary),'custom','block','--tx','erc20-transfer','--n-txs','16','--seed','0','--n-senders','1','--no-zkvm','--cache-dir',str(out/'cache'),'--save-program-input',str(out/'program-input.json')]
os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:16]);start=time.time();r={'stage':'native16 ERC20 generation and EVM execution; no ZK proof','actualProofStarted':False,'argv':args,'binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'binaryBytes':binary.stat().st_size,'sourceGuestProfile':json.loads((b/'official-guest-build-profile.json').read_text())};p=None
try:
 with(out/'native.log').open('w')as log:
  p=subprocess.Popen(args,cwd=b,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(out/'native-process.json').write_text(json.dumps({'controllerPID':os.getpid(),'childPID':p.pid},indent=2))
  while p.poll()is None:
   mem=int(Path('/sys/fs/cgroup/memory.current').read_text());st=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());rss=0
   for d in Path('/proc').glob('[0-9]*'):
    try:
     f=(d/'stat').read_text().rsplit(')',1)[1].split()
     if int(f[2])==p.pid:
      for l in(d/'status').read_text().splitlines():
       if l.startswith('VmRSS:'):rss+=int(l.split()[1])*1024
    except OSError:pass
   r['peakOwnedRSS']=max(r.get('peakOwnedRSS',0),rss)
   if os.statvfs('/root').f_bavail*os.statvfs('/root').f_frsize<6000000000 or mem-int(st['inactive_file'])>=56000000000 or rss>=40*1024**3 or time.time()-start>600:raise RuntimeError('resource/deadline guard')
   time.sleep(.1)
  r['actualExitCode']=p.returncode
  assert p.returncode==0
 r['files']={}
 for n in ['folded-genesis.json','workload.json','program-input.json']:
  q=out/n;data=q.read_bytes();r['files'][n]={'bytes':len(data),'SHA256':hashlib.sha256(data).hexdigest()}
 w=json.loads((out/'workload.json').read_text());assert len(w['rawSignedTransactions'])==16 and w['chainId']==9 and len(w['blocks'])==1
 r.update(passed=True,transactions=16,chainId=9,blocks=1)
except BaseException as e:
 r['passed']=False;r['error']=repr(e)
 if p and p.poll()is None:os.killpg(p.pid,signal.SIGTERM);p.wait()
 r['actualExitCode']=None if p is None else p.returncode
r['outerSecondsIncludingGenerationWitnessAndNativeReplay']=time.time()-start;(out/'native-result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)
