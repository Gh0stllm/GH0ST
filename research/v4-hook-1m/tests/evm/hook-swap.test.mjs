import test from 'node:test';
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import '../../frontend/hook/swap-engine.js';

const E = globalThis.GH0STSwap, C = E.CONSTANTS;
const wallet = '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
const coder = ethers.AbiCoder.defaultAbiCoder();
const interfaces = Object.fromEntries(Object.entries(E.ABI).map(([n, a]) => [n, new ethers.Interface(a)]));
const sqrt = 337195094064817369351858984726692n;
function speech(overrides = {}) {
  const event = interfaces.hook.encodeEventLog(interfaces.hook.getEvent('SentenceSpoken'),
    [C.poolId, 1n, C.modelHash, 'The quiet market carries a bright signal.', 8, true, ethers.id('input'), ethers.id('state')]);
  return { address: C.hook, ...event, blockNumber: 100, index: 1, transactionHash: ethers.id('swap'), ...overrides };
}
function harness(options = {}) {
  const state = { now: 1800000000000, account: wallet, chain: 4663n, initialized: true, liquidity: 10n ** 25n,
    allowance: 0n, permit: 0n, expiration: 0n, eth: 10n ** 20n, ghost: 10n ** 30n, codeMismatch: null,
    sends: [], calls: [], logs: [speech()], receipts: new Map(), txs: new Map(), publicDown: false, pending: false, reject: false };
  const storage = new Map();
  function code(address) { return 'code:' + address; }
  const ifaceFor = target => target === C.token.toLowerCase() ? ['token', interfaces.token] : target === C.permit2.toLowerCase() ? ['permit2', interfaces.permit2]
    : target === C.stateView.toLowerCase() ? ['state', interfaces.state] : target === C.quoter.toLowerCase() ? ['quoter', interfaces.quoter]
    : target === C.router.toLowerCase() ? ['router', interfaces.router] : target === C.hook.toLowerCase() ? ['hook', interfaces.hook] : ['model', interfaces.model];
  const provider = {
    send: async method => method === 'eth_chainId' ? ethers.toQuantity(state.chain) : [state.account],
    getBlock: async () => ({ number: 100, timestamp: Math.floor(state.now / 1000), hash: ethers.id('block') }),
    getBlockNumber: async () => 100,
    getCode: async address => state.codeMismatch === address ? '0x' : code(address),
    getBalance: async () => state.eth,
    getFeeData: async () => ({ maxFeePerGas: 2n }),
    getTransactionReceipt: async hash => state.receipts.get(hash) || null,
    getTransaction: async hash => { if (state.beforeReadTransaction) await state.beforeReadTransaction(hash); return state.txs.get(hash) || null; },
    getLogs: async filter => { state.calls.push({ logs: filter }); return state.logs; },
    call: async request => {
      state.calls.push(request);
      const [name, iface] = ifaceFor(request.to.toLowerCase()), p = iface.parseTransaction(request);
      let result;
      if (p.name === 'poolManager') result = [C.poolManager];
      else if (p.name === 'PERMIT2') result = [C.permit2];
      else if (p.name === 'modelHash') result = [C.modelHash];
      else if (p.name === 'model') result = [C.model];
      else if (p.name === 'decimals') result = [18];
      else if (p.name === 'balanceOf') result = [state.ghost];
      else if (p.name === 'allowance') result = name === 'token' ? [state.allowance] : [state.permit, state.expiration, 0n];
      else if (p.name === 'getSlot0') result = [state.initialized ? sqrt : 0n, 167130, 0, 3000];
      else if (p.name === 'getLiquidity') result = [state.liquidity];
      else if (p.name === 'quoteExactInputSingle') result = [p.args[0].zeroForOne ? 10n ** 18n : 10n ** 15n, 6500000n];
      else throw Error(`Unexpected method ${p.name}`);
      return iface.encodeFunctionResult(p.name, result);
    },
  };
  const readProvider = { ...provider, getBlock: async (...args) => { if (state.publicDown) throw Error('Public RPC unavailable'); return provider.getBlock(...args); } };
  const signer = {
    getAddress: async () => state.account,
    estimateGas: async () => 6500001n,
    sendTransaction: async request => {
      if (state.reject) throw Object.assign(Error('Rejected'), { code: 'ACTION_REJECTED' });
      state.sends.push(request);
      const hash = ethers.id(`sent-${state.sends.length}`);
      const [, iface] = ifaceFor(request.to.toLowerCase()), parsed = iface.parseTransaction(request);
      let logs = [];
      if (parsed.name === 'approve' && request.to.toLowerCase() === C.token.toLowerCase()) state.allowance = parsed.args[1];
      else if (parsed.name === 'approve') { state.permit = parsed.args[2]; state.expiration = parsed.args[3]; }
      else logs = [speech({ transactionHash: hash })];
      state.txs.set(hash, request);
      const receipt = { hash, status: 1, logs };
      if (!state.pending) state.receipts.set(hash, receipt);
      state.lastHash = hash;
      if (state.unknownSubmission) throw Error('RPC disconnected after acceptance');
      return { hash, wait: async () => { if (state.pending) throw Error('Connection interrupted'); return receipt; } };
    },
  };
  const fakeEthers = { ...ethers, keccak256: value => value.startsWith('code:') ? E.PINS[value.slice(5)] : ethers.keccak256(value) };
  const config = { ethers: fakeEthers, readProvider, walletProvider: provider, signer, now: () => state.now,
    storage: { getItem: key => storage.get(key), setItem: (key, val) => storage.set(key, val), removeItem: key => storage.delete(key) },
    withLock: options.withLock || (async (_, work) => work()) };
  const client = E.createClient(config);
  return { client, state, storage, createClient: () => E.createClient(config) };
}

