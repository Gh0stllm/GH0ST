import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AbiCoder, Interface } from 'ethers';
import { HERE } from '../scripts/build.mjs';
import { canaryBudgetPath, reserveCanarySpend, markCanaryBroadcast, releaseCanaryReservation,
  cancelCanaryReservation, recordCanaryReceipt, reconcileCanaryBudget } from '../scripts/canary-budget.mjs';

const admin = '0x1111111111111111111111111111111111111111';
const target = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'ab'.repeat(32), blockHash = '0x' + 'cd'.repeat(32);
const oracle = new Interface(['function getL1FeeUpperBound(uint256) view returns(uint256)']);
const coder = AbiCoder.defaultAbiCoder();

function fixture(t, chainId = 4663) {
  const config = { sessionId: '0x' + randomBytes(32).toString('hex'), admin, enabled: true,
    budgetApproved: true, messagingReviewed: true, deadline: 2000 };
  const chain = { chainId, maxTotalSpendWei: '10000', maxTransactionGas: '1000',
    maxMessageFeeWei: '500', maxFeePerGasWei: '100', maxPostingFeeWei: chainId === 204 ? '200' : '0', confirmations: 2 };
  const file = canaryBudgetPath(config, chain), directory = path.dirname(file);
  assert(directory.startsWith(path.join(HERE, 'deployments', 'canary-spend') + path.sep));
  const held = [];
  t.after(() => { for (const res of held) releaseCanaryReservation(res); fs.rmSync(directory, { recursive: true, force: true }); });
  const provider = {
    chainId, timestamp: 1000, nonce: 7, balance: 100000n, postingUpperBound: 40n,
    calls: [], tx: null, receipt: null, raw: null,
    async getNetwork() { return { chainId: BigInt(this.chainId) }; },
    async getBlock(tag) { assert.equal(tag, 'latest'); return { timestamp: this.timestamp }; },
    async getTransactionCount(address, tag) { assert.equal(address, admin); assert.equal(tag, 'pending'); return this.nonce; },
    async getBalance(address, tag) { assert.equal(address, admin); assert.equal(tag, 'pending'); return this.balance; },
    async getTransaction(h) { assert.equal(h.toLowerCase(), hash); return this.tx; },
    async getTransactionReceipt(h) { assert.equal(h.toLowerCase(), hash); return this.receipt; },
    async send(method, params) { assert.equal(method, 'eth_getTransactionReceipt'); assert.deepEqual(params, [hash]); return this.raw; },
    async call(request) {
      assert.equal(request.to.toLowerCase(), '0x420000000000000000000000000000000000000f');
      const parsed = oracle.parseTransaction({ data: request.data });
      assert.equal(parsed.name, 'getL1FeeUpperBound'); assert.equal(request.data.length, 2 + 36 * 2);
      assert(parsed.args[0] > 0n); this.calls.push(parsed.args[0]);
      return coder.encode(['uint256'], [this.postingUpperBound]);
    },
  };
  const reserve = async (overrides = {}) => {
    const res = await reserveCanarySpend({ config, chain, configFile: '/same/config.json', provider,
      actionId: 'test-action', gasLimit: 100n, feeOverrides: { gasPrice: 10n }, value: 50n,
      to: target, data: '0x1234', ...overrides });
    held.push(res); return res;
  };
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const broadcast = (res, { status = 1, gasUsed = 70n, gasPrice = 8n, l1Fee = '0x1e', confirmations = 2,
    txOverrides = {}, receiptOverrides = {}, rawOverrides = {} } = {}) => {
    markCanaryBroadcast(res, hash);
    provider.tx = { from: admin, nonce: res.nonce, chainId, to: target, data: '0x1234', value: 50n, gasLimit: 100n, ...txOverrides };
    provider.receipt = { hash, blockHash, blockNumber: 100, status, gasUsed, gasPrice,
      async confirmations() { return confirmations; }, ...receiptOverrides };
    provider.raw = { transactionHash: hash, blockHash, ...(l1Fee === undefined ? {} : { l1Fee }), ...rawOverrides };
    return provider.receipt;
  };
  return { config, chain, file, directory, provider, reserve, read, broadcast, held };
}

