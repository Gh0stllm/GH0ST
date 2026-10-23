import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as ethers from 'ethers';
import '../../deployment/liquidity-plan.js';

const deployment = JSON.parse(readFileSync(new URL('../../deployment/robinhood-mainnet-plan.json', import.meta.url)));
const source = readFileSync(new URL('../../deployment/liquidity-wallet.js', import.meta.url), 'utf8');
const sandbox = { globalThis: null }; sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const { createController, PINS } = sandbox.GH0STLiquidityWallet;
const planner = globalThis.GH0STLiquidity, C = planner.CONSTANTS;
const abi = ethers.AbiCoder.defaultAbiCoder();
const token = new ethers.Interface(planner.ERC20_ABI), permits = new ethers.Interface(planner.PERMIT2_ABI);
const positions = new ethers.Interface(planner.POSITION_MANAGER_ABI);
const pools = new ethers.Interface(['function extsload(bytes32 slot) view returns (bytes32)']);
const sourceSlot = ethers.keccak256(abi.encode(['bytes32', 'uint256'], [PINS.sourcePool, 6]));
const initialSqrt = 329859220081241350909428559477477n;

function harness(sharedStorage = new Map(), withLock = async (_, work) => work()) {
  const state = { now: 1800000000000, chain: 4663n, account: C.wallet, allDeployed: true, allowance: 0n,
    permit: [0n, 0n, 0n], sourceSqrt: initialSqrt, targetRaw: ethers.ZeroHash, badCode: null,
    sends: [], reads: [], fetches: [], receipts: new Map(), txs: new Map(), pending: false,
    tokenBalance: 10n ** 40n, nativeBalance: 10n ** 22n, badOwner: false, reject: false, unknown: false };
  const codePins = new Map(deployment.transactions.map(t => [t.predicted_address.toLowerCase(), t.runtime_code_hash]));
  codePins.set(C.poolManager.toLowerCase(), deployment.dependencies.pool_manager_code_hash);
  codePins.set(C.positionManager.toLowerCase(), PINS.positionManagerHash);
  codePins.set(C.permit2.toLowerCase(), PINS.permit2Hash);
  codePins.set(C.currency1.toLowerCase(), PINS.tokenHash);
  function code(address) { return 'code:' + address.toLowerCase(); }
  function result(iface, method, values) { return iface.encodeFunctionResult(method, values); }
  const provider = {
    send: async method => method === 'eth_chainId' ? ethers.toQuantity(state.chain) : [state.account],
    getBlock: async () => ({ number: 100, timestamp: Math.floor(state.now / 1000), hash: ethers.id('block') }),
    getCode: async (address, blockTag) => { state.reads.push({ code: address, blockTag }); return state.badCode === address.toLowerCase() ? '0x' : code(address); },
    getBalance: async (_, blockTag) => { state.reads.push({ nativeBalance: true, blockTag }); return state.nativeBalance; },
    getFeeData: async () => ({ maxFeePerGas: 2n }),
    getTransactionReceipt: async hash => state.receipts.get(hash) || null,
    getTransaction: async hash => state.txs.get(hash),
    call: async request => {
      state.reads.push(request);
      if (request.to.toLowerCase() === C.poolManager.toLowerCase()) {
        const parsed = pools.parseTransaction(request);
        return result(pools, 'extsload', [parsed.args[0] === sourceSlot ? ethers.toBeHex(state.sourceSqrt, 32) : state.targetRaw]);
      }
      if (request.to.toLowerCase() === C.currency1.toLowerCase()) {
        const parsed = token.parseTransaction(request);
        return result(token, parsed.name, [parsed.name === 'decimals' ? 18 : parsed.name === 'allowance' ? state.allowance : state.tokenBalance]);
      }
      if (request.to.toLowerCase() === C.permit2.toLowerCase()) return result(permits, 'allowance', state.permit);
      const parsed = positions.parseTransaction(request);
      if (parsed.name === 'poolManager') return result(positions, parsed.name, [C.poolManager]);
      if (parsed.name === 'permit2') return result(positions, parsed.name, [C.permit2]);
      if (parsed.name === 'ownerOf') return result(positions, parsed.name, [state.badOwner ? ethers.ZeroAddress : C.wallet]);
      if (parsed.name === 'getPositionLiquidity') return result(positions, parsed.name, [state.mintPlan.liquidity.units]);
      if (parsed.name === 'getPoolAndPositionInfo') {
        const info = (BigInt.asUintN(24, BigInt(C.tickLower)) << 8n) | (BigInt.asUintN(24, BigInt(C.tickUpper)) << 32n);
        return result(positions, parsed.name, [state.mintPlan.pool_key, info]);
      }
      throw Error(`Unexpected call ${parsed.name}`);
    },
  };
  const signer = {
    getAddress: async () => C.wallet,
    estimateGas: async () => 100001n,
    sendTransaction: async request => {
      if (state.beforeSend) await state.beforeSend();
      if (state.reject) throw Object.assign(Error('User rejected'), { code: 'ACTION_REJECTED' });
      if (state.unknown) throw Error('Connection lost during submission');
      state.sends.push(request);
      const hash = ethers.id(`tx-${state.sends.length}`);
      state.txs.set(hash, { ...request });
      let logs = [];
      if (request.to.toLowerCase() === C.currency1.toLowerCase()) state.allowance = token.parseTransaction(request).args[1];
      else if (request.to.toLowerCase() === C.permit2.toLowerCase()) {
        const p = permits.parseTransaction(request); state.permit = [p.args[2], p.args[3], 0n];
      } else {
        state.mintPlan = app.state().quote.plan;
        const event = positions.encodeEventLog(positions.getEvent('Transfer'), [ethers.ZeroAddress, C.wallet, 7n]);
        logs = [{ address: C.positionManager, ...event }];
      }
      const receipt = { hash, status: 1, logs };
      if (!state.pending) state.receipts.set(hash, receipt);
      return { hash, wait: async () => { if (state.pending) throw Error('Wait disconnected'); return receipt; } };
    },
  };
  const wrappedEthers = { ...ethers, keccak256: value => value.startsWith('code:') ? codePins.get(value.slice(5)) : ethers.keccak256(value) };
  const app = createController({ ethersLib: wrappedEthers, planner, getContext: () => ({ plan: deployment, provider, signer, allDeployed: state.allDeployed }),
    storage: { getItem: key => sharedStorage.get(key), setItem: (key, val) => sharedStorage.set(key, val) },
    now: () => state.now, withLock,
    fetchFn: async (url, options) => { state.fetches.push({ url, options }); return { ok: true, json: async () => ({ data: { base: 'ETH', currency: 'USD', amount: '2400' } }) }; } });
  return { app, state, sharedStorage };
}

