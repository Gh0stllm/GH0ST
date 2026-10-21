"""Loopback-only complete inference against a mirror of all deployed code.

No real RPC URL or signing key is accepted. Code is restored locally at the
recorded mainnet addresses from verified weight/kernel/index artifacts.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

from eth_abi import encode, decode
from eth_utils import keccak

ROOT=Path(__file__).resolve().parent
STUDY=ROOT.parent/'fourbit-study'
sys.path.insert(0,str(STUDY))
from local import EVM,index_blob
import deploy as d


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--weights',type=Path,required=True)
    p.add_argument('--anvil',type=Path,required=True)
    p.add_argument('--trace',type=Path,required=True)
    p.add_argument('--progress',type=Path,required=True)
    p.add_argument('--port',type=int,default=18721)
    p.add_argument('--report',type=Path,default=ROOT/'prepaid-chat-validation.json')
    p.add_argument('--max-transactions',type=int,default=3000)
    args=p.parse_args()
    golden=json.loads(args.trace.read_text())
    assert golden['status']=='passed'
    artifact=json.loads((ROOT/'compiled.json').read_text())
    deployment=json.loads((STUDY/'mainnet/deployment-state.json').read_text())
    rows={r['name']:r for r in deployment['receipts']}
    data=args.weights.read_bytes()
    assert hashlib.sha256(data).hexdigest()==d.PIN
    addresses=[rows[f'fourbit-weights-{i:04d}']['address']for i in range(495)]
    kernel=rows['FourBitAffine64']['address']
    index=rows['FourBitWeightIndex']['address']
    evm=EVM(args.anvil.resolve(),port=args.port)
    started=time.monotonic()
    report={'status':'running','scope':'Local prepaid escrow and complete 24-layer fixed-point inference; mocked posting-fee precompile',
            'public_rpc_calls':0,'public_transactions_sent':0,'additional_public_contracts':0,
            'additional_runtime_contracts_required':1,'runtime_bytes':len(artifact['evm']['deployedBytecode']['object'])//2,
            'prompt_tokens':golden['prompt_tokens'],'max_new_tokens':len(golden['generated_tokens']),
            'transactions':[],'layers_verified':0,'generated_tokens':[],'checks':[],
            'reference_trace_sha256':hashlib.sha256(args.trace.read_bytes()).hexdigest(),
            'compiled_artifact_sha256':hashlib.sha256((ROOT/'compiled.json').read_bytes()).hexdigest(),
            'billed_units':0,'executor_credit_wei':0}

    def save():
        report['elapsed_seconds']=time.monotonic()-started
        d.save(args.progress,report)

    def payload(signature,types,values):
        return '0x'+(keccak(text=signature)[:4]+encode(types,values)).hex()

    def view(signature,types,values,returns):
        raw=evm.rpc('eth_call',[{'to':target,'data':payload(signature,types,values)},'latest'])
        return decode(returns,bytes.fromhex(raw[2:]))

    def status():
        raw=evm.rpc('eth_call',[{'to':target,'data':payload('status(uint256)',['uint256'],[session_id])},'latest'])
        return decode(['address','uint256','uint256','uint256','uint256','uint256','uint32[]'],bytes.fromhex(raw[2:]))

    def budget(id):
        return view('budgets(uint256)',['uint256'],[id],['address','address']+['uint256']*5)

    def credit(account):
        return view('credits(address)',['address'],[account],['uint256'])[0]

    def quote(prompt_length,outputs):
        return view('quote(uint256,uint16,uint256,uint256)',
                    ['uint256','uint16','uint256','uint256'],[prompt_length,outputs,price,posting_cap],['uint256']*3)

    def start_call(tokens,outputs,executor):
        value=quote(len(tokens),outputs)[2]
        return {'from':evm.account,'to':target,'gasPrice':hex(price),'value':hex(value),
            'data':payload('startPrepaid(uint32[],uint16,address,uint256,uint256,uint256)',
            ['uint32[]','uint16','address','uint256','uint256','uint256'],
            [tokens,outputs,executor,price,posting_cap,value])}

    def mock_posting(fee):
        evm.rpc('anvil_setCode',['0x000000000000000000000000000000000000006c',
            '0x7f'+fee.to_bytes(32,'big').hex()+'5f5260205ff3'])

    def reject(name,call):
        rejected=False
        try:evm.rpc('eth_call',[call,'latest'])
        except RuntimeError:rejected=True
        assert rejected,name
        report['checks'].append(name)

    try:
        for i,address in enumerate(addresses):
            runtime=b'\0'+data[i*98303:(i+1)*98303]
            assert d.digest(runtime)==rows[f'fourbit-weights-{i:04d}']['runtime_keccak256']
            evm.rpc('anvil_setCode',[address,'0x'+runtime.hex()])
        code=json.loads((STUDY/'compiled-1000000.json').read_text())['contracts']['FourBitAffine64']['evm']['deployedBytecode']['object']
        assert d.digest(bytes.fromhex(code))==d.KERNEL_PIN
        evm.rpc('anvil_setCode',[kernel,'0x'+code])
        code=b'\0'+index_blob(data,addresses,98303)
        assert d.digest(code)==rows['FourBitWeightIndex']['runtime_keccak256']
        evm.rpc('anvil_setCode',[index,'0x'+code.hex()])
        report['mirrored_weight_contracts']=495
        target,gas=evm.deploy(bytes.fromhex(artifact['evm']['bytecode']['object'])+encode(['address','address'],[kernel,index]))
        report.update(local_runtime_address=target,local_deployment_gas=gas)
        report['runtime_keccak256']=d.digest(bytes.fromhex(evm.rpc('eth_getCode',[target,'latest'])[2:]))
        assert len(bytes.fromhex(evm.rpc('eth_getCode',[target,'latest'])[2:]))==report['runtime_bytes']
        report['checks'].append('Single runtime deploys locally with the actual pinned kernel and index')
        price=21088000;posting_cap=100000
        account2=evm.rpc('eth_accounts')[1]
        for prompt_length in range(1,64):
            for outputs in range(1,65-prompt_length):
                units,gascap,value=quote(prompt_length,outputs)
                assert units==(prompt_length+outputs-1)*2161+outputs*129
                assert gascap==units*31000000 and value==gascap*price+units*posting_cap
        report['checks'].append('All 2016 valid context/maximum-output combinations match independent work and escrow bounds')
        reject('Out-of-vocabulary prompt is rejected',start_call([32768],1,account2))
        reject('Context limit is enforced',{'from':evm.account,'to':target,'data':payload(
            'quote(uint256,uint16,uint256,uint256)',['uint256','uint16','uint256','uint256'],[64,1,price,posting_cap])})
        call=start_call([1],1,account2)
        reject('Underfunded start is rejected',{**call,'value':hex(int(call['value'],16)-1)})
        reject('Overpayment is rejected',{**call,'value':hex(int(call['value'],16)+1)})
        bad={**call,'data':payload('startPrepaid(uint32[],uint16,address,uint256,uint256,uint256)',
            ['uint32[]','uint16','address','uint256','uint256','uint256'],[[1],1,account2,price,posting_cap,1])}
        reject('Stale expected budget is rejected',bad)
        reject('Plain ETH transfers are rejected',{'from':evm.account,'to':target,'value':'0x1'})
        reject('Unfunded legacy start cannot bypass escrow',{'from':evm.account,'to':target,
            'data':payload('start(uint32[],uint16)',['uint32[]','uint16'],[[1],1])})
        evm.tx(call)
        advance0={'from':account2,'to':target,'gasPrice':hex(price),
                  'data':payload('advancePrepaid(uint256,uint256)',['uint256','uint256'],[0,1])}
        reject('Absent posting-fee precompile fails closed',advance0)
        mock_posting(posting_cap+1)
        reject('Posting fee above requester cap is rejected',advance0)
        mock_posting(1234)
        reject('Gas price above requester cap is rejected',{**advance0,'gasPrice':hex(price+1)})
        reject('Only chosen executor can advance', {**advance0,'from':evm.account})
        reject('Only requester can cancel',{'from':account2,'to':target,'data':payload('cancel(uint256)',['uint256'],[0])})
        reject('Only requester can replace executor',{'from':account2,'to':target,'data':payload(
            'setExecutor(uint256,address)',['uint256','address'],[0,account2])})
        assert budget(0)[5]==int(call['value'],16) and credit(account2)==0
        receipt=evm.tx(advance0)
        assert budget(0)[4]==quote(1,1)[0]-1 and budget(0)[6]>0
        assert credit(account2)==budget(0)[6]
        assert credit(account2)+budget(0)[5]==int(call['value'],16)
        report['checks'].append('Real embedding work earns bounded executor credit with an explicit posting fee')
        # Payment failure must restore credit. The recipient always reverts.
        rejecting='0x00000000000000000000000000000000deadbeef'
        evm.rpc('anvil_setCode',[rejecting,'0x5f5ffd'])
        reject('Failed refund recipient preserves withdrawal credit',{'from':account2,'to':target,
            'data':payload('withdraw(address)',['address'],[rejecting])})
        paid=credit(account2)
        evm.tx({'from':account2,'to':target,'data':payload('withdraw(address)',['address'],[account2])})
        assert credit(account2)==0
        evm.tx({'to':target,'data':payload('cancel(uint256)',['uint256'],[0])})
        assert credit(evm.account)==int(call['value'],16)-paid and budget(0)[4:6]==(0,0)
        evm.tx({'to':target,'data':payload('withdraw(address)',['address'],[evm.account])})
        assert view('totalLiability()',[],[],['uint256'])[0]==0
        report['checks'].append('Cancellation refunds unused escrow and both parties can withdraw exactly their credits')
        # Contract executor: prevent two posting reimbursements in one tx, and
        # reject reentrant withdrawal even when the recipient is the executor.
        probe=json.loads((ROOT/'tests/compiled.json').read_text())
        probe_address,_=evm.deploy(bytes.fromhex(probe['evm']['bytecode']['object']))
        evm.tx(start_call([1],1,probe_address));evm.tx(start_call([1],1,probe_address))
        evm.tx({'to':probe_address,'gasPrice':hex(price),'data':payload(
            'doubleAdvance(address,uint256,uint256)',['address','uint256','uint256'],[target,1,2])})
        assert budget(1)[6]>0 and budget(2)[6]==0
        raw=evm.rpc('eth_call',[{'to':probe_address,'data':payload('secondCallRejected()',[],[])},'latest'])
        assert decode(['bool'],bytes.fromhex(raw[2:]))[0]
        evm.tx({'to':probe_address,'data':payload('takeCredit()',[],[])})
        raw=evm.rpc('eth_call',[{'to':probe_address,'data':payload('reentryRejected()',[],[])},'latest'])
        assert decode(['bool'],bytes.fromhex(raw[2:]))[0] and credit(probe_address)==0
        report['checks']+=['One paid continuation per transaction prevents duplicate full-transaction posting reimbursement',
                           'Reentrant withdrawal is rejected and contract executors can withdraw']
        for id in [1,2]:evm.tx({'to':target,'data':payload('cancel(uint256)',['uint256'],[id])})
        evm.tx({'to':target,'data':payload('withdraw(address)',['address'],[evm.account])})
        assert view('totalLiability()',[],[],['uint256'])[0]==0
        mock_posting(0)
        session_id=3
        maximum_units,maximum_gas,prepaid=quote(len(golden['prompt_tokens']),len(golden['generated_tokens']))
        report.update(maximum_units=maximum_units,maximum_billed_gas=maximum_gas,upfront_escrow_wei=prepaid,
                      simulated_gas_price_wei=price,posting_fee_cap_wei=posting_cap,
                      posting_precompile='Explicit local mock; no claim of live RH fee behavior')
        receipt=evm.tx(start_call(golden['prompt_tokens'],len(golden['generated_tokens']),account2))
        report['session_start_gas']=int(receipt['gasUsed'],16)
        # A stalled executor can be replaced without a new session or deposit.
        evm.tx({'to':target,'data':payload('setExecutor(uint256,address)',['uint256','address'],[session_id,evm.account])})
        evm.tx({'to':target,'data':payload('setExecutor(uint256,address)',['uint256','address'],[session_id,account2])})
        report['checks'].append('Requester can replace an executor without changing budget or inference state')
        event_layer='0x'+keccak(text='LayerComputed(uint256,uint256,uint256,bytes32)').hex()
        event_token='0x'+keccak(text='Token(uint256,uint256,uint32)').hex()
        event_charge='0x'+keccak(text='Charged(uint256,address,uint256,uint256,uint256,uint256,uint256)').hex()
        seen=set()
        save()
        for tx in range(args.max_transactions):
            before=status()
            if before[3]==255:break
            call={'from':account2,'to':target,'gasPrice':hex(price),
                  'data':payload('advancePrepaid(uint256,uint256)',['uint256','uint256'],[session_id,256])}
            receipt=evm.tx(call)
            after=status()
            assert before[1:5]!=after[1:5]or len(before[6])!=len(after[6]),'No progress'
            used=int(receipt['gasUsed'],16)
            assert used<=31000000
            report['transactions'].append({'index':tx,'gas':used,'before':list(before[1:5]),'after':list(after[1:5])})
            for log in receipt['logs']:
                if log['topics'][0]==event_layer:
                    position,layer,actual=decode(['uint256','uint256','bytes32'],bytes.fromhex(log['data'][2:]))
                    expected=keccak(encode(['int256[]'],[golden['traces'][position]['layers'][layer]]))
                    if actual!=expected:
                        report.update(status='checkpoint_mismatch',mismatch_position=position,mismatch_layer=layer,
                                      actual_hash='0x'+actual.hex(),expected_hash='0x'+expected.hex())
                        save();raise AssertionError(f'Layer mismatch at position{position}, layer{layer}')
                    assert (position,layer)not in seen
                    seen.add((position,layer));report['layers_verified']+=1
                elif log['topics'][0]==event_token:
                    sequence,token=decode(['uint256','uint32'],bytes.fromhex(log['data'][2:]))
                    assert token==golden['generated_tokens'][sequence]
                    report['generated_tokens'].append(token)
                elif log['topics'][0]==event_charge:
                    units,billed,posting,payment,remaining=decode(['uint256']*5,bytes.fromhex(log['data'][2:]))
                    assert 0<units<=256 and billed<=31000000 and posting==0 and payment==billed*price
                    report['billed_units']+=units;report['executor_credit_wei']+=payment
            if tx%5==0 or before[1]!=after[1]or after[3]==255:
                save();print(json.dumps({'transactions':tx+1,'position':after[1],'layer':after[2],
                    'phase':after[3],'layers_verified':report['layers_verified'],
                    'generated_tokens':report['generated_tokens'],'gas':sum(r['gas']for r in report['transactions'])}),flush=True)
        else:raise AssertionError('Inference exceeded bounded test transaction budget')
        assert report['generated_tokens']==golden['generated_tokens']
        assert report['layers_verified']==24*len(golden['traces'])
        reject('Finished session cannot execute more inference',{'from':account2,'to':target,'data':payload('advancePrepaid(uint256,uint256)',['uint256','uint256'],[session_id,256])})
        assert report['billed_units']<=maximum_units
        if 11 not in report['generated_tokens']:assert report['billed_units']==maximum_units
        assert credit(account2)==report['executor_credit_wei']
        refund=credit(evm.account)
        assert credit(account2)+refund==prepaid and budget(session_id)[5]==0
        assert int(evm.rpc('eth_getBalance',[target,'latest']),16)==prepaid
        assert view('totalLiability()',[],[],['uint256'])[0]==prepaid
        report['refund_credit_wei']=refund
        for account in [account2,evm.account]:
            evm.tx({'from':account,'to':target,'data':payload('withdraw(address)',['address'],[account])})
        assert view('totalLiability()',[],[],['uint256'])[0]==0
        assert int(evm.rpc('eth_getBalance',[target,'latest']),16)==0
        report['checks']+=['Complete inference uses no top-ups; all successful work stays within the on-chain unit and fee bounds',
                           'Completion credits exact unused balance; executor and requester withdrawals leave zero liabilities and zero balance']
        report['checks']+=['All 24-layer Q32 checkpoint hashes match the independent reference at every processed position',
                           'Generated token IDs match the independently validated float32 reference tokens',
                           'Every continuation stays within the local 32-million computation cap']
        report.update(status='passed',total_continuation_gas=sum(r['gas']for r in report['transactions']),
                      continuation_transactions=len(report['transactions']),
                      largest_continuation_gas=max(r['gas']for r in report['transactions']),
                      checkpoints_verified=len(seen),weights_sha256=d.PIN,
                      limitations=['64 total prompt and generated tokens; greedy token IDs only',
                                   'Q32/int16 approximation needs broader quality evaluation',
                                   'Local gas excludes RH parent posting and live storage pricing effects',
                                   'Prepaid quote is a conservative fee ceiling, not exact future network gas; it does not guarantee executor availability or completion',
                                   'Executor billing uses measured in-contract gas plus 120000 allowance; it is not exact receipt reimbursement',
                                   'Start, cancel, executor change and withdrawal wallet fees are separate; failed calls are not reimbursed',
                                   'No production deployment, frontend integration, on-chain text tokenizer or agent actions'])
        save();d.save(args.report,report)
        print(json.dumps({k:v for k,v in report.items()if k!='transactions'}),flush=True)
    except Exception as error:
        if report['status']=='running':report['status']='failed'
        report['error']=str(error)[:200];save();raise
    finally:evm.close()


if __name__=='__main__':main()
