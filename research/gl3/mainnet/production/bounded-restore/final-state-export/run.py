from pathlib import Path
import subprocess,os,json,time,hashlib,re
b=Path('/root/bounded-restore/final-state-export');r=Path('/root/bounded-restore');go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'4','GL3_EXPORT_DIR':str(b/'export')}
t=time.monotonic()
with (b/'build.log').open('w') as log:p=subprocess.run([go,'build','-p','4','-mod=mod','-tags=gl3_acceptance,gl3_checkpoint_export','-o',b/'replay-export','./cmd/gl3replayexport'],cwd=b/'native',env=env,stdout=log,stderr=subprocess.STDOUT)
(b/'build-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n')
if p.returncode:raise SystemExit(p.returncode)
args=json.loads((r/'evidence/native-terminal-process.json').read_text())['args'];args[0]=str(b/'replay-export');t=time.monotonic()
with (b/'run.log').open('w') as log:
 p=subprocess.Popen(args,cwd=b/'native',env=env,stdout=log,stderr=subprocess.STDOUT)
 (b/'run-process.json').write_text(json.dumps({'pid':p.pid,'args':args,'started':time.time()})+'\n')
 try:code=p.wait(timeout=900)
 except subprocess.TimeoutExpired:p.terminate();code=p.wait(timeout=15)
(b/'run-exit.json').write_text(json.dumps({'exitCode':code,'seconds':time.monotonic()-t})+'\n')
if code:raise SystemExit(code)
s=(b/'run.log').read_text();m=re.search(r'GL3_HEADER_AUDIT (0x[0-9a-f]{64}) (\d+) (0x[0-9a-f]{64}) (0x[0-9a-f]{64})',s);header={'blockHash':m[1],'gasUsed':int(m[2]),'stateRoot':m[3],'receiptHash':m[4]} if m else {};ref=json.loads((r/'evidence/native-header-comparison.json').read_text())['results']['baseline'];end=re.search(r'GL3_REPLAY_END (0x[0-9a-f]{64}) (0x[0-9a-f]{64}) (\d+) (\d+)',s);expected=json.loads((r/'evidence/native-terminal-result.json').read_text())['expected']
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
files={str(p.relative_to(b)):{'bytes':p.stat().st_size,'sha256':sha(p)} for p in (b/'export').iterdir() if p.is_file()}
files['replay-export']={'bytes':(b/'replay-export').stat().st_size,'sha256':sha(b/'replay-export')}
passed=all(header.get(k)==ref[k] for k in ['blockHash','gasUsed','stateRoot','receiptHash']) and end is not None and list(end.groups())==expected and files['export/canonical.bin']['sha256']=='5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6'
report={'passed':passed,'scope':'native exact frozen terminal replay and cold completed image export; export itself calls no Begin/Advance; not a guest proof','header':header,'allFourGlobalStateFieldsMatch':end is not None and list(end.groups())==expected,'finalGlobalState':list(end.groups()) if end else None,'files':files,'allExecutionOnRunpod':True}
(b/'export-manifest.json').write_text(json.dumps(report,indent=2)+'\n');assert passed
