"""Runpod-only browser bundle. No server, wallet access or broadcast."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,shutil,time,resource
p=argparse.ArgumentParser();p.add_argument('--plan',required=True);p.add_argument('--terms',required=True);p.add_argument('--esbuild',required=True);p.add_argument('--out',required=True);a=p.parse_args()
assert os.uname().sysname=='Linux'
source=Path(__file__).resolve().parent;out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
plan=Path(a.plan).read_bytes();terms=Path(a.terms).read_bytes();assert terms.startswith(b'%PDF-')
hash=lambda x:hashlib.sha256(x).hexdigest()
for name in ['sign-review.mjs','review-core.mjs']:(out/name).write_bytes((source/name).read_bytes())
(out/'index.html').write_bytes((source/'review-index.html').read_bytes());(out/'plan.json').write_bytes(plan);(out/'aep-terms.pdf').write_bytes(terms)
cpus=','.join(map(str,sorted(os.sched_getaffinity(0))[:2]));start=time.monotonic()
args=['taskset','-c',cpus,a.esbuild,str(source/'review-app.mjs'),'--bundle','--minify','--platform=browser','--target=chrome110','--outfile='+str(out/'app.bundle.js'),'--define:__GL3_PLAN_SHA256__='+json.dumps(hash(plan)),'--define:__GL3_TERMS_SHA256__='+json.dumps(hash(terms))]
r=subprocess.run(args,cwd=source,capture_output=True,text=True,timeout=30)
report={'exitCode':r.returncode,'seconds':time.monotonic()-start,'stdout':r.stdout[-2000:],'stderr':r.stderr[-2000:],'planSHA256':hash(plan),'termsSHA256':hash(terms),'sources':{n:hash((source/n).read_bytes()) for n in ['sign-review.mjs','review-app.mjs','review-index.html','review-core.mjs']},'maxChildRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'serverStarted':False,'keysRead':False,'transactionsSigned':0}
if r.returncode==0:report['bundleSHA256']=hash((out/'app.bundle.js').read_bytes());report['bundleBytes']=(out/'app.bundle.js').stat().st_size
(out/'build-result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));raise SystemExit(r.returncode)
