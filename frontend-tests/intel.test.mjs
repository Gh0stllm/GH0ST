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
const POOL = '0x7777777777777777777777777777777777777777';
const ZERO = Ethers.ZeroHash, BLOCK = '0x' + 'aa'.repeat(32);
const MODEL_ID = Ethers.keccak256(Ethers.toUtf8Bytes('test numeric model'));
const MANIFEST = Ethers.keccak256(Ethers.toUtf8Bytes('test training manifest'));
const txHash = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const obsInterface = new Ethers.Interface(INTEL_ABIS.observations);
const reportInterface = new Ethers.Interface(INTEL_ABIS.reports);
const journalKey = `gh0st:intel:4663:${OWNER}`;

function dom() {
  class Element {
    constructor(tagName = 'DIV') { this.tagName = tagName; this.dataset = {}; this.style = {}; this.listeners = new Map(); this.children = []; this.textContent = ''; this.value = ''; this.checked = false; this.attributes = {}; }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    removeEventListener(type) { this.listeners.delete(type); }
    async fire(type) { await this.listeners.get(type)?.(); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    removeAttribute(name) { delete this[name]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    focus() {}
    querySelectorAll() { return []; }
  }
  const nodes = new Map(), root = new Element();
  root.ownerDocument = { defaultView: {}, createElement: tag => new Element(tag.toUpperCase()) };
  Object.defineProperty(root, 'innerHTML', { set(html) {
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, new Element());
    for (const [id, value] of Object.entries({ 'subject-id':'1', lookback:'1', action:'snapshot', kind:'3' })) nodes.get('intel-' + id).value = value;
    for (const [, id, body] of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
      const option = body.match(/<option\b[^>]*\bselected[^>]*value="([^"]+)"/) ?? body.match(/<option\b[^>]*value="([^"]+)"/);
      if (option) nodes.get(id).value = option[1];
    }
  } });
  root.querySelector = selector => nodes.get(selector.slice(1));
  root.querySelectorAll = () => [];
  return { root, get: id => nodes.get('intel-' + id) };
}

function fixture(options = {}) {
  const env = { now: 1_800_000_000_000, rpcChain: 4663, walletChain: 4663, account: OWNER,
    balance: 10n ** 21n, gasPrice: 10n ** 9n, gasEstimate: 500_000n, blockLimit: 32_000_000n,
    nonce: 7, sequence: 1n, calls: [], sends: [], transactions: new Map(), receipts: new Map(),
    saved: new Map(), codes: new Map([[OBS,'0x6001'],[REPORTS,'0x6002'],[MODEL,'0x6003'],[TARGET,'0x6004']]), ...options };
  const deployment = { chainId: 4663, subjects: options.subjects ?? [], observations: { address: OBS, codeHash: Ethers.keccak256('0x6001') },
    reports: { address: REPORTS, codeHash: Ethers.keccak256('0x6002') }, classifier: { address: MODEL,
      codeHash: Ethers.keccak256('0x6003'), modelId: MODEL_ID, trainingManifestHash: MANIFEST } };
  const listeners = new Map();
  const storage = {
    getItem(key) { if (env.storageReadFails) throw Error('Storage read failed'); return env.saved.get(key) ?? null; },
    setItem(key, value) { if (env.storageFails) throw Error('Storage disabled'); if (!env.storageDropsWrites) env.saved.set(key, value); },
    removeItem(key) { if (env.storageFails) throw Error('Storage disabled'); env.saved.delete(key); },
  };
  function encodedResult(iface, method, values) { return iface.decodeFunctionResult(method, iface.encodeFunctionResult(method, values))[0]; }
  const registry = () => env.subjects ?? [{ kind: 1, target: TARGET, account: Ethers.ZeroAddress }];
  function registered(id) { const s = registry()[Number(id) - 1]; if (!s) throw Error('Unknown registered subject'); return s; }
  function frame(id = 1n) {
    const subject = registered(id), kind = subject.kind, seq = subject.sequence ?? env.sequence;
    const observedAt = BigInt(subject.timestamp ?? 1800000000), age = BigInt(env.blockTimestamp ?? 1800000000) - observedAt;
    const fresh = age >= 0n && age <= 60n, values = kind === 2 ? [100_000n,1_000_000n,0n,0n] : kind === 3 ? [1000n,2000n,10000n,observedAt] : [1_000_000n,0n,0n,0n];
    const current = [seq, observedAt, 100n, BLOCK, values],
      previous = [seq > 1n ? seq - 1n : 0n, seq > 1n ? observedAt - 300n : 0n, 99n, seq > 1n ? BLOCK : ZERO, [seq > 1n ? 900_000n : 0n,0n,0n,0n]],
      flags = (seq > 1n ? 1 : 0) + (fresh ? 2 : 0) + 4;
    return encodedResult(obsInterface, 'features', [[id, kind, current, previous,
      txHash(seq + 100n), seq > 1n ? txHash(seq + 99n) : ZERO,
      [seq > 1n ? 1111 : 0,0,0,0,0,seq > 1n ? 300 : 0,kind,flags], seq > 1n ? 300 : 0,
      flags, seq > 1n, fresh, seq > 1n ? fresh ? 0 : 10 : 9]]);
  }
  const provider = {
    async getNetwork() { return { chainId: 4663n }; }, // Mirrors a misleading staticNetwork value.
    async send(method) { env.calls.push('rpc:' + method); if (method === 'eth_chainId') return Ethers.toQuantity(env.rpcChain); throw Error('Unexpected RPC method'); },
    async getCode(address) { return env.codes.get(address) ?? '0x'; },
    async getBlock(number) { return { number: number === 'latest' ? 100 : number, timestamp: env.blockTimestamp ?? 1800000000, gasLimit: env.blockLimit, hash: env.noncanonical ? ZERO : BLOCK }; },
    async getFeeData() { return { gasPrice: env.gasPrice }; },
    async getTransaction(hash) { return env.transactions.get(hash) ?? null; },
    async getTransactionReceipt(hash) { return env.hideReceipts ? null : env.receipts.get(hash) ?? null; },
  };
  const estimateFunction = method => ({ estimateGas: async () => { env.calls.push('estimate:' + method); await env.onEstimate?.(); return env.gasEstimate; } });
  const contracts = {
    observations: { interface: obsInterface, getFunction: estimateFunction,
      async owner() { return OWNER; }, async subjectCount() { return env.subjectCount ?? BigInt(registry().length); },
      async subject(id) {
        env.calls.push('registry:subject:' + id); if (BigInt(id) === BigInt(env.failSubjectAt ?? 0)) throw Error('Registry RPC read failed');
        const s = registered(id); return encodedResult(obsInterface, 'subject', [[s.kind,s.enabled ?? true,s.target,s.account ?? Ethers.ZeroAddress,Ethers.keccak256('0x6004'),s.target,Ethers.ZeroAddress,s.sequence ?? env.sequence,0]]);
      },
      async features(id) { return frame(id); }, snapshot: { staticCall: async () => [0, env.sequence + 1n] },
    },
    reports: { interface: reportInterface, getFunction: estimateFunction,
      async observations() { return env.reportObservations ?? OBS; }, async classifier() { return env.reportClassifier ?? MODEL; },
      async observationsCodeHash() { return env.reportObsHash ?? deployment.observations.codeHash; },
      async classifierCodeHash() { return env.reportClassifierHash ?? deployment.classifier.codeHash; },
      async modelId() { return env.reportModelId ?? MODEL_ID; }, async trainingManifestHash() { return env.reportManifest ?? MANIFEST; },
      async chainId() { return env.reportChain ?? 4663n; }, async latestReport(id) { return env.withReport ? BigInt(id) : 0n; },
      async report(id) {
        const f = frame(BigInt(id)), current = f.current, previous = f.previous;
        return encodedResult(reportInterface, 'report', [[BigInt(id),current.sequence,previous.sequence,100,100,current.timestamp,
          f.currentHash,f.previousHash,txHash(999),MODEL_ID,1,[...f.vector],[1,2,3,4,5,6],
          [...current.getValue('values')],[...previous.getValue('values')],f.flags,current.timestamp,previous.timestamp,f.elapsedSeconds]]);
      },
      async render(id) { return env.reportText ?? `Confirmed contract report for registered subject ${id}.`; },
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
    assert.equal(BigInt(journal.gasPriceWei), BigInt(request.gasPrice), 'submission price is durable before the wallet prompt');
    assert.ok(BigInt(journal.feeCeilingWei) >= BigInt(request.gasPrice));
    const hash = txHash(env.sends.length + 1); env.sends.push(request);
    env.transactions.set(hash, { ...request, hash, from: OWNER, nonce: Number(request.nonce), chainId: Number(request.chainId),
      value: BigInt(request.value), gasPrice: BigInt(request.gasPrice), gasLimit: BigInt(request.gasLimit ?? request.gas) });
    const log = obsInterface.encodeEventLog(obsInterface.getEvent('SnapshotStored'), [1, ++env.sequence, txHash(500), 1800000000, 101, [1_000_000,0,0,0]]);
    env.receipts.set(hash, { hash, status: 1, blockNumber: 101, blockHash: BLOCK, gasPrice: BigInt(request.gasPrice), gasUsed: 100_000n, logs: [{ address: OBS, ...log }] });
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
    await primary.mounted.ready; await primary.mounted.analyze(TARGET); await primary.mounted.connect();
    primary.get('action').value = 'snapshot'; await primary.get('action').fire('change'); await primary.mounted.estimate();
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
  const f = fixture(); t.after(() => f.mounted.destroy()); await f.mounted.ready; await f.mounted.analyze(TARGET);
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
  const f = fixture({ gasPrice: 1_000_000_003n }); t.after(() => f.mounted.destroy()); const q = await f.quoted();
  assert.equal(q.expiresAt - f.env.now, 45000); assert.equal(q.gasLimit, 600_000n); assert.equal(q.feeCeilingWei, 1_500_000_005n);
  const submissionPrice = (f.env.gasPrice * 11n + 9n) / 10n;
  assert.equal(q.submissionGasPriceWei, submissionPrice);
  assert.equal(q.estimatedWei, q.gasEstimate * submissionPrice, 'visible estimate includes 10 percent submission headroom rounded up');
  assert.equal(f.get('fee').textContent, `${formatIntelETH(q.estimatedWei)} ETH`);
  assert.equal(f.get('submission-price').textContent, `${Number(submissionPrice) / 1e9} gwei`);
  assert.equal(q.reserveWei, q.gasLimit * q.feeCeilingWei);
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
  assert.equal(sent.gasPrice, 1_100_000_000n, 'wallet submission uses 10 percent headroom over the live minimum');
  assert.deepEqual([...obsInterface.parseTransaction({ data: sent.data }).args], [1n]);
  assert.equal(f.env.saved.has(journalKey), false); assert.match(f.get('receipt-count').textContent, /1 confirmed/);
});

test('report and registration actions encode only reviewed identifiers or the source bytecode commitment', async () => {
  for (const action of ['analyze','captureAndAnalyze','register']) {
    const f = fixture({ waitError: true }); await f.mounted.ready; await f.mounted.analyze(TARGET); await f.mounted.connect();
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
  for (const livePrice of [1_000_500_000n, 1_490_000_000n]) {
    const f = fixture({ waitError: true }), q = await f.quoted(); await f.consent(); f.env.gasPrice = livePrice;
    await f.mounted.send(); assert.equal(f.env.sends.length, 1, f.get('notice').textContent);
    const proposed = (livePrice * 11n + 9n) / 10n, expected = proposed < q.feeCeilingWei ? proposed : q.feeCeilingWei;
    assert.equal(f.env.sends[0].gasPrice, expected); assert.ok(expected > livePrice);
    assert.ok(f.env.sends[0].gasLimit * expected <= q.reserveWei, 'submission headroom never exceeds the reviewed reserve');
    f.mounted.destroy();
  }
});

test('unreadable or corrupted existing recovery journals never become permission for a new transaction', async () => {
  for (const setup of [f => { f.env.saved.set(journalKey, '{corrupted'); }, f => { f.env.storageReadFails = true; }]) {
    const f = fixture(); await f.mounted.ready; await f.mounted.analyze(TARGET); setup(f); await f.mounted.connect();
    f.env.storageReadFails = false;
    await f.mounted.estimate(); await f.consent(); await f.mounted.send();
    assert.equal(f.env.sends.length, 0); f.mounted.destroy();
  }
});

const lookupSubjects = () => [
  { kind: 1, target: TARGET, account: Ethers.ZeroAddress, label: 'Tracked token' },
  { kind: 2, target: TARGET, account: OTHER, label: 'Watched balance' },
  { kind: 3, target: POOL, account: Ethers.ZeroAddress, label: 'Tracked pool' },
];

test('address lookup offers all matching token monitors and choices select the registered identity', async t => {
  const f = fixture({ subjects: lookupSubjects() }); t.after(() => f.mounted.destroy()); await f.mounted.ready;
  assert.equal(f.get('action').value, 'captureAndAnalyze', 'browser default updates the report in one reviewed transaction');
  await f.mounted.analyze(TARGET);
  assert.equal(f.mounted.state.current.id, 1n); assert.equal(f.get('matches').hidden, false);
  assert.equal(f.get('matches').children.length, 2);
  await f.get('matches').children[1].fire('click');
  assert.equal(f.mounted.state.current.id, 2n); assert.equal(f.mounted.state.current.subject.account, OTHER);
  assert.equal(f.get('subject-id').value, '2'); assert.equal(f.get('matches').children[1].dataset.selected, 'true');
  assert.equal(f.env.calls.some(call => call.startsWith('wallet:') || call.startsWith('estimate:')), false);
  assert.equal(f.env.sends.length, 0);
});

test('lookup matches a watched account or registered pool without confusing their source addresses', async t => {
  const f = fixture({ subjects: lookupSubjects() }); t.after(() => f.mounted.destroy()); await f.mounted.ready;
  await f.mounted.analyze(OTHER);
  assert.equal(f.mounted.state.current.id, 2n); assert.equal(f.mounted.state.current.subject.target, TARGET);
  assert.equal(f.get('address').value, OTHER); assert.match(f.get('result-type').textContent, /balance/i);
  assert.equal(f.get('matches').hidden, true);
  await f.mounted.analyze(POOL);
  assert.equal(f.mounted.state.current.id, 3n); assert.equal(f.mounted.state.current.subject.target, POOL);
  assert.match(f.get('result-type').textContent, /pool/i);
  assert.deepEqual([...f.mounted.state.current.snapshot.values].slice(0, 3), [1000n,2000n,10000n]);
  assert.equal(f.env.calls.some(call => call.startsWith('wallet:')), false); assert.equal(f.env.sends.length, 0);
});

test('invalid or unregistered addresses clear old evidence, selected identity, consent and paid quotes', async () => {
  for (const query of ['not-an-address', Ethers.ZeroAddress, MODEL]) {
    const f = fixture({ withReport: true, sequence: 2n }); await f.quoted(); await f.consent();
    assert.match(f.get('report').textContent, /Confirmed contract report/);
    const walletCalls = f.env.calls.filter(call => call.startsWith('wallet:')).length;
    await f.mounted.analyze(query);
    assert.equal(f.mounted.state.current, null); assert.equal(f.mounted.state.quote, null);
    assert.equal(f.get('subject-id').value, ''); assert.equal(f.get('consent').checked, false);
    assert.equal(f.get('result').hidden, true); assert.equal(f.get('estimate').disabled, true);
    assert.doesNotMatch(f.get('report').textContent, /Confirmed contract report/);
    assert.equal(f.get('report-details').children.length, 0); assert.equal(f.get('summary').children.length, 0);
    assert.equal(f.env.calls.filter(call => call.startsWith('wallet:')).length, walletCalls);
    const estimates = f.env.calls.filter(call => call.startsWith('estimate:')).length;
    await f.mounted.estimate(); await f.mounted.send();
    assert.equal(f.env.calls.filter(call => call.startsWith('estimate:')).length, estimates);
    assert.equal(f.env.sends.length, 0); f.mounted.destroy();
  }
});

test('partial registry read failures and oversized counts fail closed without keeping a partial match', async () => {
  for (const corrupt of [f => { f.env.subjects = lookupSubjects(); f.env.failSubjectAt = 2; }, f => { f.env.subjectCount = 257n; }]) {
    const f = fixture({ withReport: true, sequence: 2n }); await f.quoted(); corrupt(f);
    const walletCalls = f.env.calls.filter(call => call.startsWith('wallet:')).length;
    await f.mounted.analyze(TARGET);
    assert.equal(f.mounted.state.current, null); assert.equal(f.mounted.state.quote, null);
    assert.equal(f.get('subject-id').value, ''); assert.equal(f.get('matches').children.length, 0);
    assert.equal(f.get('result').hidden, true); assert.equal(f.get('estimate').disabled, true);
    assert.match(f.get('notice').textContent, /failed|supported|range|verified/i);
    assert.equal(f.env.calls.filter(call => call.startsWith('wallet:')).length, walletCalls);
    assert.equal(f.env.sends.length, 0); f.mounted.destroy();
  }
});

test('freshness badges reflect stored observation age at the RPC head rather than lookup or browser time', async t => {
  const subjects = [{ kind: 1, target: TARGET, sequence: 2n, timestamp: 1799999940 }];
  const f = fixture({ subjects, withReport: true, now: 2_000_000_000_000 }); t.after(() => f.mounted.destroy());
  await f.mounted.ready; await f.mounted.analyze(TARGET);
  assert.equal(f.mounted.state.current.report.observedAt, 1799999940n);
  assert.equal(f.get('freshness').dataset.stale, 'false'); assert.match(f.get('freshness').textContent, /^Observed /);
  subjects[0].timestamp = 1799999400;
  await f.mounted.analyze(TARGET);
  assert.equal(f.mounted.state.current.report.observedAt, 1799999400n);
  assert.equal(f.get('freshness').dataset.stale, 'true'); assert.match(f.get('freshness').textContent, /saved|refresh/i);
  assert.equal(f.env.calls.some(call => call.startsWith('wallet:')), false); assert.equal(f.env.sends.length, 0);
});

test('address form and tracked examples perform only public reads and never register or request funds', async t => {
  const f = fixture({ subjects: lookupSubjects() }); t.after(() => f.mounted.destroy()); await f.mounted.ready;
  f.get('address').value = TARGET; await f.get('search').fire('click');
  assert.equal(f.mounted.state.current.id, 1n);
  const walletExample = f.get('examples').children.find(button => /wallet/i.test(button.textContent));
  assert.ok(walletExample); await walletExample.fire('click');
  assert.equal(f.mounted.state.current.id, 2n); assert.equal(f.get('address').value, OTHER);
  assert.equal(f.env.calls.some(call => call.startsWith('wallet:') || call.startsWith('estimate:')), false);
  assert.equal(f.env.saved.size, 0); assert.equal(f.env.sends.length, 0);
});
