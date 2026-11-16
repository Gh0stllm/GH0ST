"""Require independent replay to reject a missing authenticated parent header."""
from pathlib import Path
import argparse,base64,json,struct,subprocess

HERE=Path(__file__).resolve().parent
OUT=HERE/'.cache/block'
parser=argparse.ArgumentParser();parser.add_argument('--sliced',action='store_true');options=parser.parse_args()
if options.sliced:OUT=HERE/'sliced/.cache/blocks'
binary=HERE/('.cache/bin-sliced/replay-native' if options.sliced else '.cache/bin/replay-native')
data=json.loads((OUT/'input.json').read_text());start=data['StartState']
missing=bytes.fromhex(start['BlockHash'][2:]);seen=False
target=OUT/'missing-header-preimages.bin'
with target.open('wb') as f:
 for key,value in data['PreimagesB64']['0'].items():
  if base64.b64decode(key)==missing:seen=True;continue
  raw=base64.b64decode(value);f.write(struct.pack('<Q',len(raw)));f.write(raw)
assert seen
args=[str(binary),'--last-block-hash',start['BlockHash'],'--inbox-position',str(start['Batch']),'--position-within-message',str(start['PosInBatch']),'--preimages',str(target),'--inbox',str(OUT/'batch.bin')]
p=subprocess.run(args,capture_output=True,text=True)
assert p.returncode!=0 and 'preimage not found' in p.stdout+p.stderr
assert 'GL3_REPLAY_END' not in p.stdout+p.stderr
report={'passed':True,'scope':'Independent full-block replay rejects a missing authenticated parent-header preimage before it can return any completed result','exitCode':p.returncode,'missingParentHash':start['BlockHash'],'completedResultEmitted':False,'publicDeployment':False,'realSpend':0}
(OUT/'negative-native-replay.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));target.unlink()
