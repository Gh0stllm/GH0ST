import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { validatePublicConfig, validateFinalSetupReadback, requireAmount, withdrawalBudget, confirmedMaxQuote, withdrawalArgs, ZERO } from './bridge/core.mjs';
import { parseSearch, quantity, native, verifiedConfig, blockPage } from './scan/public/core.mjs';
const tests = []; const test = async (name, fn) => { await fn(); tests.push(name); };
const base = path.dirname(new URL(import.meta.url).pathname);
const c = JSON.parse(fs.readFileSync(base + '/bridge/public-config.example.json'));
const addr = '0x' + '11'.repeat(20), hash = '0x' + 'ab'.repeat(32);
const valid = { ...c, enabled: true, childGenesisHash: hash, rollupAddress: addr, inboxAddress: addr, nativeBackingBridge: addr, outboxAddress: addr,
  evidence: { deploymentReceipts: 'fixture', nativeBridgeRehearsal: 'fixture', batchPosterHealth: 'fixture', licensingReview: 'fixture' },
  finalSetup: { ...c.finalSetup, setupReceiptTxHashes: [hash], treasury: addr, networkFeeAccount: addr, infraFeeAccount: addr, l1RewardRecipient: addr } };
await test('bridge disabled configuration and missing final setup reject', () => {
  assert.throws(() => validatePublicConfig(c)); assert.throws(() => validatePublicConfig({ ...valid, finalSetup: null }));
  assert.throws(() => validatePublicConfig({ ...valid, finalSetup: { ...valid.finalSetup, treasury: ZERO } }));
  assert.equal(validatePublicConfig(valid), valid);
});
await test('new genesis chain token role and private-query RPC binding are required', () => {
  for (const delta of [{ childGenesisHash: '0x' + '00'.repeat(32) }, { childChainId: 4663 }, { parentBackingToken: addr }, { expectedAnyTrustFastConfirmer: ZERO }, { parentRpcUrl: 'https://fixture.invalid/?private=key' }]) assert.throws(() => validatePublicConfig({ ...valid, ...delta }));
});
const readback = { owners: [ZERO], minters: [], nativeTokenManagementFrom:0n, scheduledUpgrade:[0n,0n], minimumGasPrice: 10000000000000n, baseFee: 10000000000000n, networkFeeAccount: addr, infraFeeAccount: addr, l1RewardRecipient: addr };
await test('final zero owner no minters and exact minimum/treasury policy pass', () => assert.equal(validateFinalSetupReadback(valid, readback), true));
await test('remaining owner minter lower fees or changed recipient disable activation', () => {
  for (const delta of [{ owners: [addr] }, { minters: [addr] }, { minimumGasPrice: 1n }, { baseFee: 1n }, { infraFeeAccount: ZERO }]) assert.throws(() => validateFinalSetupReadback(valid, { ...readback, ...delta }));
});
await test('integer decimal amount validation rejects zero exponents and overprecision', () => {
  for (const a of ['0', '-1', '1e6', '1.0000000000000000001', '1,000', 'NaN']) assert.throws(() => requireAmount(a));
  assert.equal(requireAmount('1000000.000000000000000001'), '1000000.000000000000000001');
});
await test('Max reserves measured gas at current price cap with margin using integers', () => {
  const b = withdrawalBudget(100000000000000000000n, 50000n, 10000000000000n);
  assert.equal(b.gasLimit, 60001n); assert.equal(b.amount + b.reserve, 100000000000000000000n);
  assert.equal(b.reserve, b.gasLimit * 10000000000000n); assert.throws(() => withdrawalBudget(1n, 50000n, 10000000000000n));
});
await test('Max rechecks the full withdrawal value and bounds changing-fee retries', async () => {
  const values = [], amounts = [100n, 90n, 95n];
  const quote = await confirmedMaxQuote(async value => { values.push(value); return { amount: amounts.shift() }; });
  assert.equal(quote.amount, 90n); assert.deepEqual(values, [1n, 100n, 90n]);
  let n = 100n; await assert.rejects(() => confirmedMaxQuote(async () => ({ amount: n-- }), 2));
});
await test('claim amount destination position and data come from actual event', () => {
  const e = { args: { position: 9n, caller: addr, destination: addr, arbBlockNum: 10n, ethBlockNum: 20n, timestamp: 30n, callvalue: 55n, data: '0x' } };
  const a = withdrawalArgs(e, [hash]); assert.equal(a[1], 9n); assert.equal(a[3], addr); assert.equal(a[7], 55n);
  assert.throws(() => withdrawalArgs({ args: { ...e.args, data: '0x01' } }, [hash]));
});
await test('explorer search distinguishes address hashes and exact large block integers', () => {
  assert.equal(parseSearch(addr).type, 'address'); assert.equal(parseSearch(hash).type, 'hash');
  assert.equal(parseSearch('9007199254740993').value, '0x20000000000001'); assert.throws(() => parseSearch('<script>'));
});
await test('explorer balances and pagination preserve exact values including genesis', () => {
  assert.equal(native('0xde0b6b3a7640001'), '1.000000000000000001'); assert.equal(quantity('0x4726d9'), 4663001n);
  assert.deepEqual(blockPage(2n, null), ['0x2', '0x1', '0x0']); assert.equal(blockPage(50n, 30n).at(-1), '0xb');
});
await test('explorer refuses disabled wrong-chain or missing-genesis profiles', () => {
  const s = { enabled: true, readOnly:false, chainId: 4663001, nativeSymbol: 'GH0ST', confirmationMode: 'project-run-fast-confirmation', zkAtLaunch: false, genesisHash: hash, rpcUrl: 'https://fixture.invalid' };
  assert.equal(verifiedConfig(s), s); for (const delta of [{ enabled: false }, { chainId: 1 }, { genesisHash: null }, { zkAtLaunch: true }]) assert.throws(() => verifiedConfig({ ...s, ...delta }));
});

