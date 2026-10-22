import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as ethers from '../website/mint/vendor/ethers.js';
import { CALIBRATION } from '../website/s0ul-gas.mjs';
import { createS0ULClient, S0UL_DEPLOYMENT as D, S0UL_ABIS, parseExpectedAction, decodeOutputIds } from '../website/s0ul-client.mjs';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const ZERO_HASH = '0x' + '00'.repeat(32);
const BLOCK_HASH = '0x' + 'ab'.repeat(32);
const iface = new ethers.Interface(S0UL_ABIS.controller);
const hashOf = n => '0x' + BigInt(n).toString(16).padStart(64, '0');

function fixture(overrides = {}) {
  const env = {
    account: OWNER, chain: 4663, now: 1_800_000_000_000, gasPrice: 1_000_000_000n,
    balance: 100n * 10n ** 18n, nonce: 0, calls: [], sends: [], estimates: [],
    transactions: new Map(), receipts: new Map(), storageData: new Map(),
    output: [], actualText: 'WAIT', request: null, progress: null, decodedResultText: null,
    ...overrides,
  };
  const cfg = { ...CALIBRATION.configuration, epsQ28: 1, attentionScaleQ14: 1 };
  const storage = {
    getItem: key => env.storageData.get(key) ?? null,
    setItem: (key, value) => { if (env.storageFails) throw Error('Storage disabled'); env.storageData.set(key, value); },
  };
  const promptIds = prompt => prompt === 'theme=dark' ? [1, 279, 419, 365, 3] : [1, 316, 50, 3];
  const hashPrompt = ids => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint16[]'], [ids]));
  function seedRequest({ expected = 'WAIT', prompt = 'Wait.', maxNewTokens = 2, owner = OWNER,
    engineOwner = D.controller, done = false, outcome = 1, actual = 'WAIT', generated = 2 } = {}) {
    const action = parseExpectedAction(expected);
    env.actualText = actual;
    env.originalPrompt = prompt;
    env.request = { owner, allowedActions: action.mask, stateRevision: 0n, adopted: false,
      outcome, action: action.kind, reason: outcome === 3 ? 11 : 0, promptHash: hashPrompt(promptIds(prompt)),
      outputHash: ZERO_HASH, expectedActionHash: action.expectedActionHash };
    env.progress = { owner: engineOwner, phase: done ? 17 : 1, position: done ? promptIds(prompt).length + generated - 2 : 0,
      layer: done ? 3 : 0, row: 0, head: 0, promptLength: promptIds(prompt).length,
      maxNewTokens, generated: done ? generated : 0, saturationCount: 0n, done, cancelled: false, logitsReady: done };
    env.output = done ? [actual === 'WAIT' ? 268 : 5, 2] : [];
  }
  function step() {
    const s = env.progress;
    switch (s.phase) {
      case 1: s.layer = 0; s.row = 0; s.head = 0; s.phase = 2; break;
      case 2: s.phase = 3; break;
      case 3: s.phase = 4; break;
      case 4: s.phase = 5; break;
      case 5: s.phase = 6; break;
      case 6: s.phase = 7; break;
      case 7: s.head = 0; s.phase = 8; break;
      case 8: if (++s.head === 4) { s.head = 0; s.phase = 9; } break;
      case 9: s.phase = 10; break;
      case 10: s.phase = 11; break;
      case 11: s.row += 128; if (s.row === 640) { s.row = 0; s.phase = 12; } break;
      case 12: s.phase = 13; break;
      case 13:
        if (++s.layer < 4) s.phase = 2;
        else { s.layer = 3; if (s.position + 1 < s.promptLength) { ++s.position; s.layer = 0; s.phase = 1; }
          else s.phase = 14; }
        break;
      case 14: s.phase = 15; break;
      case 15: s.row += 128; if (s.row === 512) { s.row = 0; s.phase = 16; s.logitsReady = true; } break;
      case 16:
        ++s.generated; env.output.push(s.generated === s.maxNewTokens ? 2 : 268);
        if (s.generated === s.maxNewTokens) { s.done = true; s.phase = 17; }
        else { ++s.position; s.layer = 0; s.phase = 1; s.logitsReady = false; }
        break;
      default: throw Error('Invalid mock engine stage');
    }
  }
  const listeners = new Map();
  const ethereum = {
    on: (name, fn) => listeners.set(name, fn),
    removeListener: name => listeners.delete(name),
    emit: name => listeners.get(name)?.(),
    async request({ method, params }) {
      env.calls.push(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [env.account];
      if (method === 'eth_chainId') return ethers.toQuantity(env.chain);
      if (method === 'wallet_switchEthereumChain') { if (!env.refuseSwitch) env.chain = Number(BigInt(params[0].chainId)); return null; }
      if (method !== 'eth_sendTransaction') throw Error('Unexpected wallet method ' + method);
      const sent = structuredClone(params[0]); env.sends.push(sent);
      const parsed = iface.parseTransaction({ data: sent.data });
      const hash = hashOf(env.sends.length), transaction = { ...sent, hash, chainId: env.chain,
        nonce: Number(BigInt(sent.nonce)), value: BigInt(sent.value), gasLimit: BigInt(sent.gas), gasPrice: BigInt(sent.gasPrice) };
      env.transactions.set(hash, transaction);
      const logs = [];
      if (parsed.name === 'beginConstrained') {
        seedRequest({ prompt: parsed.args[0], maxNewTokens: Number(parsed.args[1]), expected: env.quotedExpected ?? 'WAIT' });
        env.request.allowedActions = Number(parsed.args[2]); env.request.expectedActionHash = parsed.args[3];
        const log = iface.encodeEventLog(iface.getEvent('Bound'), [1n, OWNER, D.modelId, env.request.allowedActions, env.request.promptHash, false]);
        logs.push({ address: D.controller, ...log });
      } else if (parsed.name === 'advanceBatch') {
        if (env.finishOnAdvance) {
          env.actualText = env.finishOnAdvance;
          env.progress = { ...env.progress, phase: 17, done: true, generated: 2, position: env.progress.promptLength, layer: 3 };
          env.output = [env.actualText === 'WAIT' ? 268 : 5, 2];
        } else for (let i = 0; i < Number(parsed.args[2]) && !env.progress.done; ++i) {
          if (i > 0 && env.progress.phase === 16) break;
          step();
        }
      } else if (parsed.name === 'finalize') {
        env.request.outcome = env.actualText === (env.quotedExpected ?? 'WAIT') ? 2 : 3;
        env.request.reason = env.request.outcome === 3 ? 11 : 0;
      } else if (parsed.name === 'cancel') { env.request.outcome = 4; env.progress.cancelled = true; env.progress.phase = 18; }
      env.receipts.set(hash, { hash, status: env.revert ? 0 : 1, blockHash: BLOCK_HASH,
        blockNumber: 100 + env.sends.length, gasUsed: 100_000n, gasPrice: env.gasPrice, logs });
      ++env.nonce;
      if (env.sendFailure) throw Object.assign(Error('Wallet transport lost after submission'), { code: env.sendFailure });
      return hash;
    },
  };
  const provider = {
    async getBlock() { return { number: 100, hash: env.noncanonical ? hashOf(999) : BLOCK_HASH, gasLimit: 32_000_000n }; },
    async getFeeData() { return { gasPrice: env.gasPrice }; },
    async getBalance() { return env.balance; },
    async getTransactionCount() { await env.onNonce?.(); return env.nonce; },
    async getTransactionReceipt(hash) { return env.hideReceipts ? null : env.receipts.get(hash) ?? null; },
    async getTransaction(hash) { return env.transactions.get(hash) ?? null; },
  };
  const contracts = {
    controller: {
      interface: iface,
      getFunction(method) { return { estimateGas: async (...args) => {
        env.estimates.push({ method, args }); await env.onEstimate?.(method, args);
        if (method === 'advanceBatch' && env.maxBatch && Number(args[2]) > env.maxBatch) return 30_000_000n;
        return env.estimateGas ?? 500_000n;
      } }; },
      async requests() { if (!env.request) throw Error('Unknown request'); return { ...env.request }; },
      async resultOf() { return { output: ethers.hexlify(ethers.toUtf8Bytes(env.decodedResultText ?? env.actualText)), result: '0x' }; },
      async memoryOf() { return '0x'; }, async tasksOf() { return []; },
    },
    engine: {
      async configuration() { return { ...cfg, ...env.engineConfiguration }; },
      async status() { if (!env.progress) throw Error('Unknown request'); return { ...env.progress }; },
      async outputTokens() { return [...env.output]; },
      async tokens() { return [...promptIds(env.originalPrompt ?? 'Wait.'), ...env.output]; },
      async logits() { return Array.from({ length: 512 }, (_, i) => i); },
    },
    model: { async configuration() { return { ...cfg }; } },
    tokenizer: {
      async encode(text) { if (env.encodedPrompt) return env.encodedPrompt;
        if (text === 'Wait.') return [316, 50];
        if (text === 'theme=dark') return [279, 419, 365];
        if (text === 'MEM_SET|theme|dark') return [261, 279, 420, 365];
        return [268]; },
      async decode(ids) { return ethers.hexlify(ethers.toUtf8Bytes(ids.length ?
        (ids[0] === 316 ? 'Wait.' : ids[0] === 279 ? 'theme=dark' : env.actualText) : '')); },
    },
  };
  const dependencies = { provider, contracts, now: () => env.now,
    verifyDeployment: async () => { ++env.verifications; if (env.invalidDeployment) throw Error('Pinned runtime mismatch'); },
    waitForReceipt: async hash => {
      const saved = [...env.storageData.values()].join('');
      assert.ok(saved.includes(hash), 'returned hash must be durable before receipt polling');
      await env.onReceipt?.(hash);
      if (env.receiptFailure) throw Error('RPC unavailable while waiting; reconcile exact hash');
      return env.receipts.get(hash);
    },
  };
  env.verifications = 0;
  const makeClient = () => createS0ULClient({ ethereum, storage, dependencies, onUpdate: update => env.onUpdate?.(update) });
  const client = makeClient();
  async function quote(input = {}) {
    env.quotedExpected = input.expectedAction ?? 'WAIT';
    return client.quote({ prompt: 'Wait.', maxNewTokens: 2, expectedAction: env.quotedExpected, kind: 0, ...input });
  }
  async function started(input = {}) {
    await client.connect(); const q = await quote(input); await client.start(q, { budgetWei: q.budgetFeeWei }); return q;
  }
  return { env, client, ethereum, provider, contracts, storage, dependencies, makeClient, seedRequest, quote, started };
}

test('action commitments implement the complete deployed canonical grammar', () => {
  const valid = ['WAIT','BALANCE|SELF|ETH','BALANCE|SELF|GH0ST','MEM_SET|theme|dark',
    'MEM_GET|language','TASK_ADD|audit','TASK_LIST|SELF','TASK_DONE|9999','CLARIFY|task_id','REFUSE|unsafe'];
  for (const [kind, text] of valid.entries()) {
    const action = parseExpectedAction(text, kind);
    assert.equal(action.kind, kind); assert.equal(action.mask, 1 << kind);
    assert.equal(action.expectedActionHash, ethers.keccak256(ethers.toUtf8Bytes(text)));
  }
  for (const text of [' WAIT','WAIT\n','wait','BALANCE|OTHER|ETH','BALANCE|SELF|BTC',
    'MEM_SET|other|dark','MEM_SET|theme|Dark','TASK_ADD|a'.repeat(25),'TASK_ADD|has space',
    'TASK_ADD|é','TASK_DONE|01','TASK_DONE|0','TASK_DONE|10000','CLARIFY|other','REFUSE|other'])
    assert.throws(() => parseExpectedAction(text), text);
  assert.throws(() => parseExpectedAction('WAIT', 3));
});

test('decoder enforces actual token count, vocabulary, canonical content and terminal EOS', () => {
  assert.deepEqual(decodeOutputIds([268, 2], { done: true, generated: 2 }).content, [268]);
  assert.deepEqual(decodeOutputIds([], { done: false, generated: 0 }).content, []);
  for (const [ids, status] of [
    [[268], { done: true }], [[2], { done: true }], [[268, 2, 2], { done: true }],
    [[1, 2], { done: true }], [[421, 2], { done: true }], [[512], {}],
    [[-1], {}], [[268, 2], { done: true, generated: 3 }], [[2], { done: false }],
  ]) assert.throws(() => decodeOutputIds(ids, status));
});

test('connect, quotes and reads never request a paid transaction; explicit Start pins calldata', async () => {
  const f = fixture(); await f.client.connect(); const q = await f.quote();
  await f.client.readMemory('theme'); await f.client.readTasks();
  assert.equal(f.env.sends.length, 0); assert.equal(f.env.calls.includes('eth_sendTransaction'), false);
  await f.client.start(q, { budgetWei: q.budgetFeeWei });
  assert.equal(f.env.sends.length, 1);
  const sent = f.env.sends[0], parsed = iface.parseTransaction({ data: sent.data });
  assert.equal(sent.to, D.controller); assert.equal(sent.from, OWNER); assert.equal(BigInt(sent.value), 0n);
  assert.equal(BigInt(sent.chainId), 4663n);
  assert.equal(parsed.name, 'beginConstrained');
  assert.deepEqual([...parsed.args], ['Wait.', 2n, 1n, ethers.keccak256(ethers.toUtf8Bytes('WAIT'))]);
  assert.equal(BigInt(sent.gas), 600_000n); assert.equal(BigInt(sent.gasPrice), f.env.gasPrice);
  assert.equal(f.client.state.requestId, '1'); assert.equal(f.client.state.receipts.length, 1);
  assert.equal(f.client.state.spentWei, 100_000n * f.env.gasPrice);
});

test('private quote snapshot rejects altered identity, intent, mask and budget fields', async () => {
  for (const change of [
    { owner: OTHER }, { chainId: 1 }, { controller: OTHER }, { modelId: ZERO_HASH },
    { prompt: 'Something else' }, { maxNewTokens: 3 }, { expectedAction: 'TASK_ADD|audit' },
    { expectedActionHash: ZERO_HASH }, { kind: 5 }, { mask: 32 }, { requestId: '2' },
    { budgetFeeWei: 1n }, { feeCeilingWeiPerGas: 1n },
  ]) {
    const f = fixture(); await f.client.connect(); const q = await f.quote();
    await assert.rejects(f.client.start({ ...q, ...change }, { budgetWei: q.budgetFeeWei }), /modified|fresh quote/);
    assert.equal(f.env.sends.length, 0);
  }
});

test('expired or invalidated quotes and insufficient caps/balance stop before a wallet send', async () => {
  const f = fixture(); await f.client.connect(); let q = await f.quote();
  f.env.now = q.expiresAt;
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /expired/);
  q = await f.quote(); f.client.invalidateQuote();
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /new gas quote/);
  q = await f.quote();
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei - 1n }), /must cover/);
  f.env.balance = q.budgetFeeWei - 1n;
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /balance/);
  assert.equal(f.env.sends.length, 0);
});

