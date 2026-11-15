#!/usr/bin/env python3
"""Replay final benchmark records and PGNs; no engine or paid network calls."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import chess
import chess.pgn
from run_matches import terminal

ROOT = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run_id', nargs='?', default='baseline-3m')
    parser.add_argument('--completed-only', action='store_true',
                        help='Validate a stable completed-game subset while other games run')
    args = parser.parse_args()
    folder = ROOT/'results'/args.run_id
    config = json.loads((folder/'config.json').read_text())
    proof = json.loads((ROOT/'reference-verification.json').read_text())
    assert config['engine_binary_sha256'] == proof['uci_binary_sha256'] and proof['passed']
    results = []
    skipped_unfinished = 0
    for job in config['jobs']:
        path = folder/(job['id']+'.json')
        if not path.exists(): continue
        row = json.loads(path.read_text())
        if args.completed_only and not row['completed']:
            skipped_unfinished += 1
            continue
        board = chess.Board()
        for i, move in enumerate(row['moves']):
            assert move['ply'] == i+1 and move['fen_before'] == board.fen()
            expected_side = 'White' if board.turn == chess.WHITE else 'Black'
            assert move['side'] == expected_side
            actual = chess.Move.from_uci(move['uci'])
            assert actual in board.legal_moves and move['san'] == board.san(actual)
            if i == 0:
                assert move['forced_white_opening_choice'] and move['uci'] == job['white_first_move']
                assert move['target_nodes'] is None
            else:
                assert not move['forced_white_opening_choice']
                expected = job['challenger_nodes'] if board.turn == chess.WHITE else job['ghost_nodes']
                assert move['target_nodes'] == expected
                assert move['actual_nodes'] >= expected or move['depth'] == 245
            board.push(actual)
        assert len(board.move_stack) == row['plies'] and board.fen() == row['final_fen']
        with (folder/(job['id']+'.pgn')).open() as f: pgn = chess.pgn.read_game(f)
        assert pgn is not None and not pgn.errors
        assert list(pgn.mainline_moves()) == board.move_stack
        assert pgn.headers['Result'] == row['result']
        assert pgn.headers['Termination'] == row['termination']
        if row['completed']:
            expected = terminal(board)
            assert expected is not None and expected == (row['result'],row['termination'],row.get('draw_intended_move'))
        else:
            assert row['result'] == '*'
        results.append({'id': job['id'], 'completed': row['completed'], 'result': row['result'],
                        'termination': row['termination'], 'plies': row['plies'],
                        'json_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'pgn_sha256': hashlib.sha256((folder/(job['id']+'.pgn')).read_bytes()).hexdigest(),
                        'legal_replay_and_search_budgets_verified': True})
    report = {'scope': 'Offline legal replay of native-proxy full-game evidence, not public or Solidity execution',
              'validated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'completed_only': args.completed_only,
              'skipped_unfinished_records': skipped_unfinished,
              'passed': True, 'records_verified': len(results),
              'completed_games': sum(r['completed'] for r in results), 'games': results}
    name = 'validation-completed.json' if args.completed_only else 'validation.json'
    (folder/name).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__': main()
