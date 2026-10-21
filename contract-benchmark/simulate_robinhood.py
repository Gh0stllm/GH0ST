"""Read-only Robinhood RPC simulation with temporary code/state overrides.

No private key, signing, wallet or broadcast method exists in this script.
An eth_call is a node simulation, not a consensus-recorded transaction.
"""
import argparse
import json
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from eth_abi import decode

ROOT = Path(__file__).resolve().parent
READ_METHODS = {'eth_chainId','eth_getBlockByNumber','eth_gasPrice','eth_call','eth_estimateGas'}


def rpc(endpoint, method, params):
    if method not in READ_METHODS:
        raise ValueError('Only read-only RPC methods are permitted')
    request = urllib.request.Request(endpoint, data=json.dumps({'jsonrpc':'2.0','id':1,
        'method':method,'params':params}).encode(), headers={'Content-Type':'application/json',
        'User-Agent':'OnchainLFM-preflight/0.1'})
    with urllib.request.urlopen(request,timeout=30) as response:
        data = json.load(response)
    if 'error' in data:
        raise RuntimeError(str(data['error']))
    return data['result']


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--rpc',default='https://rpc.mainnet.chain.robinhood.com')
    args=parser.parse_args()
    data=json.loads((ROOT/'simulation-input.json').read_text())
    chain=int(rpc(args.rpc,'eth_chainId',[]),16)
    if chain != 4663:
        raise ValueError(f'Unexpected chain ID {chain}; expected 4663')
    block=rpc(args.rpc,'eth_getBlockByNumber',['latest',False])
    tag=block['number']
    price=int(rpc(args.rpc,'eth_gasPrice',[]),16)
    override={data['kernel_address']:{'code':data['kernel_runtime'],'state':{}},
        data['shard_address']:{'code':data['shard_runtime']},
        data['sender']:{'balance':hex(10**22)}}
    report={'status':'rpc_simulation_only','checked_at':datetime.now(timezone.utc).isoformat(),
        'chain_id':chain,'block_number':int(tag,16),'block_hash':block['hash'],
        'gas_price_wei':price,'transactions_broadcast':0,'contracts_deployed_on_robinhood':0,
        'temporary_code_and_state_overrides':True,'stylus_activation_verified':False,
        'calls':{},'estimates':{},
        'limitations':['eth_call and eth_estimateGas do not persist computation or deploy contracts.',
            'Code and sender funding are supplied only as temporary simulation overrides.',
            'Estimated fees are snapshots, not actual paid receipts or guaranteed future costs.',
            'A four-row integer projection is not a full LFM block, token or chat reply.']}
    output=ROOT.parent/'results'/'contract-robinhood-simulation.json'
    def save():
        output.write_text(json.dumps(report,indent=2)+'\n')
    for name,key in [('dot','dot_call_data'),('commit','commit_call_data')]:
        tx={'from':data['sender'],'to':data['kernel_address'],'data':data[key],'gas':hex(15_000_000)}
        try:
            returned=rpc(args.rpc,'eth_call',[tx,tag,override])
            if name=='dot':
                values=list(decode(['int256[]'],bytes.fromhex(returned[2:]))[0])
                matches=values==data['expected_outputs']
                report['calls'][name]={'outputs':values,'matches_reference':matches}
            else:
                matches=returned.lower()==data['expected_commitment_hex'].lower()
                report['calls'][name]={'commitment':returned,'matches_reference':matches}
            if not matches:
                save()
                raise AssertionError(f'{name} output does not match integer reference')
        except (RuntimeError, OSError) as error:
            report['calls'][name]={'error':str(error),'matches_reference':None}
        save()
        print(json.dumps({'call':name,**report['calls'][name]}),flush=True)
    requests={
        'kernel_deployment':{'from':data['sender'],'data':data['kernel_creation_data']},
        'weight_shard_deployment':{'from':data['sender'],'data':data['shard_creation_data']},
        'four_row_dot':{'from':data['sender'],'to':data['kernel_address'],'data':data['dot_call_data']},
        'four_row_dot_and_first_commit':{'from':data['sender'],'to':data['kernel_address'],'data':data['commit_call_data']}}
    for name,tx in requests.items():
        try:
            gas=int(rpc(args.rpc,'eth_estimateGas',[tx,tag,override]),16)
            report['estimates'][name]={'gas_estimate':gas,'fee_at_quoted_gas_price_wei':gas*price,
                'fee_at_quoted_gas_price_eth':str(Decimal(gas*price)/Decimal(10**18))}
        except (RuntimeError,OSError) as error:
            report['estimates'][name]={'error':str(error),'gas_estimate':None}
        save()
        print(json.dumps({'estimate':name,**report['estimates'][name]}),flush=True)


if __name__=='__main__':
    main()
