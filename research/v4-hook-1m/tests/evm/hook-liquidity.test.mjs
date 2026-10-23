import test from 'node:test';
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import '../../deployment/liquidity-plan.js';
import '../../frontend/hook/swap-engine.js';
import '../../frontend/hook/liquidity-engine.js';

const E = globalThis.GH0STLiquidityUIEngine, S = globalThis.GH0STSwap, M = globalThis.GH0STLiquidity, C = S.CONSTANTS;
const account = '0x000000000000000000000000000000000000bEEF';
const coder = ethers.AbiCoder.defaultAbiCoder();
const position = new ethers.Interface(M.POSITION_MANAGER_ABI), token = new ethers.Interface(S.ABI.token),
  permit = new ethers.Interface(S.ABI.permit2), stateView = new ethers.Interface(S.ABI.state), hook = new ethers.Interface(S.ABI.hook);
const initialPrice = 337195094064817369351858984726692n;
function harness(initialized = false, options = {}) {
  const state = { now: 1800000000000, account, chain: 4663n, initialized, price: initialPrice, allowance: 0n, permit: 0n, expiry: 0n,
    eth: 10n ** 22n, ghost: 10n ** 34n, badCode: false, sends: [], receipts: new Map(), txs: new Map(), wrongOwner: false, wrongPool: false,
    pending: false, unknown: false, minted: null };
  const store = new Map();
  const provider = {
    send: async method => method === 'eth_chainId' ? ethers.toQuantity(state.chain) : [state.account],
    getBlock: async () => ({ number: 100, timestamp: Math.floor(state.now / 1000), hash: ethers.id('block') }),
    getCode: async address => state.badCode ? '0x' : 'code:' + address,
    getBalance: async () => state.eth,
    getFeeData: async () => ({ maxFeePerGas: 2n }),
    getTransactionReceipt: async hash => state.receipts.get(hash),
    getTransaction: async hash => { if (state.beforeReadTransaction) await state.beforeReadTransaction(hash); return state.txs.get(hash); },
    call: async request => {
      const to = request.to.toLowerCase();
      const iface = to === C.token.toLowerCase() ? token : to === C.permit2.toLowerCase() ? permit
        : to === C.stateView.toLowerCase() ? stateView : to === E.POSITION_MANAGER.toLowerCase() ? position : hook;
      const p = iface.parseTransaction(request); let answer;
      if (p.name === 'poolManager') answer = [C.poolManager];
      else if (p.name === 'permit2') answer = [C.permit2];
      else if (p.name === 'model') answer = [C.model];
      else if (p.name === 'modelHash') answer = [C.modelHash];
      else if (p.name === 'decimals') answer = [18];
      else if (p.name === 'balanceOf') answer = [state.ghost];
      else if (p.name === 'allowance') answer = to === C.token.toLowerCase() ? [state.allowance] : [state.permit, state.expiry, 0n];
      else if (p.name === 'getLiquidity') answer = [10n ** 24n];
      else if (p.name === 'getSlot0') answer = [p.args[0] === C.poolId && !state.initialized ? 0n : state.price, 167130, 0, 3000];
      else if (p.name === 'ownerOf') answer = [state.wrongOwner ? C.token : state.account];
      else if (p.name === 'getPositionLiquidity') answer = [state.minted.liquidity];
      else if (p.name === 'getPoolAndPositionInfo') {
        const info = (BigInt.asUintN(24, -887220n) << 8n) | (887220n << 32n);
        answer = [state.wrongPool ? { ...S.POOL_KEY, hooks: C.token } : S.POOL_KEY, info];
      } else throw Error(`Unexpected ${p.name}`);
      return iface.encodeFunctionResult(p.name, answer);
    },
  };
  const signer = {
    getAddress: async () => state.account,
    estimateGas: async () => 100001n,
    sendTransaction: async tx => {
      state.sends.push(tx); const hash = ethers.id(`tx${state.sends.length}`); state.lastHash = hash; let logs = [];
      if (tx.to.toLowerCase() === C.token.toLowerCase()) state.allowance = token.parseTransaction(tx).args[1];
      else if (tx.to.toLowerCase() === C.permit2.toLowerCase()) { const p = permit.parseTransaction(tx); state.permit = p.args[2]; state.expiry = p.args[3]; }
      else {
        let parsed = position.parseTransaction(tx);
        if (parsed.name === 'multicall') { state.initialized = true; parsed = position.parseTransaction({ data: parsed.args[0][1] }); }
        const [, params] = coder.decode(['bytes', 'bytes[]'], parsed.args[0]);
        const p = coder.decode([S.KEY_TYPE, 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'], params[0]);
        state.minted = { liquidity: p[3], recipient: p[6] };
        logs = [{ address: E.POSITION_MANAGER, ...position.encodeEventLog(position.getEvent('Transfer'), [ethers.ZeroAddress, state.account, 42n]) }];
      }
      state.txs.set(hash, tx); const receipt = { status: 1, hash, blockNumber: 100, logs };
      if (!state.pending) state.receipts.set(hash, receipt);
      if (state.unknown) throw Error('Disconnected after acceptance');
      return { hash, wait: async () => { if (state.pending) throw Error('Wait disconnected'); return receipt; } };
    },
  };
  const wrapped = { ...ethers, keccak256: value => value.startsWith('code:') ? (value.slice(5) === E.POSITION_MANAGER ? E.POSITION_HASH : S.PINS[value.slice(5)]) : ethers.keccak256(value) };
  const config = { ethers: wrapped, math: M, swapLibrary: S, readProvider: provider, walletProvider: provider, signer,
    storage: { getItem: key => store.get(key), setItem: (key, val) => store.set(key, val), removeItem: key => store.delete(key) },
    now: () => state.now, withLock: options.withLock || (async (_, task) => task()) };
  const client = E.createClient(config);
  return { client, state, store, createClient: () => E.createClient(config) };
}
async function approved(h) {
  await h.client.connect(); const q = await h.client.quote({ amountEth: '0.01' });
  await h.client.executeNext(q); await h.client.executeNext(q); return q;
}

test('any wallet receives a quote with an exact ETH cap and no automatic spending', async () => {
  const { client, state } = harness(); await client.connect(); const q = await client.quote({ amountEth: '0.01' });
  assert.equal(q.account, account); assert.equal(q.amountEthMax, '0.01'); assert.equal(q.amount0Max, '10000000000000000');
  assert.equal(q.source, 'reference'); assert.equal(q.initialized, false); assert.equal(state.sends.length, 0);
  assert.equal(q.amount1Max, (10n ** 16n * initialPrice ** 2n / (1n << 192n)).toString());
  assert.ok(Object.isFrozen(q));
});

test('full-range fixed liquidity remains within both hard caps throughout the complete 0.5 percent interval', async () => {
  const { client } = harness(true); await client.connect(); const q = await client.quote({ amountEth: '0.03' });
  assert.equal(q.source, 'target');
  const lo = BigInt(q.lowerSqrtPriceX96), hi = BigInt(q.upperSqrtPriceX96);
  for (let i = 0n; i <= 100n; i++) {
    const price = lo + (hi - lo) * i / 100n;
    const used = M.amountsForLiquidity(price, M.sqrtRatioAtTick(q.tickLower), M.sqrtRatioAtTick(q.tickUpper), BigInt(q.liquidity));
    assert.ok(used.amount0 <= BigInt(q.amount0Max)); assert.ok(used.amount1 <= BigInt(q.amount1Max));
  }
});

test('first deposit is atomic initialization plus bounded mint, capped approvals, refund, and verified own NFT', async () => {
  const h = harness(false), q = await approved(h);
  assert.equal(h.state.sends.length, 2); assert.equal(h.state.allowance.toString(), q.amount1Max); assert.equal(h.state.permit.toString(), q.amount1Max);
  assert.equal(h.state.expiry, BigInt(q.deadline));
  const result = await h.client.executeNext(q), tx = h.state.sends[2];
  assert.equal(position.parseTransaction(tx).name, 'multicall'); assert.equal(tx.value, BigInt(q.amount0Max));
  assert.equal(result.minted.tokenId, '42'); assert.equal(result.minted.owner, account); assert.equal(h.state.minted.recipient, account);
  assert.equal(tx.gasLimit, 150002n); assert.equal(tx.gasPrice, undefined); assert.equal(tx.maxFeePerGas, undefined);
  await assert.rejects(h.client.executeNext(q), /fresh liquidity quote/); assert.equal(h.state.sends.length, 3);
});

test('existing pools use a normal mint and broad token approvals are reset before exact approval', async () => {
  const h = harness(true); await h.client.connect(); const q = await h.client.quote({ amountEth: '0.01' }); h.state.allowance = ethers.MaxUint256;
  assert.equal((await h.client.nextAction(q)).kind, 'reset_approval'); await h.client.executeNext(q); assert.equal(h.state.allowance, 0n);
  await h.client.executeNext(q); await h.client.executeNext(q); await h.client.executeNext(q);
  assert.equal(position.parseTransaction(h.state.sends[3]).name, 'modifyLiquidities');
});

test('changed pool initialization, price, chain, account, code, or stale quote prevents wallet sends', async () => {
  for (const mutate of [s => { s.initialized = true; }, s => { s.price *= 2n; }, s => { s.chain = 1n; },
    s => { s.account = C.token; }, s => { s.badCode = true; }, s => { s.now += 121000; }, s => { s.ghost = 0n; }]) {
    const h = harness(); await h.client.connect(); const q = await h.client.quote({ amountEth: '0.01' }); mutate(h.state);
    await assert.rejects(h.client.executeNext(q)); assert.equal(h.state.sends.length, 0);
  }
});

test('a wrong NFT owner or pool blocks successful completion and prevents duplicate minting', async () => {
  for (const field of ['wrongOwner', 'wrongPool']) {
    const h = harness(true), q = await approved(h); h.state[field] = true;
    await assert.rejects(h.client.executeNext(q), /position|pool/);
    assert.equal((await h.client.nextAction(q)).kind, 'pending');
    await assert.rejects(h.client.executeNext(q), /position|pool/); assert.equal(h.state.sends.length, 3);
  }
});

test('accepted transaction RPC errors recover by exact hash without a second send', async () => {
  const h = harness(); await h.client.connect(); const q = await h.client.quote({ amountEth: '0.01' }); h.state.unknown = true;
  await assert.rejects(h.client.executeNext(q), /Disconnected after acceptance/);
  assert.equal((await h.client.nextAction(null)).kind, 'pending');
  await assert.rejects(h.client.executeNext(null), /Submission status is unknown/);
  await assert.rejects(h.client.recoverPending(ethers.ZeroHash), /does not match/);
  const recovered = await h.client.recoverPending(h.state.lastHash); assert.equal(recovered.pending, false); assert.equal(h.state.sends.length, 1);
});

test('liquidity tolerance is exactly 0.5 percent and tiny or malformed budgets cannot create a plan', async () => {
  const h = harness(); await h.client.connect();
  for (const amountEth of ['0', '1e3', '-1', '1.0000000000000000001']) await assert.rejects(h.client.quote({ amountEth }));
  await assert.rejects(h.client.quote({ amountEth: '0.01', slippageBps: 100 }), /fixed 0.5/);
});

test('liquidity recovery and sends share one cross-tab lock through receipt verification', async () => {
  let held = false, release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const keys = [];
  const h = harness(false, { withLock: async (key, work) => {
    keys.push(key); if (held) throw Error('Another tab holds the lock'); held = true;
    try { return await work(); } finally { held = false; }
  } });
  await h.client.connect(); const other = h.createClient(); await other.connect();
  const q = await h.client.quote({ amountEth: '0.001' }); h.state.unknown = true;
  await assert.rejects(h.client.executeNext(q), /Disconnected after acceptance/);
  h.state.beforeReadTransaction = async () => { h.state.beforeReadTransaction = null; entered(); await gate; };
  const recovery = h.client.recoverPending(h.state.lastHash); await started;
  await assert.rejects(other.executeNext(null), /Another tab/);
  release(); await recovery;
  assert.equal(h.state.sends.length, 1); assert.ok(keys.every(key => key === 'gh0st:h00k:sign:4663'));
});

test('stale liquidity recovery preserves a changed pending record during update and clearing', async () => {
  for (const changeOn of [1, 2]) {
    const h = harness(); await h.client.connect(); const q = await h.client.quote({ amountEth: '0.001' }); h.state.unknown = true;
    await assert.rejects(h.client.executeNext(q), /Disconnected after acceptance/);
    const key = [...h.store.keys()][0], old = JSON.parse(h.store.get(key));
    const newer = { ...old, quoteId: 'newer-quote', hash: ethers.id('newer-pending') }; let reads = 0;
    h.state.beforeReadTransaction = async () => { if (++reads === changeOn) h.store.set(key, JSON.stringify(newer)); };
    await assert.rejects(h.client.recoverPending(h.state.lastHash), /changed in another tab/);
    assert.deepEqual(JSON.parse(h.store.get(key)), newer); assert.equal(h.state.sends.length, 1);
  }
});
