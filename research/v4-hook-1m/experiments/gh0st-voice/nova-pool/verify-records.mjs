import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {AbiCoder,keccak256} from 'ethers';
const dir=path.dirname(fileURLToPath(import.meta.url));
const raw=fs.readFileSync(path.join(dir,'integration-results.json'));
const r=JSON.parse(raw),c=AbiCoder.defaultAbiCoder();
assert.equal(r.status,'PASS');assert.equal(r.swaps.length,32);
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
 assert(BigInt(row.gasUsed)<32000000n);
}
const digest=createHash('sha256').update(raw).digest('hex');
const neural=JSON.parse(fs.readFileSync(path.join(dir,'independent-neural-reference.json')));
assert.equal(neural.status,'PASS');assert.equal(neural.steps,32);assert.equal(neural.report_sha256,digest);
for(const [file,digest]of Object.entries(r.source_hashes))assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(dir,'../../..',file))).digest('hex'),digest);
const result={status:'PASS',swaps_verified:32,canonical_state_hashes_match:true,features_independently_checked:true,token_supply_conserved:true,locked_position_constant:true,all_swaps_under_32m:true,neural_reference_matches_final_report:true,compiled_source_digests_unchanged:true,report_sha256:digest};
fs.writeFileSync(path.join(dir,'record-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