test('exact-input router encoding pins the only pool, requires speech and bounds settlement/output', () => {
  for (const zeroForOne of [true, false]) {
    const tx = E.buildSwap({ account: wallet, zeroForOne, amountIn: 123n, amountOutMinimum: 77n, deadline: 1800000900 }, ethers);
    assert.equal(tx.to, C.router); assert.equal(tx.chainId, 4663); assert.equal(tx.value, zeroForOne ? 123n : 0n);
    const outer = interfaces.router.parseTransaction(tx);
    assert.equal(outer.args.commands, '0x1004');
    const [actions, params] = coder.decode(['bytes', 'bytes[]'], outer.args.inputs[0]);
    assert.equal(actions, '0x060c0f');
    const [p] = coder.decode([`tuple(${E.KEY_TYPE} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`], params[0]);
    assert.equal(p.zeroForOne, zeroForOne); assert.equal(p.hookData, '0x53504b31'); assert.equal(p.amountIn, 123n); assert.equal(p.amountOutMinimum, 77n);
    assert.equal(ethers.keccak256(coder.encode([E.KEY_TYPE], [p.poolKey])), C.poolId);
    assert.deepEqual(Array.from(coder.decode(['address', 'uint256'], params[1])), [ethers.getAddress(zeroForOne ? C.native : C.token), 123n]);
    assert.deepEqual(Array.from(coder.decode(['address', 'uint256'], params[2])), [ethers.getAddress(zeroForOne ? C.token : C.native), 77n]);
    const [asset, recipient, min] = coder.decode(['address', 'address', 'uint256'], outer.args.inputs[1]);
    assert.equal(asset, C.native); assert.equal(recipient, wallet); assert.equal(min, 0n);
  }
});

test('amount parsing and slippage use exact integers and reject unsafe inputs', () => {
  assert.equal(E.parseAmount('0.000000000000000001', ethers), 1n);
  assert.equal(E.minimumOutput(1000000000000000001n, 50), 995000000000000000n);
  for (const bad of ['1e5', '-1', '0', '1.0000000000000000001', 'Infinity', ' 1']) assert.throws(() => E.parseAmount(bad, ethers));
  for (const bad of [0, 501, -1, 1.2]) assert.throws(() => E.minimumOutput(1000n, bad));
});

