"""Runpod CPU only: build exact-plan browser source. No wallet read/sign/send/server."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,time,resource
p=argparse.ArgumentParser();p.add_argument('--plan',required=True);p.add_argument('--policy',required=True);p.add_argument('--esbuild',required=True);p.add_argument('--out',required=True);p.add_argument('--receipt-packet');p.add_argument('--deployment-audit');a=p.parse_args()
assert os.uname().sysname=='Linux'
source=Path(__file__).resolve().parent;out=Path(a.out).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest();plan=Path(a.plan).read_bytes();policy=Path(a.policy).read_bytes()
for n in ['review-server.mjs','policy.mjs','engine.mjs','journal.mjs','review-session.mjs']:(out/n).write_bytes((source/n).read_bytes())
(out/'plan.json').write_bytes(plan);(out/'fee-policy.json').write_bytes(policy);(out/'index.html').write_bytes((source/'review-index.html').read_bytes())
assert bool(a.receipt_packet)==bool(a.deployment_audit)
if a.receipt_packet:
 packet=Path(a.receipt_packet).read_bytes();audit=Path(a.deployment_audit).read_bytes();parsed=json.loads(plan)
 assert sha(packet)==parsed['receiptPacketSHA256'] and sha(audit)==parsed['deploymentAuditSHA256']
 assert json.loads(packet)['passed'] is True and json.loads(audit)['passed'] is True
 (out/'receipt-packet.json').write_bytes(packet);(out/'deployment-verified.json').write_bytes(audit)
start=time.monotonic();r=subprocess.run([a.esbuild,str(source/'review-app.mjs'),'--bundle','--minify','--platform=browser','--target=chrome110','--outfile='+str(out/'app.bundle.js'),'--define:__GL3_CHILD_PLAN_SHA256__='+json.dumps(sha(plan))],cwd=source,capture_output=True,text=True,timeout=30)
report={'exitCode':r.returncode,'seconds':time.monotonic()-start,'stderr':r.stderr[-2000:],'planSHA256':sha(plan),'sourceSHA256':{n:sha((source/n).read_bytes()) for n in ['review-server.mjs','policy.mjs','engine.mjs','journal.mjs','review-session.mjs']},'maxChildRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'keysRead':False,'transactionsSigned':0,'transactionsBroadcast':0,'serverStarted':False}
if r.returncode==0:report.update(bundleSHA256=sha((out/'app.bundle.js').read_bytes()),indexSHA256=sha((out/'index.html').read_bytes()),bundleBytes=(out/'app.bundle.js').stat().st_size)
(out/'build-result.json').write_text(json.dumps(report,indent=2)+'\n')
for f in out.iterdir():
 if f.is_file():f.chmod(0o600)
print(json.dumps(report));raise SystemExit(r.returncode)
