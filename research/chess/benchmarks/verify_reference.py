#!/usr/bin/env python3
"""Validate the optimized native match proxy against the pinned direct C ABI."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import datetime
import hashlib
import json
import subprocess
import time
import chess
import chess.engine

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT.parent / 'engine'
BINARY = ENGINE / '.cache/Stockfish/src/stockfish'
PROBE = ENGINE / '.cache/native_probe'
TACTICAL = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'
OPTIONS = {'NumaPolicy': 'none', 'Threads': 1, 'Hash': 128,
           'Skill Level': 20, 'UCI_LimitStrength': False, 'SyzygyPath': ''}

def verify(case):
    name, fen, moves = case
    board = chess.Board(fen)
    for uci in moves.split(): board.push_uci(uci)
    started = time.monotonic()
    with chess.engine.SimpleEngine.popen_uci(str(BINARY), timeout=180) as engine:
        engine.configure(OPTIONS)
        info = engine.play(board, chess.engine.Limit(nodes=3_000_000),
                           game=object(), info=chess.engine.INFO_ALL)
        optimized = {'status': 0, 'bestmove': info.move.uci(),
                     'actual_nodes': info.info['nodes'], 'depth': info.info['depth']}
        ident = engine.id
    optimized_seconds = time.monotonic() - started
    started = time.monotonic()
    p = subprocess.run([str(PROBE), fen, '3000000', '128', moves],
                       check=True, capture_output=True, text=True, timeout=240)
    direct = json.loads(p.stdout.strip().splitlines()[-1])
    assert direct == optimized, (name, direct, optimized)
    return {'case': name, 'initial_fen': fen, 'moves': moves.split(),
            'target_nodes': 3_000_000, 'optimized': optimized, 'direct': direct,
            'exact_match': True, 'optimized_seconds': optimized_seconds,
            'direct_seconds': time.monotonic() - started, 'engine_id': ident}

if __name__ == '__main__':
    cases = [('black-after-e4', chess.STARTING_FEN, 'e2e4'),
             ('kiwipete', TACTICAL, '')]
    with ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(verify, cases))
    report = {'scope': 'Native CPU proxy verification only; no ICP full game or Solidity execution',
              'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'stockfish_commit': 'edb0d9db6731067ec50ce619ff372b463bc4dd5d',
              'nnue_sha256': '1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2',
              'uci_binary_sha256': hashlib.sha256(BINARY.read_bytes()).hexdigest(),
              'direct_probe_sha256': hashlib.sha256(PROBE.read_bytes()).hexdigest(),
              'options': OPTIONS, 'clear_tt_and_histories_every_search': True,
              'python_chess_version': chess.__version__, 'tests': results, 'passed': True}
    (ROOT/'reference-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)
