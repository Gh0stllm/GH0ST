#!/usr/bin/env python3
"""If a real baseline checkmate is found, test a separately pinned 10m defence.

Refuses an unfinished/drawn baseline. Never edits an existing match, engine,
canister, wallet or deployment. Known-line divergence alone is not a repair proof.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import time
import chess
import chess.engine
from run_matches import ROOT, OPTIONS, BINARY, run_game, summary, save, utc

ENGINE = ROOT.parent/'engine'
PROBE = ENGINE/'.cache/native_probe'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('baseline_record', type=Path)
    parser.add_argument('--minutes', type=float, default=45)
    args = parser.parse_args()
    args.baseline_record = args.baseline_record.resolve()
    old = json.loads(args.baseline_record.read_text())
    assert old['completed'] and old['result'] == '1-0' and old['termination'] == 'checkmate', \
        'A legally completed White checkmate is required before a repair experiment'
    board = chess.Board()
    for row in old['moves']:
        assert row['fen_before'] == board.fen()
        move = chess.Move.from_uci(row['uci'])
        assert move in board.legal_moves
        board.push(move)
    assert board.is_checkmate() and board.turn == chess.BLACK
    first = old['white_first_move']; budget = 10_000_000
    out = ROOT/'results'/('repair-10m-'+old['opening'])
    out.mkdir(parents=True, exist_ok=True)

    # Independently verify this larger-budget CPU proxy on the actual initial
    # Black position from the attack, against the direct pinned C ABI probe.
    initial = chess.Board(); initial.push_uci(first)
    with chess.engine.SimpleEngine.popen_uci(str(BINARY),timeout=240) as engine:
        engine.configure(OPTIONS)
        answer = engine.play(initial,chess.engine.Limit(nodes=budget),game=object(),info=chess.engine.INFO_ALL)
        actual = {'status':0,'bestmove':answer.move.uci(),
                  'actual_nodes':answer.info['nodes'],'depth':answer.info['depth']}
    direct = subprocess.run([str(PROBE),chess.STARTING_FEN,str(budget),'128',first],
                            capture_output=True,text=True,check=True,timeout=360)
    expected = json.loads(direct.stdout.strip().splitlines()[-1])
    assert actual == expected, (actual,expected)
    reference = {'scope':'Native 10m repair proxy comparison only; not Solidity or ICP execution',
                 'checked_at':utc(),'initial_fen':chess.STARTING_FEN,'moves':[first],
                 'target_nodes':budget,'optimized':actual,'direct':expected,'exact_match':True,
                 'uci_binary_sha256':hashlib.sha256(BINARY.read_bytes()).hexdigest(),
                 'direct_binary_sha256':hashlib.sha256(PROBE.read_bytes()).hexdigest()}
    save(out/'reference-10m.json',reference)

    # Follow the published White attack, allowing every Black response to be
    # recomputed. Stop at the first genuine new defence, never force an old
    # Black move. A divergence does not establish a drawn/winning replacement.
    board = chess.Board(); comparisons = []; divergence = None
    with chess.engine.SimpleEngine.popen_uci(str(BINARY),timeout=240) as engine:
        engine.configure(OPTIONS)
        for old_move in old['moves']:
            if board.turn == chess.WHITE:
                move = chess.Move.from_uci(old_move['uci'])
            else:
                reply = engine.play(board,chess.engine.Limit(nodes=budget),game=object(),info=chess.engine.INFO_ALL)
                move = reply.move
                row = {'ply':len(board.move_stack)+1,'old_move':old_move['uci'],'new_move':move.uci(),
                       'actual_nodes':reply.info['nodes'],'depth':reply.info['depth']}
                comparisons.append(row)
                if move.uci() != old_move['uci']:
                    divergence = row
                    break
            assert move in board.legal_moves
            board.push(move)
    save(out/'known-line.json',{'scope':'Known attack replay until first recomputed Black divergence; not a full-game repair proof',
                               'baseline_record':str(args.baseline_record.relative_to(ROOT)),
                               'baseline_json_sha256':hashlib.sha256(args.baseline_record.read_bytes()).hexdigest(),
                               'new_black_nodes':budget,'comparisons':comparisons,
                               'first_divergence':divergence,
                               'old_checkmate_reproduced':divergence is None and board.is_checkmate(),
                               'full_repair_verified':False})

    job = {'id':'24m-'+old['opening'],'opening':old['opening'],
           'white_first_move':first,'challenger_nodes':24_000_000,'ghost_nodes':budget}
    base = json.loads((ROOT/'reference-verification.json').read_text())
    config = {'scope':'Separate native full-game 10m defence candidate; not production activation or Solidity',
              'created_at':utc(),'engine_binary_sha256':base['uci_binary_sha256'],
              'stockfish_commit':base['stockfish_commit'],'nnue_sha256':base['nnue_sha256'],
              'options':OPTIONS,'gh0st_policy':'Black10m, clearTT+histories each decision',
              'challenger_policy':'White24m with retainedTT+histories, never optional draw claim',
              'work_budget_minutes':args.minutes,'jobs':[job],
              'baseline_record':str(args.baseline_record.relative_to(ROOT)),
              'full_repair_verified':False}
    save(out/'config.json',config)
    started = time.monotonic()
    run_game(job,out,started+args.minutes*60,1024)
    print(json.dumps(summary(out,[job],started),indent=2),flush=True)

if __name__ == '__main__': main()
