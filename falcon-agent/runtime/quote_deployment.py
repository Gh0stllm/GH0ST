"""Read-only RH quote for the fully pinned runtime. Never reads a signing key."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from eth_abi import encode,decode
from eth_utils import keccak

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'fourbit-study'))
import deploy as d


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--rpc-url-env',default='GH0ST_RH_RPC_URL');p.add_argument('--output',type=Path,default=ROOT/'prepaid-deployment-quote.json')
    args=p.parse_args()
    pin=json.loads((ROOT/'pinned-runtime.json').read_text());artifact=json.loads((ROOT/'compiled.json').read_text())
    for name,expected in pin['source_sha256'].items():
        assert hashlib.sha256((ROOT.parent/name).read_bytes()).hexdigest()==expected,'Runtime source changed'
    for name in ['prepaid-chat-validation.json','quality-validation.json']:
        result=json.loads((ROOT/name).read_text());assert result['status']=='passed'
        if name=='prepaid-chat-validation.json':
            assert result['compiled_artifact_sha256']==hashlib.sha256((ROOT/'compiled.json').read_bytes()).hexdigest()
            assert result['runtime_keccak256']==pin['runtime_keccak256']
    init=bytes.fromhex(artifact['evm']['bytecode']['object'])+encode(['address','address'],[pin['kernel_address'],pin['index_address']])
    assert hashlib.sha256(init).hexdigest()==pin['creation_sha256']
    state=json.loads((ROOT.parent/'fourbit-study/mainnet/deployment-state.json').read_text());sender=state['sender']
    rpc=d.RPC(os.environ[args.rpc_url_env]);chain=int(rpc('eth_chainId'),16);assert chain==4663
    nonce=int(rpc('eth_getTransactionCount',[sender,'latest']),16)
    pending=int(rpc('eth_getTransactionCount',[sender,'pending']),16);assert nonce==pending
    balance=int(rpc('eth_getBalance',[sender,'latest']),16)
    price=int(rpc('eth_gasPrice'),16);ceiling=d.bump(price)
    call='0x'+(keccak(text='gasEstimateComponents(address,bool,bytes)')[:4]+encode(['address','bool','bytes'],['0x'+'00'*20,True,init])).hex()
    result=rpc('eth_call',[{'from':sender,'to':'0x00000000000000000000000000000000000000c8','data':call},'latest'])
    total,l1,base,l1base=map(int,decode(['uint64','uint64','uint256','uint256'],bytes.fromhex(result[2:])))
    execution=total-l1;limit=d.limits(rpc,False);assert d.bump(execution,300)<=limit
    gas=d.bump(total+max(0,12000000-l1),300)
    size=d.maximum_transaction_size(chain,nonce,gas,ceiling,init);assert size<=95000
    expected_address='0x'+keccak(d.rlp.encode([bytes.fromhex(sender[2:]),nonce]))[-20:].hex()
    inference=json.loads((ROOT/'prepaid-chat-validation.json').read_text())
    # Query the exact candidate code on RH with a temporary state override.
    # This is eth_call only: no deployment, signer, deposit or public inference.
    override={expected_address:{'code':pin['runtime_code']}}
    qdata='0x'+(keccak(text='quote(uint256,uint16,uint256,uint256)')[:4]+encode(
        ['uint256','uint16','uint256','uint256'],[len(inference['prompt_tokens']),inference['max_new_tokens'],ceiling,0])).hex()
    raw=rpc('eth_call',[{'from':sender,'to':expected_address,'data':qdata},'latest',override])
    maximum_units,maximum_billed_gas,budget=map(int,decode(['uint256']*3,bytes.fromhex(raw[2:])))
    fee_data='0x'+keccak(text='getCurrentTxL1GasFees()')[:4].hex()
    fee_raw=rpc('eth_call',[{'from':sender,'to':'0x000000000000000000000000000000000000006c','data':fee_data},'latest'])
    fee_probe=int(decode(['uint256'],bytes.fromhex(fee_raw[2:]))[0])
    probe_address='0x00000000000000000000000000000000deadbeef'
    transient_raw=rpc('eth_call',[{'from':sender,'to':probe_address},'latest',
        {probe_address:{'code':'0x60015f5d5f5c5f5260205ff3'}}])
    assert int(transient_raw,16)==1,'RH transient-storage probe failed'
    report={'status':'unsigned_quote_only','as_of_utc':d.now(),'chain_id':chain,'sender':sender,
            'latest_nonce':nonce,'pending_nonce':pending,'predicted_runtime_address':expected_address,
            'runtime_bytes':pin['runtime_bytes'],'runtime_keccak256':pin['runtime_keccak256'],
            'creation_sha256':pin['creation_sha256'],'conservative_signed_transaction_bytes':size,
            'estimated_total_gas':total,'estimated_execution_gas':execution,'estimated_parent_posting_gas':l1,
            'compute_limit':limit,'signed_gas_limit_with_posting_reserve':gas,
            'market_gas_price_wei':price,'gas_price_ceiling_wei':ceiling,
            'estimated_fee_eth':d.eth(total*price),'maximum_fee_eth':d.eth(gas*ceiling),
            'wallet_balance_eth':d.eth(balance),'reserve_eth':d.eth(2*10**15),
            'suggested_top_up_for_deployment_eth':d.eth(max(0,gas*ceiling+2*10**15-balance)),
            'current_total_contracts_including_pilots':499,'total_after_one_runtime_deployment':500,
            'hi_hello_local_continuation_gas':inference['total_continuation_gas'],
            'hi_hello_local_continuation_transactions':inference['continuation_transactions'],
            'hi_hello_execution_fee_at_snapshot_eth':d.eth(inference['total_continuation_gas']*price),
            'contract_quote_via_read_only_state_override':True,
            'maximum_units':maximum_units,'maximum_billed_gas':maximum_billed_gas,
            'prepaid_budget_eth_with_zero_posting_cap':d.eth(budget),
            'prepaid_quote_kind':'Worst-case refundable maximum; zero posting cap is illustrative and may prevent execution',
            'posting_precompile_read_only_probe_wei':fee_probe,'transient_storage_read_only_probe':True,
            'inference_estimate_excludes_parent_posting':True,'public_transactions_sent':0,
            'runtime_publicly_deployed':False,'frontend_integrated':False,'onchain_text_tokenizer':False,
            'mainnet_spending_paused':True,'status_description':'Research milestone; numerical inference and prepaid accounting validated locally; public deployment paused'}
    d.save(args.output,report)
    print(json.dumps(report),flush=True)


if __name__=='__main__':main()