test('wrong chain/account, deployment mismatch and changes during nonce lookup stop before sending', async () => {
  for (const mutate of [
    f => { f.env.account = OTHER; },
    f => { f.env.chain = 1; },
    f => { f.env.invalidDeployment = true; },
    f => { f.env.onNonce = () => { f.env.chain = 1; f.ethereum.emit('chainChanged'); }; },
  ]) {
    const f = fixture(); await f.client.connect(); const q = await f.quote(); mutate(f);
    await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }));
    assert.equal(f.env.sends.length, 0);
  }
});

test('context, token budget and model configuration validation happen before Start', async () => {
  for (const setup of [
    f => { f.env.encodedPrompt = Array(127).fill(5); },
    f => { f.env.engineConfiguration = { dim: 64 }; },
  ]) {
    const f = fixture(); await f.client.connect(); setup(f);
    await assert.rejects(f.quote()); assert.equal(f.env.sends.length, 0);
  }
  const f = fixture(); await f.client.connect();
  await assert.rejects(f.quote({ prompt: '', maxNewTokens: 1 }));
  await assert.rejects(f.quote({ expectedAction: 'MEM_SET|theme|dark', kind: 3, maxNewTokens: 2 }), /too small/);
  assert.equal(f.env.sends.length, 0);
});

