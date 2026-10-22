import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,hexlify} from 'ethers';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
fs.mkdirSync(ROOT+'evidence',{recursive:true});
fs.mkdirSync(ROOT+'candidates',{recursive:true});
const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const start=options.start?Date.parse(options.start):Date.now();
const deadline=options.deadline?Date.parse(options.deadline):start+3_300_000;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const original=fs.readFileSync(ROOT+'Mxfp4Kernel.sol','utf8');
const LUT='0x000102030406080c00fffefdfcfaf8f400000000000000000000000000000000';

export function kernelBody(kind) {
  if(kind==='direct16') {
    let code='let ww := calldataload(wp)\nlet xa := calldataload(xp)\nlet xb := calldataload(add(xp,32))\n';
    for(let j=0;j<16;j++) {
      const ax=j<8?'xa':'xb',shift=240-(j%8)*32;
      const extract=(s)=>s===0?`signextend(1,${ax})`:`signextend(1,shr(${s},${ax}))`;
      code+=`{ let b := byte(${j},ww)\n dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),${extract(shift)}),mul(signextend(0,byte(shr(4,b),lut)),${extract(shift-16)}))) }\n`;
    }
    return code;
  }
  const n=Number(kind.replace('shift',''));
  let body='';
  for(let j=0;j<n;j++) {
    body+=' { let b := byte(0,ww)\n dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))\n ww := shl(8,ww)\n xx := shl(32,xx) }\n';
  }
  const loop=n===8?body:`for {let j:=0} lt(j,8) {j:=add(j,${n})} {${body}}`;
  return `for {let p:=0} lt(p,2) {p:=add(p,1)} { let ww:=calldataload(add(wp,mul(p,8)))\n let xx:=calldataload(add(xp,mul(p,32)))\n ${loop} }`;
}

export function sourceFor(kind,skip) {
  let body=kernelBody(kind);
  if(skip) body=`if and(iszero(iszero(and(shr(128,calldataload(wp)),0x77777777777777777777777777777777))),iszero(iszero(or(calldataload(xp),calldataload(add(xp,32)))))) { ${body} }`;
  return `// SPDX-License-Identifier: MIT\npragma solidity 0.8.30;\n/// @notice Synthetic-fixture research kernel; no full-model inference.\n/// @dev Signed-int16 operands; exact Q32 dyadic arithmetic, scales [96,160], <=4096 groups.\ncontract OptimizedMxfp4 {\nfunction packed(bytes calldata w,bytes calldata scales,bytes calldata x) external pure returns(int256 result) {\nrequire(w.length%16==0 && scales.length==w.length/16 && x.length==w.length*4 && scales.length<=4096);\nassembly ("memory-safe") {\nlet lut:=${LUT}\nfor {let g:=0} lt(g,scales.length) {g:=add(g,1)} {\nlet s:=byte(0,calldataload(add(scales.offset,g)))\nif or(lt(s,96),gt(s,160)) {revert(0,0)}\nlet wp:=add(w.offset,mul(g,16))\nlet xp:=add(x.offset,mul(g,64))\nlet dot:=0\n${body}\nresult:=add(result,shl(sub(s,96),dot))\n}\n}\n}\n}\n`;
}

export function fixture(seed,groups,kind='dense') {
  let state=(seed>>>0)||1;
  const rng=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  const w=Buffer.alloc(groups*16),s=Buffer.alloc(groups),x=[];
  for(let i=0;i<w.length;i++)w[i]=rng()>>>24;
  for(let i=0;i<s.length;i++)s[i]=96+(rng()%65);
  for(let i=0;i<groups*32;i++)x.push((rng()>>>16)-32768);
  if(kind==='zeroWeights')w.fill(0x88);
  if(kind==='zeroInputs')x.fill(0);
  if(kind==='sparse')for(let g=0;g<groups;g++)if(g%4)w.fill(g%2?0:0x88,g*16,g*16+16);
  if(kind==='positiveBound'){w.fill(0x77);s.fill(160);x.fill(32767);}
  if(kind==='negativeBound'){w.fill(0x77);s.fill(160);x.fill(-32768);}
  return {w,s,x,kind,seed};
}
export function reference(c) {
  let out=0n;
  for(let g=0;g<c.s.length;g++) {
    assert(c.s[g]>=96&&c.s[g]<=160);
    let dot=0n;
    for(let j=0;j<32;j++) {
      const nib=(c.w[g*16+(j>>1)]>>((j&1)*4))&15,e=(nib>>1)&3,m=nib&1;
      let v=e===0?m:((2+m)<<(e-1));if(nib&8)v=-v;
      dot+=BigInt(v)*BigInt(c.x[g*32+j]);
    }
    out+=dot*(1n<<BigInt(c.s[g]-96));
  }
  return out;
}
export function operands(c) {
  const x=Buffer.alloc(c.x.length*2);c.x.forEach((v,i)=>x.writeInt16BE(v,2*i));
  return [hexlify(c.w),hexlify(c.s),hexlify(x)];
}
export function compile(source,runs=200,viaIR=true,name='OptimizedMxfp4') {
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'kernel.sol':{content:source}},settings:{optimizer:{enabled:true,runs},viaIR,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
  const errors=(compiled.errors??[]).filter(e=>e.severity==='error');
  if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
  return compiled.contracts['kernel.sol'][name];
}

