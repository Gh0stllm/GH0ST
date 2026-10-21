"""Explicit, single-contract RH deployment. Key is read with a hidden terminal prompt.

Requires a fresh read-only quote and a persistent signed journal. Retries use the
same signed bytes only. Never starts a session or deposits inference escrow.
"""
import argparse
import fcntl
import getpass
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from eth_abi import encode, decode
from eth_account import Account
from eth_utils import keccak

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'fourbit-study'))
import deploy as d


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--quote',type=Path,required=True)
    parser.add_argument('--journal',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--expected-nonce',type=int,required=True)
    parser.add_argument('--maximum-fee-wei',type=int,required=True)
    parser.add_argument('--rpc-url-env',default='GH0ST_RH_RPC_URL')
    parser.add_argument('--broadcast',action='store_true',required=True)
    args=parser.parse_args()
    lock=args.journal.with_suffix('.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    quote=json.loads(args.quote.read_text())
    pin=json.loads((ROOT/'pinned-runtime.json').read_text())
    artifact=json.loads((ROOT/'compiled.json').read_text())
    validation=json.loads((ROOT/'prepaid-chat-validation.json').read_text())
    assert validation['status']=='passed' and validation['runtime_keccak256']==pin['runtime_keccak256']
    assert validation['compiled_artifact_sha256']==hashlib.sha256((ROOT/'compiled.json').read_bytes()).hexdigest()
    for path,expected in pin['source_sha256'].items():
        assert hashlib.sha256((ROOT.parent/path).read_bytes()).hexdigest()==expected
    init=bytes.fromhex(artifact['evm']['bytecode']['object'])+encode(
        ['address','address'],[pin['kernel_address'],pin['index_address']])
    assert hashlib.sha256(init).hexdigest()==quote['creation_sha256']==pin['creation_sha256']
    assert quote['chain_id']==4663 and quote['latest_nonce']==args.expected_nonce
    assert quote['runtime_keccak256']==pin['runtime_keccak256']
    rpc=d.RPC(os.environ[args.rpc_url_env]);assert int(rpc('eth_chainId'),16)==4663
    sender=quote['sender'];target=quote['predicted_runtime_address']
    for address,expected in [(pin['kernel_address'],validation_pin('KERNEL_HASH')),
                             (pin['index_address'],validation_pin('INDEX_HASH'))]:
        assert d.digest(bytes.fromhex(rpc('eth_getCode',[address,'latest'])[2:]))==expected
    if args.journal.exists():
        journal=json.loads(args.journal.read_text())
        assert journal['creation_sha256']==pin['creation_sha256'] and journal['sender']==sender
        assert journal['transaction']['nonce']==args.expected_nonce and journal['chain_id']==4663
        assert journal['maximum_fee_wei']<=args.maximum_fee_wei
    else:
        latest=int(rpc('eth_getTransactionCount',[sender,'latest']),16)
        pending=int(rpc('eth_getTransactionCount',[sender,'pending']),16)
        assert latest==pending==args.expected_nonce,'Unexpected mined or pending transaction; nothing signed'
        assert rpc('eth_getCode',[target,'latest'])=='0x','Predicted address already has code'
        call='0x'+(keccak(text='gasEstimateComponents(address,bool,bytes)')[:4]+encode(
            ['address','bool','bytes'],['0x'+'00'*20,True,init])).hex()
        raw=rpc('eth_call',[{'from':sender,'to':'0x00000000000000000000000000000000000000c8','data':call},'latest'])
        total,posting,_,_=decode(['uint64','uint64','uint256','uint256'],bytes.fromhex(raw[2:]))
        assert d.bump(total-posting,300)<=d.limits(rpc,False)
        gas=d.bump(total+max(0,12000000-posting),300)
        price=quote['gas_price_ceiling_wei']
        assert int(rpc('eth_gasPrice'),16)<=price,'Market exceeds reviewed price ceiling'
        maximum=gas*price
        assert maximum<=args.maximum_fee_wei and maximum<=int(rpc('eth_getBalance',[sender,'latest']),16)-2*10**15
        assert d.maximum_transaction_size(4663,latest,gas,price,init)<=95000
        tx={'chainId':4663,'nonce':latest,'value':0,'gas':gas,'gasPrice':price,'data':'0x'+init.hex()}
        print(json.dumps({'status':'ready_to_sign_one_creation','sender':sender,'predicted_address':target,
            'nonce':latest,'gas_limit':gas,'maximum_fee_eth':d.eth(maximum)}),flush=True)
        key=getpass.getpass('Deployer key (hidden, never saved): ')
        account=Account.from_key(key);del key
        assert account.address.lower()==sender.lower(),'Signer does not match deployer'
        assert int(rpc('eth_getTransactionCount',[sender,'latest']),16)==latest
        assert int(rpc('eth_getTransactionCount',[sender,'pending']),16)==latest
        signed=account.sign_transaction(tx);del account
        signed_raw='0x'+signed.raw_transaction.hex();tx_hash=d.digest(signed.raw_transaction)
        journal={'schema':1,'chain_id':4663,'sender':sender,'predicted_address':target,
            'creation_sha256':pin['creation_sha256'],'runtime_keccak256':pin['runtime_keccak256'],
            'maximum_fee_wei':maximum,'transaction':tx,'hash':tx_hash,'signed_raw':signed_raw,
            'created_at_utc':d.now(),'status':'signed_before_broadcast'}
        d.save(args.journal,journal)
    tx_hash=journal['hash'];assert d.digest(bytes.fromhex(journal['signed_raw'][2:]))==tx_hash
    receipt=rpc('eth_getTransactionReceipt',[tx_hash])
    if receipt is None:
        latest=int(rpc('eth_getTransactionCount',[sender,'latest']),16)
        assert latest<=args.expected_nonce,'Nonce consumed without expected receipt'
        answer=rpc.batch([('eth_sendRawTransaction',[journal['signed_raw']])])[0]
        journal['submission']=answer;journal['status']='submitted';d.save(args.journal,journal)
        if 'result' in answer:assert answer['result'].lower()==tx_hash.lower()
        print(json.dumps({'status':'submitted_one_creation','hash':tx_hash,'submission':answer}),flush=True)
    for _ in range(120):
        receipt=rpc('eth_getTransactionReceipt',[tx_hash])
        if receipt is not None:break
        time.sleep(1)
    assert receipt is not None,'Receipt pending; resume the same journal, never create a new transaction'
    journal['receipt']=receipt;d.save(args.journal,journal)
    assert int(receipt['status'],16)==1,'Deployment reverted; do not retry with a new nonce'
    assert receipt['contractAddress'].lower()==target.lower()
    runtime=bytes.fromhex(rpc('eth_getCode',[target,'latest'])[2:])
    assert runtime==bytes.fromhex(pin['runtime_code'][2:])
    assert d.digest(runtime)==pin['runtime_keccak256'] and len(runtime)==pin['runtime_bytes']
    # Re-read the receipt after code verification to detect a changing block hash.
    assert rpc('eth_getTransactionReceipt',[tx_hash])['blockHash']==receipt['blockHash']
    used=int(receipt['gasUsed'],16);effective=int(receipt['effectiveGasPrice'],16)
    fee=used*effective;assert fee<=journal['maximum_fee_wei']
    def view(signature,types=(),values=(),returns=('uint256',)):
        data='0x'+(keccak(text=signature)[:4]+encode(list(types),list(values))).hex()
        raw=rpc('eth_call',[{'to':target,'data':data},'latest'])
        return decode(list(returns),bytes.fromhex(raw[2:]))
    assert view('kernel()',returns=('address',))[0].lower()==pin['kernel_address'].lower()
    assert view('index()',returns=('address',))[0].lower()==pin['index_address'].lower()
    assert view('nextSession()')[0]==view('totalLiability()')[0]==0
    assert int(rpc('eth_getBalance',[target,'latest']),16)==0
    q=view('quote(uint256,uint16,uint256,uint256)',('uint256','uint16','uint256','uint256'),
           (11,2,quote['market_gas_price_wei'],0),('uint256','uint256','uint256'))
    assert q[0]==26190 and q[1]==811890000000
    report={'status':'deployed_and_byte_for_byte_verified','as_of_utc':d.now(),'chain_id':4663,
        'address':target,'sender':sender,'transaction_hash':tx_hash,'nonce':args.expected_nonce,
        'block_number':int(receipt['blockNumber'],16),'block_hash':receipt['blockHash'],
        'receipt_status':1,'runtime_bytes':len(runtime),'runtime_keccak256':d.digest(runtime),
        'creation_sha256':pin['creation_sha256'],'kernel_address':pin['kernel_address'],'index_address':pin['index_address'],
        'gas_used':used,'parent_posting_gas':int(receipt.get('gasUsedForL1','0x0'),16),
        'effective_gas_price_wei':effective,'fee_wei':fee,'fee_eth':d.eth(fee),
        'maximum_signed_fee_eth':d.eth(journal['maximum_fee_wei']),
        'wallet_balance_eth':d.eth(int(rpc('eth_getBalance',[sender,'latest']),16)),
        'latest_nonce':int(rpc('eth_getTransactionCount',[sender,'latest']),16),
        'pending_nonce':int(rpc('eth_getTransactionCount',[sender,'pending']),16),
        'total_public_contracts_including_pilots':500,'next_session':0,'runtime_balance_wei':0,'total_liability_wei':0,
        'mainnet_chat_started':False,'frontend_integrated':False,'executor_service_operating':False,
        'example_read_only_quote':{'prompt_tokens':11,'max_new_tokens':2,'gas_price_cap_wei':quote['market_gas_price_wei'],
            'posting_fee_cap_wei':0,'maximum_units':q[0],'maximum_billed_execution_gas':q[1],
            'budget_wei':q[2],'budget_eth':d.eth(q[2]),'zero_posting_cap_is_illustrative':True},
        'receipt':receipt,'scope':'Only runtime creation authorized and sent; no inference funding, session or continuation transaction'}
    journal['status']='deployed_and_verified';d.save(args.journal,journal);d.save(args.report,report)
    print(json.dumps({k:v for k,v in report.items()if k!='receipt'}),flush=True)


def validation_pin(name):
    import re
    source=(ROOT/'GH0STRuntime.sol').read_text()
    return re.search(r'\b'+name+r'=(0x[0-9a-f]{64});',source).group(1)


if __name__=='__main__':main()
