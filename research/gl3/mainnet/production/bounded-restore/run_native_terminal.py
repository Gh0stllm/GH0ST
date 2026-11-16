"""Replay the unchanged captured terminal block on Linux, recording exit first."""
from pathlib import Path
import base64,hashlib,json,os,re,struct,subprocess,time
r=Path('/root/bounded-restore');out=r/'evidence';inp=Path('/root/terminal-acceptance/evidence/terminal-input.json')
assert hashlib.file_digest(inp.open('rb'),'sha256').hexdigest()=='bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90'
data=json.loads(inp.read_bytes());start,end=data['StartState'],data['ExpectedEndState']
assert set(data['PreimagesB64'])=={'0'} and len(data['BatchInfo'])==1
with (r/'preimages.bin').open('wb') as f:
 for value in data['PreimagesB64']['0'].values():
  raw=base64.b64decode(value);f.write(struct.pack('<Q',len(raw)));f.write(raw)
batch=data['BatchInfo'][0];assert batch['Number']==start['Batch'];(r/'batch.bin').write_bytes(base64.b64decode(batch['DataB64']));del data
args=[str(r/'replay-native'),'--last-block-hash',start['BlockHash'],'--inbox-position',str(start['Batch']),'--position-within-message',str(start['PosInBatch']),'--preimages',str(r/'preimages.bin'),'--inbox',str(r/'batch.bin')]
began=time.monotonic()
with (out/'native-terminal.log').open('w') as log:
 p=subprocess.Popen(args,env={**os.environ,'GOMAXPROCS':'12','MALLOC_ARENA_MAX':'2'},stdout=log,stderr=subprocess.STDOUT)
 (out/'native-terminal-process.json').write_text(json.dumps({'pid':p.pid,'args':args})+'\n')
 code=p.wait()
(out/'native-terminal-exit.json').write_text(json.dumps({'exitCode':code,'seconds':time.monotonic()-began})+'\n')
output=(out/'native-terminal.log').read_text();actual=re.search(r'GL3_REPLAY_END (0x[0-9a-f]{64}) (0x[0-9a-f]{64}) (\d+) (\d+)',output)
expected=(end['BlockHash'],end['SendRoot'],str(end['Batch']),str(end['PosInBatch']))
report={'passed':code==0 and actual is not None and actual.groups()==expected,'exitCode':code,'actual':list(actual.groups()) if actual else None,'expected':list(expected),'inputSHA256':hashlib.file_digest(inp.open('rb'),'sha256').hexdigest(),'nativeBinarySHA256':hashlib.file_digest((r/'replay-native').open('rb'),'sha256').hexdigest(),'allExecutionOnRunpod':True,'fullBoLDDisputeExecuted':False,'WAVMReplayPassed':False,'enginePolicyChanged':False}
(out/'native-terminal-result.json').write_text(json.dumps(report,indent=2)+'\n');assert report['passed'],report
