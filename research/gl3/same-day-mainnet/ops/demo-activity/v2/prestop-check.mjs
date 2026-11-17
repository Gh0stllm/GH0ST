// Root-invoked READ ONLY readiness sample; never sends a signal or transaction.
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {ensure} from './engine.mjs';
const{JsonRpcProvider}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
export function readySample({latest,pending,status}){
 return status.running===true&&status.stopReason===null&&Number.isSafeInteger(status.intentCount)&&BigInt(latest)===BigInt(pending)&&BigInt(latest)===BigInt(status.intentCount);
}
async function main(){
 const p=new JsonRpcProvider('http://127.0.0.1:8547',undefined,{cacheTimeout:-1,batchMaxCount:1}),rpc=(m,a)=>p.send(m,a),base='/workspace/gl3/mainnet/private/demo';
 try{ensure(BigInt(await rpc('eth_chainId',[]))===4663001n,'WRONG_CHAIN');const launch=JSON.parse(fs.readFileSync(base+'/launch-v1.json')),samples=[];
  for(let n=0;n<3;n++){const status=JSON.parse(fs.readFileSync(base+'/state-v1/status.json'));const[latest,pending]=await Promise.all([rpc('eth_getTransactionCount',[status.signer,'latest']),rpc('eth_getTransactionCount',[status.signer,'pending'])]);ensure(readySample({latest,pending,status}),'NOT_AT_OBSERVED_DRAINED_INTERVAL');samples.push({latest,pending,intentCount:status.intentCount,signer:status.signer,observedUTC:new Date().toISOString()});if(n<2)await new Promise(r=>setTimeout(r,100));}
  ensure(samples.every(s=>s.latest===samples[0].latest),'NONCE_MOVED_DURING_SAMPLE');const head=await rpc('eth_getBlockByNumber',['latest',false]),next=BigInt(samples[0].latest);let receipt=null;
  for(let n=BigInt(head.number);n>=0n&&n>BigInt(head.number)-8n;n--){const b=await rpc('eth_getBlockByNumber',['0x'+n.toString(16),true]);const t=b.transactions.find(t=>t.from.toLowerCase()===samples[0].signer.toLowerCase()&&BigInt(t.nonce)===next-1n);if(t){receipt=await rpc('eth_getTransactionReceipt',[t.hash]);ensure(receipt?.status==='0x1'&&receipt.blockHash===b.hash,'LAST_RECEIPT_NOT_CANONICAL');break;}}
  ensure(receipt,'LAST_OWNED_RECEIPT_NOT_FOUND');const report={schema:'gh0st.gl3.demo-prestop-readiness.v2',readyForGracefulStop:true,controllerPID:launch.controllerPID,samples,
   lastReceipt:{hash:receipt.transactionHash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,status:receipt.status},
   scope:'A sampled drained interval, not an atomic stop. Root alone requests demo-only graceful stop. Mandatory post-stop migration audit catches any later admitted transaction and refuses pending/unknown receipts. No journal/key/config/log reads or mutations.'};
  const dir=path.dirname(new URL(import.meta.url).pathname);fs.mkdirSync(path.join(dir,'evidence'),{recursive:true});fs.writeFileSync(path.join(dir,'evidence/prestop-readiness.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{p.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'PRESTOP_READONLY_CHECK_FAILED');process.exitCode=1});
