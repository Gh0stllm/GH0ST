#!/usr/bin/env python3
"""Read-only optimized upstream UCI reference, one isolated process per game."""
from pathlib import Path
import hashlib,json,subprocess,time
HERE=Path(__file__).resolve().parent
ENGINE=HERE.parents[1]
BINARY=ENGINE/'.cache/Stockfish/src/stockfish'
def run_native():
 inputs=json.loads((HERE/'inputs.json').read_text())
 config=json.loads((ENGINE.parent/'benchmarks/results/repair-retained3m-vs12m-larsen/config.json').read_text())
 assert hashlib.sha256(BINARY.read_bytes()).hexdigest()==config['engine_binary_sha256']
 p=subprocess.Popen([str(BINARY)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
 def command(s):p.stdin.write(s+'\n');p.stdin.flush()
 def until(prefix):
  rows=[]
  while 1:
   line=p.stdout.readline();assert line,'native EOF';rows.append(line.strip())
   if line.startswith(prefix):return rows
 def search(case):
  command('position startpos moves '+' '.join(case['moves']));command('go nodes 3000000');rows=until('bestmove');t=[x for x in rows if x.startswith('info depth ')][-1].split()
  return {'bestmove':rows[-1].split()[1],'actual_nodes':int(t[t.index('nodes')+1]),'depth':int(t[t.index('depth')+1])}
 try:
  command('uci');until('uciok')
  for k,v in [('NumaPolicy','none'),('Threads','1'),('Hash','128'),('Skill Level','20'),('UCI_LimitStrength','false'),('MultiPV','1'),('Ponder','false'),('SyzygyPath','<empty>')]:command('setoption name '+k+' value '+v)
  command('ucinewgame');command('isready');until('readyok')
  rows=[]
  for c in inputs['cases']:
   r=search(c);saved=c['saved_native'];expected={'bestmove':saved['uci'],'actual_nodes':saved['actual_nodes'],'depth':saved['depth']};assert r==expected,(r,expected)
   rows.append({'ply':c['ply'],'moves':c['moves'],'result':r,'matches_saved_game':True});print('native retained',r,flush=True)
  command('ucinewgame');command('isready');until('readyok');reset=search(inputs['cases'][0]);assert reset==rows[0]['result']
  report={'scope':'Fresh local optimized upstream native process retaining TT/history within one game, compared against saved completed native game; not ICP execution','binary_sha256':hashlib.sha256(BINARY.read_bytes()).hexdigest(),'cases':rows,'new_game_reset':reset,'new_game_reset_matches_original':True}
  (HERE/'evidence/native-reference.json').write_text(json.dumps(report,indent=2)+'\n');return report
 finally:command('quit');p.communicate(timeout=30)
if __name__=='__main__':run_native()
