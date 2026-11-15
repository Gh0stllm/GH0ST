import { ContractFactory, Interface, formatEther } from 'ethers';
import { readFileSync, writeFileSync } from 'node:fs';
import { rpc, verifyChain, endpointSource } from './rpc.mjs';
const chainId=await verifyChain();
const a=JSON.parse(readFileSync(new URL('../evm/artifacts.json',import.meta.url))).contracts.RHChessChallengeVault;
const token='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const owner='0x1111111111111111111111111111111111111111',attestor='0x2222222222222222222222222222222222222222',config='0x'+'aa'.repeat(32),from='0x0000000000000000000000000000000000000001';
const data=(await new ContractFactory(a.abi,a.bytecode).getDeployTransaction(token,owner,attestor,config)).data;
const approve=new Interface(['function approve(address,uint256) returns(bool)']);
const ni=new Interface(['function gasEstimateComponents(address to,bool contractCreation,bytes data) payable returns(uint64 gasEstimate,uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)']);
const report={scope:'Read-only RH estimates for the EXISTING ICP-attested reward vault and canonical-token approval. This is not native engine deployment or gameplay gas. Constructor uses clearly synthetic owner/attestor/config only for simulation.',checkedAt:new Date().toISOString(),chainId,endpointSource,runtimeBytes:a.runtimeBytes,creationBytes:a.creationBytes,constructorBindings:{token,owner,attestor,config},cases:[]};
for(const item of [{label:'LEGACY ICP-attested vault deployment',to:null,data},{label:'Canonical GH0ST exact 25000 approval',to:token,data:approve.encodeFunctionData('approve',[owner,25000n*10n**18n])}]){
  const tx={from,data:item.data,gas:'0x1e84800',gasPrice:'0x0'};if(item.to)tx.to=item.to;
  const row={label:item.label,calldataBytes:(item.data.length-2)/2};
  try{row.ethEstimateGas=BigInt(await rpc('eth_estimateGas',[tx])).toString();}
  catch(e){row.ethEstimateGasError={code:e.rpcCode??null};}
  try{
    const raw=await rpc('eth_call',[{from,to:'0x00000000000000000000000000000000000000C8',data:ni.encodeFunctionData('gasEstimateComponents',[item.to||'0x0000000000000000000000000000000000000000',!item.to,item.data]),gas:'0x1e84800'},'latest']);
    const r=ni.decodeFunctionResult('gasEstimateComponents',raw);
    row.nodeInterface={totalGas:r.gasEstimate.toString(),parentFeeGas:r.gasEstimateForL1.toString(),l2Gas:(r.gasEstimate-r.gasEstimateForL1).toString(),l2BaseFeeWei:r.baseFee.toString(),parentBaseFeeEstimateWei:r.l1BaseFeeEstimate.toString(),estimatedTotalEth:formatEther(r.gasEstimate*r.baseFee)};
  }catch(e){row.nodeInterfaceError={code:e.rpcCode??null};}
  report.cases.push(row);console.log(JSON.stringify(row));
}
writeFileSync(new URL('./legacy-vault-mainnet-estimates.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
