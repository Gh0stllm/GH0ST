"""Malformed-input checks for the new metadata parsers, on a local EVM."""
import argparse,json
from pathlib import Path
import numpy as np
from eth_abi import encode
from eth_utils import keccak
from benchmark import LocalEVM,initcode,legacy,encode_matrix,fixed,shifted,predecoded
ROOT=Path(__file__).resolve().parent

def main():
 p=argparse.ArgumentParser();p.add_argument('--anvil',type=Path,required=True);a=p.parse_args();evm=LocalEVM(a.anvil,port=18563)
 art=json.loads((ROOT/'compiled.json').read_text());report={'status':'running','checks':[],'public_transactions_broadcast':0}
 try:
  o=np.full(4,-9437184,dtype=np.int64);s=np.full(4,264224,dtype=np.uint32);c=np.tile(np.arange(64,dtype=np.uint8),4)
  compact,_=encode_matrix(legacy(o,s,c),4)
  for name,encoder in [('SixBitFixed',fixed),('SixBitShifted',shifted),('SixBitPredecoded2',predecoded)]:
   target,_=evm.deploy(bytes.fromhex(art['contracts'][name]['evm']['bytecode']['object']));blob=encoder(o,s,compact);shard,_=evm.deploy(initcode(blob))
   bad_magic=bytearray(blob);bad_magic[0]^=1
   bad_count=bytearray(blob);bad_count[7]^=1
   bad_data=[('bad_magic',bytes(bad_magic)),('bad_group_count',bytes(bad_count)),('truncated',blob[:-1])]
   if name=='SixBitFixed':b=bytearray(blob);b[8]=32;bad_data.append(('bad_shift',bytes(b)))
   if name=='SixBitShifted':
    for label,index,value in [('bad_stride',8,3),('bad_shift',9,32),('bad_scale_bits',10,0)]:
     b=bytearray(blob);b[index]=value;bad_data.append((label,bytes(b)))
   cases=[('rows_zero',shard,bytes(128),0,64),('rows_too_many',shard,bytes(128),65,64),('cols_zero',shard,b'',4,0),('cols_unaligned',shard,bytes(126),4,63),('cols_too_many',shard,bytes(2176),4,1088),('wrong_input_length',shard,bytes(127),4,64),('no_code',evm.account,bytes(128),4,64)]
   for label,data in bad_data:
    addr,_=evm.deploy(initcode(data));cases.append((label,addr,bytes(128),4,64))
   for label,addr,x,rows,cols in cases:
    payload={'to':target,'data':'0x'+(keccak(text='dot(address,bytes,uint256,uint256)')[:4]+encode(['address','bytes','uint256','uint256'],[addr,x,rows,cols])).hex()}
    try:evm.rpc('eth_call',[payload,'latest'])
    except RuntimeError as error:assert 'revert' in str(error).lower(),error
    else:raise AssertionError((name,label,'should revert'))
    report['checks'].append({'kernel':name,'case':label,'reverted':True})
  report['status']='completed'
 finally:evm.close();(ROOT/'input-validation.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'status':report['status'],'checks':len(report['checks'])}))
if __name__=='__main__':main()
