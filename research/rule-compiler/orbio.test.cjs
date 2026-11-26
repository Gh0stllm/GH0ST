'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {verifyProposal, requestProposal} = require('./orbio.cjs');
const reference = readFileSync(join(__dirname,'quote.rule'),'utf8');
const equivalent = 'qty * (if tier == 1 then 95 else if tier == 2 then 90 else 100)';

test('accepts an equivalent rule and rejects changing the tier-2 discount',()=>{
  const accepted=verifyProposal(reference,equivalent);
  assert.equal(accepted.evidence.checkedInputs,65536);
  assert.match(accepted.evidence.outputSha256,/^[a-f0-9]{64}$/);
  assert.equal(accepted.gas,'unmeasured');
  assert.throws(()=>verifyProposal(reference,equivalent.replace('90','91')),/qty=1, tier=2: expected 90, got 91/);
  assert.throws(()=>verifyProposal(reference,reference),/repeats/);
  assert.throws(()=>verifyProposal(reference,'process.exit()'),/supported integer expression/);
});
test('mocked gateway gives only a reviewable candidate and does not execute model output',async()=>{
  const prev=process.env.ORBIO_API_KEY;
  process.env.ORBIO_API_KEY='offline-test-only';
  try {
    const mock=async(url,options)=>{
      assert.equal(url,'https://api.orbio.so/api/v1/chat/completions');
      assert.equal(options.redirect,'error');
      const data=JSON.parse(options.body);
      assert.deepEqual(JSON.parse(data.messages[1].content),{expression:reference});
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({expression:equivalent})}}],
        usage:{prompt_tokens:11,completion_tokens:12,total_tokens:23}}));
    };
    const reply=await requestProposal(reference,mock);
    assert.equal(reply.kind,'reviewable-proposal');
    assert.equal(reply.evidence.checkedInputs,65536);
    const bad=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"expression":"qty","run":"ignored"}'}}]}));
    await assert.rejects(requestProposal(reference,bad),/unexpected candidate format/);
  } finally {
    if(prev===undefined)delete process.env.ORBIO_API_KEY;else process.env.ORBIO_API_KEY=prev;
  }
});
