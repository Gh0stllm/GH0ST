"""Run the actual compiled WASM with explicit local mock host functions.

This validates arithmetic, ABI and state behavior. It does not meter Stylus ink
or emulate Nitro consensus, activation, caching or chain fees.
"""
import hashlib
import importlib.metadata
import json
import random
from datetime import datetime, timezone
from pathlib import Path
import wasmtime
from eth_abi import encode, decode
from eth_utils import keccak

ROOT=Path(__file__).resolve().parent
WASM=ROOT/'target/wasm32-unknown-unknown/release/lfm_int4_stylus.wasm'


class Host:
    def __init__(self):
        config=wasmtime.Config()
        config.consume_fuel=True
        self.engine=wasmtime.Engine(config)
        self.module=wasmtime.Module.from_file(self.engine,str(WASM))
        self.storage={}
        self.code={}
        self.max_memory_bytes=0

    def call(self,data):
        store=wasmtime.Store(self.engine)
        store.set_limits(memory_size=8*1024*1024)
        store.set_fuel(100_000_000)  # Local loop guard, never interpreted as gas/ink.
        linker=wasmtime.Linker(self.engine)
        result=bytearray()
        cache={}
        before=self.storage.copy()
        def host(name,caller,*args):
            mem=caller.get('memory')
            def read(ptr,size):return bytes(mem.read(caller,ptr,ptr+size))
            def write(ptr,value):mem.write(caller,value,ptr)
            if name=='read_args':write(args[0],data)
            elif name=='write_result':result[:]=read(args[0],args[1])
            elif name=='msg_value':write(args[0],bytes(32))
            elif name=='msg_reentrant':return 0
            elif name=='pay_for_memory_grow':pass  # No Nitro metering is claimed.
            elif name=='native_keccak256':write(args[2],keccak(read(args[0],args[1])))
            elif name=='account_code_size':return len(self.code.get(read(args[0],20),b''))
            elif name=='account_code':
                code=self.code.get(read(args[0],20),b'')
                part=code[args[1]:args[1]+args[2]]
                write(args[3],part)
                return len(part)
            elif name=='storage_load_bytes32':
                key=read(args[0],32)
                write(args[1],cache.get(key,self.storage.get(key,bytes(32))))
            elif name=='storage_cache_bytes32':cache[read(args[0],32)]=read(args[1],32)
            elif name=='storage_flush_cache':
                self.storage.update(cache)
                if args[0]:cache.clear()
            else:raise NotImplementedError(name)
        for imp in self.module.imports:
            if imp.module!='vm_hooks':raise ValueError(f'Unexpected import module {imp.module}')
            def callback(caller,*args,_name=imp.name):return host(_name,caller,*args)
            linker.define_func(imp.module,imp.name,imp.type,callback,access_caller=True)
        instance=linker.instantiate(store,self.module)
        try:
            status=instance.exports(store)['user_entrypoint'](store,len(data))
        except Exception:
            self.storage=before
            raise
        if status!=0:self.storage=before
        memory=instance.exports(store)['memory'].data_len(store)
        self.max_memory_bytes=max(self.max_memory_bytes,memory)
        return status,bytes(result)


def calldata(signature,types,values):return keccak(text=signature)[:4]+encode(types,values)


def pack(matrix,values):
    flat=[v for row in matrix for v in row]
    weights=bytes((flat[i]&15)|(((flat[i+1] if i+1<len(flat) else 0)&15)<<4)
                  for i in range(0,len(flat),2))
    activations=b''.join(v.to_bytes(2,'little',signed=True) for v in values)
    return weights,activations


