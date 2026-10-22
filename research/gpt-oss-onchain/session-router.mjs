import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory} from 'ethers';
import {compile} from './session-optimize.mjs';
const ROOT=fileURLToPath(new URL('.',import.meta.url)),source=fs.readFileSync(ROOT+'RouterTop4.sol','utf8');
const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const deadline=options.deadline?Date.parse(options.deadline):Date.now()+300_000;
function scores(seed,kind){return Array.from({length:32},(_,i)=>{
if(kind==='ascending')return BigInt(i);if(kind==='descending')return BigInt(31-i);
if(kind==='allMin')return -(1n<<255n);if(kind==='allMax')return (1n<<255n)-1n;
const raw=BigInt('0x'+crypto.createHash('sha256').update(seed+':'+i).digest('hex'));
if(kind==='ties')return (raw%5n)-2n;return BigInt.asIntN(256,raw);
});}
function cpu(values){return values.map((v,i)=>({v,i})).sort((a,b)=>a.v>b.v?-1:a.v<b.v?1:a.i-b.i).slice(0,4).map(x=>BigInt(x.i));}
async function main(){
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
const build=compile(source,10000,true,'RouterTop4'),contract=await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy();await contract.waitForDeployment();
const report={status:'RUNNING_SYNTHETIC_TOP4',source_sha256:crypto.createHash('sha256').update(source).digest('hex'),benchmarks:[],validation:{cases:0},
limits:['32 integer scores, top-4 only; ties choose lower index.',
'No real router weights, model score calculation, gate softmax or trained-model parity.',
'Gas comparison is against our full insertion-sort control, not an existing optimized GPT-OSS implementation.']};
const save=()=>fs.writeFileSync(ROOT+'evidence/router-experiments.json',JSON.stringify(report,null,2)+'\n');
async function validate(values,control=true){const want=cpu(values);assert.deepEqual(Array.from(await contract.selected(values)),want);if(control)assert.deepEqual(Array.from(await contract.sortedControl(values)),want);report.validation.cases++;}
async function gas(method,values){const tx=await contract[method].populateTransaction(values);const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});const receipt=await sent.wait();assert.equal(receipt.status,1);return Number(receipt.gasUsed);}
for(const kind of ['random','ascending','descending','ties','allMin','allMax']){
const values=scores('heldout-router',kind);await validate(values);const before=await gas('sortedControl',values),after=await gas('selected',values);
report.benchmarks.push({kind,full_sort_control_gas:before,streaming_top4_gas:after,reduction_percent:100*(before-after)/before});save();console.log(JSON.stringify({stage:'router_bench',...report.benchmarks.at(-1)}));
}
for(let pos=0;pos<32;pos++){const s=Array(32).fill(-(1n<<255n));s[pos]=(1n<<255n)-1n;await validate(s);}
// Held-out differential fuzz with broad signed values and deliberately tied scores.
let index=0,last=Date.now();
while(Date.now()<deadline){const values=scores('fuzz-'+index,index%3?'random':'ties');await validate(values,index%16===0);index++;report.validation.fuzz_cases=index;
if(Date.now()-last>30000){save();console.log(JSON.stringify({stage:'router_fuzz',cases:report.validation.cases,remaining_seconds:Math.round((deadline-Date.now())/1000)}));last=Date.now();}}
report.status='PASS_SYNTHETIC_TOP4_SELECTION';report.finished_at=new Date().toISOString();save();await local.disconnect();console.log(JSON.stringify({stage:'router_complete',cases:report.validation.cases}));
}
main().catch(e=>{fs.writeFileSync(ROOT+'evidence/router-failure.json',JSON.stringify({error:String(e),stack:e.stack},null,2)+'\n');console.error(e);process.exitCode=1;});
