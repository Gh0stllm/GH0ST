import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const dir='experiments/simplestories-v2/optimization/varied-sentence/continuity/';
const files={local:dir+'model-rolling64-local.json',reference:dir+'quality/rolling64/rolling64-140turn-reference.json',source:dir+'kernel/SimpleStoriesV2Rolling64Model.sol',table:dir+'model/tables-2048.bin'};
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const local=JSON.parse(fs.readFileSync(files.local)),ref=JSON.parse(fs.readFileSync(files.reference));
assert.equal(local.status,'PASS');assert.equal(local.sourceSha256,hash(files.source));assert(local.turns.length>100);
for(let i=0;i<local.turns.length;i++){
 const a=local.turns[i],b=ref.turns[i];assert.equal(a.maxNew,b.max_new_tokens_requested);
 assert.deepEqual(a.tokens,b.tokens);assert.equal(a.logitHash,b.last_logit_hash);assert.equal(Number(a.processed),b.processed_after);assert.equal(Number(a.generated),b.total_generated_after);assert.equal(Number(a.pending),b.pending_after);assert.equal(a.endedEos,b.ended_eos);assert.equal(a.endedSentence,b.ended_sentence);assert.equal(a.refreshed,false);assert.equal(Number(a.epoch),0);
}
const sustained=local.turns.filter(x=>Number(x.processed)>=64);
const report={status:'PASS',localOnly:true,publicTransactionsSubmitted:0,sourceSha256:hash(files.source),localReportSha256:hash(files.local),referenceSha256:hash(files.reference),tableSha256:hash(files.table),turnsCompared:local.turns.length,processedPositions:Number(local.turns.at(-1).processed),everyGeneratedTokenMatches:true,everyTurnFull4019LogitHashMatches:true,allStateCountersAndNativeStopsMatch:true,noRefreshOrReset:true,maximumMeasuredGas:local.maximumMeasuredGas,sustainedWindowGas:{minimum:Math.min(...sustained.map(x=>Number(x.gasUsed))),maximum:Math.max(...sustained.map(x=>Number(x.gasUsed)))},checks:local.checks,limits:['Fixed quote prompt and one seed42 stream tested for model parity.','Sliding64 attention keeps cached historical context but is different from full unbounded attention.','One or two tokens per swap; a full sentence generally spans multiple swaps.','Absolute RoPE positions stop at2048. Automatic story lifecycle/reset remains undecided; not mainnet-ready.']};
fs.writeFileSync(dir+'model-rolling64-parity.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
