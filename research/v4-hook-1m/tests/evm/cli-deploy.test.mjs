import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keccak256 } from 'ethers';
import { PIN, loadReviewedPlan, gasWithHeadroom, verifyNetwork, inspectEntry, deployEntries } from '../../scripts/deploy-reviewed-plan.mjs';

const bytes = readFileSync(new URL('../../deployment/robinhood-mainnet-plan.json', import.meta.url));
const original = loadReviewedPlan(bytes);
const runtime = '0x6001600055';
function harness() {
  const events = [], code = new Map(), state = { transactions: {} };
  const plan = structuredClone(original);
  plan.transactions = plan.transactions.slice(0, 2).map(row => ({ ...row, runtime_code_hash: keccak256(runtime) }));
  plan.dependencies.create2_deployer_code_hash = keccak256(runtime);
  plan.dependencies.pool_manager_code_hash = keccak256(runtime);
  code.set(PIN.factory.toLowerCase(), runtime); code.set(PIN.manager.toLowerCase(), runtime);
  const status = { chain: PIN.chain, signer: PIN.sender, nonce: 0, pendingNonce: 0, failReceipt: false };
  const provider = {
    send: async () => status.chain,
    getCode: async address => code.get(address.toLowerCase()) || '0x',
    getTransactionCount: async (_, tag) => tag === 'pending' ? status.pendingNonce : status.nonce,
    getTransactionReceipt: async () => null,
    getFeeData: async () => ({ gasPrice: 1n }), getBalance: async () => 10n ** 18n,
  };
  const signer = {
    getAddress: async () => status.signer,
    estimateGas: async () => 101n,
    sendTransaction: async request => {
      assert.equal(events.at(-1).type, 'save');
      assert.equal(events.at(-1).row.status, 'submitting');
      assert.equal(request.gasLimit, 152n); assert.equal(request.value, 0n); assert.equal(request.chainId, PIN.chain);
      assert.equal(request.to, PIN.factory); assert.equal(request.gasPrice, undefined); assert.equal(request.maxFeePerGas, undefined);
      const index = events.filter(e => e.type === 'send').length;
      events.push({ type: 'send', request });
      return { hash: '0x' + String(index + 1).padStart(64, '0'), wait: async () => {
        assert.equal(events.at(-1).row.status, 'pending');
        if (!status.failReceipt) code.set(plan.transactions[index].predicted_address.toLowerCase(), runtime);
        return { status: status.failReceipt ? 0 : 1 };
      } };
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
    if (alteration === 'nonce') h.status.pendingNonce = 1;
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
