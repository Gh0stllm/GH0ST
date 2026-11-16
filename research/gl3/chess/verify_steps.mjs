// Verify actual WAVM witnesses using the pinned Solidity one-step verifier.
// No public chain, real funds or weakened chess policy is involved.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../..');
const require=createRequire(path.join(repo,'research/chess/package.json'));
const ganache=require('ganache');
const {BrowserProvider,ContractFactory,ZeroAddress}=require('ethers');
const options=process.argv.slice(2),aot=options.includes('--aot'),sliced=aot||options.includes('--sliced');
const stem=options.find(x=>!x.startsWith('--'))||'prefix';
if(!/^[a-z0-9-]+$/.test(stem))throw Error('bad fixture name');
const dir=path.join(here,aot?'sliced/aot/.cache/'+(options.includes('--next')?'proof-next':'proof-first'):sliced?'sliced/.cache/blocks':'.cache/block');
const proofPath=sliced?path.join(dir,'selected-proofs.json'):stem==='search-selected'?path.join(dir,'search-selected/selected-proofs.json'):stem==='complete'?path.join(dir,'complete-selected-proofs.json'):stem==='selected'?path.join(dir,'selected/selected-proofs.json'):path.join(dir,stem+'-proofs.json');
const logPath=sliced?path.join(dir,'prover.log'):path.join(here,'prover-'+(stem==='complete'?'full':stem)+'.log');
const rows=JSON.parse(fs.readFileSync(proofPath,'utf8'));
const clean=fs.readFileSync(logPath,'utf8').replace(/\x1b\[[0-9;]*m/g,'');
const logSteps=[...clean.matchAll(/Generating proof\s+\d+\s+\(inst\s+([\d,]+)\)/g)].map(x=>BigInt(x[1].replaceAll(',','')));
const steps=rows.every(x=>typeof x.step==='string')?rows.map(x=>BigInt(x.step)):logSteps;
if(steps.length!==rows.length && !clean.includes('End machine status: Finished'))throw Error('proof/step count');
const base=path.join(repo,'research/chess/l3/nitro/.cache/contracts-provenance/compiled-main/build/contracts/src/osp');
const server=ganache.provider({logging:{quiet:true},chain:{chainId:13371,hardfork:'shanghai'},miner:{blockGasLimit:100000000},wallet:{deterministic:true}});
const provider=new BrowserProvider(server),signer=await provider.getSigner();
// Decode only the authenticated instruction location, using upstream Deserialize.machine's layout.
function location(hex){
 const b=Buffer.from(hex,'hex');let o=1;
 const stack=()=>{const n=BigInt('0x'+b.subarray(o+32,o+64).toString('hex'));if(n>100n)throw Error('unexpected stack window');o+=64+33*Number(n)};
 stack();o+=64;stack();o+=32;const has=b[o++];if(has)o+=73;o+=64+32;
 return {module:b.readUInt32BE(o),function:b.readUInt32BE(o+4),pc:b.readUInt32BE(o+8)};
}
const artifacts={};
async function deploy(name,args=[]){
 const file=path.join(base,name+'.sol',name+'.json'),bytes=fs.readFileSync(file);const a=JSON.parse(bytes);artifacts[name]=createHash('sha256').update(bytes).digest('hex');
 const c=await new ContractFactory(a.abi,a.bytecode,signer).deploy(...args,{gasLimit:30000000});await c.waitForDeployment();return c;
}
try{
 const p0=await deploy('OneStepProver0'),mem=await deploy('OneStepProverMemory'),math=await deploy('OneStepProverMath'),io=await deploy('OneStepProverHostIo',[ZeroAddress]);
 const entry=await deploy('OneStepProofEntry',await Promise.all([p0,mem,math,io].map(x=>x.getAddress())));
 const manifest=sliced&&fs.existsSync(path.join(dir,'proof-manifest.json'))?JSON.parse(fs.readFileSync(path.join(dir,'proof-manifest.json'),'utf8')):null;
 const root=manifest?.moduleRoot||fs.readFileSync(path.join(here,sliced?'.cache/machine-sliced/module-root.txt':'.cache/machine/module-root.txt'),'utf8').trim();
 const context={maxInboxMessagesRead:1000000n,bridge:ZeroAddress,initialWasmModuleRoot:root};
 const records=[];
 for(let i=0;i<steps.length;i++){
  const r=rows[i];const actual=await entry.proveOneStep(context,steps[i],'0x'+r.before,'0x'+r.proof,{gasLimit:30000000});
  if(actual.toLowerCase()!=='0x'+r.after.toLowerCase())throw Error('after mismatch '+i);
  const corruptBefore='0x'+(BigInt('0x'+r.before)^1n).toString(16).padStart(64,'0');
  let rejected=false;try{const wrong=await entry.proveOneStep(context,steps[i],corruptBefore,'0x'+r.proof,{gasLimit:30000000});rejected=wrong.toLowerCase()!=='0x'+r.after.toLowerCase()}catch{rejected=true}
  if(!rejected)throw Error('corrupt pre-state accepted');
  const changed=Buffer.from(r.proof,'hex');changed[0]^=1;let badProof=false;
  try{const wrong=await entry.proveOneStep(context,steps[i],'0x'+r.before,'0x'+changed.toString('hex'),{gasLimit:30000000});badProof=wrong.toLowerCase()!=='0x'+r.after.toLowerCase()}catch{badProof=true}
  if(!badProof)throw Error('corrupt witness accepted');
  records.push({step:String(steps[i]),reason:r.reason||null,moduleName:r.moduleName||null,functionName:r.functionName||null,location:location(r.proof),before:r.before,after:r.after,proofBytes:r.proof.length/2,corruptBeforeRejected:rejected,corruptProofRejected:badProof});
 }
 const scope=sliced?'Real Solidity verification of sampled steps from the complete recorded sliced block; not a complete24m-move WAVM run or full BoLD dispute':['full','complete'].includes(stem)?'Real Solidity verification of sampled witnesses from complete replay; not a full BoLD challenge':'Real Solidity verification of bounded trace witnesses; no complete chess replay or engine-search proof implied';
 const report={passed:true,scope,sliced,experimentalAOTProof:aot,proofFileSHA256:createHash('sha256').update(fs.readFileSync(proofPath)).digest('hex'),moduleRoot:root,verifierSourceCommit:'4341b132cfbdcc980ead03765ca5224ff6cb5d97',artifacts,records,publicDeployment:false,realSpend:0};
 fs.writeFileSync(path.join(dir,stem+'-solidity-steps.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await server.disconnect()}