test('adaptive batching estimates four through one without sending failed candidates', async () => {
  const f = fixture({ maxBatch: 1 }); await f.started();
  await f.client.advance();
  const estimates = f.env.estimates.filter(e => e.method === 'advanceBatch').map(e => Number(e.args[2]));
  assert.deepEqual(estimates, [4, 3, 2, 1]);
  assert.equal(f.env.sends.length, 2);
  const parsed = iface.parseTransaction({ data: f.env.sends[1].data });
  assert.deepEqual([...parsed.args], [1n, 128n, 1n]);
  assert.equal(f.client.state.progress.phase, 2);
});

test('live fee ceiling and spending cap are rechecked before every next transaction', async () => {
  const f = fixture(); await f.started();
  f.env.gasPrice = f.client.state.quote.feeCeilingWeiPerGas + 1n;
  await assert.rejects(f.client.advance(), /fee ceiling/);
  assert.equal(f.env.sends.length, 1);
  f.env.gasPrice = 1_000_000_000n;
  // An accepted lower cap can never authorize another tx whose reserve exceeds it.
  await assert.rejects(f.client.run({ budgetWei: f.client.state.spentWei }), /spending cap/);
  await assert.rejects(f.client.advance(), /spending cap|fresh quote|approve/i);
  assert.equal(f.env.sends.length, 1);
});

