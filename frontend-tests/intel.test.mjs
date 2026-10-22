import test from 'node:test';
import assert from 'node:assert/strict';
import * as Ethers from '../website/mint/vendor/ethers.js';
import { mountS0ULIntel, INTEL_ABIS, parseIntelBudget, formatIntelETH, intelQuoteMatches } from '../website/s0ul-intel.mjs';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const OBS = '0x3333333333333333333333333333333333333333';
const REPORTS = '0x4444444444444444444444444444444444444444';
const MODEL = '0x5555555555555555555555555555555555555555';
const TARGET = '0x6666666666666666666666666666666666666666';
const ZERO = Ethers.ZeroHash, BLOCK = '0x' + 'aa'.repeat(32);
const MODEL_ID = Ethers.keccak256(Ethers.toUtf8Bytes('test numeric model'));
const MANIFEST = Ethers.keccak256(Ethers.toUtf8Bytes('test training manifest'));
const txHash = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const obsInterface = new Ethers.Interface(INTEL_ABIS.observations);
const reportInterface = new Ethers.Interface(INTEL_ABIS.reports);
const journalKey = `gh0st:intel:4663:${OWNER}`;

function dom() {
  class Element {
    constructor() { this.dataset = {}; this.style = {}; this.listeners = new Map(); this.children = []; this.textContent = ''; this.value = ''; this.checked = false; }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    removeEventListener(type) { this.listeners.delete(type); }
    async fire(type) { await this.listeners.get(type)?.(); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    removeAttribute(name) { delete this[name]; }
  }
  const nodes = new Map(), root = new Element();
  root.ownerDocument = { defaultView: {}, createElement: () => new Element() };
  Object.defineProperty(root, 'innerHTML', { set(html) {
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, new Element());
    for (const [id, value] of Object.entries({ 'subject-id':'1', lookback:'1', action:'snapshot', kind:'3' })) nodes.get('intel-' + id).value = value;
  } });
  root.querySelector = selector => nodes.get(selector.slice(1));
  return { root, get: id => nodes.get('intel-' + id) };
}

