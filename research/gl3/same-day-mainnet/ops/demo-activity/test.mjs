import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Journal, DemoEngine, digest, json } from './engine.mjs';
import { validateConfig, tickActions, CHAIN, GENESIS, patchedRuntime, FORBIDDEN } from './worker.mjs';
const req = createRequire('/workspace/gl3/durable/neutral/dispute/package.json');
const { Wallet, BrowserProvider, ContractFactory } = req('ethers');
const ganache = req('ganache');
const dir = path.dirname(new URL(import.meta.url).pathname);
const reports = [];
async function test(name, fn) { const t = performance.now(); await fn(); reports.push({ name, passed: true, elapsedMs: performance.now() - t }); console.log('PASS ' + name); }
const signer = '0x1111111111111111111111111111111111111111';
const H = c => '0x' + c.repeat(64);
function decode(raw) {
  const t = JSON.parse(Buffer.from(raw.slice(2), 'hex'));
  return { ...t, hash: '0x' + digest(raw), from: signer, chainId: BigInt(t.chainId), value: BigInt(t.value), gasLimit: BigInt(t.gasLimit), maxFeePerGas: BigInt(t.maxFeePerGas), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas) };
}
function setup(opts = {}) {
  const journal = { events: [], append(e) { this.events.push(JSON.parse(json(e))); } };
  const chain = { latest: 0, pending: new Map(), receipts: new Map(), balance: 100000n, chainId: CHAIN, genesis: GENESIS, sent: 0, signed: 0, now: 1000, blocks: new Map(), ambiguous: false };
  const rpc = async (m, a) => {
    if (m === 'eth_chainId') return '0x' + chain.chainId.toString(16);
    if (m === 'eth_getBlockByNumber') return a[0] === '0x0' ? { hash: chain.genesis } : chain.blocks.get(a[0]);
    if (m === 'eth_getTransactionCount') return '0x' + (a[1] === 'latest' ? chain.latest : chain.latest + chain.pending.size).toString(16);
    if (m === 'eth_getBalance') return '0x' + chain.balance.toString(16);
    if (m === 'eth_getTransactionReceipt') return chain.receipts.get(a[0]) ?? null;
    if (m === 'eth_getTransactionByHash') return chain.pending.get(a[0]) ?? null;
    if (m === 'eth_sendRawTransaction') {
      chain.sent++; const tx = decode(a[0]);
      assert(journal.events.some(e => e.type === 'intent' && e.raw === a[0] && e.hash === tx.hash), 'intent must exist before RPC');
      chain.pending.set(tx.hash, { ...tx, nonce: '0x' + tx.nonce.toString(16), blockHash: null });
      if (chain.ambiguous) throw Error('transport lost');
      return tx.hash;
    }
    throw Error('unimplemented ' + m);
  };
  const sign = async tx => { chain.signed++; return '0x' + Buffer.from(json(tx)).toString('hex'); };
  const build = () => new DemoEngine({ rpc, sign, decode, journal, identity: { chainId: CHAIN, genesis: GENESIS, signer, configSHA256: 'c'.repeat(64) }, budgetWei: 10000, reserveWei: 100, maxPending: 4, now: () => chain.now, ...opts });
  const action = i => ({ key: 'a' + i, label: 'AUTOMATED DEMO', to: signer, data: '0x', value: 0, gasLimit: 10n, maxFeePerGas: 2n, quoteTimeMs: chain.now });
  const mine = (hash, status = '0x1') => {
    const tx = chain.pending.get(hash); const blockNumber = '0x' + (chain.latest + 1).toString(16); const blockHash = H(String((chain.latest + 1) % 10));
    const r = { transactionHash: hash, blockNumber, blockHash, status, gasUsed: '0x8', effectiveGasPrice: '0x2' };
    chain.blocks.set(blockNumber, { hash: blockHash }); chain.receipts.set(hash, r); chain.pending.delete(hash); chain.latest++; chain.balance -= 16n; return r;
  };
  return { journal, chain, rpc, build, engine: build(), action, mine };
}

