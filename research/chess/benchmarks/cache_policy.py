# Native-only cache-policy candidate. Baseline runner is unmodified.
import datetime
import json
import time
import traceback
import chess
import chess.engine
import chess.pgn
from run_matches import ROOT, OPTIONS, BINARY, STOP, LOCK, utc, save, terminal

def run_game_cached(job, out, deadline, max_plies):
    started = time.monotonic()
    board = chess.Board()
    pgn = chess.pgn.Game()
    pgn.headers.update({'Event': 'GH0ST adversarial native-proxy benchmark', 'Site': 'isolated local CPU',
                        'Date': datetime.date.today().strftime('%Y.%m.%d'),
                        'White': f'Stockfish19-{job["challenger_nodes"]//1_000_000}m-retained',
                        'Black': f'GH0ST-SF19-{job["ghost_nodes"]//1_000_000}m-retained',
                        'Result': '*', 'OpeningChoice': job['white_first_move']})
    node = pgn
    state = dict(job, scope='Native CPU per-game retained Black cache candidate; not current ICP or Solidity execution',
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
            black_game = object()
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
                    # Both engine instances retain TT and histories within this one
                    # game. A fresh process/game is used for each experiment.
                    reply = engine.play(board, chess.engine.Limit(nodes=target),
                                        game=white_game if is_white else black_game,
                                        info=chess.engine.INFO_ALL)
                    move, info = reply.move, reply.info
                    assert engine.protocol.game is (white_game if is_white else black_game)
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