test('only the pinned hook, pool, and model can supply displayed sentences', () => {
  const valid = E.decodeMessage(speech(), ethers);
  assert.equal(valid.text, 'The quiet market carries a bright signal.'); assert.equal(valid.sequence, '1');
  assert.equal(E.decodeMessage(speech({ address: wallet }), ethers), null);
  assert.equal(E.decodeMessage(speech({ removed: true }), ethers), null);
  const spoof = speech(); spoof.topics = [...spoof.topics]; spoof.topics[1] = ethers.ZeroHash;
  assert.equal(E.decodeMessage(spoof, ethers), null);
  const fake = speech(); fake.topics = [...fake.topics]; fake.topics[3] = ethers.ZeroHash;
  assert.equal(E.decodeMessage(fake, ethers), null);
});

test('live readiness blocks empty liquidity and unexpected bytecode before any quote or signature', async () => {
  const { client, state } = harness();
  assert.equal((await client.status()).ready, true);
  state.liquidity = 0n; assert.equal((await client.status()).ready, false);
  await assert.rejects(client.quote({ amount: '1' }), /needs liquidity/);
  state.liquidity = 10n; state.codeMismatch = C.hook;
  await assert.rejects(client.status(), /Contract verification/);
  assert.equal(state.sends.length, 0);
});

test('quotes simulate the exact speech hook on one pool without sending transactions', async () => {
  const { client, state } = harness(); await client.connect();
  const q = await client.quote({ amount: '0.0001' });
  const req = state.calls.find(x => x.to?.toLowerCase() === C.quoter.toLowerCase() && x.data.startsWith(interfaces.quoter.getFunction('quoteExactInputSingle').selector));
  const parsed = interfaces.quoter.parseTransaction(req).args[0];
  assert.equal(parsed.hookData, C.hookData); assert.equal(req.blockTag, 100); assert.equal(req.gasLimit, 30000000n);
  assert.equal(q.minimumOutput, '995000000000000000'); assert.ok(Object.isFrozen(q));
  assert.equal(state.sends.length, 0);
});

test('token sell approvals are exact, expire, and require one click each with 150 percent gas', async () => {
  const { client, state } = harness(); await client.connect();
  const q = await client.quote({ amount: '100', direction: 'GH0ST_TO_ETH' }); state.allowance = ethers.MaxUint256;
  assert.equal((await client.nextAction(q)).kind, 'reset_approval');
  await client.executeNext(q); assert.equal(state.sends.length, 1); assert.equal(state.allowance, 0n);
  await client.executeNext(q); assert.equal(state.sends.length, 2); assert.equal(state.allowance, ethers.parseEther('100'));
  await client.executeNext(q); assert.equal(state.sends.length, 3); assert.equal(state.permit, ethers.parseEther('100'));
  assert.equal(state.expiration, BigInt(q.deadline));
  const done = await client.executeNext(q); assert.equal(state.sends.length, 4); assert.equal(done.message.text, 'The quiet market carries a bright signal.');
  for (const tx of state.sends) { assert.equal(tx.gasLimit, 9750002n); assert.equal(tx.maxFeePerGas, undefined); assert.equal(tx.gasPrice, undefined); }
});

test('native buys do not request approval and use only the entered ETH amount', async () => {
  const { client, state } = harness(); await client.connect(); const q = await client.quote({ amount: '0.001' });
  assert.equal((await client.nextAction(q)).kind, 'swap');
  const result = await client.executeNext(q);
  assert.equal(state.sends.length, 1); assert.equal(state.sends[0].value, ethers.parseEther('0.001'));
  assert.equal(result.messages.length, 1);
  await assert.rejects(client.executeNext(q), /fresh quote/); assert.equal(state.sends.length, 1);
});

test('stale quotes, account changes, wrong network and insufficient funds cannot sign', async () => {
  for (const mutate of [s => { s.now += 121000; }, s => { s.account = C.token; }, s => { s.chain = 1n; }, s => { s.eth = 0n; }]) {
    const { client, state } = harness(); await client.connect(); const q = await client.quote({ amount: '1' }); mutate(state);
    await assert.rejects(client.executeNext(q)); assert.equal(state.sends.length, 0);
  }
});