await test('journal-exclusive-owner-mode-durable-exact-bytes', async () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'gl3-demo-')); fs.chmodSync(p, 0o700);
  const j = new Journal(p); j.append({ type: 'test', raw: '0xdeadbeef' });
  assert.throws(() => new Journal(p), /EEXIST/); assert.equal(fs.statSync(j.file).mode & 0o777, 0o600); j.close();
  const again = new Journal(p); assert.equal(again.events[0].raw, '0xdeadbeef'); again.close();
  fs.appendFileSync(path.join(p, 'intents.jsonl'), '{'); assert.throws(() => new Journal(p), /TRUNCATED/);
  fs.rmSync(p, { recursive: true });
});
await test('journal-tamper-and-public-directory-rejected', async () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'gl3-demo-')); fs.chmodSync(p, 0o700);
  const j = new Journal(p); j.append({ type: 'test', value: 1 }); j.close();
  const f = path.join(p, 'intents.jsonl'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"value":1', '"value":2'));
  assert.throws(() => new Journal(p), /HASH_CHAIN/); fs.chmodSync(p, 0o755); assert.throws(() => new Journal(p), /UNSAFE/); fs.rmSync(p, { recursive: true });
});
await test('write-ahead-exact-intent-then-canonical-receipt-and-cost', async () => {
  const s = setup(); const r = await s.engine.submit(s.action(0)); assert.equal(r.nonce, 0); s.mine(r.hash); await s.engine.reconcile();
  assert.equal(s.engine.spent, 16n); assert.equal(s.engine.pending.length, 0); assert.equal(s.chain.sent, 1);
  const resumed = s.build(); await resumed.reconcile(); assert.equal(resumed.nextNonce, 1); assert.equal(resumed.spent, 16n);
});
await test('ambiguous-broadcast-stops-no-resend-recover-known-hash', async () => {
  const s = setup(); s.chain.ambiguous = true; await assert.rejects(s.engine.submit(s.action(0)), /BROADCAST_UNCERTAIN/);
  assert.equal(s.chain.sent, 1); const resumed = s.build(); await resumed.reconcile(); assert.equal(s.chain.sent, 1);
  s.mine(resumed.pending[0].hash); await resumed.reconcile(); assert.equal(resumed.spent, 16n);
});
await test('unknown-signed-intent-after-crash-never-resubmitted', async () => {
  const s = setup(); const r = await s.engine.submit(s.action(0)); s.chain.pending.delete(r.hash);
  await assert.rejects(s.build().reconcile(), /UNCERTAIN_INTENT/); assert.equal(s.chain.sent, 1);
});
await test('pending-window-four-backpressure-no-extra-sign', async () => {
  const s = setup(); for (let i = 0; i < 4; i++) await s.engine.submit(s.action(i));
  assert.deepEqual(await s.engine.submit(s.action(4)), { backpressure: true }); assert.equal(s.chain.signed, 4);
});
await test('finite-budget-and-upfront-balance-account-for-all-pending', async () => {
  const s = setup({ budgetWei: 150, reserveWei: 100 }); await s.engine.submit(s.action(0)); await s.engine.submit(s.action(1));
  await assert.rejects(s.engine.submit(s.action(2)), /FINITE_BUDGET/); assert.equal(s.chain.signed, 2);
  const t = setup(); t.chain.balance = 119n; await assert.rejects(t.engine.submit(t.action(0)), /LOW_BALANCE/); assert.equal(t.chain.signed, 0);
});
await test('stale-quote-nonzero-value-and-external-nonce-stop-before-sign', async () => {
  const s = setup(); await assert.rejects(s.engine.submit({ ...s.action(0), quoteTimeMs: -10000 }), /STALE/);
  await assert.rejects(s.engine.submit({ ...s.action(0), value: 1 }), /INVALID_DEMO/);
  await s.engine.reconcile(); s.chain.latest = 1; await assert.rejects(s.engine.submit(s.action(1)), /NONCE_DRIFT/); assert.equal(s.chain.signed, 0);
});
await test('wrong-chain-and-genesis-fail-before-sign', async () => {
  const s = setup(); s.chain.chainId++; await assert.rejects(s.engine.submit(s.action(0)), /WRONG_CHAIN/); s.chain.chainId--;
  s.chain.genesis = H('a'); await assert.rejects(s.engine.submit(s.action(0)), /WRONG_GENESIS/); assert.equal(s.chain.signed, 0);
});
await test('reorg-reverted-receipt-and-timeout-stop-without-replacement', async () => {
  const s = setup(); const r = await s.engine.submit(s.action(0)); const receipt = s.mine(r.hash); await s.engine.reconcile();
  s.chain.blocks.set(receipt.blockNumber, { hash: H('a') }); await assert.rejects(s.engine.reconcile(), /REORG/);
  const t = setup(); const q = await t.engine.submit(t.action(0)); t.mine(q.hash, '0x0'); await assert.rejects(t.engine.reconcile(), /FAILED_TRANSACTION/);
  const u = setup(); await u.engine.submit(u.action(0)); u.chain.now += 31000; await assert.rejects(u.engine.reconcile(), /PENDING_TIMEOUT/); assert.equal(u.chain.sent, 1);
});
await test('duplicate-action-and-mutated-signer-transaction-rejected', async () => {
  const s = setup(); await s.engine.submit(s.action(0)); await assert.rejects(s.engine.submit(s.action(0)), /DUPLICATE_ACTION/);
  const t = setup(); t.engine.sign = async tx => '0x' + Buffer.from(json({ ...tx, to: '0x2222222222222222222222222222222222222222' })).toString('hex');
  await assert.rejects(t.engine.submit(t.action(0)), /SIGNER_RETURNED/); assert.equal(t.chain.sent, 0);
});
await test('no-concurrent-signing-and-journal-identity-mismatch', async () => {
  const s = setup(); s.engine.busy = true; await assert.rejects(s.engine.submit(s.action(0)), /CONCURRENT/); s.engine.busy = false;
  assert.throws(() => new DemoEngine({ rpc: s.rpc, decode, sign: async () => '', journal: s.journal,
    identity: { chainId: CHAIN, genesis: GENESIS, signer, configSHA256: 'd'.repeat(64) }, budgetWei: 1000, reserveWei: 1 }), /IDENTITY_MISMATCH/);
});
const config = { schema: 'gh0st.gl3.automated-demo.config.v1', activationApproved: true, label: 'AUTOMATED DEMO - NOT ORGANIC ADOPTION OR ECONOMIC VOLUME',
  chainId: CHAIN, genesis: GENESIS, rpc: 'http://127.0.0.1:8547', signer, intervalMs: 1000, maxPending: 4, tokenEveryTicks: 10, nftEveryTicks: 30,
  maxRunSeconds: 21600, maxTransactions: 100000, budgetWei: '100000000000000000000000', reserveWei: '100000000000000000000',
  gasMarginBps: 12500, feeMultiplierBps: 20000, mode: 'counter', keyFile: '/workspace/gl3/mainnet/private/demo/wallet.json', stateDir: '/workspace/gl3/mainnet/private/demo/state-v1',
  artifactsSHA256: 'a'.repeat(64), engineSHA256: 'b'.repeat(64), workerSHA256: 'c'.repeat(64), tokenRecipient: '0x000000000000000000000000000000000000dEaD' };