test('RPC receipt failure keeps its saved hash and never automatically resends', async () => {
  const f = fixture({ receiptFailure: true }); await f.client.connect(); const q = await f.quote();
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /RPC unavailable/);
  assert.equal(f.client.state.pending.hash, hashOf(1));
  assert.ok([...f.env.storageData.values()].join('').includes(hashOf(1)));
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /Reconcile/);
  assert.equal(f.env.sends.length, 1);
  f.env.receiptFailure = false;
  await f.client.reconcile(hashOf(1));
  assert.equal(f.client.state.pending, null); assert.equal(f.client.state.requestId, '1');
  assert.equal(f.env.sends.length, 1);
});

test('ambiguous wallet error blocks all new sends and requires exact matching transaction reconciliation', async () => {
  const f = fixture({ sendFailure: -32603 }); await f.client.connect(); const q = await f.quote();
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /transport lost/);
  assert.equal(f.client.state.ambiguous, true); assert.equal(f.client.state.pending.hash, null);
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /Reconcile/);
  assert.equal(f.env.sends.length, 1);
  const recovered = f.makeClient(); await recovered.connect();
  assert.equal(recovered.state.ambiguous, true);
  await recovered.reconcile(hashOf(1));
  assert.equal(recovered.state.ambiguous, false); assert.equal(recovered.state.requestId, '1');
  assert.equal(f.env.sends.length, 1);
});