def main():
    host=Host()
    sample=json.loads((ROOT.parent/'contract-benchmark/lfm-slice.json').read_text())
    old=json.loads((ROOT.parent/'contract-benchmark/simulation-input.json').read_text())
    addr=bytes.fromhex(old['shard_address'][2:])
    checks=[]
    rng=random.Random(20261020)
    fixtures=[('zero',[[0]*3],[0]*3),
        ('signed_extremes',[[-8,7,-1,0],[7,-8,1,0]],[-32768,32767,-1,0]),
        ('accumulator_bound',[[-8]*1024],[-32768]*1024)]
    for r,c in [(1,1),(1,2),(2,3),(3,31),(4,64),(8,1024)]:
        fixtures.append((f'random_{r}x{c}',[[rng.randint(-8,7) for _ in range(c)] for _ in range(r)],
            [rng.randint(-32768,32767) for _ in range(c)]))
    for name,matrix,values in fixtures:
        w,a=pack(matrix,values)
        expected=[sum(x*y for x,y in zip(row,values)) for row in matrix]
        host.code[addr]=b'\x00'+w
        for path in ['calldata','code_shard']:
            if path=='calldata':
                data=calldata('dotCalldata(bytes,bytes,uint256,uint256)',
                    ['bytes','bytes','uint256','uint256'],[w,a,len(matrix),len(values)])
            else:
                data=calldata('dotFromCode(address,bytes,uint256,uint256)',
                    ['address','bytes','uint256','uint256'],[addr,a,len(matrix),len(values)])
            status,result=host.call(data)
            assert status==0,(name,path,status,result.hex())
            assert list(decode(['int256[]'],result)[0])==expected,(name,path)
            checks.append({'name':name,'path':path,'passed':True})
    for name,w,a,r,c in [('zero_rows',b'',b'',0,1),('too_many_rows',b'',b'',9,1),
        ('zero_cols',b'',b'',1,0),('too_many_cols',b'',b'',1,1025),
        ('missing_weight',b'',b'\x00\x00',1,1),('missing_activation',b'\x00',b'\x00',1,1),
        ('excess_weight',b'\x00\x00',b'\x00\x00',1,1)]:
        status,result=host.call(calldata('dotCalldata(bytes,bytes,uint256,uint256)',
            ['bytes','bytes','uint256','uint256'],[w,a,r,c]))
        error='InvalidDimensions()' if name in ['zero_rows','too_many_rows','zero_cols','too_many_cols'] else 'InvalidDataLength()'
        assert status!=0 and result==keccak(text=error)[:4],name
        checks.append({'name':name,'rejected':True})
    host.code[addr]=b'\x00'+bytes.fromhex(sample['packed_weights_hex'])
    status,result=host.call(bytes.fromhex(old['dot_call_data'][2:]))
    assert status==0 and list(decode(['int256[]'],result)[0])==sample['expected_integer_outputs']
    checks.append({'name':'real_lfm_slice_matches_solidity_abi','passed':True})
    for count in [1,2]:
        status,result=host.call(bytes.fromhex(old['commit_call_data'][2:]))
        assert status==0 and result.hex()==old['expected_commitment_hex'][2:]
        assert host.storage[bytes(32)]==result
        assert int.from_bytes(host.storage[(1).to_bytes(32,'big')],'big')==count
        checks.append({'name':f'commitment_and_counter_{count}','passed':True})
    for signature,expected in [('runs()',encode(['uint256'],[2])),
        ('resultHash()',bytes.fromhex(old['expected_commitment_hex'][2:]))]:
        status,result=host.call(keccak(text=signature)[:4])
        assert status==0 and result==expected
        checks.append({'name':signature,'passed':True})
    report={'status':'compiled_wasm_local_mock_host_only',
        'checked_at':datetime.now(timezone.utc).isoformat(),
        'wasm_sha256':hashlib.sha256(WASM.read_bytes()).hexdigest(),
        'wasm_bytes':WASM.stat().st_size,'wasmtime_version':importlib.metadata.version('wasmtime'),
        'checks':checks,'checks_passed':len(checks),'max_observed_memory_bytes':host.max_memory_bytes,
        'real_lfm_integer_outputs':sample['expected_integer_outputs'],
        'real_lfm_commitment':old['expected_commitment_hex'],
        'stylus_gas_measured':False,'stylus_ink_measured':False,'public_transactions_broadcast':0,
        'limitations':['Local mock host, not Nitro or a chain validator.',
            'Storage/code/keccak behavior is explicitly mocked; host I/O gas and activation are not modeled.',
            'Wasmtime fuel is only a loop guard and is never converted to Stylus ink or gas.',
            'This is an integer projection slice, not a full layer or language-model inference.']}
    (ROOT.parent/'results/stylus-wasm-tests.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['checks_passed','wasm_bytes','max_observed_memory_bytes','real_lfm_integer_outputs','stylus_gas_measured']},indent=2))


if __name__=='__main__':main()
