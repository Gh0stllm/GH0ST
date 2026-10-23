import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keccak256 } from 'ethers';
import { PIN, loadReviewedPlan, gasWithHeadroom, verifyNetwork, inspectEntry, deployEntries } from '../../scripts/deploy-reviewed-plan.mjs';

const bytes = readFileSync(new URL('../../deployment/robinhood-mainnet-plan.json', import.meta.url));
const original = loadReviewedPlan(bytes);
const runtime = '0x6001600055';
function harness() {
  const events = [], code = new Map(), receipts = new Map(), signedRequests = new Map(), state = { transactions: {} };
  const plan = structuredClone(original);
  plan.transactions = plan.transactions.slice(0, 2).map(row => ({ ...row, runtime_code_hash: keccak256(runtime) }));
  plan.dependencies.create2_deployer_code_hash = keccak256(runtime);
  plan.dependencies.pool_manager_code_hash = keccak256(runtime);
  code.set(PIN.factory.toLowerCase(), runtime); code.set(PIN.manager.toLowerCase(), runtime);
  const status = { chain: PIN.chain, signer: PIN.sender, nonce: 6118, pendingNonce: 6118,
    failReceipt: false, ackError: false, noReceipt: false, delayedReceipt: false, wrongReceipt: false, wrongRuntime: false };
  function mine(hash, request) {
    if (!status.failReceipt) {
      const entry = plan.transactions.find(entry => entry.unsigned_transaction.data === request.data);
      code.set(entry.predicted_address.toLowerCase(), status.wrongRuntime ? '0x6000' : runtime);
    }
    const receipt = { status: status.failReceipt ? 0 : 1, hash: status.wrongReceipt ? '0x' + '99'.repeat(32) : hash };
    receipts.set(hash, receipt); return receipt;
  }
  const provider = {
    send: async () => status.chain,
    getCode: async address => code.get(address.toLowerCase()) || '0x',
    getTransactionCount: async (_, tag) => tag === 'pending' ? status.pendingNonce : status.nonce,
    getTransactionReceipt: async hash => receipts.get(hash) || null,
    waitForTransaction: async hash => {
      if (status.noReceipt) return null;
      const pair = [...signedRequests].find(([serialized]) => keccak256(serialized) === hash);
      return receipts.get(hash) || mine(hash, pair[1]);
    },
    getFeeData: async () => ({ gasPrice: 1n }), getBalance: async () => 10n ** 18n,
    broadcastTransaction: async serialized => {
      const request = signedRequests.get(serialized), hash = keccak256(serialized);
      assert.equal(events.at(-1).type, 'save');
      assert.equal(events.at(-1).row.status, 'pending');
      assert.equal(events.at(-1).row.hash, hash);
      events.push({ type: 'send', request });
      if (!status.noReceipt && !status.delayedReceipt) mine(hash, request);
      if (status.ackError) throw Object.assign(Error('nonce has already been used'), { code: 'NONCE_EXPIRED' });
      return { hash };
    },
  };
  const signer = {
    getAddress: async () => status.signer,
    estimateGas: async () => 101n,
    populateTransaction: async request => {
      assert.equal(request.gasLimit, 152n); assert.equal(request.value, 0n); assert.equal(request.chainId, PIN.chain);
      assert.equal(request.to, PIN.factory); assert.equal(request.gasPrice, undefined); assert.equal(request.maxFeePerGas, undefined);
      return request;
    },
    signTransaction: async request => {
      const serialized = '0x' + request.nonce.toString(16).padStart(8, '0');
      signedRequests.set(serialized, request); return serialized;
    },
  };
  const save = current => { const row = Object.values(current.transactions).at(-1); events.push({ type: 'save', row: structuredClone(row) }); };
  return { plan, provider, signer, state, save, status, code, events };
}

test('only exact reviewed bytes are accepted, and gas rounds 150% upward', () => {
  assert.equal(original.transactions.length, 59);
  assert.throws(() => loadReviewedPlan(Buffer.concat([bytes, Buffer.from(' ')])), /reviewed/);
  assert.equal(gasWithHeadroom(1n), 2n); assert.equal(gasWithHeadroom(101n), 152n);
});

