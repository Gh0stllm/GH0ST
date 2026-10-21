"""Produce exact immutable-patched runtime bytes using a local constructor."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from eth_abi import encode

ROOT=Path(__file__).resolve().parent
STUDY=ROOT.parent/'fourbit-study'
sys.path.insert(0,str(STUDY))
from local import EVM,index_blob
import deploy as d


def main():
    p=argparse.ArgumentParser();p.add_argument('--weights',type=Path,required=True);p.add_argument('--anvil',type=Path,required=True)
    args=p.parse_args()
    a=json.loads((ROOT/'compiled.json').read_text())
    m=json.loads((STUDY/'mainnet/deployment-state.json').read_text());rows={x['name']:x for x in m['receipts']}
    kernel=rows['FourBitAffine64']['address'];index=rows['FourBitWeightIndex']['address']
    data=args.weights.read_bytes();assert hashlib.sha256(data).hexdigest()==d.PIN
    addresses=[rows[f'fourbit-weights-{i:04d}']['address']for i in range(495)]
    kernel_code=json.loads((STUDY/'compiled-1000000.json').read_text())['contracts']['FourBitAffine64']['evm']['deployedBytecode']['object']
    index_code=b'\0'+index_blob(data,addresses,98303)
    assert d.digest(bytes.fromhex(kernel_code))==d.KERNEL_PIN
    assert d.digest(index_code)==rows['FourBitWeightIndex']['runtime_keccak256']
    init=bytes.fromhex(a['evm']['bytecode']['object'])+encode(['address','address'],[kernel,index])
    evm=EVM(args.anvil.resolve(),port=18722)
    try:
        evm.rpc('anvil_setCode',[kernel,'0x'+kernel_code]);evm.rpc('anvil_setCode',[index,'0x'+index_code.hex()])
        target,gas=evm.deploy(init)
        runtime=bytes.fromhex(evm.rpc('eth_getCode',[target,'latest'])[2:])
        assert len(runtime)==len(a['evm']['deployedBytecode']['object'])//2
    finally:evm.close()
    pin={'schema':1,'kernel_address':kernel,'index_address':index,'weights_sha256':d.PIN,
         'runtime_bytes':len(runtime),'runtime_keccak256':d.digest(runtime),
         'creation_bytes':len(init),'creation_sha256':hashlib.sha256(init).hexdigest(),
         'runtime_code':'0x'+runtime.hex(),'local_deployment_gas':gas,
         'source_sha256':{str(path.relative_to(ROOT.parent)):hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in [ROOT/'GH0STRuntime.sol',ROOT/'PrepaidBudget.sol',ROOT/'FixedMath.sol',STUDY/'WeightReader.sol']},
         'scope':'Exact runtime observed after loopback deployment of the pinned-address constructor',
         'public_transactions_sent':0}
    d.save(ROOT/'pinned-runtime.json',pin)
    print(json.dumps({k:pin[k]for k in ['runtime_bytes','runtime_keccak256','creation_bytes','creation_sha256','local_deployment_gas']}))


if __name__=='__main__':main()