function fixture(options = {}) {
  const env = { now: 1_800_000_000_000, rpcChain: 4663, walletChain: 4663, account: OWNER,
    balance: 10n ** 21n, gasPrice: 10n ** 9n, gasEstimate: 500_000n, blockLimit: 32_000_000n,
    nonce: 7, sequence: 1n, calls: [], sends: [], transactions: new Map(), receipts: new Map(),
    saved: new Map(), codes: new Map([[OBS,'0x6001'],[REPORTS,'0x6002'],[MODEL,'0x6003'],[TARGET,'0x6004']]), ...options };
  const deployment = { chainId: 4663, observations: { address: OBS, codeHash: Ethers.keccak256('0x6001') },
    reports: { address: REPORTS, codeHash: Ethers.keccak256('0x6002') }, classifier: { address: MODEL,
      codeHash: Ethers.keccak256('0x6003'), modelId: MODEL_ID, trainingManifestHash: MANIFEST } };
  const listeners = new Map();
  const storage = {
    getItem(key) { if (env.storageReadFails) throw Error('Storage read failed'); return env.saved.get(key) ?? null; },
    setItem(key, value) { if (env.storageFails) throw Error('Storage disabled'); if (!env.storageDropsWrites) env.saved.set(key, value); },
    removeItem(key) { if (env.storageFails) throw Error('Storage disabled'); env.saved.delete(key); },
  };
  function encodedResult(iface, method, values) { return iface.decodeFunctionResult(method, iface.encodeFunctionResult(method, values))[0]; }
  function frame() {
    const seq = env.sequence, current = [seq, 1800000000n, 100n, BLOCK, [1_000_000n, 0n, 0n, 0n]],
      previous = [seq > 1n ? seq - 1n : 0n, seq > 1n ? 1799999700n : 0n, 99n, seq > 1n ? BLOCK : ZERO, [seq > 1n ? 900_000n : 0n, 0n, 0n, 0n]],
      flags = seq > 1n ? 7 : 6;
    return encodedResult(obsInterface, 'features', [[1n, 1, current, previous,
      txHash(seq + 100n), seq > 1n ? txHash(seq + 99n) : ZERO,
      [seq > 1n ? 1111 : 0,0,0,0,0,seq > 1n ? 300 : 0,1,flags], seq > 1n ? 300 : 0,
      flags, seq > 1n, true, seq > 1n ? 0 : 9]]);
  }
  const provider = {
    async getNetwork() { return { chainId: 4663n }; }, // Mirrors a misleading staticNetwork value.
    async send(method) { env.calls.push('rpc:' + method); if (method === 'eth_chainId') return Ethers.toQuantity(env.rpcChain); throw Error('Unexpected RPC method'); },
    async getCode(address) { return env.codes.get(address) ?? '0x'; },
    async getBlock(number) { return { number: number === 'latest' ? 100 : number, timestamp: 1800000000, gasLimit: env.blockLimit, hash: env.noncanonical ? ZERO : BLOCK }; },
    async getFeeData() { return { gasPrice: env.gasPrice }; },
    async getTransaction(hash) { return env.transactions.get(hash) ?? null; },
    async getTransactionReceipt(hash) { return env.hideReceipts ? null : env.receipts.get(hash) ?? null; },
  };
  const estimateFunction = method => ({ estimateGas: async () => { env.calls.push('estimate:' + method); await env.onEstimate?.(); return env.gasEstimate; } });
  const contracts = {
    observations: { interface: obsInterface, getFunction: estimateFunction,
      async owner() { return OWNER; }, async subjectCount() { return 1n; },
      async subject() { return encodedResult(obsInterface, 'subject', [[1,true,TARGET,Ethers.ZeroAddress,Ethers.keccak256('0x6004'),TARGET,Ethers.ZeroAddress,env.sequence,0]]); },
      async features() { return frame(); }, snapshot: { staticCall: async () => [0, env.sequence + 1n] },
    },
    reports: { interface: reportInterface, getFunction: estimateFunction,
      async observations() { return env.reportObservations ?? OBS; }, async classifier() { return env.reportClassifier ?? MODEL; },
      async observationsCodeHash() { return env.reportObsHash ?? deployment.observations.codeHash; },
      async classifierCodeHash() { return env.reportClassifierHash ?? deployment.classifier.codeHash; },
      async modelId() { return env.reportModelId ?? MODEL_ID; }, async trainingManifestHash() { return env.reportManifest ?? MANIFEST; },
      async chainId() { return env.reportChain ?? 4663n; }, async latestReport() { return 0n; },
    },
    classifier: { async modelId() { return env.modelId ?? MODEL_ID; }, async trainingManifestHash() { return env.manifest ?? MANIFEST; } },
  };
  async function broadcast(request) {
    const journal = JSON.parse(env.saved.get(journalKey) ?? 'null');
    assert.ok(journal, 'durable intent must precede the wallet prompt');
    assert.equal(journal.hash, null); assert.equal(journal.owner, OWNER); assert.equal(journal.chainId, 4663);
    assert.equal(journal.nonce, env.nonce); assert.equal(journal.to, request.to);
    assert.equal(journal.dataHash, Ethers.keccak256(request.data));
    assert.ok(BigInt(journal.budgetWei) > 0n); assert.ok(BigInt(journal.gasLimit) > 0n);
    assert.ok(BigInt(journal.feeCeilingWei) >= BigInt(request.gasPrice));
    const hash = txHash(env.sends.length + 1); env.sends.push(request);
    env.transactions.set(hash, { ...request, hash, from: OWNER, nonce: Number(request.nonce), chainId: Number(request.chainId),
      value: BigInt(request.value), gasPrice: BigInt(request.gasPrice), gasLimit: BigInt(request.gasLimit ?? request.gas) });
    const log = obsInterface.encodeEventLog(obsInterface.getEvent('SnapshotStored'), [1, ++env.sequence, txHash(500), 1800000000, 101, [1_000_000,0,0,0]]);
    env.receipts.set(hash, { hash, status: 1, blockNumber: 101, blockHash: BLOCK, gasPrice: env.gasPrice, gasUsed: 100_000n, logs: [{ address: OBS, ...log }] });
    if (env.sendError) throw Object.assign(Error('Wallet transport result is ambiguous'), { code: env.sendError });
    return { hash, async wait() {
      const saved = JSON.parse(env.saved.get(journalKey));
      assert.equal(saved.hash, hash, 'hash must be durable before receipt waiting');
      if (env.waitError || env.hideReceipts) throw Error('Receipt RPC interrupted');
      return env.receipts.get(hash);
    } };
  }
  const ethereum = {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { for (const fn of listeners.get(name) ?? []) fn(); },
    async request({ method }) {
      env.calls.push('wallet:' + method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [env.account];
      if (method === 'eth_chainId') return Ethers.toQuantity(env.walletChain);
      if (method === 'wallet_switchEthereumChain') { env.walletChain = 4663; return null; }
      if (method === 'eth_getTransactionCount') { await env.onNonce?.(); return Ethers.toQuantity(env.nonce); }
      throw Error('Unexpected wallet request ' + method);
    },
  };
  const signer = { async getNonce() { await env.onNonce?.(); return env.nonce; }, sendTransaction: broadcast };
  const eth = { ...Ethers, BrowserProvider: class { async getBalance() { return env.balance; } async getSigner() { return signer; } destroy() {} } };
  function surface(config = deployment) {
    const d = dom(), mounted = mountS0ULIntel(d.root, { deployment: config, ethers: eth, provider, contracts,
      ethereum, storage, now: () => env.now, setInterval: () => 1, clearInterval() {} });
    return { ...d, mounted };
  }
  const primary = surface(options.noDeployment ? null : deployment);
  async function quoted() {
    await primary.mounted.ready; await primary.mounted.connect(); await primary.mounted.estimate();
    assert.ok(primary.mounted.state.quote, primary.get('notice').textContent); return primary.mounted.state.quote;
  }
  async function consent() { primary.get('consent').checked = true; await primary.get('consent').fire('change'); }
  return { ...primary, env, deployment, provider, contracts, storage, ethereum, surface, quoted, consent };
}

test('Intel budget and quote helpers preserve exact wei and bind wallet/chain/context/expiry', () => {
  assert.equal(parseIntelBudget('0.000000000000000001'), 1n);
  assert.equal(formatIntelETH(parseIntelBudget('9007199254740993.123456789012345678')), '9007199254740993.123456789012345678');
  for (const bad of ['0','-1','1e18','1.0000000000000000001','NaN']) assert.throws(() => parseIntelBudget(bad));
  const context = { address: OWNER, chainId: 4663, action: 'snapshot', contextHash: 'context', now: 1000 };
  const q = { owner: OWNER, chainId: 4663, action: 'snapshot', contextHash: 'context', expiresAt: 46000 };
  assert.equal(intelQuoteMatches(q, context), true);
  for (const changed of [{ owner: OTHER },{ chainId: 1 },{ action: 'analyze' },{ contextHash: 'different' },{ expiresAt: 1000 },{ expiresAt: NaN }])
    assert.equal(intelQuoteMatches({ ...q, ...changed }, context), false, JSON.stringify(changed));
});

test('null deployment is visibly awaiting deployment and cannot read or send', async t => {
  const f = fixture({ noDeployment: true }); t.after(() => f.mounted.destroy()); await f.mounted.ready;
  assert.equal(f.mounted.state.verified, false); assert.equal(f.get('connect').disabled, true); assert.equal(f.get('send').disabled, true);
  assert.match(f.get('notice').textContent, /awaiting deployment/);
  assert.equal(f.env.calls.length, 0); assert.equal(f.env.sends.length, 0);
});

test('public reads use real ABI tuples including Snapshot.values without requesting wallet access', async t => {
  const f = fixture(); t.after(() => f.mounted.destroy()); await f.mounted.ready; await f.mounted.load();
  assert.equal(f.mounted.state.verified, true); assert.equal(f.mounted.state.current.snapshot.values[0], 1_000_000n);
  assert.match(f.get('metrics').children[0].children[1].textContent, /1,000,000/);
  assert.equal(f.env.calls.some(call => call.startsWith('wallet:')), false); assert.equal(f.env.sends.length, 0);
});

test('actual RPC chain is checked despite a provider staticNetwork claiming4663', async t => {
  const f = fixture({ rpcChain: 1 }); t.after(() => f.mounted.destroy()); await f.mounted.ready;
  assert.equal(f.mounted.state.verified, false); assert.match(f.get('notice').textContent, /read provider is not/);
  assert.ok(f.env.calls.includes('rpc:eth_chainId')); assert.equal(f.get('send').disabled, true);
});

test('all runtime, immutable dependency, model and manifest pins fail closed', async () => {
  const corruptions = [
    f => f.env.codes.set(OBS, '0x00'), f => f.env.codes.set(REPORTS, '0x00'), f => f.env.codes.set(MODEL, '0x00'),
    f => { f.env.reportObservations = OTHER; }, f => { f.env.reportClassifier = OTHER; },
    f => { f.env.reportObsHash = ZERO; }, f => { f.env.reportClassifierHash = ZERO; },
    f => { f.env.reportModelId = ZERO; }, f => { f.env.reportManifest = ZERO; },
    f => { f.env.reportChain = 1; }, f => { f.deployment.classifier.modelId = ZERO; },
    f => { f.deployment.classifier.trainingManifestHash = ZERO; },
  ];
  for (const corrupt of corruptions) {
    const f = fixture(); corrupt(f); await f.mounted.ready;
    assert.equal(f.mounted.state.verified, false); assert.equal(f.get('send').disabled, true); assert.equal(f.env.sends.length, 0);
    f.mounted.destroy();
  }
});

test('no action sends without a fresh45-second quote, explicit consent and full fee reserve', async t => {
  const f = fixture(); t.after(() => f.mounted.destroy()); const q = await f.quoted();
  assert.equal(q.expiresAt - f.env.now, 45000); assert.equal(q.gasLimit, 600_000n); assert.equal(q.feeCeilingWei, 1_500_000_000n);
  await f.mounted.send(); assert.equal(f.env.sends.length, 0);
  f.get('limit').value = formatIntelETH(q.reserveWei - 1n); await f.consent(); await f.mounted.send();
  assert.equal(f.env.sends.length, 0);
  f.get('limit').value = formatIntelETH(q.reserveWei); await f.consent(); f.env.now = q.expiresAt; await f.mounted.send();
  assert.equal(f.env.sends.length, 0); assert.equal(f.get('send').disabled, true);
});

test('explicit send saves hash-null intent and nonce before the prompt, then saves hash before waiting', async t => {
  const f = fixture(); t.after(() => f.mounted.destroy()); await f.quoted(); await f.consent(); await f.mounted.send();
  assert.equal(f.env.sends.length, 1); assert.equal(f.mounted.state.pending, null);
  const sent = f.env.sends[0]; assert.equal(sent.to, OBS); assert.equal(sent.chainId, 4663); assert.equal(sent.nonce, 7); assert.equal(sent.value, 0n);
  assert.deepEqual([...obsInterface.parseTransaction({ data: sent.data }).args], [1n]);
  assert.equal(f.env.saved.has(journalKey), false); assert.match(f.get('receipt-count').textContent, /1 confirmed/);
});

test('report and registration actions encode only reviewed identifiers or the source bytecode commitment', async () => {
  for (const action of ['analyze','captureAndAnalyze','register']) {
    const f = fixture({ waitError: true }); await f.mounted.ready; await f.mounted.connect();
    f.get('action').value = action; await f.get('action').fire('change');
    if (action === 'register') { f.get('kind').value = '1'; f.get('target').value = TARGET; }
    await f.mounted.estimate(); await f.consent(); await f.mounted.send();
    assert.equal(f.env.sends.length, 1, f.get('notice').textContent);
    const sent = f.env.sends[0], iface = action === 'register' ? obsInterface : reportInterface;
    const parsed = iface.parseTransaction({ data: sent.data });
    assert.equal(sent.to, action === 'register' ? OBS : REPORTS);
    assert.equal(parsed.name, action === 'register' ? 'registerSubject' : action);
    assert.deepEqual([...parsed.args], action === 'register' ? [1n,TARGET,Ethers.ZeroAddress,Ethers.keccak256('0x6004')] : [1n,1n]);
    f.mounted.destroy();
  }
});

test('unavailable or silently dropping durable storage blocks the wallet prompt', async () => {
  for (const flag of ['storageFails','storageDropsWrites']) {
    const f = fixture(); await f.quoted(); await f.consent(); f.env[flag] = true; await f.mounted.send();
    assert.equal(f.env.sends.length, 0); assert.match(f.get('notice').textContent, /storage|recovery/i); f.mounted.destroy();
  }
});

test('ambiguous wallet errors retain a hash-null journal and prevent another send across reload', async t => {
  const f = fixture({ sendError: 'NETWORK_ERROR' }); t.after(() => f.mounted.destroy()); await f.quoted(); await f.consent(); await f.mounted.send();
  assert.equal(f.env.sends.length, 1); assert.equal(f.mounted.state.pending.hash, null);
  assert.equal(JSON.parse(f.env.saved.get(journalKey)).nonce, 7);
  await f.mounted.estimate(); await f.consent(); await f.mounted.send(); assert.equal(f.env.sends.length, 1);
  f.mounted.destroy(); const recovered = f.surface(); t.after(() => recovered.mounted.destroy());
  await recovered.mounted.ready; await recovered.mounted.connect(); assert.equal(recovered.mounted.state.pending.hash, null);
  await recovered.mounted.reconcile(txHash(1)); assert.equal(recovered.mounted.state.pending, null); assert.equal(f.env.sends.length, 1);
});

test('receipt RPC interruptions retain the known hash and never automatically resubmit', async t => {
  const f = fixture({ waitError: true }); t.after(() => f.mounted.destroy()); await f.quoted(); await f.consent(); await f.mounted.send();
  assert.equal(f.mounted.state.pending.hash, txHash(1)); assert.equal(JSON.parse(f.env.saved.get(journalKey)).hash, txHash(1));
  await f.mounted.send(); assert.equal(f.env.sends.length, 1);
  await f.mounted.reconcile(txHash(9)); assert.notEqual(f.mounted.state.pending, null);
  await f.mounted.reconcile(txHash(1)); assert.equal(f.mounted.state.pending, null); assert.equal(f.env.sends.length, 1);
});

test('recovery verifies exact sender, target, nonce, chain, zero value and calldata before accepting a candidate hash', async () => {
  for (const mutate of [tx => { tx.from = OTHER; },tx => { tx.to = OTHER; },tx => { ++tx.nonce; },
    tx => { tx.chainId = 1; },tx => { tx.value = 1n; },tx => { tx.data = obsInterface.encodeFunctionData('snapshot',[2]); }]) {
    const f = fixture({ sendError: 'NETWORK_ERROR' }); await f.quoted(); await f.consent(); await f.mounted.send();
    const tx = f.env.transactions.get(txHash(1)), original = { ...tx }; mutate(tx);
    await f.mounted.reconcile(txHash(1)); assert.equal(f.mounted.state.pending.hash, null); assert.match(f.get('notice').textContent, /does not match/);
    f.env.transactions.set(txHash(1), original); await f.mounted.reconcile(txHash(1)); assert.equal(f.mounted.state.pending, null);
    assert.equal(f.env.sends.length, 1); f.mounted.destroy();
  }
});

test('noncanonical or absent receipts keep pending recovery unresolved', async t => {
  const f = fixture({ waitError: true }); t.after(() => f.mounted.destroy()); await f.quoted(); await f.consent(); await f.mounted.send();
  f.env.noncanonical = true; await f.mounted.reconcile(txHash(1)); assert.notEqual(f.mounted.state.pending, null);
  f.env.noncanonical = false; f.env.hideReceipts = true; await f.mounted.reconcile(txHash(1)); assert.notEqual(f.mounted.state.pending, null);
  f.env.hideReceipts = false;
  const originalTx = { ...f.env.transactions.get(txHash(1)) }, originalReceipt = { ...f.env.receipts.get(txHash(1)) };
  for (const corrupt of [
    (tx, receipt) => { tx.hash = txHash(9); },
    (tx, receipt) => { receipt.hash = txHash(9); },
    (tx, receipt) => { receipt.transactionHash = txHash(9); },
    (tx, receipt) => { receipt.gasPrice = 0n; },
    (tx, receipt) => { receipt.gasUsed = 0n; },
    (tx, receipt) => { delete tx.gasPrice; delete receipt.gasPrice; },
  ]) {
    const tx = { ...originalTx }, receipt = { ...originalReceipt }; corrupt(tx, receipt);
    f.env.transactions.set(txHash(1), tx); f.env.receipts.set(txHash(1), receipt);
    await f.mounted.reconcile(txHash(1)); assert.notEqual(f.mounted.state.pending, null);
  }
  f.env.transactions.set(txHash(1), originalTx); f.env.receipts.set(txHash(1), originalReceipt);
  await f.mounted.reconcile(txHash(1)); assert.equal(f.mounted.state.pending, null); assert.equal(f.env.sends.length, 1);
});

test('wallet changes and expiry during nonce lookup stop before any wallet prompt', async () => {
  for (const mutate of [f => { f.env.account = OTHER; },f => { f.env.walletChain = 1; }, f => { f.env.now = f.mounted.state.quote.expiresAt; }]) {
    const f = fixture(); await f.quoted(); await f.consent(); f.env.onNonce = () => mutate(f); await f.mounted.send();
    assert.equal(f.env.sends.length, 0); f.mounted.destroy();
  }
});

test('quote edits, changed on-chain context, fee ceiling, gas growth, block cap and balance stop sending', async () => {
  for (const mutate of [
    f => { f.get('subject-id').value = '2'; return f.get('subject-id').fire('input'); },
    f => { ++f.env.sequence; }, f => { f.env.gasPrice = 2_000_000_000n; },
    f => { f.env.gasEstimate = 500_001n; }, f => { f.env.blockLimit = 599_999n; }, f => { f.env.balance = 1n; },
  ]) {
    const f = fixture(); await f.quoted(); await f.consent(); await mutate(f); await f.mounted.send();
    assert.equal(f.env.sends.length, 0); f.mounted.destroy();
  }
});

test('unreadable or corrupted existing recovery journals never become permission for a new transaction', async () => {
  for (const setup of [f => { f.env.saved.set(journalKey, '{corrupted'); }, f => { f.env.storageReadFails = true; }]) {
    const f = fixture(); await f.mounted.ready; setup(f); await f.mounted.connect();
    f.env.storageReadFails = false;
    await f.mounted.estimate(); await f.consent(); await f.mounted.send();
    assert.equal(f.env.sends.length, 0); f.mounted.destroy();
  }
});