test('wrong chain, signer, dependency or pending nonce prevents every broadcast', async () => {
  for (const alteration of ['chain', 'signer', 'dependency', 'nonce']) {
    const h = harness();
    if (alteration === 'chain') h.status.chain = 1n;
    if (alteration === 'signer') h.status.signer = PIN.factory;
    if (alteration === 'dependency') h.code.set(PIN.factory.toLowerCase(), '0x');
    if (alteration === 'nonce') h.status.pendingNonce = 6119;
    await assert.rejects(deployEntries(h)); assert.equal(h.events.filter(e => e.type === 'send').length, 0);
  }
});

test('existing matching runtime skips; conflict and unknown or pending outcomes halt', async () => {
  const h = harness(), entry = h.plan.transactions[0];
  h.code.set(entry.predicted_address.toLowerCase(), runtime);
  assert.equal(await inspectEntry(h.provider, entry, h.state), true);
  h.code.set(entry.predicted_address.toLowerCase(), '0x6000');
  await assert.rejects(inspectEntry(h.provider, entry, h.state), /Conflicting/);
  h.code.delete(entry.predicted_address.toLowerCase());
  h.state.transactions[entry.order] = { status: 'submitting' };
  await assert.rejects(inspectEntry(h.provider, entry, h.state), /unknown outcome/);
  h.state.transactions[entry.order].hash = '0x123';
  await assert.rejects(inspectEntry(h.provider, entry, h.state), /pending or replaced/);
});

test('submission and hash are journaled before send and wait, and failures stop subsequent deployments', async () => {
  const h = harness(); await deployEntries(h);
  assert.equal(h.events.filter(e => e.type === 'send').length, 2);
  assert(Object.values(h.state.transactions).every(row => row.status === 'verified'));
  const bad = harness(); bad.status.failReceipt = true;
  await assert.rejects(deployEntries(bad), /failed/);
  assert.equal(bad.events.filter(e => e.type === 'send').length, 1);
  assert.equal(Object.values(bad.state.transactions)[0].status, 'pending');
});

test('explicit nonces advance despite stale RPC pending counts after a confirmed deployment', async () => {
  const h = harness();
  // The RPC mock deliberately keeps returning 6118 after both sends.
  await deployEntries(h);
  assert.deepEqual(h.events.filter(e => e.type === 'send').map(e => e.request.nonce), [6118, 6119]);
  assert.deepEqual(Object.values(h.state.transactions).map(e => e.nonce), [6118, 6119]);
});

test('resuming past matching contracts starts at the live account nonce without incrementing for skipped rows', async () => {
  const h = harness();
  h.code.set(h.plan.transactions[0].predicted_address.toLowerCase(), runtime);
  h.state.transactions[h.plan.transactions[0].order] = { status: 'submitting' };
  await deployEntries(h);
  assert.deepEqual(h.events.filter(e => e.type === 'send').map(e => e.request.nonce), [6118]);
});

test('an accepted transaction followed by a nonce-error response is recovered by its exact pre-saved hash', async () => {
  for (const delayed of [false, true]) {
    const h = harness(); h.status.ackError = true; h.status.delayedReceipt = delayed;
    await deployEntries(h);
    assert.equal(h.events.filter(e => e.type === 'send').length, 2);
    assert(Object.values(h.state.transactions).every(row => row.status === 'verified' && /^0x[0-9a-f]{64}$/.test(row.hash)));
  }
});

test('a broadcast error without a receipt preserves its hash and stops without a second broadcast', async () => {
  const h = harness(); h.status.ackError = true; h.status.noReceipt = true;
  await assert.rejects(deployEntries(h), /unresolved/);
  assert.equal(h.events.filter(e => e.type === 'send').length, 1);
  const row = Object.values(h.state.transactions)[0];
  assert.equal(row.status, 'pending'); assert.match(row.hash, /^0x[0-9a-f]{64}$/);
  await assert.rejects(inspectEntry(h.provider, h.plan.transactions[0], h.state), /pending or replaced/);
});

test('broadcast-error recovery refuses another receipt or a mismatching deployed runtime', async () => {
  for (const kind of ['wrongReceipt', 'wrongRuntime']) {
    const h = harness(); h.status.ackError = true; h.status[kind] = true;
    await assert.rejects(deployEntries(h), kind === 'wrongReceipt' ? /different transaction/ : /runtime mismatch/);
    assert.equal(h.events.filter(e => e.type === 'send').length, 1);
    assert.equal(Object.values(h.state.transactions)[0].status, 'pending');
  }
});