test('reconciliation rejects wrong sender, calldata, chain, value, nonce and canonical block', async () => {
  for (const mutate of [
    tx => { tx.from = OTHER; }, tx => { tx.to = OTHER; }, tx => { tx.data = '0x1234'; },
    tx => { tx.chainId = 1; }, tx => { tx.value = 1n; }, tx => { tx.nonce += 1; },
  ]) {
    const f = fixture({ receiptFailure: true }); await f.client.connect(); const q = await f.quote();
    await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }));
    f.env.receiptFailure = false; mutate(f.env.transactions.get(hashOf(1)));
    await assert.rejects(f.client.reconcile(hashOf(1)), /does not match/);
    assert.notEqual(f.client.state.pending, null); assert.equal(f.env.sends.length, 1);
  }
  const f = fixture({ receiptFailure: true }); await f.client.connect(); const q = await f.quote();
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }));
  f.env.receiptFailure = false; f.env.noncanonical = true;
  await assert.rejects(f.client.reconcile(hashOf(1)), /canonical/);
  assert.notEqual(f.client.state.pending, null);
});

test('resume verifies request and engine owners and rereads receipt gas', async () => {
  const f = fixture(); await f.started();
  const resumed = f.makeClient(); await resumed.connect(); await resumed.loadRequest('1');
  assert.equal(resumed.state.spentWei, 100_000n * f.env.gasPrice);
  await assert.rejects(resumed.advance(), /Approve a fresh quote/);
  assert.equal(f.env.sends.length, 1);
  f.env.request.owner = OTHER;
  await assert.rejects(resumed.loadRequest('1'), /another wallet/);
  f.env.request.owner = OWNER; f.env.progress.owner = OTHER;
  await assert.rejects(resumed.loadRequest('1'), /owner does not match/);
});