test('a disconnected receipt wait never causes a duplicate send and can recover the original receipt', async () => {
  const { client, state } = harness(); await client.connect(); const q = await client.quote({ amount: '0.001' }); state.pending = true;
  const first = await client.executeNext(q); assert.equal(first.pending, true);
  await client.executeNext(q); assert.equal(state.sends.length, 1);
  state.receipts.set(first.hash, { hash: first.hash, status: 1, logs: [speech({ transactionHash: first.hash })] });
  const recovered = await client.executeNext(q); assert.equal(recovered.pending, false); assert.equal(state.sends.length, 1);
});

test('a wallet rejection can be retried without a stuck pending record', async () => {
  const { client, state } = harness(); await client.connect(); const q = await client.quote({ amount: '0.001' }); state.reject = true;
  await assert.rejects(client.executeNext(q), /Rejected/); state.reject = false;
  assert.equal((await client.nextAction(q)).kind, 'swap'); assert.equal(state.sends.length, 0);
});

test('an ambiguous submission blocks repeat sends until its exact transaction hash is recovered', async () => {
  const { client, state } = harness(); await client.connect(); const q = await client.quote({ amount: '0.001' });
  state.unknownSubmission = true;
  await assert.rejects(client.executeNext(q), /RPC disconnected/);
  assert.equal((await client.nextAction(q)).kind, 'pending');
  await assert.rejects(client.executeNext(q), /Submission status is unknown/);
  await assert.rejects(client.recoverPending(ethers.ZeroHash), /does not match/);
  const recovered = await client.recoverPending(state.lastHash);
  assert.equal(recovered.message.sequence, '1'); assert.equal(state.sends.length, 1);
});

test('connected wallet reads can recover from a failed public RPC and feed logs filter the pinned provenance', async () => {
  const { client, state } = harness(); await client.connect(); state.publicDown = true;
  assert.equal((await client.status()).ready, true);
  state.logs.push(speech({ address: C.token }));
  const rows = await client.messages(); assert.equal(rows.length, 1);
  const filter = state.calls.find(x => x.logs).logs;
  assert.equal(filter.address, C.hook); assert.equal(filter.topics[1], C.poolId); assert.equal(filter.topics[3], C.modelHash);
});

test('recovery holds the same cross-tab lock as sends until receipt verification ends', async () => {
  let held = false, release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const keys = [];
  const h = harness({ withLock: async (key, work) => {
    keys.push(key); if (held) throw Error('Another tab holds the lock'); held = true;
    try { return await work(); } finally { held = false; }
  } });
  await h.client.connect(); const other = h.createClient(); await other.connect();
  const q = await h.client.quote({ amount: '0.001' }); h.state.unknownSubmission = true;
  await assert.rejects(h.client.executeNext(q), /RPC disconnected/);
  h.state.beforeReadTransaction = async () => { h.state.beforeReadTransaction = null; entered(); await gate; };
  const recovery = h.client.recoverPending(h.state.lastHash); await started;
  await assert.rejects(other.executeNext(null), /Another tab/);
  release(); await recovery;
  assert.equal(h.state.sends.length, 1); assert.ok(keys.every(key => key === 'gh0st:h00k:sign:4663'));
});

test('a stale recovery cannot overwrite or clear a changed shared pending record', async () => {
  for (const changeOn of [1, 2]) {
    const h = harness(); await h.client.connect(); const q = await h.client.quote({ amount: '0.001' }); h.state.unknownSubmission = true;
    await assert.rejects(h.client.executeNext(q), /RPC disconnected/);
    const key = [...h.storage.keys()][0], old = JSON.parse(h.storage.get(key));
    const newer = { ...old, quoteId: 'newer-quote', hash: ethers.id('newer-pending') }; let reads = 0;
    h.state.beforeReadTransaction = async () => { if (++reads === changeOn) h.storage.set(key, JSON.stringify(newer)); };
    await assert.rejects(h.client.recoverPending(h.state.lastHash), /changed in another tab/);
    assert.deepEqual(JSON.parse(h.storage.get(key)), newer); assert.equal(h.state.sends.length, 1);
  }
});
