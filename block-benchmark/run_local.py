"""Deploy and execute only on a disposable child Anvil at loopback, chain 31337.

All accounts/funding belong to that local simulator. No public transaction method
or public endpoint is accepted. Every arithmetic step is checked against Python.
"""
import argparse
import gzip
import hashlib
import json
import math
import random
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import requests
from eth_abi import encode, decode
from eth_utils import keccak, to_checksum_address
from reference import Q, pack, unpack, silu

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT.parent/'results'
STEP = '0x'+keccak(text='step()')[:4].hex()


def data(sig,types=(),values=()):
    return '0x'+(keccak(text=sig)[:4]+encode(types,values)).hex()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--anvil',required=True,type=Path)
    parser.add_argument('--variant',choices=['scalar','swar','swar6','optimized','compiled'],default='scalar')
    parser.add_argument('--batch-size',type=int,choices=[1,2,4,8],default=1)
    parser.add_argument('--port',type=int,default=18545)
    args=parser.parse_args()
    manifest=json.loads((ROOT/'manifest.json').read_text())
    if args.batch_size != 1 and args.variant not in ['optimized','compiled']:parser.error('Batching requires optimized variant')
    contract_name={'scalar':'LfmBlock','swar':'LfmBlockSwar','swar6':'LfmBlockSwar6','optimized':'LfmBlockOptimized','compiled':'LfmBlockCodeweights'}[args.variant]
    compiled=json.loads((ROOT/'compiled.json').read_text())['contracts'][contract_name]
    suffix='' if args.variant=='scalar' else '-'+args.variant
    if args.variant in ['optimized','compiled']:suffix+='-batch'+str(args.batch_size)
    result_name='block'+suffix+'-local.json'
    cases_name='simulation-cases'+suffix+'.json.gz'
    shard_code=json.loads((ROOT.parent/'contract-benchmark'/'compiled.json').read_text())['contracts']['WeightShard']['evm']['bytecode']['object']
    session=requests.Session();session.trust_env=False
    child=subprocess.Popen([str(args.anvil.resolve()),'--host','127.0.0.1','--port',str(args.port),
        '--chain-id','31337','--hardfork','cancun','--gas-limit','16777216','--silent'],
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    url=f'http://127.0.0.1:{args.port}'

    def rpc(method,params=()):
        assert url==f'http://127.0.0.1:{args.port}'
        res=session.post(url,json={'jsonrpc':'2.0','id':1,'method':method,'params':list(params)},timeout=120).json()
        if 'error' in res:raise RuntimeError(str(res['error']))
        return res['result']

    report={'started_at':datetime.now(timezone.utc).isoformat(),'environment':'disposable local Anvil, Cancun EVM',
        'anvil_version':subprocess.check_output([str(args.anvil.resolve()),'--version'],text=True).strip(),
        'variant':args.variant,'batch_size':args.batch_size,'public_transactions_broadcast':0,'public_eth_spent':'0','deployments':[],'tokens':[],'checks':[],
        'status':'running','limitations':['Local receipt totals are not mainnet receipts.',
            'Layer zero at three sequence positions is not a full model token or chat reply.',
            'Q16/int4 output is approximate relative to float32; integer reference agreement does not establish model quality.']}
    cases=[]

    def save():
        (RESULTS/result_name).write_text(json.dumps(report,indent=2)+'\n')
        (ROOT/cases_name).write_bytes(gzip.compress(json.dumps(cases,separators=(',',':')).encode(),mtime=0))

    try:
        for _ in range(100):
            try:
                if int(rpc('eth_chainId'),16)==31337:break
                raise ValueError('Wrong local chain')
            except requests.ConnectionError:time.sleep(.05)
        else:raise RuntimeError('Anvil did not start')
        accounts=rpc('eth_accounts');sender=accounts[0];other=accounts[1]

        def submit(tx):
            tx={'from':sender,'gas':'0xf00000','gasPrice':hex(10**9),**tx}
            h=rpc('eth_sendTransaction',[tx])
            for _ in range(1000):
                receipt=rpc('eth_getTransactionReceipt',[h])
                if receipt is not None:break
                time.sleep(.01)
            if receipt is None or int(receipt['status'],16)!=1:raise RuntimeError(f'Local transaction failed: {h}, {receipt}')
            return receipt

        addresses=[]
        for i,item in enumerate(manifest['shards']):
            payload=(ROOT/'data'/item['file']).read_bytes()
            assert hashlib.sha256(payload).hexdigest()==item['sha256']
            creation='0x'+shard_code+encode(['bytes'],[payload]).hex()
            receipt=submit({'data':creation})
            addresses.append(to_checksum_address(receipt['contractAddress']))
            report['deployments'].append({'kind':'shard','index':i,'address':addresses[-1],
                'payload_bytes':len(payload),'creation_bytes':(len(creation)-2)//2,
                'local_gas_used':int(receipt['gasUsed'],16)})
            if (i+1)%64==0:print(json.dumps({'deployed_local_shards':i+1}),flush=True)
        books=[];program_addresses=[];program_manifest=None
        if args.variant=='compiled':
            from compiled_weights import creation as program_creation
            program_manifest=json.loads((ROOT/'compiled-weight-manifest.json').read_text())
            for i,item in enumerate(program_manifest['programs']):
                runtime=(ROOT/'compiled-weight-data'/item['file']).read_bytes()
                assert hashlib.sha256(runtime).hexdigest()==item['sha256']
                assert '0x'+keccak(runtime).hex()==item['codehash']
                receipt=submit({'data':'0x'+program_creation(runtime).hex()})
                target=to_checksum_address(receipt['contractAddress']);program_addresses.append(target)
                report['deployments'].append({'kind':'weight_program','index':i,'address':target,
                    'runtime_bytes':len(runtime),'local_gas_used':int(receipt['gasUsed'],16)})
                if (i+1)%512==0:print(json.dumps({'deployed_local_weight_programs':i+1}),flush=True)
            for start in range(0,len(program_addresses),400):
                payload=b''.join(bytes.fromhex(a[2:])+bytes.fromhex(item['codehash'][2:]) for a,item in
                    zip(program_addresses[start:start+400],program_manifest['programs'][start:start+400]))
                receipt=submit({'data':'0x'+shard_code+encode(['bytes'],[payload]).hex()})
                target=to_checksum_address(receipt['contractAddress']);books.append(target)
                report['deployments'].append({'kind':'program_book','index':len(books)-1,'address':target,
                    'payload_bytes':len(payload),'local_gas_used':int(receipt['gasUsed'],16)})
            report['program_runtime_bytes']=program_manifest['total_runtime_bytes']
        constructor_args=encode(['address[]','address[]'],[addresses,books]) if books else encode(['address[]'],[addresses])
        creation='0x'+compiled['evm']['bytecode']['object']+constructor_args.hex()
        receipt=submit({'data':creation});engine=to_checksum_address(receipt['contractAddress'])
        report['deployments'].append({'kind':'engine','address':engine,'creation_bytes':(len(creation)-2)//2,
            'local_gas_used':int(receipt['gasUsed'],16)})
        report['engine']=engine;report['local_sender']=sender
        print(json.dumps({'local_engine':engine,'deployment_gas':report['deployments'][-1]['local_gas_used']}),flush=True)

        def call(sig,types=(),values=(),returns=(),caller=sender):
            raw=rpc('eth_call',[{'from':caller,'to':engine,'data':data(sig,types,values)},'latest'])
            return decode(returns,bytes.fromhex(raw[2:])) if returns else raw

        def reject(label,sig,types=(),values=(),caller=sender):
            try:call(sig,types,values,caller=caller)
            except RuntimeError:report['checks'].append({'name':label,'passed':True})
            else:raise AssertionError(label+' did not revert')

        reject('step before begin','step()')
        reject('unauthorized begin','begin(bytes)',['bytes'],[bytes(4096)],caller=other)
        reject('bad input length','begin(bytes)',['bytes'],[b''])
        if args.variant in ['optimized','compiled']:
            reject('batch before begin','advance(uint256)',['uint256'],[1])
            reject('empty batch rejected','advance(uint256)',['uint256'],[0])
            reject('oversized batch rejected','advance(uint256)',['uint256'],[9])
        for x in [0,1,2,3,4,15,16,17,2**64-1,2**255-1]:
            assert call('integerSqrt(uint256)',['uint256'],[x],['uint256'])[0]==math.isqrt(x),f'integer sqrt failed at {x}'
        report['checks'].append({'name':'integer square root boundaries','cases':10,'passed':True})
        lut=unpack((ROOT/'data'/'sigmoid.bin').read_bytes())
        probes=[-(2**31),-16*Q-1,-16*Q,-16*Q+1,-3*Q-123,-1,0,1,3*Q+123,16*Q-1,16*Q,2**31-1]
        for x in probes:
            assert call('siluProbe(int256)',['int256'],[x],['int256'])[0]==int(silu(np.array([x]),lut)[0])
        reject('silu overflow guard','siluProbe(int256)',['int256'],[2**31])
        report['checks'].append({'name':'SiLU negative/extreme/boundary parity','cases':len(probes),'passed':True})

        rng=random.Random(20261020)
        for i in range(48):
            cols=[4,8,32,64,1024,2560][i%6];rows=1+i%4
            values=[rng.randint(-100000,100000) for _ in range(cols)]
            matrix=[[rng.randint(-8,7) for _ in range(cols)] for _ in range(rows)]
            scale=16777216
            if i<6:
                values=[(-2**31 if j%2==0 else 2**31-1) for j in range(cols)]
                scale=65536
            payload=b'';expected=[]
            for weights in matrix:
                payload+=scale.to_bytes(4,'big')+bytes((weights[j]&15)|((weights[j+1]&15)<<4) for j in range(0,cols,2))
                acc=sum(a*b for a,b in zip(weights,values))*scale
                expected.append((abs(acc)//16777216)*(-1 if acc<0 else 1))
            args_probe=(["bytes","bytes","uint256","uint256"],[pack(values),payload,rows,cols])
            if any(x<-(2**31) or x>=2**31 for x in expected):
                reject(f'projection overflow fixture {i}','projectProbe(bytes,bytes,uint256,uint256)',*args_probe)
            else:
                assert call('projectProbe(bytes,bytes,uint256,uint256)',*args_probe,['bytes'])[0]==pack(expected),f'projection fixture {i}'
        report['checks'].append({'name':'signed projection randomized/extreme parity','cases':48,'passed':True})

        if args.variant=='compiled':
            reject('compiled projection index bound','compiledProbe(uint256,bytes)',['uint256','bytes'],[352,bytes(4096)])
            reject('compiled projection input length','compiledProbe(uint256,bytes)',['uint256','bytes'],[0,b''])
            target=program_addresses[0]
            original_runtime=(ROOT/'compiled-weight-data'/program_manifest['programs'][0]['file']).read_bytes()
            rpc('anvil_setCode',[target,'0x00'])
            reject('changed weight program code rejected','compiledProbe(uint256,bytes)',['uint256','bytes'],[0,bytes(4096)])
            rpc('anvil_setCode',[target,'0x'+original_runtime.hex()])
            assert call('compiledProbe(uint256,bytes)',['uint256','bytes'],[0,bytes(4096)],['bytes'])[0]==bytes(128)
            report['checks'].append({'name':'compiled program codehash binding and restore','passed':True})

        def snapshot(label,tx,expected,shard_indices):
            raw=bytes.fromhex(rpc('anvil_dumpState')[2:])
            state=json.loads(gzip.decompress(raw))['accounts']
            e=state[engine.lower()]
            # Full engine state, including all persisted intermediates and bound shard addresses.
            override={engine:{'code':e['code'],'state':e['storage']},sender:{'balance':hex(10**25)}}
            for index in shard_indices:override[addresses[index]]={'code':state[addresses[index].lower()]['code']}
            if args.variant=='compiled':
                for index in shard_indices:
                    if index>=352:continue
                    entry=program_manifest['logical_shards'][index]
                    for n in range(entry['first_program'],entry['first_program']+entry['program_count']):
                        for a in [program_addresses[n],books[n//400]]:
                            override[a]={'code':state[a.lower()]['code']}
            return {'label':label,'tx':{'from':sender,'to':engine,'data':tx['data']},
                'override':override,'expected_return':expected}

        phase_info={2:('in_projection',32,3072,0),4:('out_projection',32,1024,96),
                    6:('w1',32,2560,128),7:('w3',32,2560,208),9:('w2',16,1024,288)}
        selected={(1,0),(2,0),(2,32),(2,3040),(3,0),(4,0),(5,0),(6,0),(7,0),(8,0),(9,0),(10,0)}
        for token in range(3):
            ref=np.load(ROOT/'data'/f'token-{token}-reference.npz')
            tx={'to':engine,'data':data('begin(bytes)',['bytes'],[(ROOT/'data'/f'token-{token}-input.bin').read_bytes()])}
            case=snapshot(f't{token}-begin',tx,'0x',[]) if token==0 and args.variant!='compiled' else None
            receipt=submit(tx)
            if case:case['local_gas_used']=int(receipt['gasUsed'],16);cases.append(case)
            token_report={'token_index':token,'begin_gas_used':int(receipt['gasUsed'],16),'steps':[],'transactions':[]}
            if token==0:reject('cannot replace active input','begin(bytes)',['bytes'],[bytes(4096)])
            if token==0 and args.variant in ['optimized','compiled']:
                def engine_storage():
                    raw=bytes.fromhex(rpc('anvil_dumpState')[2:])
                    return json.loads(gzip.decompress(raw))['accounts'][engine.lower()]['storage']
                before_storage=engine_storage()
                h=rpc('eth_sendTransaction',[{'from':other,'to':engine,
                    'data':data('advance(uint256)',['uint256'],[2]),'gas':hex(2000000),'gasPrice':hex(10**9)}])
                for _ in range(1000):
                    failed=rpc('eth_getTransactionReceipt',[h])
                    if failed is not None:break
                    time.sleep(.01)
                assert failed is not None and int(failed['status'],16)==0 and not failed['logs']
                assert engine_storage()==before_storage
                report['checks'].append({'name':'out-of-gas multi-step batch rolls back all engine storage','passed':True,
                    'extra_test_transaction_gas_excluded_from_inference_total':int(failed['gasUsed'],16)})
            def planned_step(s,row):
                if s in phase_info:
                    key,count,total,start=phase_info[s];expected=pack(ref[key][row:row+count]);indices=[start+row//count]
                    next_stage,next_row=(s+1,0) if row+count==total else (s,row+count)
                elif s==1:expected=pack(ref['norm1']);indices=[352];next_stage,next_row=2,0
                elif s==3:
                    expected=pack(ref['convolution'][row:row+128])+pack(ref['history_old'][row:row+128])+pack(ref['history_prev'][row:row+128])
                    indices=[353];next_stage,next_row=(4,0) if row==896 else (3,row+128)
                elif s==5:expected=pack(ref['residual'])+pack(ref['norm2']);indices=[352];next_stage,next_row=6,0
                elif s==8:
                    expected=pack(ref['activation'][row:row+128]);indices=[354]
                    next_stage,next_row=(9,0) if row==2432 else (8,row+128)
                elif s==10:expected=pack(ref['output']);indices=[];next_stage,next_row=11,0
                return {'stage':s,'row':row,'expected_digest':keccak(expected),'indices':indices,
                        'next_stage':next_stage,'next_row':next_row}
            s,row=1,0
            while s!=11:
                planned=[];next_stage,next_row=s,row
                for _ in range(args.batch_size):
                    item=planned_step(next_stage,next_row);planned.append(item)
                    next_stage,next_row=item['next_stage'],item['next_row']
                    if next_stage!=s:break
                count=8 if s==10 and args.batch_size>1 else len(planned)
                tx={'to':engine,'data':STEP if args.batch_size==1 else data('advance(uint256)',['uint256'],[count])}
                capture=any((token==0 and (p['stage'],p['row']) in selected) or
                    (token==2 and (p['stage'],p['row']) in {(3,0),(9,0)}) for p in planned)
                if args.variant=='compiled':capture=False
                indices=sorted(set(i for p in planned for i in p['indices']))
                case=snapshot(f't{token}-s{s}-r{row}',tx,'0x'+planned[-1]['expected_digest'].hex(),indices) if capture else None
                # A different caller can advance the same stored job without supplying arithmetic.
                if token==0 and s==2 and row==0:tx['from']=other
                receipt=submit(tx)
                assert len(receipt['logs'])==len(planned)
                gas=int(receipt['gasUsed'],16)
                transaction_index=len(token_report['transactions'])
                for log,p in zip(receipt['logs'],planned):
                    decoded=decode(['uint256','uint256','bytes32'],bytes.fromhex(log['data'][2:]))
                    assert decoded==(p['stage'],p['row'],p['expected_digest']),f'Integer mismatch: {token}, {p}'
                    record={'stage':p['stage'],'row':p['row'],'transaction_index':transaction_index,'reference_match':True}
                    if len(planned)==1:record['local_gas_used']=gas
                    token_report['steps'].append(record)
                token_report['transactions'].append({'stage':s,'row':row,'step_count':len(planned),'local_gas_used':gas})
                if case:case['local_gas_used']=gas;case['step_count']=len(planned);cases.append(case)
                if next_stage!=s:print(json.dumps({'token':token,'stage_complete':s,'steps':len(token_report['steps'])}),flush=True)
                if token==0 and s==6 and row==0:
                    # Execute a real extra step, restore, and let the main loop
                    # execute that same step again from the recovered checkpoint.
                    before=rpc('eth_getStorageAt',[engine,hex(355+2368),'latest'])
                    vector_before=call('vector(uint256)',['uint256'],[6],['bytes'])[0]
                    checkpoint=rpc('evm_snapshot')
                    reject('unauthorized input replacement mid-run','begin(bytes)',['bytes'],[bytes(4096)],caller=other)
                    p=planned_step(next_stage,next_row)
                    recovery=submit({'to':engine,'data':STEP})
                    recovery_log=decode(['uint256','uint256','bytes32'],bytes.fromhex(recovery['logs'][-1]['data'][2:]))
                    assert recovery_log==(p['stage'],p['row'],p['expected_digest'])
                    assert rpc('evm_revert',[checkpoint]) is True
                    assert rpc('eth_getStorageAt',[engine,hex(355+2368),'latest'])==before
                    assert call('cursor()',returns=['uint256'])[0]==next_row
                    assert call('vector(uint256)',['uint256'],[6],['bytes'])[0]==vector_before
                    report['checks'].append({'name':'state-changing step rollback and deterministic replay','passed':True,
                        'extra_test_transaction_gas_excluded_from_inference_total':int(recovery['gasUsed'],16)})
                s,row=next_stage,next_row
            for id,key in [(0,'input'),(1,'norm1'),(2,'in_projection'),(3,'convolution'),(4,'residual'),
                           (5,'norm2'),(6,'w1'),(7,'w3'),(8,'activation'),(9,'output'),(10,'history_old'),(11,'history_prev')]:
                assert call('vector(uint256)',['uint256'],[id],['bytes'])[0]==pack(ref[key]),f'Persisted vector mismatch: {key}'
            assert call('stage()',returns=['uint256'])[0]==11
            assert call('tokens()',returns=['uint256'])[0]==token+1
            reject(f'completed job rejects extra step, token {token}','step()')
            if args.variant in ['optimized','compiled']:reject(f'completed job rejects extra batch, token {token}','advance(uint256)',['uint256'],[1])
            token_report.update(output_matches_reference=True,persisted_vectors_checked=12,
                transaction_count=1+len(token_report['transactions']),
                total_local_gas_used=token_report['begin_gas_used']+sum(x['local_gas_used'] for x in token_report['transactions']),
                output_sha256=hashlib.sha256(pack(ref['output'])).hexdigest(),
                float32_comparison=manifest['cases'][token])
            report['tokens'].append(token_report);save()
            print(json.dumps({k:token_report[k] for k in ['token_index','transaction_count','total_local_gas_used','output_matches_reference']}),flush=True)
        report.update(status='passed',total_local_deployment_gas=sum(x['local_gas_used'] for x in report['deployments']),
            max_local_transaction_gas=max([x['local_gas_used'] for x in report['deployments']]+[x['local_gas_used'] for t in report['tokens'] for x in t['transactions']]),
            public_simulation_cases=len(cases),finished_at=datetime.now(timezone.utc).isoformat())
        save()
        print(json.dumps({'status':report['status'],'deployments':len(report['deployments']),
                         'max_transaction_gas':report['max_local_transaction_gas'],'public_simulation_cases':len(cases)}),flush=True)
    except Exception as error:
        report.update(status='failed',error=str(error));save();raise
    finally:
        child.terminate()
        try:child.wait(timeout=10)
        except subprocess.TimeoutExpired:child.kill();child.wait()


if __name__=='__main__':main()