test('RH reservation covers worst-case fee plus value and settles only actual successful spend', async t => {
  const f = fixture(t), res = await f.reserve();
  assert.equal(res.reservedWei, 1050n); assert.equal(f.read().pending.reservedWei, '1050');
  const entry = await recordCanaryReceipt(res, f.broadcast(res));
  assert.equal(entry.chargedWei, '610'); assert.equal(entry.postingWei, '0');
  assert.equal(f.read().spentWei, '610'); assert.equal(f.read().pending, null); assert.equal(res.released, true);
  assert.equal(fs.existsSync(f.file + '.lock'), false);
  await assert.rejects(recordCanaryReceipt(res, f.provider.receipt), /lock is released/);
});

test('reverted receipt charges gas but not reverted message value', async t => {
  const f = fixture(t), res = await f.reserve();
  const entry = await recordCanaryReceipt(res, f.broadcast(res, { status: 0 }));
  assert.equal(entry.status, 0); assert.equal(entry.chargedWei, '560'); assert.equal(f.read().spentWei, '560');
});

test('confirmed broadcast can be settled after restart and old config path cannot reset spend', async t => {
  const f = fixture(t), res = await f.reserve(); f.broadcast(res); releaseCanaryReservation(res);
  const ledger = await reconcileCanaryBudget({ config: { ...f.config }, chain: { ...f.chain },
    configFile: '/copied/config.json', provider: f.provider });
  assert.equal(ledger.spentWei, '610'); assert.equal(ledger.pending, null); assert.equal(ledger.receipts.length, 1);
  f.chain.maxTotalSpendWei = '1200';
  await assert.rejects(f.reserve({ configFile: '/copied/again.json' }), /approved cap changed/);
  assert.equal(f.read().spentWei, '610');
});

test('copying config preserves budget and cumulative reservations cannot overspend', async t => {
  const f = fixture(t); f.chain.maxTotalSpendWei = '1200';
  const first = await f.reserve(); await recordCanaryReceipt(first, f.broadcast(first));
  await assert.rejects(f.reserve({ configFile: '/new-path/same-session.json' }), /Total canary budget/);
  assert.equal(f.read().spentWei, '610'); assert.equal(f.read().pending, null);
  assert.equal(fs.existsSync(f.file + '.lock'), false);
});

test('unknown broadcast fails closed across release, restart and new reservations', async t => {
  const f = fixture(t), res = await f.reserve(); releaseCanaryReservation(res);
  await assert.rejects(reconcileCanaryBudget({ config: f.config, chain: f.chain, provider: f.provider }), /Unknown broadcast outcome/);
  await assert.rejects(f.reserve(), /Pending canary spend/);
  assert.equal(f.read().pending.id, res.id); assert.equal(f.read().spentWei, '0');
  assert.equal(fs.existsSync(f.file + '.lock'), false);
});

test('only proven never-broadcast reservation can be canceled', async t => {
  const f = fixture(t), res = await f.reserve();
  assert.throws(() => cancelCanaryReservation(res), /proof of no broadcast/);
  cancelCanaryReservation(res, { neverBroadcast: true });
  assert.equal(f.read().pending, null); assert.equal(f.read().spentWei, '0');
  const next = await f.reserve(); f.broadcast(next);
  assert.throws(() => cancelCanaryReservation(next, { neverBroadcast: true }), /cannot be canceled/);
  assert.equal(f.read().pending.hash, hash);
});

test('pending and underconfirmed known transactions retain the durable reservation', async t => {
  const f = fixture(t), res = await f.reserve(); f.broadcast(res, { confirmations: 1 }); releaseCanaryReservation(res);
  await assert.rejects(reconcileCanaryBudget({ config: f.config, chain: f.chain, provider: f.provider }), /awaits confirmations/);
  f.provider.receipt = null;
  await assert.rejects(reconcileCanaryBudget({ config: f.config, chain: f.chain, provider: f.provider }), /still pending/);
  assert.equal(f.read().pending.hash, hash); assert.equal(f.read().receipts.length, 0);
});

