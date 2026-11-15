// Shanghai data-contract arithmetic, checked against actual isolated receipts.
// No contract or model-search engine is deployed by this program.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { formatEther } from 'ethers';
const CAPACITY=98303; // 96KiB runtime minus one STOP prefix.
const q=n=>BigInt(n), ceil=(n,d)=>Math.floor((n+d-1)/d);
function creation(payload){const runtime=Buffer.concat([Buffer.from([0]),payload]),s=runtime.length.toString(16).padStart(6,'0');return {runtime,init:Buffer.from('62'+s+'620000105f3962'+s+'5ff3'+runtime.toString('hex'),'hex')};}
function count(bytes){let zero=0;for(const n of bytes)if(n===0)zero++;return{zero,nonzero:bytes.length-zero};}
function shardGas(payload){
 const {runtime,init}=creation(payload),c=count(init),words=ceil(runtime.length,32);
 const components={transactionAndCreate:53000n,calldata:4n*q(c.zero)+16n*q(c.nonzero),initcodeMetering:2n*q(ceil(init.length,32)),minimalConstructor:16n+3n*q(words)+3n*q(words)+q(Math.floor(words*words/512)),codeDeposit:200n*q(runtime.length)};
 return{runtimeBytes:runtime.length,payloadBytes:payload.length,initcodeBytes:init.length,...components,total:Object.values(components).reduce((a,b)=>a+b,0n)};
}
function representative(n){const out=Buffer.alloc(n);for(let i=0;i<n;i+=32)createHash('sha256').update(`GH0ST_READ_ONLY_DATA_SHARD_${i}`).digest().copy(out,i,0,Math.min(32,n-i));return out;}
const receipts=JSON.parse(readFileSync(new URL('./local-gas-receipts.json',import.meta.url))).receipts;
const validation=[];
for(const runtimeBytes of [24576,98304]){
 const model=shardGas(representative(runtimeBytes-1)),receipt=receipts.find(x=>x.label===`DATA shard deploy ${runtimeBytes} runtime bytes`);
 assert.equal(model.total.toString(),receipt.gasUsed);
 validation.push({runtimeBytes,calculatedShanghaiGas:model.total,actualLocalReceiptGas:receipt.gasUsed,receiptHash:receipt.localReceiptHash,matched:true});
}
const file=new URL('../engine/.cache/Stockfish/src/nn-1a298aa575a0.nnue',import.meta.url);
const bytes=readFileSync(file),fileSha=createHash('sha256').update(bytes).digest('hex');
assert.equal(fileSha,'1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2');
const totals={transactionAndCreate:0n,calldata:0n,initcodeMetering:0n,minimalConstructor:0n,codeDeposit:0n,total:0n};
let shards=0,last;
for(let i=0;i<bytes.length;i+=CAPACITY){last=shardGas(bytes.subarray(i,Math.min(i+CAPACITY,bytes.length)));shards++;for(const key of Object.keys(totals))totals[key]+=last[key];}
const snap=JSON.parse(readFileSync(new URL('./mainnet-snapshot.json',import.meta.url)));
const price=BigInt(snap.gasPriceWei);
const layout=JSON.parse(readFileSync(new URL('../solidity-research/network-layout.json',import.meta.url)));
assert.equal(layout.networkSha256,fileSha);
const fixedWidthBytes=layout.decodedRawParameterBytes;
assert.equal(layout.decodedRawZeroBytes+layout.decodedRawNonzeroBytes,fixedWidthBytes);
const rawShards=ceil(fixedWidthBytes,CAPACITY);
const rawTotals=Object.fromEntries(Object.keys(totals).map(k=>[k,0n]));
// Header/STOP/copy costs depend on chunk length, while aggregate payload input gas
// depends only on zero/nonzero counts, not layout order or endianness.
for(let i=0;i<fixedWidthBytes;i+=CAPACITY){const n=Math.min(CAPACITY,fixedWidthBytes-i),row=shardGas(Buffer.alloc(n));for(const key of Object.keys(rawTotals))rawTotals[key]+=row[key];}
const replacePayloadGas=4n*q(layout.decodedRawZeroBytes)+16n*q(layout.decodedRawNonzeroBytes)-4n*q(fixedWidthBytes);
rawTotals.calldata+=replacePayloadGas;rawTotals.total+=replacePayloadGas;
const report={scope:'Calculated deployment gas for data-only STOP-prefixed code shards. Exact Shanghai arithmetic for the compressed NNUE file and source-parsed fixed-width parameter zero/nonzero counts, independently matched to two local deployment receipts. Not a full Stockfish Solidity port or a native full-game estimate.',generatedAt:new Date().toISOString(),runtimeCapacity:98304,payloadCapacity:CAPACITY,validation,compressedFile:{bytes:bytes.length,sha256:fileSha,shards,lastShardPayloadBytes:last.payloadBytes,gas:totals,codeDepositOnlyFloorGas:200n*q(bytes.length+shards),executionEthAtSnapshot:formatEther(totals.total*price)},decodedFixedWidth:{sourceDerivedBytes:fixedWidthBytes,zeroBytes:layout.decodedRawZeroBytes,nonzeroBytes:layout.decodedRawNonzeroBytes,sourceReport:'../solidity-research/network-layout.json',shards:rawShards,gas:rawTotals,executionEthAtSnapshot:formatEther(rawTotals.total*price),codeDepositOnlyFloorGas:200n*q(fixedWidthBytes+rawShards),codeDepositOnlyFloorEthAtSnapshot:formatEther(200n*q(fixedWidthBytes+rawShards)*price),note:'Lossless fixed-width parameter layout only. Does not include alternative SWAR-expanded weight representations, catalog/engine code, or full-game execution.'},pricing:{gasPriceWei:snap.gasPriceWei,snapshotBlock:snap.block.number,checkedAt:snap.checkedAt,parentFeeExcluded:true,parentFeeNote:'Shanghai arithmetic excludes Nitro fee buffering and parent posting fees; current RPC sample reports zero parent component, but this is not a future guarantee.'},excluded:['native search/rules engine deployment','shard catalogs and code hashes','NNUE decoding or extra representation','search state and execution','funding/entry/prize transactions','any future nonzero parent posting fee','Nitro estimate padding'],quote:{usdPerEth:1777.09,quotedAtApproxUTC:'2026-11-15 07:48 UTC',source:'web.finance ETH/USD tool quote supplied by parent task; illustrative only'}};
writeFileSync(new URL('./weight-deployment.json',import.meta.url),JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2));
