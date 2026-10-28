import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChatArchive} from '../worker/chat-capture.mjs';
const coord='6jacx-5yaaa-aaaaj-a65jq-cai',id='0x'+'ab'.repeat(32),prompt='A distinct scene.';
const job={request:{id,prompt},voice:[{attempt:1,generation:[]}],phase:{Running:null},busy:false,answer:'',output_tokens:'0'};
const raw=text=>`${coord}\n<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n${text}`;
test('full chat is bound to exact source/prompt and preserves terminal text',()=>{
 const r=parseChatArchive({raw:raw('  The clock forgot its hands.\n<|im_end|>'),jobs:[job],observedAt:100});
 assert.equal(r.complete,true);assert.equal(r.sourceId,id);assert.equal(r.generation,'1');assert.equal(r.text,'  The clock forgot its hands.\n');
});
test('unfinished saved prefix is never labelled full',()=>{
 const r=parseChatArchive({raw:raw('The clock forgot'),jobs:[job],observedAt:100});assert.equal(r.complete,false);assert.equal(r.text,'The clock forgot');
});
test('known hidden-control-token frame remains exactly source-bound',()=>{
 const displayed=raw('The clock forgot its hands.').replace(/<\|(?:im_start|im_end)\|>/g,'');
 const r=parseChatArchive({raw:displayed,jobs:[{...job,phase:{Complete:null},answer:'The clock forgot its hands.'}],observedAt:100});
 assert.equal(r.sourceId,id);assert.equal(r.complete,true);
});
test('complete coordinator answer proves completion without an end token',()=>{
 const j={...job,answer:'The clock forgot its hands.',phase:{Complete:null}};
 assert.equal(parseChatArchive({raw:raw(j.answer),jobs:[j],observedAt:100}).complete,true);
});
test('quality reset does not promote an unverified or stale file prefix to full',()=>{
 const record={sourceId:id,generation:'1',skipped:true,skipReason:'length',supersededAt:90};
 const observed=parseChatArchive({raw:raw('A candidate sentence.'),jobs:[job],terminalRecords:[record],observedAt:100});
 assert.equal(observed.complete,false);assert.equal(observed.rejectionObserved,true);
 assert.equal(parseChatArchive({raw:raw('A prefix'),jobs:[job],terminalRecords:[record],observedAt:80}).complete,false);
});
test('manual abort alone cannot turn a saved prefix into a complete rejected thought',()=>{
 assert.equal(parseChatArchive({raw:raw('A prefix'),jobs:[job],terminalRecords:[{sourceId:id,generation:'1',skipped:true,skipReason:'operator abort'}],observedAt:100}).complete,false);
});
test('principal, prompt and source ambiguity fail closed',()=>{
 assert.equal(parseChatArchive({raw:'wrong\n'+raw('x'),jobs:[job],observedAt:100}).status,'unmatched');
 assert.equal(parseChatArchive({raw:raw('x'),jobs:[{...job,request:{id,prompt:'other'}}],observedAt:100}).status,'unmatched');
 const other={...job,request:{id:'0x'+'cd'.repeat(32),prompt}};
 assert.equal(parseChatArchive({raw:raw('x<|im_end|>'),jobs:[job,other],observedAt:100}).status,'ambiguous');
});
test('filenames do not create source identity and duplicate snapshots do not create ambiguity',()=>{
 const r=parseChatArchive({raw:raw('finished.<|endoftext|>'),jobs:[{job,observedAt:1},job],filename:'unrelated-source',observedAt:100});assert.equal(r.complete,true);assert.equal(r.sourceId,id);
});