test('provider identity, deadline and approval gates reject before reserving', async t => {
  const f = fixture(t); f.provider.chainId = 204;
  await assert.rejects(f.reserve(), /provider chain mismatch/); assert.equal(fs.existsSync(f.file), false);
  f.provider.chainId = 4663; f.provider.timestamp = 2001;
  await assert.rejects(f.reserve(), /deadline expired/); assert.equal(fs.existsSync(f.file), false);
  f.provider.timestamp = 1000; f.config.budgetApproved = false;
  await assert.rejects(f.reserve(), /not approved/); assert.equal(fs.existsSync(f.file), false);
});

test('reconciliation refuses a provider switch or expired configuration without releasing spend', async t => {
  const f = fixture(t), res = await f.reserve(); f.broadcast(res); releaseCanaryReservation(res);
  f.provider.chainId = 204;
  await assert.rejects(reconcileCanaryBudget({ config: f.config, chain: f.chain, provider: f.provider }), /provider chain mismatch/);
  f.provider.chainId = 4663; f.provider.timestamp = 2001;
  await assert.rejects(reconcileCanaryBudget({ config: f.config, chain: f.chain, provider: f.provider }), /deadline expired/);
  assert.equal(f.read().pending.hash, hash); assert.equal(f.read().spentWei, '0');
});

