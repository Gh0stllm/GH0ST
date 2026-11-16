"""Independently replay a recorded full block with authenticated preimages only."""
from pathlib import Path
import argparse,base64,hashlib,json,re,struct,subprocess,time

HERE=Path(__file__).resolve().parent
OUT=HERE/'.cache/block'
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--sliced',action='store_true');parser.add_argument('--input-dir',type=Path);parser.add_argument('--variant',default='');options=parser.parse_args()
 assert not options.variant or (options.sliced and re.fullmatch('[a-z0-9-]+',options.variant))
 suffix='-'+options.variant if options.variant else ''
 if options.sliced:OUT=HERE/('sliced/.cache/blocks'+suffix)
 if options.input_dir:OUT=options.input_dir.resolve()
 binary=HERE/('.cache/bin-sliced'+suffix+'/replay-native' if options.sliced else '.cache/bin/replay-native')
 source=OUT/'input.json';data=json.loads(source.read_text());start=data['StartState'];end=data['ExpectedEndState']
 assert set(data['PreimagesB64'])=={'0'} and len(data['BatchInfo'])==1
 with (OUT/'preimages.bin').open('wb') as f:
  for _,value in data['PreimagesB64']['0'].items():
   raw=base64.b64decode(value);f.write(struct.pack('<Q',len(raw)));f.write(raw)
 batch=data['BatchInfo'][0];assert batch['Number']==start['Batch'];(OUT/'batch.bin').write_bytes(base64.b64decode(batch['DataB64']))
 args=[str(binary),'--last-block-hash',start['BlockHash'],'--inbox-position',str(start['Batch']),'--position-within-message',str(start['PosInBatch']),'--preimages',str(OUT/'preimages.bin'),'--inbox',str(OUT/'batch.bin')]
 began=time.monotonic();p=subprocess.run(args,capture_output=True,text=True);seconds=time.monotonic()-began
 output=p.stdout+p.stderr;(OUT/'native-replay.log').write_text(output)
 assert p.returncode==0,output[-5000:]
 actual=re.search(r'GL3_REPLAY_END (0x[0-9a-f]{64}) (0x[0-9a-f]{64}) (\d+) (\d+)',output)
 assert actual,output[-5000:]
 assert actual.groups()==(end['BlockHash'],end['SendRoot'],str(end['Batch']),str(end['PosInBatch'])),actual.groups()
 report={'passed':True,'scope':'Independent complete native cmd/replay block execution from recorded preimages/batch; no live node/database access','sliced':options.sliced,'seconds':seconds,'inputBytes':source.stat().st_size,'inputSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'start':start,'expectedEnd':end,'replayBinarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'WAVMReplayPassed':False,'publicDeployment':False,'realSpend':0}
 (OUT/'native-replay.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
