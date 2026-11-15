import { Interface, formatEther, keccak256 } from 'ethers';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { rpc, verifyChain, endpointSource } from './rpc.mjs';
const ni = new Interface(['function gasEstimateComponents(address to,bool contractCreation,bytes data) payable returns(uint64 gasEstimate,uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)']);
const address='0x00000000000000000000000000000000000000C8';
// Deterministic high-entropy representative input, not the actual model weights.
function dataBytes(n) { let out=Buffer.alloc(n); for(let i=0;i<n;i+=32) createHash('sha256').update(`GH0ST_READ_ONLY_DATA_SHARD_${i}`).digest().copy(out,i,0,Math.min(32,n-i)); return out; }
export function creationFor(payload) {
  const runtime=Buffer.concat([Buffer.from([0]),payload]); const size=runtime.length.toString(16).padStart(6,'0');
  return {runtime:'0x'+runtime.toString('hex'),data:'0x62'+size+'620000105f3962'+size+'5ff3'+runtime.toString('hex')};
}
const chainId=await verifyChain();
const report={scope:'Read-only RH eth_estimateGas and NodeInterface estimation of isolated STOP-prefixed data-code shards; no deployment or transaction broadcast',checkedAt:new Date().toISOString(),chainId,endpointSource,representativePayload:'deterministic high-entropy bytes, not NNUE data',cases:[]};
for(const runtimeBytes of [24576,98304,98305]) {
  const c=creationFor(dataBytes(runtimeBytes-1));
  const row={runtimeBytes,payloadBytes:runtimeBytes-1,initcodeBytes:(c.data.length-2)/2,runtimeKeccak256:keccak256(c.runtime),initcodeKeccak256:keccak256(c.data),codeDepositOnlyGas:runtimeBytes*200};
  const tx={from:'0x0000000000000000000000000000000000000001',data:c.data,gas:'0x1e84800',gasPrice:'0x0'};
  try {row.ethEstimateGas=BigInt(await rpc('eth_estimateGas',[tx])).toString();}
  catch(e){row.ethEstimateGasError={code:e.rpcCode??null,summary:'RPC rejected estimate; no transaction was sent'};}
  try {
    const raw=await rpc('eth_call',[{from:tx.from,to:address,data:ni.encodeFunctionData('gasEstimateComponents',['0x0000000000000000000000000000000000000000',true,c.data]),gas:'0x1e84800'},'latest']);
    const r=ni.decodeFunctionResult('gasEstimateComponents',raw);
    row.nodeInterface={totalGas:r.gasEstimate.toString(),parentFeeGas:r.gasEstimateForL1.toString(),l2Gas:(r.gasEstimate-r.gasEstimateForL1).toString(),l2BaseFeeWei:r.baseFee.toString(),parentBaseFeeEstimateWei:r.l1BaseFeeEstimate.toString(),estimatedTotalEth:formatEther(r.gasEstimate*r.baseFee),estimatedParentEth:formatEther(r.gasEstimateForL1*r.baseFee)};
  } catch(e){row.nodeInterfaceError={code:e.rpcCode??null,summary:'NodeInterface rejected estimate; no transaction was sent'};}
  report.cases.push(row);console.log(JSON.stringify(row));
}
writeFileSync(new URL('./shard-mainnet-estimates.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
