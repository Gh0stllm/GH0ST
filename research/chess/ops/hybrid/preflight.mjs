// Read-only current RH resources and constructor pricing. Never signs or broadcasts.
import fs from 'node:fs';
import { ContractFactory, Interface, keccak256, formatEther, formatUnits } from 'ethers';
const endpoint=process.env.ROBINHOOD_MAINNET_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
const token='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const owner='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
// Nonzero public stand-ins ONLY for pricing. Final signer/config require real ICP deployment.
const attestor='0x1111111111111111111111111111111111111111';
const configHash='0x'+'22'.repeat(32);
const artifact=JSON.parse(fs.readFileSync(new URL('../../evm/hybrid-artifacts/hybridchessgame.json',import.meta.url)));
const local=JSON.parse(fs.readFileSync(new URL('../../evm/hybrid-test-report.json',import.meta.url)));
const maxMoveGas=local.receipts.filter(r=>/move/i.test(r.label)).reduce((m,r)=>BigInt(r.gasUsed)>m?BigInt(r.gasUsed):m,0n);
let id=0;
async function rpc(method,params=[]){
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(25_000)});
 if(!r.ok)throw Error('Read-only RPC unavailable');const j=await r.json();if(j.error||j.result===undefined)throw Error(`Read-only ${method} failed`);return j.result;
}
try{
 if(BigInt(await rpc('eth_chainId'))!==4663n)throw Error('Wrong chain');
 const block=await rpc('eth_getBlockByNumber',['latest',false]);
 const ti=new Interface(['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)']);
 const tx=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(token,owner,attestor,configHash);
 const reads=await Promise.allSettled([
  rpc('eth_getCode',[token,block.number]),rpc('eth_gasPrice'),
  rpc('eth_estimateGas',[{from:owner,data:tx.data,value:'0x0'}]),
  rpc('eth_getBalance',[owner,block.number]),
  rpc('eth_call',[{to:token,data:ti.encodeFunctionData('balanceOf',[owner])},block.number]),
  rpc('eth_call',[{to:token,data:ti.encodeFunctionData('decimals')},block.number]),
 ]);
 for(const r of reads)if(r.status!=='fulfilled')throw r.reason;
 const [code,price,gas,balance,tokens,decimals]=reads.map(x=>x.value);
 const hash=keccak256(code);if(hash!=='0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164'||BigInt(decimals)!==18n)throw Error('Canonical token mismatch');
 const report={scope:'Read-only RH mainnet snapshot and new native-game constructor estimate; signer and config are pricing stand-ins, not a deployment binding',checkedAt:new Date().toISOString(),chainId:4663,blockNumber:Number(BigInt(block.number)),blockHash:block.hash,token,tokenRuntimeHash:hash,poolOwnerCandidate:owner,ownerETH:formatEther(balance),ownerGH0ST:formatUnits(tokens,18),gasPriceWei:BigInt(price).toString(),gasPriceGwei:formatUnits(price,9),deploymentEstimateGas:BigInt(gas).toString(),deploymentEstimateETH:formatEther(BigInt(gas)*BigInt(price)),entryGH0ST:'25000',totalPrizeGH0ST:'1000000',maxObservedLocalMoveGas:maxMoveGas.toString(),localReceiptReport:'../../evm/hybrid-test-report.json',spendApproved:false,transactionsBroadcast:0};
 if(process.argv.includes('--write'))fs.writeFileSync(new URL('./resource-preflight.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}catch(e){console.error(/^(Read-only|Wrong chain|Canonical token)/.test(e.message)?e.message:'Read-only hybrid preflight failed; no funds moved');process.exitCode=1;}
