"""Verify modeled creation gas and bytes on local sample deployments only."""
import argparse,hashlib,json,sys
from pathlib import Path
from benchmark import LocalEVM,initcode
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent))
from prepare_deployment import cancun_creation_gas

def main():
 p=argparse.ArgumentParser();p.add_argument('--exports',type=Path,required=True);p.add_argument('--anvil',type=Path,required=True);a=p.parse_args()
 evm=LocalEVM(a.anvil,port=18563);report={'status':'running','public_transactions_broadcast':0,'scope':'Sample local data-shard creation, not full model deployment','samples':[]}
 try:
  for variant in ['shifted','predecoded','fixed']:
   folder=a.exports/variant;m=json.loads((folder/'manifest.json').read_text());data=(folder/'weights.bin').read_bytes();assert hashlib.sha256(data).hexdigest()==m['sha256']
   for limit in [24575,61439]:
    count=(len(data)+limit-1)//limit
    for i in sorted({0,count//2,count-1}):
     payload=data[i*limit:(i+1)*limit];runtime=b'\0'+payload;init=initcode(payload);addr,gas=evm.deploy(init)
     assert evm.rpc('eth_getCode',[addr,'latest'])=='0x'+runtime.hex()
     assert gas==cancun_creation_gas(init,runtime),(variant,limit,i,gas)
     report['samples'].append({'variant':variant,'payload_limit':limit,'index':i,'bytes':len(payload),'gas':gas,'modeled_gas_matches_receipt':True,'runtime_bytes_verified':True})
  report['status']='completed'
 finally:
  evm.close();(ROOT/'deployment-validation.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'status':report['status'],'samples':len(report['samples'])}))
if __name__=='__main__':main()