test('missing/reorganized saved receipts prohibit resuming an approved budget', async () => {
  const f = fixture(); await f.started(); const resumed = f.makeClient(); await resumed.connect();
  f.env.hideReceipts = true;
  await assert.rejects(resumed.loadRequest('1'), /receipt is no longer available/);
  f.env.hideReceipts = false; f.env.receipts.get(hashOf(1)).blockHash = hashOf(9);
  await assert.rejects(resumed.loadRequest('1'), /reorganized/);
  assert.equal(f.env.sends.length, 1);
});

test('actual output mismatch is displayed and pauses run without finalizing or claiming expected output', async () => {
  const f = fixture({ finishOnAdvance: 'TASK_ADD|ee' }); const q = await f.started();
  await f.client.run({ budgetWei: q.budgetFeeWei });
  assert.equal(f.client.state.actualAction, 'TASK_ADD|ee');
  assert.notEqual(f.client.state.actualAction, 'WAIT');
  assert.equal(f.client.state.status, 'paused'); assert.equal(f.client.state.request.outcome, 1);
  assert.equal(f.client.state.result, null); assert.match(f.client.state.lastError, /differs/);
  assert.equal(f.env.sends.length, 2);
  assert.equal(f.env.sends.some(tx => iface.parseTransaction({ data: tx.data }).name === 'finalize'), false);
  await f.client.finalize();
  assert.equal(f.client.state.request.outcome, 3); assert.equal(f.client.state.result.reasonName, 'ActionMismatch');
  assert.equal(f.client.state.result.output, 'TASK_ADD|ee');
});

test('stored execution output cannot silently substitute an expected action for actual generation', async () => {
  const f = fixture(); f.seedRequest({ expected: 'WAIT', done: true, outcome: 2, actual: 'TASK_ADD|ee' });
  f.env.decodedResultText = 'WAIT'; await f.client.connect();
  await assert.rejects(f.client.loadRequest('1'), /differs from actual/);
  assert.equal(f.env.sends.length, 0);
});

test('Pause while a submitted batch settles prevents further wallet requests', async () => {
  const f = fixture(); const q = await f.started();
  f.env.onReceipt = () => f.client.pause();
  await f.client.run({ budgetWei: q.budgetFeeWei });
  assert.equal(f.env.sends.length, 2); assert.equal(f.client.state.status, 'paused');
  assert.equal(f.client.state.pending, null); assert.equal(f.client.state.receipts.length, 2);
});

test('storage failure prevents the wallet request and unsafe numeric budget values are rejected', async () => {
  const f = fixture(); await f.client.connect(); const q = await f.quote(); f.env.storageFails = true;
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /storage is unavailable/);
  assert.equal(f.env.sends.length, 0);
  const g = fixture({ gasPrice: 1n }); await g.client.connect(); const r = await g.quote();
  await assert.rejects(g.client.start(r, { budgetWei: Number.MAX_SAFE_INTEGER + 1 }), /safe integer|integer/);
  assert.equal(g.env.sends.length, 0);
});

test('production deployment pins match recorded mainnet deployment evidence', async () => {
  const base = JSON.parse(await readFile(new URL('../s0ul-1m/deployments/robinhood-mainnet.json', import.meta.url), 'utf8'));
  const agent = JSON.parse(await readFile(new URL('../s0ul-1m/deployments/robinhood-mainnet-agent.json', import.meta.url), 'utf8'));
  assert.equal(D.chainId, Number(base.chainId));
  assert.equal(D.controller, agent.controller); assert.equal(D.controllerCodeHash, agent.controllerCodeHash);
  assert.equal(D.gh0stToken, agent.gh0stToken); assert.equal(D.gh0stCodeHash, agent.gh0stCodeHash);
  for (const key of ['model', 'engine', 'tokenizer']) {
    assert.equal(D[key], base[key]);
    assert.equal(D[key + 'CodeHash'], base.transactions.find(tx => tx.key === key).runtimeCodeHash);
  }
  assert.equal(D.modelId, base.modelId); assert.equal(D.sourceCheckpoint, base.sourceCheckpoint);
  assert.equal(Object.isFrozen(D), true);
});

