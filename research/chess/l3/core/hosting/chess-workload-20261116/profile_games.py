#!/usr/bin/env python3
"""Measure unchanged full Black game workloads; this is not L3 execution."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import datetime
import hashlib
import json
import os
import platform
import re
import signal
import subprocess
import threading
import time
import chess
import chess.engine

HERE = Path(__file__).resolve().parent
CHESS = HERE.parents[3]
CACHE = HERE / '.cache'
CACHE.mkdir(exist_ok=True)
BINARY = CHESS / 'engine/.cache/Stockfish/src/stockfish'
GAMES = CHESS / 'benchmarks/results/retained24m-vs48m'
OPTIONS = {'NumaPolicy': 'none', 'Threads': 1, 'Hash': 128,
           'Skill Level': 20, 'UCI_LimitStrength': False,
           'MultiPV': 1, 'Ponder': False, 'SyzygyPath': ''}
STOP = threading.Event()
LOCK = threading.Lock()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


class MemorySampler:
    def __init__(self):
        self.roots = {}
        self.records = []
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.sample, daemon=True)

    def add(self, name, pid):
        with LOCK:
            self.roots[name] = pid

    def sample(self):
        while not self.stop.is_set():
            rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,rss='], text=True)
            processes = {int(a): (int(b), int(c))
                         for a, b, c in (line.split() for line in rows.splitlines())}
            with LOCK:
                roots = dict(self.roots)
            result = {}
            all_owned = set()
            for name, root in roots.items():
                selected = {root}
                while True:
                    expanded = selected | {pid for pid, (parent, _) in processes.items()
                                           if parent in selected}
                    if expanded == selected:
                        break
                    selected = expanded
                live = selected & processes.keys()
                all_owned |= live
                result[name] = sum(processes[pid][1] for pid in live)
            self.records.append({'elapsedSeconds': round(time.monotonic() - START, 3),
                                 'rolesRSSKiB': result,
                                 'totalOwnedRSSKiB': sum(processes[p][1] for p in all_owned)})
            self.stop.wait(0.5)


def lifetime_peak(path):
    match = re.search(r'(\d+)\s+maximum resident set size', path.read_text())
    if not match:
        raise RuntimeError('OS lifetime peak missing')
    return int(match[1])


def run_game(name, sampler):
    prior = json.loads((GAMES / (name + '.json')).read_text())
    assert prior['completed'] and prior['ghost_nodes'] == 24_000_000
    board = chess.Board()
    rows = []
    output = CACHE / (name + '-os-time.txt')
    started = time.monotonic()
    with chess.engine.SimpleEngine.popen_uci(
            ['/usr/bin/time', '-l', '-o', str(output), str(BINARY)], timeout=240) as engine:
        sampler.add(name, engine.transport.get_pid())
        engine.configure({k: v for k, v in OPTIONS.items() if k not in ['Ponder', 'MultiPV']})
        game_token = object()
        for old in prior['moves']:
            if STOP.is_set():
                raise InterruptedError('Stopped; game remains unfinished')
            assert board.fen() == old['fen_before']
            if board.turn == chess.WHITE:
                move = chess.Move.from_uci(old['uci'])
            else:
                began = time.monotonic()
                reply = engine.play(board, chess.engine.Limit(nodes=24_000_000),
                                    game=game_token, info=chess.engine.INFO_ALL)
                actual = {'bestmove': reply.move.uci(), 'actual_nodes': reply.info['nodes'],
                          'depth': reply.info['depth']}
                expected = {'bestmove': old['uci'], 'actual_nodes': old['actual_nodes'],
                            'depth': old['depth']}
                assert actual == expected, (name, old['ply'], actual, expected)
                assert actual['actual_nodes'] >= 24_000_000 or actual['depth'] == 245
                assert engine.protocol.game is game_token
                rows.append({'ply': old['ply'], **actual,
                             'seconds': round(time.monotonic() - began, 6),
                             'exactPriorPolicyMatch': True})
                save(CACHE / (name + '-progress.json'),
                     {'complete': False, 'pliesReplayed': old['ply'], 'blackSearches': rows})
                if len(rows) % 4 == 0:
                    print(json.dumps({'game': name, 'completedBlackDecisions': len(rows),
                                      'lastMove': actual['bestmove']}), flush=True)
                move = reply.move
            assert move in board.legal_moves
            board.push(move)
        assert board.fen() == prior['final_fen']
        assert len(board.move_stack) == prior['plies']
        engine.quit()
    record = {'game': name, 'complete': True, 'plies': len(board.move_stack),
              'blackDecisions': len(rows), 'targetNodesPerDecision': 24_000_000,
              'actualNodesTotal': sum(x['actual_nodes'] for x in rows),
              'blackSearches': rows, 'wallSeconds': round(time.monotonic() - started, 6),
              'OSPeakRSSBytes': lifetime_peak(output), 'finalFEN': board.fen(),
              'whiteMovesFromPublishedRecord': True, 'newStrengthGame': False}
    save(CACHE / (name + '-progress.json'), record)
    return record


def checkpoint_probe(sampler):
    binary = CHESS / 'engine/.cache/prefix-cache-native/src/stockfish'
    build = json.loads((CHESS / 'engine/prefix-cache/evidence/native-build.json').read_text())
    assert sha(binary) == build['binary_sha256']
    output = CACHE / 'checkpoint-os-time.txt'
    log = CACHE / 'checkpoint.stdout'
    with log.open('w') as handle:
        process = subprocess.Popen(['/usr/bin/time', '-l', '-o', str(output),
                                    str(binary), '24000000'], stdout=handle,
                                   stderr=subprocess.STDOUT)
        sampler.add('retained-checkpoint-recovery', process.pid)
        try:
            if process.wait(timeout=600) != 0:
                raise RuntimeError('Exact checkpoint recovery probe failed')
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=20)
    rows = [json.loads(x) for x in log.read_text().splitlines() if x.startswith('{')]
    assert rows[-1]['passed'] and rows[-1]['full24m_searches'] == 5
    return {'passed': True, 'binarySHA256': sha(binary),
            'OSPeakRSSBytes': lifetime_peak(output), 'events': rows,
            'nativeLogicalCheckpointOnly': True, 'L3ReplayOrFraudProof': False}


def main():
    proof = json.loads((CHESS / 'benchmarks/reference-verification.json').read_text())
    assert sha(BINARY) == proof['uci_binary_sha256']
    model = CHESS / 'engine/.cache/Stockfish/src/nn-1a298aa575a0.nnue'
    assert model.stat().st_size == 98_511_183
    assert sha(model) == '1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2'
    assert subprocess.check_output(['git', '-C', str(model.parent.parent), 'rev-parse', 'HEAD'],
                                   text=True).strip() == 'edb0d9db6731067ec50ce619ff372b463bc4dd5d'
    sampler = MemorySampler()
    sampler.add('profile-harness', os.getpid())
    sampler.thread.start()
    report = {'status': 'RUNNING', 'host': platform.platform(),
              'hostRAMBytes': int(subprocess.check_output(['sysctl', '-n', 'hw.memsize'])),
              'nativeBinarySHA256': sha(BINARY), 'modelSHA256': sha(model),
              'options': OPTIONS, 'memoryLimit16GBEnforced': False,
              'L3StockfishExecution': False, 'L3FraudProverExecution': False,
              'realSpend': 0, 'serverOrdered': False}
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            games = [pool.submit(run_game, name, sampler)
                     for name in ['48m-larsen', '48m-king-pawn']]
            recovery = pool.submit(checkpoint_probe, sampler)
            report['games'] = [future.result() for future in games]
            report['checkpointRecovery'] = recovery.result()
        report['status'] = 'PASSED'
    except BaseException as error:
        STOP.set()
        report.update(status='FAILED_OR_UNFINISHED', error=str(error))
        raise
    finally:
        sampler.stop.set()
        sampler.thread.join(timeout=10)
        report['wallSeconds'] = round(time.monotonic() - START, 6)
        report['sampleIntervalSeconds'] = 0.5
        report['sampleCount'] = len(sampler.records)
        report['sampledPeakOwnedRSSKiB'] = max((x['totalOwnedRSSKiB']
                                               for x in sampler.records), default=0)
        save(CACHE / 'memory-samples.json', sampler.records)
        save(CACHE / 'results.json', report)
        print(json.dumps({k: v for k, v in report.items()
                          if k not in ['games', 'checkpointRecovery']}, indent=2), flush=True)


if __name__ == '__main__':
    START = time.monotonic()
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    main()
