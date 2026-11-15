// Read-only demonstration of moving-head response divergence. Never signs or broadcasts.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const endpoint='https://rpc.mainnet.chain.robinhood.com';
const token='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function rpc(body){
 const started=performance.now();
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20_000)});
 if(!r.ok)throw Error('Read-only official RPC unavailable');
 const rows=await r.json();
 if(!Array.isArray(rows)||rows.some(x=>x.error))throw Error('Read-only JSON-RPC batch failed');
 rows.sort((a,b)=>a.id-b.id);
 if(BigInt(rows.find(r=>r.id===1)?.result)!==4663n)throw Error('Wrong chain');
 return {rows,milliseconds:performance.now()-started};
}
const row=(rows,id)=>rows.find(r=>r.id===id).result;
const group=values=>Object.values(values.reduce((out,v)=>(out[v]=(out[v]||0)+1,out),{})).sort((a,b)=>b-a);
const startedAt=new Date().toISOString();
const dynamic=await Promise.all(Array.from({length:13},async(_,i)=>{
 await pause(i*75);
 const r=await rpc([{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]},{jsonrpc:'2.0',id:2,method:'eth_blockNumber',params:[]}]);
 return {sample:i,staggerMilliseconds:i*75,head:Number(BigInt(row(r.rows,2))),latencyMilliseconds:Math.round(r.milliseconds),payloadSHA256:digest(r.rows)};
}));
const heads=dynamic.map(x=>x.head).sort((a,b)=>a-b),median=heads[6],number=median-12,block='0x'+number.toString(16);
const fixed=await Promise.all(Array.from({length:13},async(_,i)=>{
 await pause(i*75);
 const r=await rpc([{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]},{jsonrpc:'2.0',id:2,method:'eth_getBlockByNumber',params:[block,false]},{jsonrpc:'2.0',id:3,method:'eth_getCode',params:[token,block]}]);
 return {sample:i,number:Number(BigInt(row(r.rows,2).number)),blockHash:row(r.rows,2).hash,latencyMilliseconds:Math.round(r.milliseconds),payloadSHA256:digest(r.rows)};
}));
const report={scope:'Read-only host-side official RPC probe with a deliberately staggered 900ms request-arrival window; not an actual ICP distributed-outcall or production-latency measurement',startedAt,finishedAt:new Date().toISOString(),chainId:4663,requests:26,committeeAnalogy:{nodes:13,requiredIdenticalReplicatedResponses:9},movingHead:{samples:dynamic,min:heads[0],max:heads[12],median,identicalPayloadGroupSizes:group(dynamic.map(x=>x.payloadSHA256)),largestIdenticalGroup:group(dynamic.map(x=>x.payloadSHA256))[0]},fixedBlock:{number,samples:fixed,identicalPayloadGroupSizes:group(fixed.map(x=>x.payloadSHA256)),largestIdenticalGroup:group(fixed.map(x=>x.payloadSHA256))[0],allHashesMatch:fixed.every(x=>x.blockHash===fixed[0].blockHash)},transactionsBroadcast:0};
if(process.argv.includes('--write'))writeFileSync(new URL('./rpc-consensus-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,startedAt,finishedAt:report.finishedAt,movingHeadRange:[heads[0],heads[12]],movingHeadLargestIdenticalGroup:report.movingHead.largestIdenticalGroup,fixedBlock:number,fixedBlockLargestIdenticalGroup:report.fixedBlock.largestIdenticalGroup,allFixedHashesMatch:report.fixedBlock.allHashesMatch,transactionsBroadcast:0},null,2));
