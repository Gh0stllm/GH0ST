import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,keccak256} from 'ethers';
import {compile} from './session-optimize.mjs';
import {tile} from './session-lanes.mjs';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const deadline=options.deadline?Date.parse(options.deadline):Date.now()+300_000;
const source=fs.readFileSync(ROOT+'HelperLaneMxfp4.sol','utf8');
const sourceHash=crypto.createHash('sha256').update(source).digest('hex');
async function main(){
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
const build=compile(source,10000,true,'LaneMxfp4'),contract=await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy();await contract.waitForDeployment();
const report={status:'RUNNING_PERSISTENT_CODE_VALIDATION',started_at:new Date().toISOString(),synthetic_only:true,source_sha256:sourceHash,
validation:{cases:0,invalid_rejections:0},coverage:{},examples:[],
limits:['Local immutable synthetic weight shards only; no trained GPT-OSS data or mainnet transactions.',
'This expands correctness coverage of the selected code-reading path; it is not another gas benchmark.']};
const save=()=>fs.writeFileSync(ROOT+'evidence/code-path-validation.json',JSON.stringify(report,null,2)+'\n');
async function dataStore(frames,prefix=0){const runtime=Buffer.concat([Buffer.from([prefix]),frames]);assert(runtime.length<=24576);const len=runtime.length.toString(16).padStart(4,'0');const sent=await signer.sendTransaction({data:'0x61'+len+'61000f60003961'+len+'6000f3'+runtime.toString('hex'),gasLimit:20_000_000});const receipt=await sent.wait();assert.equal(receipt.status,1);return {address:receipt.contractAddress,hash:keccak256(runtime)};}
const a=tile(0x5544,1),badPrefix=await dataStore(a.frames,1);
await assert.rejects(contract.tileCode(badPrefix.address,badPrefix.hash,1,a.x));report.validation.invalid_rejections++;
const extra=await dataStore(Buffer.concat([a.frames,Buffer.from([0])])),short=await dataStore(a.frames.subarray(0,a.frames.length-1));
for(const store of [extra,short]){await assert.rejects(contract.tileCode(store.address,store.hash,1,a.x));report.validation.invalid_rejections++;}
const badScale=tile(1,1);badScale.frames[128+7]=255;const invalid=await dataStore(badScale.frames);
await assert.rejects(contract.tileCode(invalid.address,invalid.hash,1,badScale.x));report.validation.invalid_rejections++;
let index=0,last=Date.now();
while(Date.now()<deadline){
const groups=[0,1,2,3,7,8,15,16,31,32,63,64,90,128,179,180][index%16],kind=['dense','dense','sparse','zeroInputs','zeroWeights','positiveBound','negativeBound'][Math.floor(index/16)%7];
const seed=(0x51983+Math.imul(index+1,0x9e3779b9))>>>0,c=tile(seed,groups,kind),store=await dataStore(c.frames);
assert.deepEqual(Array.from(await contract.tileCode(store.address,store.hash,groups,c.x)),c.expected);report.validation.cases++;
const coverage=groups+':'+kind;report.coverage[coverage]=(report.coverage[coverage]??0)+1;
if(index%32===0){await assert.rejects(contract.tileCode(store.address,'0x'+'00'.repeat(32),groups,c.x));report.validation.invalid_rejections++;}
if(report.examples.length<6)report.examples.push({seed,groups,kind,weight_code_hash:store.hash,result_q32:c.expected.map(String)});
index++;report.validation.fuzz_cases=index;
if(Date.now()-last>30000){save();console.log(JSON.stringify({stage:'persistent_code',cases:index,rejections:report.validation.invalid_rejections,remaining_seconds:Math.round((deadline-Date.now())/1000)}));last=Date.now();}
}
report.status='PASS_SYNTHETIC_PERSISTENT_CODE_PATH';report.finished_at=new Date().toISOString();save();await local.disconnect();console.log(JSON.stringify({stage:'persistent_code_complete',validation:report.validation}));
}
main().catch(e=>{fs.writeFileSync(ROOT+'evidence/code-path-failure.json',JSON.stringify({error:String(e),stack:e.stack},null,2)+'\n');console.error(e);process.exitCode=1;});
