"""Read-only Stylus runtime checks; never changes chain parameters or broadcasts."""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from eth_utils import keccak

ROOT = Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'contract-benchmark'))
from simulate_robinhood import rpc


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--rpc',default='https://rpc.mainnet.chain.robinhood.com')
    parser.add_argument('--chain-id',type=int,default=4663)
    parser.add_argument('--output',type=Path,default=ROOT.parent/'results/stylus-runtime.json')
    args=parser.parse_args()
    chain=int(rpc(args.rpc,'eth_chainId',[]),16)
    if chain!=args.chain_id:raise ValueError(f'Unexpected chain ID: {chain}')
    block=rpc(args.rpc,'eth_getBlockByNumber',['latest',False])
    signatures=['stylusVersion()','inkPrice()','pageLimit()','activationGas()','expiryDays()']
    def probe(signature):
        try:
            raw=rpc(args.rpc,'eth_call',[{'to':'0x0000000000000000000000000000000000000071',
                'data':'0x'+keccak(text=signature)[:4].hex()},block['number']])
            return signature,{'value':int(raw,16),'raw':raw}
        except (RuntimeError,OSError,ValueError) as error:
            return signature,{'error':str(error)}
    with ThreadPoolExecutor(max_workers=3) as pool:
        values=dict(pool.map(probe,signatures))
    charge=values.get('activationGas()',{}).get('value')
    pages=values.get('pageLimit()',{}).get('value')
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'chain_id':chain,
        'block_number':int(block['number'],16),'block_hash':block['hash'],
        'precompile':'0x0000000000000000000000000000000000000071','runtime_values':values,
        'transactions_broadcast':0,'memory_limit_bytes':None if pages is None else pages*65536,
        'new_activations_appear_paused':None if charge is None else charge>30_000_000,
        'pause_detection':'Same >30,000,000 activationGas heuristic as official stylus-tools 0.10.10; this reads state and does not override chain parameters.',
        'activation_attempted':False,
        'source':'https://github.com/OffchainLabs/stylus-sdk-rs/blob/v0.10.10/stylus-tools/src/core/activation.rs'}
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__':main()