test('quote is read-only, pins all contracts and same-block reads, and fetches fixed price without credentials', async () => {
  const { app, state } = harness();
  const quote = await app.getQuote();
  assert.equal(state.sends.length, 0);
  assert.equal(quote.plan.pool_id, PINS.targetPool);
  assert.ok(Object.isFrozen(quote.plan.liquidity));
  assert.ok(state.reads.every(read => read.blockTag === 100));
  assert.equal(state.fetches[0].url, PINS.ethUsdUrl);
  assert.equal(state.fetches[0].options.credentials, 'omit');
  assert.equal(state.fetches[0].options.redirect, 'error');
  assert.equal(quote.plan.liquidity.amount0_max, '41666666666666666');
});

test('wrong chain/account, incomplete deployments or changed code block quote and every approval', async () => {
  for (const mutate of [state => { state.chain = 1n; }, state => { state.account = ethers.ZeroAddress; },
    state => { state.allDeployed = false; }, state => { state.badCode = C.hook.toLowerCase(); },
    state => { state.badCode = C.positionManager.toLowerCase(); }, state => { state.badCode = C.permit2.toLowerCase(); },
    state => { state.badCode = C.currency1.toLowerCase(); }]) {
    const { app, state } = harness(); await app.getQuote(); mutate(state);
    await assert.rejects(app.signNext());
    assert.equal(state.sends.length, 0);
    await assert.rejects(app.getQuote());
  }
});

test('one click sends one exact-capped approval with 50% gas headroom, then atomic init/mint verifies NFT', async () => {
  const { app, state } = harness();
  const quote = await app.getQuote();
  await app.signNext();
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0].gasLimit, 150002n);
  assert.equal(state.sends[0].maxFeePerGas, undefined);
  assert.equal(state.sends[0].gasPrice, undefined);
  assert.equal(state.allowance.toString(), quote.plan.liquidity.amount1_max);
  await app.signNext();
  assert.equal(state.sends.length, 2);
  assert.equal(state.permit[0].toString(), quote.plan.liquidity.amount1_max);
  assert.equal(state.permit[1].toString(), quote.plan.deadline);
  const completed = await app.signNext();
  assert.equal(state.sends.length, 3);
  assert.equal(state.sends[2].value.toString(), quote.plan.liquidity.amount0_max);
  assert.equal(positions.parseTransaction(state.sends[2]).name, 'multicall');
  assert.equal(completed.minted.tokenId, '7');
  await assert.rejects(app.getQuote(), /already added/);
  await assert.rejects(app.signNext(), /already added/);
  assert.equal(state.sends.length, 3);
});

