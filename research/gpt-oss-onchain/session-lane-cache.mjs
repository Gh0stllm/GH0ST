import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,hexlify,keccak256} from 'ethers';
import {compile,reference} from './session-optimize.mjs';
import {tile,packItems} from './session-lanes.mjs';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const deadline=args.deadline?Date.parse(args.deadline):Date.now()+600_000;
const lanes=args.lanes==='9'?9:8,groupCap=lanes===9?160:180;
const outputSource=lanes===9?'CachedNineLaneMxfp4.sol':'CachedLaneMxfp4.sol';
const outputReport=lanes===9?'nine-lane-cache-experiments.json':'lane-cache-experiments.json';
const original=fs.readFileSync(ROOT+(lanes===9?'NineLaneMxfp4.sol':'LaneMxfp4V2.sol'),'utf8');

function generated(unroll){
 let source=original;
 for(const load of ['calldataload','mload']){
  const marker='for {let j:=0} lt(j,32) {j:=add(j,1)} {';
  const start=source.indexOf(marker),end=source.indexOf('\nfor {let r:=0}',start);
  assert(start>=0&&end>start);
  let inner=source.slice(start+marker.length,end).trim();
  assert(inner.endsWith('}'));inner=inner.slice(0,-1);
  inner=lanes===9?inner.replace(`let n:=and(shr(sub(220,mul(and(j,1),4)),${load}(add(base,div(mul(j,9),2)))),0xfffffffff)`,'let n:=shr(220,ww)'):inner.replace(`let n:=shr(224,${load}(add(base,mul(j,4))))`,'let n:=shr(224,ww)');
  inner=inner.replace('let a:=sar(240,calldataload(add(xp,mul(j,2))))','let a:=sar(240,xx)');
  assert(!inner.includes('mul(j,'));
  const perChunk=lanes===9?4:8;
  const repeated=Array.from({length:unroll},()=>`{${inner}\nww:=shl(${lanes*4},ww)\nxx:=shl(16,xx)}\n`).join('');
  const loop=unroll===perChunk?repeated:`for {let j:=0} lt(j,${perChunk}) {j:=add(j,${unroll})} {${repeated}}`;
  const replacement=`for {let chunk:=0} lt(chunk,${32/perChunk}) {chunk:=add(chunk,1)} {let ww:=${load}(add(base,mul(chunk,${lanes*4*perChunk/8})))\nlet xx:=calldataload(add(xp,mul(chunk,${perChunk*2})))\n${loop}}`;
  source=source.slice(0,start)+replacement+source.slice(end);
 }
 return source;
}
async function main(){
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
const deploy=async build=>{const c=await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy();await c.waitForDeployment();return c;};
const report={status:'RUNNING_LANE_CACHE_RESEARCH',lanes,synthetic_only:true,started_at:new Date().toISOString(),candidates:[],validation:{cases:0,invalid_rejections:0},
limits:[`Only synthetic exact-Q32 ${lanes}-row tiles; no GPT-OSS full-model or mainnet claim.`,
`Supported domain: ${lanes} rows, <=${groupCap} groups, int16 inputs, encoded scale [96,160].`,
'Predeployed weight code is immutable local data; one-time deployment excluded from per-call gas and recorded separately.']};
const save=()=>fs.writeFileSync(ROOT+'evidence/'+outputReport,JSON.stringify(report,null,2)+'\n');
async function send(method,inputs){const tx=await method.populateTransaction(...inputs);const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});const receipt=await sent.wait();assert.equal(receipt.status,1);return {gas:Number(receipt.gasUsed),calldata_bytes:(tx.data.length-2)/2};}
async function dataStore(frames){const runtime=Buffer.concat([Buffer.from([0]),frames]);assert(runtime.length<=24576);const len=runtime.length.toString(16).padStart(4,'0');const tx=await signer.sendTransaction({data:'0x61'+len+'61000f60003961'+len+'6000f3'+runtime.toString('hex'),gasLimit:20_000_000});const receipt=await tx.wait();assert.equal(receipt.status,1);return {address:receipt.contractAddress,hash:keccak256(runtime),deployment_gas:Number(receipt.gasUsed),runtime_bytes:runtime.length};}
let best;
const training=[tile(0x764522,90),tile(0x583147,90)];
for(const runs of [200,10000,100000])for(const unroll of lanes===9?[1,2,4]:[1,2,4,8]){
 const text=generated(unroll),entry={runs,unroll,source_sha256:crypto.createHash('sha256').update(text).digest('hex')};
 try{const build=compile(text,runs,true,'LaneMxfp4'),contract=await deploy(build);entry.gas=[];
 for(const c of training){assert.deepEqual(Array.from(await contract.tile(hexlify(c.frames),c.x)),c.expected);report.validation.cases++;entry.gas.push((await send(contract.tile,[hexlify(c.frames),c.x])).gas);}
 entry.mean=entry.gas.reduce((a,b)=>a+b)/entry.gas.length;entry.runtime_bytes=build.evm.deployedBytecode.object.length/2;entry.status='PASS';
 if(!best||entry.mean<best.entry.mean){best={entry,contract,build,text};fs.writeFileSync(ROOT+outputSource,text);}
 }catch(error){entry.status='FAIL';entry.error=String(error);}
 report.candidates.push(entry);report.winner=best?.entry;save();console.log(JSON.stringify({stage:'cached_candidate',...entry}));
}
assert(best);report.source_sha256=best.entry.source_sha256;report.benchmarks=[];
for(const kind of ['dense','sparse','zeroInputs','zeroWeights','positiveBound','negativeBound']){
 const c=tile(0x712373,90,kind);assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);report.validation.cases++;
 const store=await dataStore(c.frames),codeArgs=[store.address,store.hash,90,c.x];assert.deepEqual(Array.from(await best.contract.tileCode(...codeArgs)),c.expected);report.validation.cases++;
 const calldata=await send(best.contract.tile,[hexlify(c.frames),c.x]),code=await send(best.contract.tileCode,codeArgs);
 const entry={kind,rows:lanes,groups:90,tile_calldata:calldata,tile_code:code,store,amortization_calls_vs_tile_calldata:calldata.gas>code.gas?Math.ceil(store.deployment_gas/(calldata.gas-code.gas)):null};
 report.benchmarks.push(entry);save();console.log(JSON.stringify({stage:'cached_bench',...entry}));
}
let last=Date.now();
for(let s=96;s<=160;s++)for(let b=0;b<256;b++){
 const c=tile(0x3281,1);
 for(let r=0;r<lanes;r++){c.items[r].w.fill((r%2?b>>4:b&15)*17);c.items[r].s[0]=s;}
 c.frames=packItems(c.items,1);
 assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.items.map(reference));report.validation.cases++;
 if(Date.now()-last>30000){save();console.log(JSON.stringify({stage:'cached_exhaustive',scale:s,byte:b,cases:report.validation.cases}));last=Date.now();}
}
report.validation.exhaustive_byte_scale_cases=16640;
for(const kind of ['positiveBound','negativeBound','dense']){const c=tile(0x776755,groupCap,kind);assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);const store=await dataStore(c.frames);assert.deepEqual(Array.from(await best.contract.tileCode(store.address,store.hash,groupCap,c.x)),c.expected);report.validation.cases+=2;}
for(let p=0;p<32;p++){const c=tile(0x880000+p,1);for(const item of c.items)item.x.fill(0);for(const item of c.items)item.x[p]=p%2?-32768:32767;c.x='0x'+Buffer.concat(c.items[0].x.map(v=>{const b=Buffer.alloc(2);b.writeInt16BE(v);return b;})).toString('hex');assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.items.map(reference));report.validation.cases++;}
const invalid=tile(71,1);invalid.frames[lanes*16+6]=95;await assert.rejects(best.contract.tile(hexlify(invalid.frames),invalid.x));report.validation.invalid_rejections++;
const badStore=await dataStore(invalid.frames);await assert.rejects(best.contract.tileCode(badStore.address,badStore.hash,1,invalid.x));report.validation.invalid_rejections++;
await assert.rejects(best.contract.tile('0x00','0x'));report.validation.invalid_rejections++;
const c1=tile(1,1);await assert.rejects(best.contract.tile(hexlify(c1.frames),'0x'));report.validation.invalid_rejections++;
await assert.rejects(best.contract.tile(hexlify(tile(1,groupCap+1).frames),tile(1,groupCap+1).x));report.validation.invalid_rejections++;
const goodStore=await dataStore(c1.frames);await assert.rejects(best.contract.tileCode(goodStore.address,'0x'+'00'.repeat(32),1,c1.x));report.validation.invalid_rejections++;
let index=0;
while(Date.now()<deadline){const groups=[0,1,2,3,7,8,16,31,64,90,128,groupCap][index%12],kind=['dense','dense','sparse','zeroWeights','zeroInputs','positiveBound','negativeBound'][Math.floor(index/12)%7];
 const c=tile((0x759ff+Math.imul(index+1,0x9e3779b9))>>>0,groups,kind);assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);report.validation.cases++;index++;report.validation.fuzz_cases=index;
 if(Date.now()-last>30000){save();console.log(JSON.stringify({stage:'cached_fuzz',cases:report.validation.cases,fuzz:index,remaining_seconds:Math.round((deadline-Date.now())/1000)}));last=Date.now();}}
report.status='PASS_SYNTHETIC_CACHED_LANES';report.finished_at=new Date().toISOString();save();await local.disconnect();console.log(JSON.stringify({stage:'cached_complete',cases:report.validation.cases,winner:best.entry}));
}
main().catch(e=>{fs.writeFileSync(ROOT+'evidence/'+(lanes===9?'nine-lane-cache-failure.json':'lane-cache-failure.json'),JSON.stringify({error:String(e),stack:e.stack},null,2)+'\n');console.error(e);process.exitCode=1;});
