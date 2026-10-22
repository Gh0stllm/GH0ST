import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,hexlify,keccak256} from 'ethers';
import {compile,reference} from './session-optimize.mjs';
import {tile,packItems} from './session-lanes.mjs';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const lanes=options.lanes==='9'?9:8,cap=lanes===9?160:180;
const deadline=options.deadline?Date.parse(options.deadline):Date.now()+300_000;
const outputSource=lanes===9?'HelperNineLaneMxfp4.sol':'HelperLaneMxfp4.sol';
const outputReport=lanes===9?'nine-lane-helper-experiments.json':'lane-helper-experiments.json';
function converted(text){
 const ones=text.match(/let ones:=(0x[0-9a-f]+)/)?.[1];assert(ones);
 const begin=text.indexOf('n:=and(or(n,shl('),end=text.indexOf('\nlet a:=',begin);assert(begin>=0&&end>begin);
 const decoder=text.slice(begin,end);assert(decoder.includes('let weights:='));
 let next=text.split(decoder).join('let weights:=decode(n)');
 next=next.split('let ones:='+ones).join('');
 const helper=`function decode(n)->weights {let ones:=${ones}\n${decoder.replace('let weights:=','weights:=')}\n}\n`;
 next=next.split('assembly ("memory-safe"){').join('assembly ("memory-safe"){'+helper);
 assert(next!==text);return next;
}
async function main(){
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
const deploy=async b=>{const c=await new ContractFactory(b.abi,b.evm.bytecode.object,signer).deploy();await c.waitForDeployment();return c;};
const report={status:'RUNNING_DECODER_HELPER',lanes,synthetic_only:true,candidates:[],validation:{cases:0,invalid_rejections:0},
limits:[`Exactly ${lanes} rows, <=${cap} groups; synthetic fixed-point arithmetic only.`,
'No real GPT-OSS weights, full-model inference, quality or mainnet result.']};
const save=()=>fs.writeFileSync(ROOT+'evidence/'+outputReport,JSON.stringify(report,null,2)+'\n');
const send=async(method,args)=>{const tx=await method.populateTransaction(...args),sent=await signer.sendTransaction({...tx,gasLimit:90_000_000}),receipt=await sent.wait();assert.equal(receipt.status,1);return {gas:Number(receipt.gasUsed),calldata_bytes:(tx.data.length-2)/2};};
async function dataStore(frames){const runtime=Buffer.concat([Buffer.from([0]),frames]);const len=runtime.length.toString(16).padStart(4,'0');const tx=await signer.sendTransaction({data:'0x61'+len+'61000f60003961'+len+'6000f3'+runtime.toString('hex'),gasLimit:20_000_000});const r=await tx.wait();assert.equal(r.status,1);return {address:r.contractAddress,hash:keccak256(runtime),deployment_gas:Number(r.gasUsed),runtime_bytes:runtime.length};}
const files=lanes===9?['NineLaneMxfp4.sol','CachedNineLaneMxfp4.sol']:['LaneMxfp4V2.sol','CachedLaneMxfp4.sol'];
const training=[tile(0x764522,90),tile(0x583147,90)];let best;
for(const file of files)for(const runs of [200,10000,100000]){
 const text=converted(fs.readFileSync(ROOT+file,'utf8')),entry={input_source:file,runs,source_sha256:crypto.createHash('sha256').update(text).digest('hex')};
 try{const build=compile(text,runs,true,'LaneMxfp4'),contract=await deploy(build);entry.gas=[];
 for(const c of training){assert.deepEqual(Array.from(await contract.tile(hexlify(c.frames),c.x)),c.expected);report.validation.cases++;entry.gas.push((await send(contract.tile,[hexlify(c.frames),c.x])).gas);}
 entry.mean=entry.gas.reduce((a,b)=>a+b)/2;entry.runtime_bytes=build.evm.deployedBytecode.object.length/2;entry.status='PASS';
 if(!best||entry.mean<best.entry.mean){best={entry,contract,text};fs.writeFileSync(ROOT+outputSource,text);}
 }catch(e){entry.status='FAIL';entry.error=String(e);}
 report.candidates.push(entry);report.winner=best?.entry;save();console.log(JSON.stringify({stage:'decoder_helper_candidate',lanes,...entry}));
}
assert(best);report.source_sha256=best.entry.source_sha256;report.benchmarks=[];
for(const kind of ['dense','sparse','zeroInputs','zeroWeights','positiveBound','negativeBound']){
 const c=tile(0x712373,90,kind);assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);const store=await dataStore(c.frames),args=[store.address,store.hash,90,c.x];assert.deepEqual(Array.from(await best.contract.tileCode(...args)),c.expected);report.validation.cases+=2;
 report.benchmarks.push({kind,rows:lanes,groups:90,tile_calldata:await send(best.contract.tile,[hexlify(c.frames),c.x]),tile_code:await send(best.contract.tileCode,args),store});save();console.log(JSON.stringify({stage:'decoder_helper_bench',lanes,...report.benchmarks.at(-1)}));
}
let last=Date.now();
for(let scale=96;scale<=160;scale++)for(let b=0;b<256;b++){
 const c=tile(0x3281,1);for(let r=0;r<lanes;r++){c.items[r].w.fill((r%2?b>>4:b&15)*17);c.items[r].s[0]=scale;}c.frames=packItems(c.items,1);
 assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.items.map(reference));report.validation.cases++;
 if(Date.now()-last>30000){save();console.log(JSON.stringify({stage:'decoder_helper_exhaustive',lanes,scale,byte:b,cases:report.validation.cases}));last=Date.now();}
}
report.validation.exhaustive_byte_scale_cases=16640;
for(const kind of ['positiveBound','negativeBound','dense']){const c=tile(0x776755,cap,kind);assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);const store=await dataStore(c.frames);assert.deepEqual(Array.from(await best.contract.tileCode(store.address,store.hash,cap,c.x)),c.expected);report.validation.cases+=2;}
const invalid=tile(71,1);invalid.frames[lanes*16+6]=95;await assert.rejects(best.contract.tile(hexlify(invalid.frames),invalid.x));report.validation.invalid_rejections++;
const badStore=await dataStore(invalid.frames);await assert.rejects(best.contract.tileCode(badStore.address,badStore.hash,1,invalid.x));report.validation.invalid_rejections++;
await assert.rejects(best.contract.tile('0x00','0x'));report.validation.invalid_rejections++;
const c1=tile(1,1);await assert.rejects(best.contract.tile(hexlify(c1.frames),'0x'));report.validation.invalid_rejections++;
const over=tile(1,cap+1);await assert.rejects(best.contract.tile(hexlify(over.frames),over.x));report.validation.invalid_rejections++;
const goodStore=await dataStore(c1.frames);await assert.rejects(best.contract.tileCode(goodStore.address,'0x'+'00'.repeat(32),1,c1.x));report.validation.invalid_rejections++;
let index=0;
while(Date.now()<deadline){const groups=[0,1,2,3,7,8,16,31,64,90,128,cap][index%12],kind=['dense','dense','sparse','zeroWeights','zeroInputs','positiveBound','negativeBound'][Math.floor(index/12)%7];const c=tile((0x759ff+Math.imul(index+1,0x9e3779b9))>>>0,groups,kind);
assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);report.validation.cases++;index++;report.validation.fuzz_cases=index;
if(Date.now()-last>30000){save();console.log(JSON.stringify({stage:'decoder_helper_fuzz',lanes,cases:report.validation.cases,remaining_seconds:Math.round((deadline-Date.now())/1000)}));last=Date.now();}}
report.status='PASS_SYNTHETIC_DECODER_HELPER';report.finished_at=new Date().toISOString();save();await local.disconnect();console.log(JSON.stringify({stage:'decoder_helper_complete',lanes,cases:report.validation.cases}));
}
main().catch(e=>{fs.writeFileSync(ROOT+'evidence/'+(lanes===9?'nine-lane-helper-failure.json':'lane-helper-failure.json'),JSON.stringify({error:String(e),stack:e.stack},null,2)+'\n');console.error(e);process.exitCode=1;});
