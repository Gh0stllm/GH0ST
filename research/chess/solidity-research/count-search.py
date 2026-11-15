#!/usr/bin/env python3
"""Count true dense/accumulator invocations in one exact three-million-node search."""
from pathlib import Path
import hashlib
import json
import os
import struct
import subprocess
import time
ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent/'engine/.cache/Stockfish/src/stockfish'
COUNT=ROOT/'.cache/instrumented-src/stockfish'
rows=[]
dump=ROOT/'.cache/position-inputs.bin'
dump.unlink(missing_ok=True)
for name,binary in [('official-native',BASE),('instrumented-native',COUNT)]:
 env=dict(os.environ)
 if name=='instrumented-native':env['GH0ST_NNUE_DUMP_PATH']=str(dump)
 p=subprocess.Popen([str(binary)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1,env=env)
 def command(s):p.stdin.write(s+'\n');p.stdin.flush()
 def until(prefix):
  lines=[]
  while True:
   line=p.stdout.readline()
   assert line,'unexpected engine EOF'
   lines.append(line.strip())
   if line.startswith(prefix):return lines
 command('uci');until('uciok')
 for option,value in [('NumaPolicy','none'),('Threads','1'),('Hash','128'),('Skill Level','20'),('UCI_LimitStrength','false'),('Ponder','false'),('MultiPV','1'),('SyzygyPath','<empty>')]:
  command('setoption name '+option+' value '+value)
 command('ucinewgame');command('isready');until('readyok')
 command('position startpos moves e2e4')
 start=time.monotonic();command('go nodes 3000000');lines=until('bestmove')
 elapsed=time.monotonic()-start
 command('quit');extra=p.communicate(timeout=20)[0];p.wait(timeout=20)
 final=[x for x in lines if x.startswith('info depth ')][-1].split()
 row={'binary':name,'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
  'bestmove':lines[-1].split()[1],'nodes':int(final[final.index('nodes')+1]),
  'depth':int(final[final.index('depth')+1]),'elapsedSeconds':elapsed}
 for line in extra.splitlines():
  if line.startswith('info string GH0ST_COUNTERS '):row['counters']=json.loads(line.split('GH0ST_COUNTERS ',1)[1])
 rows.append(row);print(json.dumps(row),flush=True)
assert all(rows[0][k]==rows[1][k] for k in ['bestmove','nodes','depth'])
assert [rows[0][k] for k in ['bestmove','nodes','depth']]==['e7e5',3000212,28]
assert rows[1]['counters']['network_evaluations']>0
vectors=[]
data=dump.read_bytes()
assert len(data)%1032==0
for start in range(0,len(data),1032):
 bucket,expected=struct.unpack_from('<ii',data,start)
 inputs=data[start+8:start+1032]
 input_file=ROOT/f'.cache/position-{len(vectors)}.bin'
 input_file.write_bytes(inputs)
 scalar=int(subprocess.check_output([str(ROOT/'.cache/dense-reference'),str(ROOT/f'.cache/stack-{bucket}-native.bin'),str(input_file)]))
 assert scalar==expected,(bucket,scalar,expected)
 vectors.append({'sample':len(vectors),'networkInvocation':len(vectors)*100000+1,'bucket':bucket,
  'inputHex':inputs.hex(),'inputSha256':hashlib.sha256(inputs).hexdigest(),
  'nonzero':sum(x!=0 for x in inputs),'nativeOutput':expected,'upstreamScalarMatchesOptimized':True})
(ROOT/'position-vectors.json').write_text(json.dumps({'scope':'Real transformed feature vectors sampled from the instrumented fixed3m-node native search; already transformed dense inputs, not Solidity board feature extraction',
 'networkSha256':'1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2',
 'vectors':vectors},indent=2)+'\n')
report={'scope':'One instrumented native SF19 search, not EVM execution or an end-to-end Solidity gas bill',
 'position':'standard initial position with full history e2e4; Black to move',
 'options':{'Threads':1,'Hash':128,'SkillLevel':20,'LimitStrength':False,'MultiPV':1,'clearHistoryAndTTEachDecision':True},
 'targetNodes':3000000,'runs':rows,'exactSearchOutcomePreserved':True,'sampledActualTransformedVectors':len(vectors),
 'counterCaveat':'Accumulator counters count function invocations, not individual1024-lane feature-row operations. No per-node eval-count assumption is used.'}
(ROOT/'search-counters.json').write_text(json.dumps(report,indent=2)+'\n')
