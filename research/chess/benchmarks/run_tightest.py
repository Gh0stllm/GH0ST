#!/usr/bin/env python3
"""New 24m retained-cache strength reference, isolated from prior experiments.

No funding, public deployment or source change to an existing engine/canister.
By default there is no work-time adjudication. Only legal terminal outcomes count;
an explicit stop or resource/error condition remains unfinished.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import argparse
import hashlib
import json
import signal
import time
from run_matches import ROOT, OPTIONS, BINARY, STOP, save, utc, summary
from cache_policy import run_game_cached

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--openings',default='larsen,king-pawn')
    parser.add_argument('--workers',type=int,default=2)
    parser.add_argument('--run-id',default='retained24m-vs48m')
    args=parser.parse_args()
    selected=args.openings.split(',')
    choices={'larsen':'b2b3','king-pawn':'e2e4','queen-pawn':'d2d4','english':'c2c4'}
    assert 1 <= args.workers <= 2 and selected and len(set(selected))==len(selected)
    assert all(x in choices for x in selected)
    signal.signal(signal.SIGTERM,lambda *_: STOP.set())
    signal.signal(signal.SIGINT,lambda *_: STOP.set())
    proof=json.loads((ROOT/'reference-verification.json').read_text())
    assert proof['passed'] and proof['uci_binary_sha256']==hashlib.sha256(BINARY.read_bytes()).hexdigest()
    out=ROOT/'results'/args.run_id
    out.mkdir(parents=True,exist_ok=True)
    if (out/'config.json').exists():
        raise RuntimeError('Existing run folder: choose a new run ID; prior evidence is never overwritten')
    jobs=[{'id':'48m-'+name,'opening':name,'white_first_move':choices[name],
           'challenger_nodes':48_000_000,'ghost_nodes':24_000_000} for name in selected]
    config={'scope':'New native CPU full-game retained-cache strength reference; no ICP full game, Solidity search, deployment or paid activation',
            'created_at':utc(),'policy_version':'GH0ST_NATIVE_RETAINED_TT_24M_V1',
            'engine_binary_sha256':proof['uci_binary_sha256'],
            'stockfish_commit':proof['stockfish_commit'],'nnue_sha256':proof['nnue_sha256'],
            'options':OPTIONS,'gh0st_policy':'Black24m retains its own TT and histories within one isolated game',
            'challenger_policy':'White48m retains its own TT and histories, never elects an optional draw',
            'opening_policy':'Standard initial board. Only the disclosed first White move is forced. No Black move is forced.',
            'draw_policy':'Black claims current threefold/50move; mandatory fivefold/75move and insufficient material/stalemate remain; checkmate has precedence.',
            'uci_cache_control':'One stable game token per colour; fresh engine processes per game; no per-turn Hash/Threads/NumaPolicy changes',
            'termination_policy':'Complete legal games only. Explicit operator stop, error or1024ply ceiling is unfinished, never a draw.',
            'wall_time_limit_minutes':None,'max_plies':1024,'workers':args.workers,
            'native_policy_source_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
                                          for name in ['run_tightest.py','cache_policy.py','run_matches.py']},
            'deployed_icp_module':None,'deployed_solidity_engine':None,
            'reference_limit':'Same pinned native Stockfish code/network as prior proxy checks, new larger node budget. No full-game ICP parity or rating is inferred.',
            'jobs':jobs}
    save(out/'config.json',config)
    started=time.monotonic()
    def report():
        data=summary(out,jobs,started)
        data['scope']='Full native CPU games of the new24m retained-cache policy; not ICP/Solidity full games, public win probabilities or paid execution'
        save(out/'summary.json',data)
        return data
    report()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures=[pool.submit(run_game_cached,job,out,float('inf'),1024) for job in jobs]
        for future in as_completed(futures):
            future.result()
            print(json.dumps(report(),indent=2),flush=True)
    print(json.dumps(report(),indent=2),flush=True)

if __name__=='__main__': main()
