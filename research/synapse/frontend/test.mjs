import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forward, tokenize, assertDeployment, checkQuote, verifyInferenceReceipt, assertTrace } from './core.mjs';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const model = read('../model/model.json'), alternate = read('../model/alternate-expert.json'), fixtures = read('../model/fixtures.json');

test('exact published integer fixtures, including alternate expert', () => {
  for (const fixture of fixtures.fixtures) assert.deepEqual(forward(model, fixture.tokens, fixture.variant === 'alternate' ? alternate : null), fixture.expected, fixture.id);
});
test('all 52 upgraded domain-model fixtures match browser reference math', () => {
  const m = read('../candidates/domain/model.json'), a = read('../candidates/domain/alternate-expert.json'), fixtureSet = read('../candidates/domain/fixtures.json');
  assert.equal(fixtureSet.fixtures.length, 52);
  for (const fixture of fixtureSet.fixtures) assert.deepEqual(forward(m, fixture.tokens, fixture.variant === 'alternate' ? a : null), fixture.expected, fixture.id);
});
test('context padding, truncation, unknown tokens, and generalized positional embedding math', () => {
  assert.deepEqual(tokenize('ghost', model.vocab, 4).tokens, [0, 0, 0, 7]);
  assert.deepEqual(tokenize('ghost checks proof', model.vocab).tokens, [4, 21]);
  assert.throws(() => tokenize('unknown', model.vocab), /Outside/);
  const m = { contextSize: 3, hiddenSize: 1, scale: 1, activationMax: 32767, vocab: ['<bos>', 'x'], embeddings: [1, 2, 3, 4, 5, 6], experts: [{ weights: [1], bias: [0] }, { weights: [1], bias: [0] }], headWeights: [1, 2], headBias: [0, 0] };
  assert.deepEqual(forward(m, [1, 0, 1]), { hidden: [11], expertActivations: [[11], [11]], merged: [11], logits: [11, 22], token: 1 });
  assert.throws(() => forward(m, [0, 0]), /exactly 3/);
});
test('unconfigured / wrong-chain / private RPC manifests fail closed', () => {
  const config = { ...read('./deployment.json'), status: 'unconfigured' };
  assert.throws(() => assertDeployment(config), /not configured/);
  assert.throws(() => assertDeployment({ ...config, status: 'live', chainId: 1 }), /Unexpected network/);
  assert.throws(() => assertDeployment({ ...config, status: 'live', rpcUrl: 'https://private.example' }), /public Robinhood/);
});
test('quote protects graph identity and exact fee, and reference mismatch is rejected', () => {
  assert.deepEqual(checkQuote(['0xabc', 6n], { graphId: '0xABC', totalFee: '6' }), { graphId: '0xabc', fee: 6n });
  assert.throws(() => checkQuote(['0xabc', 7n], { graphId: '0xabc', totalFee: '6' }), /quote differs/);
  const trace = forward(model, [7, 4]);
  assertTrace(trace, trace); assert.throws(() => assertTrace({ ...trace, token: 0 }, trace), /does not match/);
});
test('receipt authenticates payer, graph, context, trace, token and every module credit', () => {
  const expected = { address: '0xgraph', payer: '0xpayer', graphId: '0xid', fee: '6', token: 21, inputHash: '0xinput', traceHash: '0xtrace', modules: [0, 1, 2].map(i => ({ address: `0xmodule${i}`, beneficiary: `0xbeneficiary${i}`, fee: '2', activationHash: `0xactivation${i}` })) };
  const events = [{ address: expected.address, name: 'Inference', args: { payer: expected.payer, graphId: expected.graphId, fee: '6', token: 21, inputHash: expected.inputHash, traceHash: expected.traceHash } }, ...expected.modules.map(m => ({ address: expected.address, name: 'ModuleUsed', args: { module: m.address, beneficiary: m.beneficiary, fee: m.fee, activationHash: m.activationHash, graphId: expected.graphId } }))];
  const receipt = { status: 1, to: expected.address, from: expected.payer, logs: events };
  assert.equal(verifyInferenceReceipt(receipt, expected, item => item), 21);
  for (const field of ['payer', 'graphId', 'inputHash', 'traceHash', 'fee', 'token']) {
    const invalid = structuredClone(receipt); invalid.logs[0].args[field] = field === 'token' || field === 'fee' ? 999 : '0xwrong';
    assert.throws(() => verifyInferenceReceipt(invalid, expected, item => item), /does not match/, field);
  }
  assert.throws(() => verifyInferenceReceipt({ ...receipt, status: 0 }, expected, item => item), /did not succeed/);
  assert.throws(() => verifyInferenceReceipt({ ...receipt, logs: events.slice(0, 3) }, expected, item => item), /missing module/);
  const badCredit = structuredClone(receipt); badCredit.logs[2].args.beneficiary = '0xwrong';
  assert.throws(() => verifyInferenceReceipt(badCredit, expected, item => item), /payment credit differs/);
  assert.throws(() => verifyInferenceReceipt({ ...receipt, logs: [...events, events[0]] }, expected, item => item), /exactly one/);
});
