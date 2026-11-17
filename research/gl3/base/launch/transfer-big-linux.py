from pathlib import Path
import subprocess,shlex,json,time,os
TASK=Path('/root/gl3-base-launch/big-transfer');opts=['-i',str(TASK/'source-only-ed25519'),'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(TASK/'known_hosts'),'-o','ConnectTimeout=10','-p','10748','root@185.226.156.233'];os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:])
paths=['root/gl3-base-launch/nitro-clean','root/gl3-base-launch/machines','root/gl3-base-launch/bin/nitro','root/gl3-base-launch/artifact-lock.json','root/bounded-restore/toolchain/go','root/bounded-restore/nitro/target/lib','root/bounded-restore/nitro/target/include','root/terminal-acceptance/bin/geth','root/gl3-base-withdrawal/bin/genesis-diagnostics']
receiver="""from pathlib import Path
import subprocess,sys,os,json,hashlib,time
D=Path('/workspace/gl3/durable');stage=D/'.incoming-initial';stage.mkdir(exist_ok=False)
r=subprocess.run(['tar','-C',str(stage),'-xf','-'],stdin=sys.stdin.buffer);assert r.returncode==0
mapping={'root/gl3-base-launch/nitro-clean':'nitro-clean','root/gl3-base-launch/machines':'machines','root/gl3-base-launch/bin/nitro':'bin/nitro','root/gl3-base-launch/artifact-lock.json':'artifact-lock.json','root/bounded-restore/toolchain/go':'toolchain/go','root/bounded-restore/nitro/target/lib':'native/lib','root/bounded-restore/nitro/target/include':'native/include','root/terminal-acceptance/bin/geth':'bin/geth'}
for src,dest in mapping.items():
 p=D/dest;p.parent.mkdir(parents=True,exist_ok=True);assert not p.exists();(stage/src).rename(p)
gen=Path('/workspace/gl3/testnet/withdrawal-recovery/bin/genesis-diagnostics');gen.parent.mkdir(parents=True,exist_ok=True);assert not gen.exists();(stage/'root/gl3-base-withdrawal/bin/genesis-diagnostics').rename(gen)
links={'/root/gl3-base-launch/nitro-clean':D/'nitro-clean','/root/gl3-base-launch/machines':D/'machines','/root/gl3-base-launch/bin':D/'bin','/root/gl3-base-launch/artifact-lock.json':D/'artifact-lock.json','/root/bounded-restore/toolchain/go':D/'toolchain/go','/root/bounded-restore/nitro/target/lib':D/'native/lib','/root/bounded-restore/nitro/target/include':D/'native/include','/root/gl3-final-pairing/source05/target/lib':D/'native/lib','/root/gl3-final-pairing/source05/target/include':D/'native/include','/root/terminal-acceptance/bin/geth':D/'bin/geth','/root/gl3-base-withdrawal/bin/genesis-diagnostics':gen}
for old,dest in links.items():
 q=Path(old);q.parent.mkdir(parents=True,exist_ok=True)
 if not q.exists():q.symlink_to(dest,target_is_directory=dest.is_dir())
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for x in iter(lambda:f.read(1048576),b''):h.update(x)
 return h.hexdigest()
checks={'nitro':sha(D/'bin/nitro'),'libstylus':sha(D/'native/lib/libstylus.a'),'genesis':sha(gen)}
assert checks['nitro']=='d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed';assert checks['libstylus']=='42cc75b003aaab6686620da6ec947bb475fe221b605bd0ac1bf417a171f4546c';assert checks['genesis']=='0c797bd8ecf079669ade4ddcd34d2000ec263c51e21831cea3fec71f0618e678';assert (D/'machines/latest/module-root.txt').read_text().strip()=='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97';assert 'Gh0stllm' not in (D/'nitro-clean/go.mod').read_text();assert not list((D/'nitro-clean/precompiles').glob('*Ghost*'))
report={'status':'PRISTINE_SOURCE_TOOLCHAIN_NATIVE_LINK_OFFICIAL_RUNTIME_READY','checks':checks,'durableRoot':str(D),'source':str(D/'nitro-clean'),'go':str(D/'toolchain/go/bin/go'),'legacyAliasesReady':True,'moduleCacheReady':False,'warmBuildCacheReady':False,'genesisHelper':str(gen),'noWalletKeysOrChessSTFSourceCopied':True};(D/'transfer/initial-ready.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
"""
start=time.time()
with (TASK/'initial-source.stderr').open('w') as e1,(TASK/'initial-target.stderr').open('w') as e2,(TASK/'initial-target.stdout').open('w') as output:
 source=subprocess.Popen(['tar','-C','/','-cf','-',*paths],stdout=subprocess.PIPE,stderr=e1)
 target=subprocess.Popen(['ssh',*opts,'python3 -c '+shlex.quote(receiver)],stdin=source.stdout,stdout=output,stderr=e2);source.stdout.close();b=target.wait();a=source.wait()
receipt={'sourceExitCode':a,'targetExitCode':b,'seconds':time.time()-start,'paths':paths,'phase':'initial source/tools/official runtime/native libraries/genesis helper','noNewOldDiskArchive':True};(TASK/'initial-exit.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
if a or b:raise SystemExit(1)
