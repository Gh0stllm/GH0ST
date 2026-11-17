"""Runpod-only selected ordinary-source closure audit; no build/service/engine."""
from pathlib import Path
import hashlib,json,os,subprocess,time
base=Path('/root/gl3-final-pairing/source05');out=base.parent/'source06';ev=out/'evidence';go='/root/bounded-restore/toolchain/go/bin/go'
os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:])
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
r=subprocess.run(['python3',str(out/'make-overlay.py'),'--source-base',str(base),'--output',str(out/'verified-frozen-production-overlay.json')],capture_output=True,text=True)
if r.returncode:raise RuntimeError(r.stderr)
overlay=json.loads((out/'verified-frozen-production-overlay.json').read_text())['Replace']
args=[go,'list','-deps','-json','-p','1','-mod=readonly','-overlay',str(out/'verified-frozen-production-overlay.json'),'./cmd/nitro','./cmd/nitro-val'];env=os.environ.copy();env['PATH']=str(Path(go).parent)+':'+env['PATH'];env['GOMAXPROCS']='2';start=time.time();r=subprocess.run(args,cwd=base,env=env,capture_output=True,text=True)
(ev/'ordinary06-go-list.stderr').write_text(r.stderr);(ev/'ordinary06-go-list-exit.json').write_text(json.dumps({'actualExitCode':r.returncode,'seconds':time.time()-start,'args':args,'buildOrTestOrEngineExecuted':False},indent=2)+'\n')
if r.returncode:raise RuntimeError('go list failed')
decoder=json.JSONDecoder();position=0;packages=[]
while position<len(r.stdout):
 while position<len(r.stdout) and r.stdout[position].isspace():position+=1
 if position==len(r.stdout):break
 pkg,position=decoder.raw_decode(r.stdout,position)
 if pkg.get('Error') or pkg.get('DepsErrors'):raise RuntimeError('dependency errors')
 packages.append(pkg)
records={};kinds=['GoFiles','CgoFiles','CFiles','HFiles','CXXFiles','MFiles','FFiles','SFiles','SwigFiles','SwigCXXFiles','SysoFiles','EmbedFiles']
for pkg in packages:
 for kind in kinds:
  for filename in pkg.get(kind,[]):
   virtual=Path(pkg['Dir'])/filename;actual=Path(overlay.get(str(virtual),str(virtual)));key=pkg['ImportPath']+'/'+kind+'/'+filename
   records[key]={'path':str(virtual),'sourcePath':str(actual),'SHA256':sha(actual),'bytes':actual.stat().st_size}
old=json.loads((out/'source05-compiled-go-source-files.json').read_text());changes=[]
for key in sorted(set(old)|set(records)):
 a,b=old.get(key),records.get(key)
 if a is None or b is None or a['SHA256']!=b['SHA256']:changes.append({'key':key,'before':a,'after':b})
lock=json.loads((out/'manifest.json').read_text());expected={'github.com/offchainlabs/nitro/'+str(Path(path).parent)+'/GoFiles/'+Path(path).name for path in lock['hostSourceFiles']}
if {row['key'] for row in changes}!=expected:raise RuntimeError('ordinary dependency changes outside approved7hostfiles')
(ev/'ordinary06-source-files.json').write_text(json.dumps(records,indent=2,sort_keys=True)+'\n')
summary={'status':'ORDINARY_PRODUCTION_DEPENDENCY_SOURCE_CLOSURE_PASSED_NO_BINARY_BUILD','source05Records':len(old),'source06Records':len(records),'changedOrAddedOrRemoved':len(changes),'changes':changes,'allChangesExactlySevenReviewedHostFiles':True,'newSourceRecordsSHA256':sha(ev/'ordinary06-source-files.json'),'frozenManifestSHA256':sha(out/'manifest.json'),'allExecutionOnRunpod':True,'buildOrTestOrEngineExecuted':False}
(ev/'ordinary06-source-pairing.json').write_text(json.dumps(summary,indent=2)+'\n');print({k:v for k,v in summary.items() if k!='changes'})
