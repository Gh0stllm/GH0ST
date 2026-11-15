#!/usr/bin/env python3
"""Native-only per-game cache candidate; original ICP cache policy is unchanged."""
import argparse
import hashlib
import json
import signal
import time
from pathlib import Path
import chess
import chess.engine
from run_matches import ROOT, OPTIONS, BINARY, STOP, save, utc, summary
from cache_policy import run_game_cached

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('baseline_record',type=Path)
    parser.add_argument('--challenger-nodes',type=int,default=12_000_000)
    parser.add_argument('--minutes',type=float,default=45)
    args=parser.parse_args(); path=args.baseline_record.resolve()
    old=json.loads(path.read_text())
    assert old['completed'] and old['result']=='1-0' and old['termination']=='checkmate'
    assert args.challenger_nodes in [12_000_000,24_000_000]
    signal.signal(signal.SIGTERM,lambda *_: STOP.set())
    signal.signal(signal.SIGINT,lambda *_: STOP.set())
    out=ROOT/'results'/f'repair-retained3m-vs{args.challenger_nodes//1_000_000}m-{old["opening"]}'
    out.mkdir(parents=True,exist_ok=True)
    baseline_hash=hashlib.sha256(path.read_bytes()).hexdigest()
    proof=json.loads((ROOT/'reference-verification.json').read_text())
    assert proof['uci_binary_sha256']==hashlib.sha256(BINARY.read_bytes()).hexdigest()
    board=chess.Board(); comparisons=[];divergence=None
    with chess.engine.SimpleEngine.popen_uci(str(BINARY),timeout=180) as engine:
        engine.configure(OPTIONS); game=object()
        for old_move in old['moves']:
            if STOP.is_set(): return
            if board.turn==chess.WHITE:
                move=chess.Move.from_uci(old_move['uci'])
            else:
                response=engine.play(board,chess.engine.Limit(nodes=3_000_000),game=game,info=chess.engine.INFO_ALL)
                assert engine.protocol.game is game
                move=response.move
                row={'ply':len(board.move_stack)+1,'old_move':old_move['uci'],'new_move':move.uci(),
                     'actual_nodes':response.info['nodes'],'depth':response.info['depth'],
                     'cache_policy':'retained_within_this_game'}
                if not comparisons:
                    # Both policies begin with an empty cache; the first response
                    # must reproduce the already recorded clear-cache baseline.
                    assert row['new_move']==old_move['uci']
                    assert row['actual_nodes']==old_move['actual_nodes'] and row['depth']==old_move['depth']
                comparisons.append(row)
                if move.uci()!=old_move['uci']:
                    divergence=row;break
            assert move in board.legal_moves
            board.push(move)
    save(out/'known-line.json',{'scope':'Changed native cache policy replay; not current ICP/Solidity implementation or a full repair proof',
                               'baseline_json_sha256':baseline_hash,'black_nodes':3_000_000,
                               'first_empty_cache_response_exact':True,'comparisons':comparisons,
                               'first_divergence':divergence,
                               'old_checkmate_reproduced':divergence is None and board.is_checkmate(),
                               'full_repair_verified':False})
    job={'id':f'{args.challenger_nodes//1_000_000}m-'+old['opening'],'opening':old['opening'],
         'white_first_move':old['white_first_move'],'challenger_nodes':args.challenger_nodes,'ghost_nodes':3_000_000}
    config={'scope':'Fresh native-only retained-Black-cache candidate; not an implemented ICP/Solidity policy or prize activation',
            'created_at':utc(),'engine_binary_sha256':proof['uci_binary_sha256'],
            'stockfish_commit':proof['stockfish_commit'],'nnue_sha256':proof['nnue_sha256'],
            'options':OPTIONS,'gh0st_policy':'Black3m retains its OWN per-game TT+histories, isolated engine instance per game',
            'challenger_policy':f'White{args.challenger_nodes//1_000_000}m retainedTT+histories, never voluntary draw',
            'uci_cache_control':'Stable game token for each side; no ucinewgame between decisions; fresh engine processes at game start',
            'reference_limit':'Pinned optimized upstream Stockfish binary/math, changed state policy. First empty-cache response matches baseline. No retained-cache ICP equivalence is claimed.',
            'baseline_json_sha256':baseline_hash,'work_budget_minutes':args.minutes,'jobs':[job]}
    save(out/'config.json',config)
    started=time.monotonic()
    run_game_cached(job,out,started+args.minutes*60,1024)
    report=summary(out,[job],started)
    report['scope']='Full native CPU game of a changed retained-cache policy; not ICP/Solidity gameplay or a deployed policy'
    save(out/'summary.json',report)
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__': main()
