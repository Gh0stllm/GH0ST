#!/usr/bin/env python3
"""Complete native-proxy games against larger-budget adversarial Stockfish.

Only legal White checkmate counts as a prize win. Natural draws, valid draw
claims, and unfinished games remain separate. No network/identity/funding used.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import signal
import threading
import time
import traceback
import chess
import chess.engine
import chess.pgn
from verify_reference import BINARY, OPTIONS

ROOT = Path(__file__).resolve().parent
STOP = threading.Event()
LOCK = threading.Lock()
OPENERS = [('king-pawn', 'e2e4'), ('queen-pawn', 'd2d4'), ('english', 'c2c4'),
           ('reti', 'g1f3'), ('kings-fianchetto', 'g2g3'), ('larsen', 'b2b3')]

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)

def terminal(board):
    # Checkmate always has precedence over move-clock draw conditions.
    if board.is_checkmate():
        return ('1-0' if board.turn == chess.BLACK else '0-1', 'checkmate', None)
    if board.is_stalemate(): return '1/2-1/2', 'stalemate', None
    if board.is_insufficient_material(): return '1/2-1/2', 'insufficient_material', None
    if board.is_seventyfive_moves(): return '1/2-1/2', 'seventy_five_moves', None
    if board.is_fivefold_repetition(): return '1/2-1/2', 'fivefold_repetition', None
    # GH0ST claims current optional draws, matching protocol/src/lib.rs.
    # A bounty hunter needs checkmate and may decline every voluntary draw.
    # White therefore NEVER elects optional draw claims in this adversarial run.
    if board.turn == chess.BLACK:
        if board.is_fifty_moves(): return '1/2-1/2', 'claimed_fifty_moves_current', None
        if board.is_repetition(3): return '1/2-1/2', 'claimed_threefold_current', None
    return None

def schedule():
    # Every run starts from the standard initial board. Only White's first move
    # is fixed, representing a legal challenger choice; no GH0ST move is forced.
    jobs = []
    for i, (name, first) in enumerate(OPENERS):
        jobs.append({'id': f'12m-{name}', 'opening': name, 'white_first_move': first,
                     'challenger_nodes': 12_000_000, 'ghost_nodes': 3_000_000})
    for name, first in OPENERS:
        jobs.append({'id': f'24m-{name}', 'opening': name, 'white_first_move': first,
                     'challenger_nodes': 24_000_000, 'ghost_nodes': 3_000_000})
    return jobs

def summary(out, jobs, runtime):
    rows = []
    for job in jobs:
        p = out / (job['id'] + '.json')
        if p.exists(): rows.append(json.loads(p.read_text()))
    completed = [r for r in rows if r.get('completed')]
    white_mates = [r for r in completed if r['result'] == '1-0' and r['termination'] == 'checkmate']
    black_mates = [r for r in completed if r['result'] == '0-1' and r['termination'] == 'checkmate']
    data = {'scope': 'Full native CPU games using a verified proxy of the ICP search configuration; not Solidity games or public execution',
            'updated_at': utc(), 'wall_seconds': time.monotonic() - runtime,
            'planned_games': len(jobs), 'completed_games': len(completed),
            'challenger_checkmates': len(white_mates), 'ghost_checkmates': len(black_mates),
            'natural_or_valid_claim_draws': sum(r['result'] == '1/2-1/2' for r in completed),
            'unfinished_games': sum(not r.get('completed') for r in rows),
            'observed_challenger_checkmate_fraction': len(white_mates)/len(completed) if completed else None,
            'statistical_limit': 'A deterministic selected-opening suite, not a random or independent sample of future users. Its observed fraction is not a calibrated public win probability, Elo, or profitability forecast.',
            'games': [{k: r.get(k) for k in ['id', 'completed', 'result', 'termination', 'plies', 'challenger_nodes', 'ghost_nodes', 'wall_seconds']} for r in rows]}
    save(out/'summary.json', data)
    return data

def run_game(job, out, deadline, max_plies):
    started = time.monotonic()
    board = chess.Board()
    pgn = chess.pgn.Game()
    pgn.headers.update({'Event': 'GH0ST adversarial native-proxy benchmark', 'Site': 'isolated local CPU',
                        'Date': datetime.date.today().strftime('%Y.%m.%d'),
                        'White': f'Stockfish19-{job["challenger_nodes"]//1_000_000}m-retained',
                        'Black': f'GH0ST-SF19-{job["ghost_nodes"]//1_000_000}m-cleared',
                        'Result': '*', 'OpeningChoice': job['white_first_move']})
    node = pgn
    state = dict(job, scope='Native CPU full game, not ICP gameplay or Solidity execution',
                 started_at=utc(), completed=False, result='*', termination='in_progress', moves=[],
                 wall_seconds=0, plies=0, final_fen=board.fen())
    path = out/(job['id']+'.json')
    def checkpoint():
        state.update(plies=len(board.move_stack), final_fen=board.fen(), wall_seconds=time.monotonic()-started)
        save(path, state)
        (out/(job['id']+'.pgn')).write_text(str(pgn) + '\n')
    checkpoint()
    try:
        with chess.engine.SimpleEngine.popen_uci(str(BINARY), timeout=180) as white, \
             chess.engine.SimpleEngine.popen_uci(str(BINARY), timeout=180) as black:
            white.configure(OPTIONS); black.configure(OPTIONS)
            white_game = object()
            while True:
                outcome = terminal(board)
                if outcome:
                    state['result'], state['termination'], state['draw_intended_move'] = outcome
                    state['completed'] = True
                    break
                if STOP.is_set() or time.monotonic() >= deadline:
                    state['termination'] = 'stopped_at_work_budget_unfinished'
                    break
                if len(board.move_stack) >= max_plies:
                    state['termination'] = 'resource_ply_ceiling_unfinished'
                    break
                is_white = board.turn == chess.WHITE
                forced = len(board.move_stack) == 0
                before = board.fen()
                move_started = time.monotonic()
                if forced:
                    move = chess.Move.from_uci(job['white_first_move']); info = {}
                else:
                    engine = white if is_white else black
                    target = job['challenger_nodes'] if is_white else job['ghost_nodes']
                    # A fresh game token forces ucinewgame/search_clear for each
                    # GH0ST decision. The challenger retains its normal cache.
                    reply = engine.play(board, chess.engine.Limit(nodes=target),
                                        game=white_game if is_white else object(),
                                        info=chess.engine.INFO_ALL)
                    move, info = reply.move, reply.info
                assert move in board.legal_moves, (job['id'], before, move)
                san = board.san(move)
                record = {'ply': len(board.move_stack)+1, 'side': 'White' if is_white else 'Black',
                          'uci': move.uci(), 'san': san, 'fen_before': before,
                          'forced_white_opening_choice': forced,
                          'target_nodes': None if forced else (job['challenger_nodes'] if is_white else job['ghost_nodes']),
                          'actual_nodes': info.get('nodes'), 'depth': info.get('depth'),
                          'search_seconds': time.monotonic()-move_started,
                          'score_white': str(info['score'].white()) if 'score' in info else None,
                          'pv': [m.uci() for m in info.get('pv', [])]}
                if not forced:
                    assert info.get('nodes', 0) >= record['target_nodes'] or info.get('depth') == 245, record
                board.push(move)
                node = node.add_variation(move)
                if info:
                    node.comment = f'nodes={info.get("nodes")} depth={info.get("depth")} scoreWhite={record["score_white"]}'
                state['moves'].append(record)
                checkpoint()
                if len(board.move_stack) % 10 == 0:
                    with LOCK: print(json.dumps({'progress': job['id'], 'ply': len(board.move_stack), 'seconds': round(time.monotonic()-started,1), 'last': san, 'score_white': record['score_white']}), flush=True)
    except Exception as error:
        state['termination'] = 'error_unfinished'
        state['error'] = str(error)
        state['traceback'] = traceback.format_exc()
    state['ended_at'] = utc()
    pgn.headers['Result'] = state['result']
    pgn.headers['Termination'] = state['termination']
    checkpoint()
    with LOCK: print(json.dumps({'finished': job['id'], 'completed': state['completed'], 'result': state['result'], 'termination': state['termination'], 'plies': state['plies'], 'seconds': round(state['wall_seconds'],1)}), flush=True)
    return state

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--games', type=int, default=12)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--minutes', type=float, default=30)
    parser.add_argument('--max-plies', type=int, default=1024)
    parser.add_argument('--run-id', default='baseline-3m')
    args = parser.parse_args()
    assert 1 <= args.workers <= 4 and 1 <= args.games <= 12
    proof = json.loads((ROOT/'reference-verification.json').read_text())
    assert proof['passed'] and proof['uci_binary_sha256'] == hashlib.sha256(BINARY.read_bytes()).hexdigest()
    out = ROOT/'results'/args.run_id; out.mkdir(parents=True, exist_ok=True)
    jobs = schedule()[:args.games]
    config = {'scope': 'Native-proxy strength benchmark only; not Solidity, ICP full-game execution, public deployment or paid play',
              'created_at': utc(), 'engine_binary_sha256': proof['uci_binary_sha256'],
              'stockfish_commit': proof['stockfish_commit'], 'nnue_sha256': proof['nnue_sha256'],
              'options': OPTIONS, 'gh0st_policy': 'Black, fixed3m nodes, new UCI game token clears TT+histories every decision',
              'challenger_policy': 'White,12m/24m nodes with normal retained TT+histories, fullskill,1thread,128MiBhash',
              'white_draw_policy': 'Never elects optional draw claims; only GH0ST claims current optional draws, while mandatory75move/fivefold draws still apply',
              'first_move_policy': 'White first move is fixed from six disclosed legal choices; no Black move is forced; every game starts from the standard position',
              'termination_policy': 'Only legal checkmate wins. Automatic draws and valid claims separate. No score/resign/clock/maxply adjudication is recorded as a draw or checkmate.',
              'workers': args.workers, 'work_budget_minutes': args.minutes, 'max_plies': args.max_plies,
              'python_chess': chess.__version__, 'jobs': jobs}
    save(out/'config.json', config)
    runtime = time.monotonic(); deadline = runtime+args.minutes*60
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    summary(out, jobs, runtime)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(run_game, job, out, deadline, args.max_plies): job for job in jobs}
        for future in as_completed(futures):
            future.result()
            with LOCK: print(json.dumps({'summary': summary(out,jobs,runtime)}), flush=True)
    print(json.dumps(summary(out,jobs,runtime),indent=2), flush=True)

if __name__ == '__main__': main()
