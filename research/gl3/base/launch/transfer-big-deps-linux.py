from pathlib import Path
import subprocess,shlex,json,time,os,struct,concurrent.futures
T=Path('/root/gl3-base-launch/big-transfer');opts=['-i',str(T/'source-only-ed25519'),'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(T/'known_hosts'),'-o','ConnectTimeout=10','-p','10748','root@185.226.156.233'];os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:])
neutral=['root/dispute/package.json','root/dispute/package-lock.json','root/dispute/node_modules','root/dispute/repo/research/chess/l3/nitro/evidence/contract-source-compilation.json','root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance/compiled-main/build/contracts','root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance/git/nitro-contracts-4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/rollup/DeployHelper.sol','root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance/deps/@offchainlabs__upgrade-executor/package.tgz']
def phase(name,paths,move_from,move_to,alias):
 receiver="from pathlib import Path;import sys,subprocess,json;d=Path('/workspace/gl3/durable');s=d/"+repr('.incoming-'+name)+";s.mkdir(exist_ok=False);r=subprocess.run(['tar','-C',str(s),'-xf','-'],stdin=sys.stdin.buffer);assert r.returncode==0;q=d/"+repr(move_to)+";q.parent.mkdir(parents=True,exist_ok=True);assert not q.exists();(s/"+repr(move_from)+").rename(q);a=Path("+repr(alias)+");a.parent.mkdir(parents=True,exist_ok=True);assert not a.exists();a.symlink_to(q,target_is_directory=True);(d/'transfer'/"+repr(name+'-ready.json')+").write_text(json.dumps({'complete':True,'phase':"+repr(name)+",'durablePath':str(q),'legacyAlias':str(a),'publishedAtomicallyAfterComplete':True},indent=2));print('READY',"+repr(name)+",flush=True)"
 start=time.time()
 with (T/(name+'-source.stderr')).open('w') as e1,(T/(name+'-target.stderr')).open('w') as e2,(T/(name+'-target.stdout')).open('w') as out:
  args=['tar','-C','/','-cf','-']
  if name=='modules':args+=['--exclude=*.zip']
  source=subprocess.Popen(args+paths,stdout=subprocess.PIPE,stderr=e1);target=subprocess.Popen(['ssh',*opts,'python3 -c '+shlex.quote(receiver)],stdin=source.stdout,stdout=out,stderr=e2);source.stdout.close();b=target.wait();a=source.wait()
 r={'phase':name,'sourceExitCode':a,'targetExitCode':b,'seconds':time.time()-start,'publishedOnlyAfterComplete':True};(T/(name+'-exit.json')).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)
 return a==b==0
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 jobs=[pool.submit(phase,'modules',['root/go/pkg/mod'],'root/go/pkg/mod','go/pkg/mod','/root/go/pkg/mod'),pool.submit(phase,'neutral-npm-contracts',neutral,'root/dispute','neutral/dispute','/root/dispute')]
 ok=all(job.result() for job in jobs)
if not ok:raise SystemExit(1)
# Only cache data that cannot contain the embedded100MB chess/NNUE modules;
# large executables and archives naming custom imports are deliberately excluded.
cache=Path('/root/.cache/go-build');selected=[];excluded=0;total=0
for q in cache.rglob('*'):
 if not q.is_file():continue
 try:
  size=q.stat().st_size
  with q.open('rb') as f:header=f.read(min(size,262144))
  if size>64*1024*1024 or (header.startswith(b'\x7fELF') and len(header)>18 and int.from_bytes(header[16:18],'little') in (2,3)) or b'gh0stllm' in header.lower():excluded+=1;continue
  selected.append(str(q.relative_to('/')));total+=size
 except OSError:continue
(T/'warm-cache-selected.json').write_text(json.dumps({'selectedFiles':len(selected),'selectedBytes':total,'excludedFiles':excluded,'excludedModelArchivesAndExecutables':True},indent=2)+'\n');(T/'warm-cache-files.txt').write_text('\n'.join(selected)+'\n')
# Reuse phase with a temporary minimal file-list argument; no raw duplicate cache.
receiver="from pathlib import Path;import subprocess,sys,json;d=Path('/workspace/gl3/durable');s=d/'.incoming-warm-cache';s.mkdir();r=subprocess.run(['tar','-C',str(s),'-xf','-'],stdin=sys.stdin.buffer);assert r.returncode==0;q=d/'go-build-seed';(s/'root/.cache/go-build').rename(q);(d/'transfer/warm-cache-ready.json').write_text(json.dumps({'complete':True,'path':str(q),'selectedBytes':"+str(total)+",'selectedFiles':"+str(len(selected))+",'noModelArchivesOrExecutables':True}));print('WARM_CACHE_READY',flush=True)"
start=time.time()
with (T/'warm-cache-source.stderr').open('w') as e1,(T/'warm-cache-target.stderr').open('w') as e2,(T/'warm-cache-target.stdout').open('w') as out:
 s=subprocess.Popen(['tar','-C','/','-cf','-','-T',str(T/'warm-cache-files.txt')],stdout=subprocess.PIPE,stderr=e1);r=subprocess.Popen(['ssh',*opts,'python3 -c '+shlex.quote(receiver)],stdin=s.stdout,stdout=out,stderr=e2);s.stdout.close();b=r.wait();a=s.wait()
(T/'warm-cache-exit.json').write_text(json.dumps({'sourceExitCode':a,'targetExitCode':b,'seconds':time.time()-start},indent=2)+'\n');print('WARM_CACHE',a,b,flush=True)
