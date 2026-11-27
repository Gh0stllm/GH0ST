'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {verifyProposal, requestProposal} = require('./orbio.cjs');
const {readBoundedJson} = require('./orbio-response.cjs');
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

test('an unchanged completion succeeds after one call and reports its usage', async () => {
  const previous = process.env.ORBIO_API_KEY;
  process.env.ORBIO_API_KEY = 'offline-test-only';
  try {
    let calls = 0;
    const usage = { prompt_tokens: 17, completion_tokens: 4, total_tokens: 21 };
    const result = await requestProposal(reference, async () => {
      calls++;
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ expression: reference.trim() }) } }],
        usage
      });
    });
    assert.equal(calls, 1);
    assert.equal(result.kind, 'unchanged');
    assert.equal(result.provider, 'Orbio');
    assert.deepEqual(result.usage, usage);
    assert.match(result.originalSha256, /^[0-9a-f]{64}$/);
    assert.equal(Object.hasOwn(result, 'candidate'), false);
  } finally {
    if (previous === undefined) delete process.env.ORBIO_API_KEY;
    else process.env.ORBIO_API_KEY = previous;
  }
});

test('a valid JSON response at the exact byte cap preserves split UTF-8', async () => {
  const bytes = new TextEncoder().encode('{"city":"Kōbe"}');
  const split = bytes.indexOf(0xc5) + 1;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(bytes.subarray(0, split));
    controller.enqueue(bytes.subarray(split));
    controller.close();
  } });
  assert.deepEqual(await readBoundedJson(new Response(body), bytes.length), { city: 'Kōbe' });
});

test('the reader cancels on the actual byte cap even with a smaller declared size', async () => {
  let cancelled = false;
  let part = 0;
  const pieces = ['{"a":', '12}'];
  const body = new ReadableStream({
    pull(controller) {
      if (part < pieces.length) controller.enqueue(new TextEncoder().encode(pieces[part++]));
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const response = new Response(body, { headers: { 'Content-Length': '5' } });
  await assert.rejects(readBoundedJson(response, 7), /exceeded the byte limit/);
  assert.equal(cancelled, true);
});

test('declared over-limit, missing, malformed and error responses report safe errors', async () => {
  await assert.rejects(readBoundedJson(new Response('{}', { headers: { 'Content-Length': '9' } }), 8),
    /exceeded the byte limit/);
  await assert.rejects(readBoundedJson(new Response(null)), /empty response/);
  await assert.rejects(readBoundedJson(new Response('malformed')), { message: 'Orbio returned an invalid JSON response.' });
  await assert.rejects(readBoundedJson(new Response('provider detail', { status: 429 })), { message: 'Orbio returned HTTP 429.' });
});