test('concurrent reservations have one winner and a live lock cannot be stolen', async t => {
  const f = fixture(t);
  const outcomes = await Promise.allSettled([f.reserve({ actionId: 'first' }), f.reserve({ actionId: 'second' })]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(x => x.status === 'rejected'); assert.match(rejected.reason.message, /Budget lock exists/);
  const winner = outcomes.find(x => x.status === 'fulfilled').value;
  assert.equal(f.read().pending.id, winner.id);
  cancelCanaryReservation(winner, { neverBroadcast: true });
});

test('stale and foreign-host locks both fail closed and are never auto-deleted', async t => {
  const f = fixture(t), deadPid = 2147483647;
  assert.throws(() => process.kill(deadPid, 0), error => error.code === 'ESRCH');
  fs.writeFileSync(f.file + '.lock', JSON.stringify({ pid: deadPid, host: os.hostname() }));
  await assert.rejects(f.reserve(), /Budget lock exists/);
  assert.equal(JSON.parse(fs.readFileSync(f.file + '.lock')).pid, deadPid);
  fs.unlinkSync(f.file + '.lock'); // Explicit test-only operator recovery after confirming no runner exists.
  fs.writeFileSync(f.file + '.lock', JSON.stringify({ pid: deadPid, host: 'different-host' }));
  await assert.rejects(f.reserve(), /Budget lock exists/);
  assert.equal(JSON.parse(fs.readFileSync(f.file + '.lock')).host, 'different-host');
});

test('transaction content/authority mismatch and receipt hash mismatch do not settle', async t => {
  const f = fixture(t), res = await f.reserve();
  let receipt = f.broadcast(res, { txOverrides: { nonce: 8 } });
  await assert.rejects(recordCanaryReceipt(res, receipt), /authority or nonce mismatch/);
  receipt = f.broadcast(res, { txOverrides: { data: '0xbeef' } });
  await assert.rejects(recordCanaryReceipt(res, receipt), /contents exceed reservation/);
  receipt = f.broadcast(res, { receiptOverrides: { hash: '0x' + 'ff'.repeat(32) } });
  await assert.rejects(recordCanaryReceipt(res, receipt), /does not match reservation/);
  assert.equal(f.read().spentWei, '0'); assert.equal(f.read().pending.hash, hash);
  assert.throws(() => markCanaryBroadcast(res, '0x' + 'ee'.repeat(32)), /Broadcast hash changed/);
});

test('fee/gas/value/balance caps reject before any durable charge', async t => {
  const f = fixture(t);
  await assert.rejects(f.reserve({ gasLimit: 1001n }), /exceeds gas limit/);
  await assert.rejects(f.reserve({ value: 501n }), /message fee cap/);
  await assert.rejects(f.reserve({ feeOverrides: { gasPrice: 101n } }), /gas price exceeds cap/);
  await assert.rejects(f.reserve({ feeOverrides: { maxFeePerGas: 10n, maxPriorityFeePerGas: 11n } }), /Priority fee/);
  await assert.rejects(f.reserve({ feeOverrides: { gasPrice: 10n, maxFeePerGas: 10n } }), /Ambiguous transaction fee/);
  f.provider.balance = 1049n;
  await assert.rejects(f.reserve(), /Insufficient native balance/);
  assert.equal(fs.existsSync(f.file), false); assert.equal(fs.existsSync(f.file + '.lock'), false);
});

test('opBNB reserves twice the oracle upper bound and records actual receipt L1 fee', async t => {
  const f = fixture(t, 204), res = await f.reserve({ feeOverrides: { maxFeePerGas: 10n, maxPriorityFeePerGas: 2n } });
  assert.equal(res.reservedWei, 1130n); assert.equal(f.read().pending.postingReserveWei, '80');
  assert.equal(f.provider.calls.length, 1);
  const entry = await recordCanaryReceipt(res, f.broadcast(res, { l1Fee: '0x1e' }));
  assert.equal(entry.postingSource, 'receipt'); assert.equal(entry.postingWei, '30'); assert.equal(entry.chargedWei, '640');
});

test('opBNB absent l1Fee uses the full conservative reserve, including reverted receipts', async t => {
  const f = fixture(t, 204), res = await f.reserve();
  const receipt = f.broadcast(res, { status: 0 }); delete f.provider.raw.l1Fee;
  const entry = await recordCanaryReceipt(res, receipt);
  assert.equal(entry.postingSource, 'conservative-reservation'); assert.equal(entry.postingWei, '80');
  assert.equal(entry.chargedWei, '640'); assert.equal(f.read().spentWei, '640');
});

test('opBNB posting cap and mismatched raw receipts fail closed', async t => {
  const f = fixture(t, 204); f.provider.postingUpperBound = 101n;
  await assert.rejects(f.reserve(), /posting estimate exceeds cap/); assert.equal(fs.existsSync(f.file), false);
  f.provider.postingUpperBound = 40n; const res = await f.reserve();
  const receipt = f.broadcast(res, { rawOverrides: { blockHash: '0x' + 'ff'.repeat(32) } });
  await assert.rejects(recordCanaryReceipt(res, receipt), /Raw receipt mismatch/);
  assert.equal(f.read().spentWei, '0'); assert.equal(f.read().pending.hash, hash);
});

test('actual posting overspend is durably charged before throwing and prevents future reservations', async t => {
  const f = fixture(t, 204); f.chain.maxTotalSpendWei = '1200'; const res = await f.reserve();
  const receipt = f.broadcast(res, { l1Fee: '0x1000' });
  await assert.rejects(recordCanaryReceipt(res, receipt), /Actual chain fees exceeded/);
  assert.equal(res.released, true); assert.equal(f.read().pending, null);
  assert.equal(f.read().spentWei, '4706'); assert.equal(f.read().overBudget, true);
  await assert.rejects(reconcileCanaryBudget({ config: f.config, chain: f.chain, provider: f.provider }), /budget exceeded/);
  await assert.rejects(f.reserve(), /Total canary budget|manual review/);
});

test('reservation breach below total cap remains stopped after restart for explicit review', async t => {
  const f = fixture(t, 204), res = await f.reserve();
  const receipt = f.broadcast(res, { l1Fee: '0x258' }); // 600 posting; actual1210 >reserved1130, below10000total.
  await assert.rejects(recordCanaryReceipt(res, receipt), /Actual chain fees exceeded/);
  assert.equal(f.read().spentWei, '1210'); assert.equal(f.read().pending, null);
  assert.equal(f.read().overBudget, false);
  assert.equal(f.read().reviewRequired, true);
  await assert.rejects(reconcileCanaryBudget({ config: f.config, chain: f.chain, provider: f.provider }), /review|reservation|exceeded/i);
  await assert.rejects(f.reserve(), /review|reservation|exceeded/i);
});