async function main() {
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;
const signer=await provider.getSigner();
const deploy=async build=>{const c=await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy();await c.waitForDeployment();return c;};
const baselineBuild=compile(original,200,true,'Mxfp4Kernel');
const baseline=await deploy(baselineBuild);
const training=[fixture(0x13579,90),fixture(0xbad5eed,90)];
const holdouts=['dense','zeroWeights','zeroInputs','sparse'].map((kind,i)=>fixture(0x80ffee+i*0x12345,90,kind));
const result={status:'RUNNING_SYNTHETIC_ONLY',started_at:new Date(start).toISOString(),deadline:new Date(deadline).toISOString(),
  environment:{solc:solc.version(),node:process.version,ganache:'7.9.2',ethers:'6.13.5',hardfork:'shanghai',chain_id:31337},
  baseline_sha256:sha(original),candidates:[],validation:{cases:0,invalid_rejections:0,failures:[]},
  limitations:['All weights and activations synthetic. No GPT-OSS model inference or quality evaluation.',
  'Local EVM receipts include intrinsic/calldata gas. No mainnet performance claim.',
  'Candidate domain adds a 4096-group limit to prove assembly accumulators cannot overflow.',
  'Arithmetic exactness is bounded dyadic Q32, not full BF16 model equivalence.']};
function checkpoint(){fs.writeFileSync(ROOT+'evidence/optimization-session.json',JSON.stringify(result,null,2)+'\n');}
async function parity(contract,c,checkOld=false){const want=reference(c),args=operands(c);assert.equal(await contract.packed(...args),want);if(checkOld)assert.equal(await baseline.packed(...args),want);result.validation.cases++;}
async function gas(contract,c){const tx=await contract.packed.populateTransaction(...operands(c));const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});const receipt=await sent.wait();assert.equal(receipt.status,1);return Number(receipt.gasUsed);}
result.original_baseline_gas=[];
for(const c of [...training,...holdouts])result.original_baseline_gas.push({seed:c.seed,kind:c.kind,gas:await gas(baseline,c)});
checkpoint();
let winner;
for(const runs of [1,200,1000,10000])for(const kind of ['shift1','shift2','shift4','shift8','direct16'])for(const skip of [false,true]) {
  const name=`${kind}-${skip?'skip':'dense'}-runs${runs}`,source=sourceFor(kind,skip);
  const entry={name,runs,kind,skip,source_sha256:sha(source)};
  try {
    const build=compile(source,runs,true),contract=await deploy(build);
    entry.runtime_bytes=build.evm.deployedBytecode.object.length/2;
    entry.training=[];
    for(const c of training){await parity(contract,c);entry.training.push(await gas(contract,c));}
    for(const c of [fixture(12,1,'zeroWeights'),fixture(13,8,'zeroInputs'),fixture(14,65,'positiveBound'),fixture(15,65,'negativeBound')])await parity(contract,c);
    entry.mean_training_gas=entry.training.reduce((a,b)=>a+b)/entry.training.length;
    entry.status='PASS';
    if(!winner||entry.mean_training_gas<winner.entry.mean_training_gas){winner={entry,source,contract,build};fs.writeFileSync(ROOT+'OptimizedMxfp4.sol',source);}
  } catch(e){entry.status='FAIL';entry.error=String(e);}
  result.candidates.push(entry);result.winner=winner?.entry;checkpoint();
  console.log(JSON.stringify({stage:'candidate',name,status:entry.status,gas:entry.mean_training_gas,best:winner?.entry.name,best_gas:winner?.entry.mean_training_gas}));
}
assert(winner,'No passing candidate');
result.heldout=[];
for(let i=0;i<holdouts.length;i++){const c=holdouts[i];await parity(winner.contract,c,true);const used=await gas(winner.contract,c),old=result.original_baseline_gas[training.length+i].gas;result.heldout.push({seed:c.seed,kind:c.kind,groups:90,old_gas:old,new_gas:used,reduction_percent:100*(old-used)/old});}
result.winner_source_sha256=sha(winner.source);
result.winner_bytecode_sha256=sha(Buffer.from(winner.build.evm.deployedBytecode.object,'hex'));
checkpoint();console.log(JSON.stringify({stage:'winner',winner:result.winner,heldout:result.heldout}));
// Exhaustive constant-byte E2M1 pairs x every supported scale, with asymmetric activations.
let lastProgress=Date.now();
for(let scale=96;scale<=160;scale++)for(let byte=0;byte<256;byte++) {
  const c={w:Buffer.alloc(16,byte),s:Buffer.from([scale]),x:Array.from({length:32},(_,i)=>i%2?-32768:32767)};
  await parity(winner.contract,c,scale===127);
  if(Date.now()-lastProgress>30_000){checkpoint();console.log(JSON.stringify({stage:'exhaustive',scale,byte,cases:result.validation.cases}));lastProgress=Date.now();}
}
result.validation.exhaustive_scale_byte_pairs=65*256;
for(let position=0;position<32;position++){const c=fixture(0x8899+position,1);c.x.fill(0);c.x[position]=position%2?-32768:32767;await parity(winner.contract,c,true);}
// Validate accepted maximums, then domain and shape failures. Bound cases stress signed accumulation.
for(const kind of ['positiveBound','negativeBound','dense'])await parity(winner.contract,fixture(19,4096,kind));
for(const c of [fixture(11,0),fixture(11,1),fixture(11,90)])await parity(winner.contract,c);
const invalid=[];
for(const scale of [0,95,161,255]){const c=fixture(1,1);c.s[0]=scale;invalid.push(operands(c));}
invalid.push(['0x00','0x60','0x00']);
invalid.push(['0x'+'00'.repeat(16),'0x60','0x'+'00'.repeat(62)]);
invalid.push(['0x'+'00'.repeat(16),'0x6060','0x'+'00'.repeat(64)]);
invalid.push(operands(fixture(1,4097)));
for(const args of invalid){await assert.rejects(winner.contract.packed(...args));result.validation.invalid_rejections++;}
result.validation.boundary_cases_complete=true;checkpoint();
// Time-boxed held-out differential fuzz: varied groups, density, signs and full supported scales.
let index=0;
const groupCounts=[1,2,3,7,8,16,31,32,64,90,128,256];
const distributions=['dense','dense','dense','sparse','zeroInputs','zeroWeights','positiveBound','negativeBound'];
while(Date.now()<deadline) {
  const groups=groupCounts[index%groupCounts.length],kind=distributions[Math.floor(index/groupCounts.length)%distributions.length];
  const c=fixture((0x9e3779b9+Math.imul(index+1,0x45d9f3b))>>>0,groups,kind);
  await parity(winner.contract,c,index%128===0);
  index++;result.validation.fuzz_cases=index;
  if(Date.now()-lastProgress>30_000){checkpoint();console.log(JSON.stringify({stage:'fuzz',cases:result.validation.cases,fuzz_cases:index,elapsed_seconds:Math.round((Date.now()-start)/1000),remaining_seconds:Math.max(0,Math.round((deadline-Date.now())/1000))}));lastProgress=Date.now();}
}
result.status='PASS_SYNTHETIC_OPTIMIZATION_SESSION';result.finished_at=new Date().toISOString();result.elapsed_seconds=(Date.now()-start)/1000;checkpoint();
await local.disconnect();console.log(JSON.stringify({stage:'complete',cases:result.validation.cases,winner:result.winner.name,heldout:result.heldout}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{fs.writeFileSync(ROOT+'evidence/session-failure.json',JSON.stringify({error:String(e),stack:e.stack},null,2)+'\n');console.error(e);process.exitCode=1;});
