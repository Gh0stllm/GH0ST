import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, hexlify } from 'ethers';

const root = fileURLToPath(new URL('.', import.meta.url));
const synthetic = process.argv.includes('--synthetic');
const fixtureWeights = Buffer.from(Array.from({length:4*90*16},(_,i)=>(i*73+(i>>>3)*29+17)&255));
const fixtureScales = Buffer.from(Array.from({length:4*90},(_,i)=>115+i%8));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sample = synthetic ? {model:'MXFP4 synthetic fixture; NOT GPT-OSS weights',revision:null,
  rows:4,groups_per_row:90,block_hex:fixtureWeights.toString('hex'),scale_hex:fixtureScales.toString('hex'),
  block_sha256:sha(fixtureWeights),scale_sha256:sha(fixtureScales)}
  : JSON.parse(fs.readFileSync(root + 'evidence/sample.json'));
const source = fs.readFileSync(root + 'Mxfp4Kernel.sol', 'utf8');
const compiled = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',
  sources:{'Mxfp4Kernel.sol':{content:source}}, settings:{optimizer:{enabled:true,runs:200},
    viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
for (const e of compiled.errors ?? []) if (e.severity === 'error') throw Error(e.formattedMessage);
const build = compiled.contracts['Mxfp4Kernel.sol'].Mxfp4Kernel;
const local = ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},
  miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider = new BrowserProvider(local); provider.pollingInterval = 10;
const signer = await provider.getSigner();
const contract = await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy();
await contract.waitForDeployment();
// Independent E2M1 interpretation: sign/exponent/mantissa, no copied lookup table.
function cpu(w,s,x) {
  let result=0n;
  for(let g=0;g<s.length;g++) {
    assert(s[g]>=96 && s[g]<=160);
    let dot=0n;
    for(let j=0;j<32;j++) {
      const n=(w[g*16+(j>>1)] >> ((j&1)*4)) & 15;
      const e=(n>>1)&3,m=n&1;
      let v=e===0?m:((2+m)<<(e-1)); if(n&8) v=-v;
      dot+=BigInt(v)*BigInt(x[g*32+j]);
    }
    result+=dot*(1n<<BigInt(s[g]-96));
  }
  return result;
}
function pack(x) { const b=Buffer.alloc(x.length*2); x.forEach((v,i)=>b.writeInt16BE(v,2*i)); return hexlify(b); }
let checked=0;
async function parity(w,s,x) {
  const expected=cpu(w,s,x), args=[hexlify(w),hexlify(s)];
  assert.equal(await contract.baseline(...args,x),expected);
  assert.equal(await contract.packedControl(...args,pack(x)),expected);
  assert.equal(await contract.packed(...args,pack(x)),expected);
  checked++;
  return expected;
}
const tests=[];
// All nibble values in both positions, signed-int16 bounds, every supported scale.
for(let n=0;n<16;n++) {
  const w=Buffer.from(Array.from({length:16},(_,j)=>j%2 ? n<<4 : n));
  const x=Array.from({length:32},(_,j)=>[-32768,32767,-1,0,1][j%5]);
  await parity(w,Buffer.from([127]),x);
}
await parity(Buffer.alloc(65*16,0xf7),Buffer.from(Array.from({length:65},(_,i)=>96+i)),
  Array.from({length:65*32},(_,i)=>i%2?-32768:32767));
