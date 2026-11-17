// Public, read-only batch-poster cost observation. No credentials or signer APIs.
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {digest,ensure} from './engine.mjs';
const{Interface}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
const dir=path.dirname(new URL(import.meta.url).pathname),out=path.join(dir,'evidence/live');
async function rpc(method,params){const response=await fetch('https://rpc.mainnet.chain.robinhood.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});ensure(response.ok,'PARENT_HTTP_ERROR');const v=await response.json();ensure(!v.error,'PARENT_RPC_ERROR');return v.result;}
const artifactRoot='/root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance/compiled-main/build/contracts';
const found=[];function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(e.name==='SequencerInbox.json')found.push(f);}}walk(artifactRoot);ensure(found.length===1,'AMBIGUOUS_ARTIFACT');
const artifact=fs.readFileSync(found[0]),iface=new Interface(JSON.parse(artifact).abi);
ensure(BigInt(await rpc('eth_chainId',[]))===4663n,'WRONG_CHAIN');
const latest=await rpc('eth_getBlockByNumber',['latest',false]),end=BigInt(latest.number),start=end-2000n;
const logs=await rpc('eth_getLogs',[{address:'0xBaaF819a28CceC669168344632Aa4660427aB2fA',fromBlock:'0x'+start.toString(16),toBlock:latest.number,topics:[iface.getEvent('SequencerBatchDelivered').topicHash]}]);
const launch=JSON.parse(fs.readFileSync('/workspace/gl3/mainnet/private/demo/launch-v1.json')),launchTimestamp=Date.parse(launch.startedUTC)/1000;
const rows=[];let paid=0n;
for(const l of logs){const block=await rpc('eth_getBlockByNumber',[l.blockNumber,false]);ensure(block.hash===l.blockHash,'LOG_NOT_CANONICAL');const ts=Number(BigInt(block.timestamp));if(ts<launchTimestamp||ts>=launchTimestamp+120)continue;
 const [tx,r]=await Promise.all([rpc('eth_getTransactionByHash',[l.transactionHash]),rpc('eth_getTransactionReceipt',[l.transactionHash])]);ensure(r.status==='0x1'&&r.blockHash===block.hash&&tx.from.toLowerCase()==='0x52cc715ef517ce1933142d2168b43f8fdc54b7c5','POSTER_RECEIPT_BINDING');
 const event=iface.parseLog(l),fee=BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice);paid+=fee;rows.push({hash:l.transactionHash,block:l.blockNumber,blockHash:block.hash,timestamp:ts,posterNonce:Number(BigInt(tx.nonce)),batchSequenceNumber:String(event.args.batchSequenceNumber),gasUsed:String(BigInt(r.gasUsed)),gasUsedForL1:r.gasUsedForL1??null,effectiveGasPrice:String(BigInt(r.effectiveGasPrice)),paidWei:String(fee),calldataBytes:(tx.input.length-2)/2});
}
ensure((await rpc('eth_getBlockByNumber',[latest.number,false])).hash===latest.hash,'PARENT_SNAPSHOT_REORG');
const result={schema:'gh0st.gl3.automated-demo.parent-pilot.v1',passed:true,observedUTC:new Date().toISOString(),chainId:4663,window:{startUTC:launch.startedUTC,seconds:120,complete:Number(BigInt(latest.timestamp))>=launchTimestamp+120},canonicalBatches:rows.length,actualPosterPaidWei:String(paid),actualPosterPaidETH:Number(paid)/1e18,artifactSHA256:digest(artifact),batches:rows,
 scope:'Actual GL3 poster transaction fees with parent timestamps in the first120s after worker launch. These batches may also contain system or other-user messages and are not attributed solely to demo transactions. No secrets/intents/logs or signing/broadcast.'};
const file=path.join(out,'parent-pilot.json');fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({file,SHA256:digest(fs.readFileSync(file)),...result,batches:undefined}));