test('default production verification rejects missing or wrong runtime bytecode before any signing', async () => {
  for (const code of ['0x', '0x00']) {
    const f = fixture(); f.provider.getCode = async () => code;
    const { verifyDeployment, ...dependencies } = f.dependencies;
    const client = createS0ULClient({ ethereum: f.ethereum, storage: f.storage, dependencies });
    await assert.rejects(client.connect(), /runtime does not match deployment/);
    assert.equal(f.env.sends.length, 0);
  }
});

test('external owned request resumes only after a fresh matching quote and explicit budget approval', async () => {
  const f = fixture({ finishOnAdvance: 'WAIT' }); f.seedRequest();
  await f.client.connect(); await f.client.loadRequest('1');
  assert.equal(f.client.state.authorizationActive, false);
  await assert.rejects(f.client.advance(), /Approve a fresh quote/);
  await assert.rejects(f.quote({ requestId: '1', expectedAction: 'TASK_ADD|audit', kind: 5 }), /immutable request commitment/);
  const q = await f.quote({ requestId: '1' });
  assert.equal(q.requestId, '1'); assert.equal(q.prompt, 'Wait.');
  assert.equal(f.env.sends.length, 0);
  await f.client.approve(q, { budgetWei: q.budgetFeeWei });
  assert.equal(f.client.state.authorizationActive, true);
  assert.equal(f.env.sends.length, 0);
  await f.client.run();
  assert.equal(f.client.state.actualAction, 'WAIT');
  assert.equal(f.client.state.request.outcome, 2);
  assert.equal(f.client.state.result.message, 'WAIT');
  assert.equal(f.env.sends.length, 2);
});

test('an unrelated candidate hash cannot lock an ambiguous journal away from its real transaction', async () => {
  const f = fixture({ sendFailure: -32603 }); await f.client.connect(); const q = await f.quote();
  await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }));
  f.env.transactions.set(hashOf(99), { ...f.env.transactions.get(hashOf(1)), from: OTHER });
  await assert.rejects(f.client.reconcile(hashOf(99)), /does not match/);
  assert.equal(f.client.state.pending.hash, null);
  await f.client.reconcile(hashOf(1));
  assert.equal(f.client.state.requestId, '1'); assert.equal(f.env.sends.length, 1);
});

test('begin recovery requires exact mask, prompt commitment and nonadopted Bound event', async () => {
  for (const changed of [{ mask: 32 }, { promptHash: ZERO_HASH }, { adopted: true }]) {
    const f = fixture(); await f.client.connect(); const q = await f.quote();
    f.env.onReceipt = hash => {
      const log = iface.encodeEventLog(iface.getEvent('Bound'), [1n, OWNER, D.modelId,
        changed.mask ?? 1, changed.promptHash ?? f.env.request.promptHash, changed.adopted ?? false]);
      f.env.receipts.get(hash).logs = [{ address: D.controller, ...log }];
    };
    await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /matching Bound event/);
    assert.notEqual(f.client.state.pending, null); assert.equal(f.client.state.requestId, null);
    await assert.rejects(f.client.start(q, { budgetWei: q.budgetFeeWei }), /Reconcile/);
    assert.equal(f.env.sends.length, 1);
  }
});

test('each continuation rereads the immutable action commitment before any further wallet request', async () => {
  const f = fixture(); await f.started();
  f.env.request.expectedActionHash = ethers.keccak256(ethers.toUtf8Bytes('TASK_ADD|audit'));
  await assert.rejects(f.client.advance(), /original request intent/);
  assert.equal(f.env.sends.length, 1);
});