test('old broad allowance resets to zero before exact amount; already exact approval is not repeated', async () => {
  const { app, state } = harness(); state.allowance = ethers.MaxUint256;
  const quote = await app.getQuote();
  await app.signNext(); assert.equal(state.allowance, 0n);
  await app.signNext(); assert.equal(state.allowance.toString(), quote.plan.liquidity.amount1_max);
  await app.signNext(); assert.equal(state.sends.length, 3);
  assert.equal(state.sends[2].to.toLowerCase(), C.permit2.toLowerCase());
});

test('quote expiry, source movement and changed target state stop signing without spending', async () => {
  for (const mutate of [state => { state.now += 300001; }, state => { state.sourceSqrt = initialSqrt * 101n / 100n; },
    state => { state.targetRaw = ethers.toBeHex(initialSqrt, 32); }]) {
    const { app, state } = harness(); await app.getQuote(); mutate(state);
    await assert.rejects(app.signNext(), /expired|moved|changed/);
    assert.equal(state.sends.length, 0);
  }
});

test('pending or unknown submissions persist across reload and prevent duplicate transactions', async () => {
  const { app, state, sharedStorage } = harness(); await app.getQuote(); state.pending = true;
  await assert.rejects(app.signNext(), /disconnected/);
  await assert.rejects(app.signNext(), /still pending/);
  const reloaded = harness(sharedStorage);
  await assert.rejects(reloaded.app.getQuote(), /still pending/);
  assert.equal(state.sends.length, 1);
  assert.equal(reloaded.state.sends.length, 0);
  const uncertain = harness(); await uncertain.app.getQuote(); uncertain.state.unknown = true;
  await assert.rejects(uncertain.app.signNext(), /Connection lost/);
  await assert.rejects(uncertain.app.signNext(), /unknown result/);
});

test('user rejection may retry, insufficient balance blocks spending, mismatched NFT stays unverified', async () => {
  const rejected = harness(); await rejected.app.getQuote(); rejected.state.reject = true;
  await assert.rejects(rejected.app.signNext(), /rejected/);
  rejected.state.reject = false; await rejected.app.signNext(); assert.equal(rejected.state.sends.length, 1);
  const poor = harness(); await poor.app.getQuote(); poor.state.nativeBalance = 0n;
  await assert.rejects(poor.app.signNext(), /Insufficient/); assert.equal(poor.state.sends.length, 0);
  const bad = harness(); await bad.app.getQuote(); await bad.app.signNext(); await bad.app.signNext(); bad.state.badOwner = true;
  await assert.rejects(bad.app.signNext(), /owner/); assert.equal(bad.app.state().record.mint, undefined);
  await assert.rejects(bad.app.signNext(), /owner/); assert.equal(bad.state.sends.length, 3);
});

test('origin-wide exclusive lock blocks another tab for the whole mint and prevents a duplicate after release', async () => {
  const shared = new Map(); let held = false, acquiredName;
  const lock = async (name, work) => {
    acquiredName = name;
    if (held) throw Error('Another tab is processing this liquidity wallet.');
    held = true;
    try { return await work(); } finally { held = false; }
  };
  const first = harness(shared, lock), second = harness(shared, lock);
  const q = await first.app.getQuote();
  for (const page of [first, second]) {
    page.state.allowance = BigInt(q.plan.liquidity.amount1_max);
    page.state.permit = [BigInt(q.plan.liquidity.amount1_max), BigInt(q.plan.deadline), 0n];
    await page.app.getQuote();
  }
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  first.state.beforeSend = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const mint = first.app.signNext();
  await entered;
  await assert.rejects(second.app.signNext(), /Another tab/);
  assert.equal(second.state.sends.length, 0);
  assert.match(acquiredName, /^gh0st-liquidity:4663:/);
  release(); await mint;
  await assert.rejects(second.app.signNext(), /already added/);
  assert.equal(first.state.sends.length, 1);
  assert.equal(second.state.sends.length, 0);
});

test('signing without Web Locks fails closed while read-only quotes still work', async () => {
  const { app, state } = harness(new Map(), null);
  await app.getQuote();
  await assert.rejects(app.signNext(), /Web Locks/);
  assert.equal(state.sends.length, 0);
});
