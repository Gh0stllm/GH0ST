#!/usr/bin/env python3
"""Compare bounded native searches; does not claim IC-meter savings."""
from pathlib import Path
import json, re, subprocess, time

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
def run(binary):
    p = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    p.stdin.write('uci\nsetoption name Threads value 1\nsetoption name Hash value 128\nsetoption name Skill Level value 20\nsetoption name UCI_LimitStrength value false\nisready\n')
    p.stdin.flush()
    while p.stdout.readline().strip() != 'readyok':
        assert p.poll() is None
    p.stdin.write('ucinewgame\nposition startpos moves e2e4\ngo nodes 400000\n')
    p.stdin.flush()
    lines = []
    started = time.monotonic()
    while True:
        line = p.stdout.readline().strip()
        lines.append(line)
        if line.startswith('bestmove '):
            break
        assert p.poll() is None
        assert time.monotonic() - started < 60
    p.stdin.write('quit\n'); p.stdin.flush()
    _, error = p.communicate(timeout=10)
    assert p.returncode == 0, error
    last = [line for line in lines if ' nodes ' in line][-1]
    result = {'bestmove': lines[-1].split()[1],
              'nodes': int(re.search(r'\bnodes (\d+)', last).group(1)),
              'depth': int(re.search(r'\bdepth (\d+)', last).group(1)),
              'score': re.search(r'\bscore (cp|mate) (-?\d+)', last).group(0),
              'pv': last.split(' pv ', 1)[1],
              'scope': '400k-node native probe, not full24m strength proof or IC execution'}
    found = re.search(r'GH0ST_EXACT_REUSE (\{[^\n]+\})', error)
    if found: result['probe'] = json.loads(found.group(1))
    return result

baseline = run(ENGINE / '.cache/Stockfish/src/stockfish')
probe = run(HERE / '.cache/src/stockfish')
fields = ['bestmove', 'nodes', 'depth', 'score', 'pv']
assert all(baseline[k] == probe[k] for k in fields), (baseline, probe)
assert probe['probe']['mismatches'] == 0
ratio = probe['probe']['hits'] / probe['probe']['evaluations']
record = {'baseline': baseline, 'probe': probe, 'matchingSearchFields': fields,
          'affineCacheHitFraction': ratio,
          'scope': 'Native reuse measurement only; all affine calls execute; no optimization promoted'}
(HERE / 'evidence/probe.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