let seed=0x520025;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let i=0;i<12;i++) {
  const count=1+i%8,w=Buffer.from(Array.from({length:count*16},()=>random()&255));
  const s=Buffer.from(Array.from({length:count},()=>96+random()%65));
  const x=Array.from({length:count*32},()=>random()%65536-32768);
  await parity(w,s,x);
}
let rejected=0;
for(const method of ['baseline','packedControl','packed']) {
  for(const scale of [0,95,161,255]) {
    await assert.rejects(contract[method]('0x'+'00'.repeat(16),hexlify(Uint8Array.of(scale)),method==='baseline'?Array(32).fill(0):'0x'+'00'.repeat(64)));
    rejected++;
  }
  await assert.rejects(contract[method]('0x00','0x7f',method==='baseline'?[]:'0x'));
  rejected++;
  await assert.rejects(contract[method]('0x'+'00'.repeat(16),'0x7f',method==='baseline'?Array(31).fill(0):'0x'+'00'.repeat(62)));
  rejected++;
  assert.equal(await contract[method]('0x','0x',method==='baseline'?[]:'0x'),0n);
}
const weights=Buffer.from(sample.block_hex,'hex'), scales=Buffer.from(sample.scale_hex,'hex');
assert.equal(crypto.createHash('sha256').update(weights).digest('hex'),sample.block_sha256);
assert.equal(crypto.createHash('sha256').update(scales).digest('hex'),sample.scale_sha256);
const rows=[];
for(let row=0;row<sample.rows;row++) {
  const groups=sample.groups_per_row;
  const w=weights.subarray(row*groups*16,(row+1)*groups*16);
  const s=scales.subarray(row*groups,(row+1)*groups);
  const x=Array.from({length:groups*32},()=>random()%65536-32768);
  const result=await parity(w,s,x);
  const gas={}, sizes={};
  for(const method of ['baseline','packedControl','packed']) {
    const operands=[hexlify(w),hexlify(s),method==='baseline'?x:pack(x)];
    const tx=await contract[method].populateTransaction(...operands);
    sizes[method]=(tx.data.length-2)/2;
    const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});
    const receipt=await sent.wait(); assert.equal(receipt.status,1);
    gas[method]=Number(receipt.gasUsed);
  }
  rows.push({row,weights:groups*32,groups,result_q32:result.toString(),gas,calldata_bytes:sizes,
    same_packed_abi_gas_saving_percent:100*(gas.packedControl-gas.packed)/gas.packedControl,
    expanded_int16_abi_gas_saving_percent:100*(gas.baseline-gas.packed)/gas.baseline});
  console.log(JSON.stringify(rows.at(-1)));
}
const report={status:synthetic?'PASS_SYNTHETIC_MICROKERNEL_ONLY':'PASS_LOCAL_MICROKERNEL_ONLY',
  synthetic_fixture:synthetic,model:sample.model,revision:sample.revision,
  environment:{chain_id:31337,hardfork:'shanghai',solc:solc.version(),viaIR:true,optimizer_runs:200,
    ganache:'7.9.2',ethers:'6.13.5',gas_basis:'local successful transaction receipts including intrinsic/calldata gas'},
  kernel_sha256:crypto.createHash('sha256').update(source).digest('hex'),
  runtime_bytecode_bytes:build.evm.deployedBytecode.object.length/2,
  parity_cases:checked,three_way_parity:true,rejected_invalid_calls:rejected,
  benchmark:rows,
  limits:[synthetic?'Synthetic weights and activations ONLY; real-weight download incomplete. No GPT-OSS parity claim.':'Only first four rows of layer-0 expert-0 gate/up tensor; no representative sampling claim.',
    'Signed-int16 activations are synthetic, not actual model activations.',
    'Exact Q32 dyadic dot arithmetic only for encoded scales [96,160]; not full BF16 model equivalence.',
    'No router, attention, nonlinearities, tokenizer, generation, quality evaluation, deployment or mainnet gas measurement.',
    'No full-model gas extrapolation; weights supplied in calldata for this microbenchmark.']};
fs.mkdirSync(root+'evidence',{recursive:true});
fs.writeFileSync(root+'evidence/'+(synthetic?'synthetic-benchmark.json':'benchmark.json'),JSON.stringify(report,null,2)+'\n');
await local.disconnect();
console.log(`PASS ${checked} three-way parity cases; ${rejected} invalid calls rejected.`);
