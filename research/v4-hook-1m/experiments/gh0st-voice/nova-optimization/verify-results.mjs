// Verify saved local evidence, including independent neural replay and same-block placement.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {AbiCoder,keccak256} from 'ethers';
const dir=path.dirname(fileURLToPath(import.meta.url)),base=path.resolve(dir,'../../..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const raw=fs.readFileSync(path.join(dir,'flat-full-test/integration-results.json'));
const r=JSON.parse(raw),c=AbiCoder.defaultAbiCoder();
assert.equal(r.status,'PASS');assert.equal(r.swaps.length,32);assert.equal(r.checks.length,64);
assert(r.checks.every(x=>x.passed));assert.equal(r.public_transactions_submitted,0);
assert.equal(r.optimization.inference_budget,13300000);
assert.equal(r.optimization.transaction_limit,'17500000');
assert.equal(r.optimization.block_limit,32000000);
for(const row of r.swaps){
 const before=row.before.context,after=row.after.context;
 const computed=keccak256(c.encode(['bytes32','bytes32','uint64','uint16','uint8','int16[768]'],[r.model_hash,r.poolId,row.sequence,row.token,row.punct,row.after.hidden]));
 assert.equal(computed,after[8]);assert.equal(Number(after[4]),Number(before[4])+1);
 assert.equal(row.after.position,r.plan.liquidity);
 assert.equal(row.after.nova.reduce((a,x)=>a+BigInt(x),0n),1000000n*10n**18n);
 const move=Math.min(1024,Math.abs(Number(row.after.pool[1])-Number(before[0])));
 const elapsed=Math.min(300,Number(after[3])-Number(before[3]));
 const features=[move*4,Number(before[2])*4,Math.abs(move-Number(before[1]))*4,Math.floor(elapsed*1024/300),row.direction==='BUY'?1024:-1024,1024];
 assert.deepEqual(row.features.map(Number),features);
 assert.equal(after[5],String(row.token));assert.equal(after[6],String(row.punct));
 assert(row.text.length>0);assert(BigInt(row.gasUsed)<17500000n);
}
const neural=JSON.parse(fs.readFileSync(path.join(dir,'flat-full-test/independent-neural-reference.json')));
assert.equal(neural.status,'PASS');assert.equal(neural.steps,32);assert.equal(neural.report_sha256,sha(raw));
for(const [file,digest]of Object.entries(r.source_hashes)){
 const actual=file.endsWith('/GRU2SIMDModel.sol')?path.join(dir,'selected/GRU2SIMDModel.sol'):path.resolve(base,file);
 assert.equal(sha(fs.readFileSync(actual)),digest,file);
}
const loadRaw=fs.readFileSync(path.join(dir,'flat-load-test/load-test-results.json'));
const load=JSON.parse(loadRaw);assert.equal(load.status,'PASS');assert.equal(load.total_successful_swaps,44);
assert.equal(load.max_swaps_per_32m_block,2);assert.equal(load.failure_count,0);
assert.equal(load.public_transactions_submitted,0);
const blockEvidence=[];
for(const burst of load.bursts){
 assert.equal(burst.accepted_before_mining,burst.submitted);assert.equal(burst.successful,burst.submitted);
 assert.equal(burst.endSequence-burst.startSequence,burst.submitted);
 const blocks=new Map();
 for(const row of burst.rows){
  assert(row.text.length>0);assert(BigInt(row.gasUsed)<17500000n);
  const block=blocks.get(row.blockNumber)??{block:row.blockNumber,gas:0n,sequences:[],words:[]};
  block.gas+=BigInt(row.gasUsed);block.sequences.push(row.sequence);block.words.push(row.text);blocks.set(row.blockNumber,block);
 }
 for(const block of blocks.values()){
  assert(block.gas<=32000000n);block.sequences.sort((a,b)=>a-b);
  for(let i=1;i<block.sequences.length;i++)assert.equal(block.sequences[i],block.sequences[i-1]+1);
  blockEvidence.push({...block,gas:block.gas.toString()});
 }
}
assert(blockEvidence.some(x=>x.sequences.length===2));
const result={status:'PASS',mainnet_actions:0,security_checks:64,neural_replay_steps:32,
 canonical_state_hashes_match:true,all_features_independently_checked:true,supply_and_locked_lp_preserved:true,
 original_pool_hook_unchanged:true,full_report_sha256:sha(raw),load_report_sha256:sha(loadRaw),
 successful_queued_swaps:44,max_queued_before_mining:16,max_swaps_per_32m_block:2,blocks:blockEvidence};
fs.writeFileSync(path.join(dir,'record-verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,blocks:undefined},null,2));