await test('dedicated-signer-config-and-explicit-approval-required', async () => {
  assert.equal(validateConfig(config), config);
  for (const address of FORBIDDEN) assert.throws(() => validateConfig({ ...config, signer: address }), /DEDICATED/);
  assert.throws(() => validateConfig({ ...config, activationApproved: false }), /NOT_APPROVED/);
  assert.throws(() => validateConfig({ ...config, intervalMs: 100 }), /INTERVAL/);
  assert.throws(() => validateConfig({ ...config, rpc: 'http://example.com' }), /CHAIN_BINDING/);
});
await test('one-second-mix-max-three-no-catch-up-claim', async () => {
  let actions = 0;
  for (let n = 1; n <= 30; n++) { const a = tickActions(n, config); assert(a.length >= 1 && a.length <= 3); actions += a.length; }
  assert.equal(actions, 34); assert.equal(tickActions(30, config).length, 3);
});
await test('actual-in-memory-EVM-demo-contracts-runtime-authorization-and-events', async () => {
  // Public TEST keys on an isolated in-memory EVM. Never the live GL3 RPC or a real wallet.
  const key = '0x' + '1'.padStart(64, '0'), secondKey = '0x' + '2'.padStart(64, '0');
  const eip = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, wallet: { accounts: [key, secondKey].map(secretKey => ({ secretKey, balance: '0x' + (1000n * 10n ** 18n).toString(16) })) } });
  const provider = new BrowserProvider(eip, undefined, { cacheTimeout: -1 });
  const w = await provider.getSigner(new Wallet(key).address), second = await provider.getSigner(new Wallet(secondKey).address);
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'artifacts.json'))); const deployed = {};
  try {
    for (const [name, artifact] of Object.entries(a)) {
      const c = await new ContractFactory(artifact.abi, artifact.bytecode, w).deploy(await w.getAddress()); await c.waitForDeployment();
      assert.equal(await provider.getCode(await c.getAddress()), patchedRuntime(artifact, await w.getAddress())); deployed[name] = c;
    }
    const pulse = deployed.GL3AutomatedDemoPulse;
    await (await pulse.pulse()).wait(); await (await pulse.pulse()).wait(); assert.equal(await pulse.pulses(), 2n);
    await assert.rejects(pulse.connect(second).pulse());
    const token = deployed.GL3AutomatedDemoToken;
    await (await token.transfer(await second.getAddress(), 10n ** 18n)).wait(); assert.equal(await token.balanceOf(await second.getAddress()), 10n ** 18n);
    await (await token.approve(await second.getAddress(), 2)).wait(); await (await token.connect(second).transferFrom(await w.getAddress(), await second.getAddress(), 2)).wait();
    assert.equal(await token.allowance(await w.getAddress(), await second.getAddress()), 0n); assert.equal(await token.totalSupply(), 10n ** 24n);
    const nft = deployed.GL3AutomatedDemoNFT;
    await assert.rejects(nft.connect(second).mintDemo()); await (await nft.mintDemo()).wait(); assert.equal(await nft.ownerOf(1), await w.getAddress());
    assert(await nft.supportsInterface('0x80ac58cd')); assert.match(await nft.tokenURI(1), /Automated.*No backing/);
    await (await nft['safeTransferFrom(address,address,uint256)'](await w.getAddress(), await second.getAddress(), 1)).wait(); assert.equal(await nft.ownerOf(1), await second.getAddress());
  } finally { provider.destroy(); await eip.disconnect(); }
});
const result = { schema: 'gh0st.gl3.automated-demo.tests.v1', passed: true, actualExitCode: 0, testCount: reports.length,
  liveTransactionsSigned: 0, liveTransactionsSent: 0, inMemoryTestChainOnly: true, tests: reports };
fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true }); fs.writeFileSync(path.join(dir, 'evidence/tests.json'), JSON.stringify(result, null, 2) + '\n');
console.log('ALL PASS ' + reports.length);