// Compare the public app's handwritten ABI signatures against pinned compiled
// upstream ABI artifacts supplied separately to this bounded test, not a live contract.
if (fs.existsSync(base + '/test-fixtures/vendor.mjs')) {
  const { Interface } = await import('./test-fixtures/vendor.mjs');
  const all = JSON.parse(fs.readFileSync(base + '/test-fixtures/pinned-abis.json'));
  const source = fs.readFileSync(base + '/bridge/app.mjs', 'utf8');
  await test('bridge ABI signatures/events agree with pinned compiled upstream artifacts', () => {
    const available = new Set(all.filter(x => ['function', 'event'].includes(x.type)).map(x => new Interface([x]).fragments[0].format('sighash')));
    for (const match of source.matchAll(/const \w+_ABI = (\[[^;]+\]);/g)) {
      for (const sig of vm.runInNewContext(match[1])) {
        const fragment = new Interface([sig]).fragments[0];
        if (['approve', 'allowance', 'balanceOf', 'decimals'].includes(fragment.name)) continue;
        assert.ok(available.has(fragment.format('sighash')), fragment.format('sighash'));
      }
    }
  });
  class Element { constructor() { this.disabled = false; this.classList = { toggle() {} }; this.children = []; } append(...x) { this.children.push(...x); } prepend(...x) { this.children.unshift(...x); } replaceChildren(...x) { this.children = x; } setAttribute(k, v) { this[k] = v; } }
  await test('real bridge module initializes disabled without issuing any chain request', async () => {
    const elements = new Map(); globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement: () => new Element() };
    globalThis.window = {}; globalThis.localStorage = { getItem: () => null, setItem() {} }; globalThis.location = { hash: '' };
    let calls = 0; globalThis.fetch = async url => { calls++; assert.equal(url, './public-config.json'); return { json: async () => c }; };
    const target = base + '/test-fixtures/bridge-app.mjs';
    fs.writeFileSync(target, source.replace("from '/mint/vendor/ethers.js'", "from './vendor.mjs'").replace("from './bridge-state.mjs'", "from '../bridge-state.mjs'").replace("from './core.mjs'", "from '../bridge/core.mjs'"));
    await import(pathToFileURL(target)); assert.equal(calls, 1); assert.equal(elements.get('action').disabled, true); assert.ok(elements.get('network-status').textContent.includes('not enabled'));
  });
}
console.log(JSON.stringify({ scope: 'bounded Runpod frontend/ABI/unit DOM fixtures; not browser-wallet, live Nitro or deployed Netlify evidence', passed: tests.length, tests }, null, 2));
