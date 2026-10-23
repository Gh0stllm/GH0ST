import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as ethers from 'ethers';
import solc from 'solc-v4';
import hre from 'hardhat';
import '../../deployment/liquidity-plan.js';
import { liquidityIntentFromConfig } from '../../scripts/prepare-ghost-eth-pool.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lp = globalThis.GH0STLiquidity;
const q96 = 1n << 96n, q192 = 1n << 192n;
const standard = { wallet: lp.CONSTANTS.wallet, initialized: false, quoteSqrtPriceX96: q96 * 500n,
  ethUsd: '2500.12345678', blockTimestamp: 1_800_000_000, observedBlock: 96_000_000 };
const mintTypes = [lp.POOL_KEY_TYPE, 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'];

test('read-only pool preparation preserves configured USD liquidity intent without inventing token caps', () => {
  const configured = { liquidity_budget_usd_each: '100', liquidity_budget_usd_total: '200',
    liquidity_tick_range: [-887220, 887220], tick_spacing: 60, liquidity_slippage_bps: 50,
    liquidity_deadline_seconds: 900, liquidity_gas_is_additional: true };
  const intent = liquidityIntentFromConfig(configured);
  assert.equal(intent.status, 'BUDGET_CONFIGURED_AWAITING_FRESH_QUOTE_AND_DEPLOYMENT');
  assert.equal(intent.maximum_usd_each, '100'); assert.equal(intent.maximum_usd_total, '200');
  assert.deepEqual(intent.tick_range, [-887220, 887220]);
  assert.equal(intent.maximum_eth, null); assert.equal(intent.maximum_ghost, null);
  assert.match(intent.note, /liquidity-plan\.js/);
  assert.equal(liquidityIntentFromConfig({}).status, 'NOT_CONFIGURED');
  assert.throws(() => liquidityIntentFromConfig({ ...configured, liquidity_tick_range: [-887221, 887220] }));
  assert.throws(() => liquidityIntentFromConfig({ ...configured, liquidity_budget_usd_each: '0' }));
});

test('standalone browser module loads with no Node or wallet APIs', () => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(path.join(root, 'deployment/liquidity-plan.js'), 'utf8'), sandbox);
  assert.equal(sandbox.GH0STLiquidity.sqrtRatioAtTick(0), q96);
  assert.equal(sandbox.GH0STLiquidity.CONSTANTS.maximumUsdEach, '100');
  assert.throws(() => sandbox.GH0STLiquidity.buildPlan(standard), /ethers/);
});

test('quote-time USD limits use exact integer math and never round either $100 cap upward', () => {
  for (const ethUsd of ['0.1234567890123456789', '1', '2500.12345678', '1000000.99']) {
    for (const ratio of [q96 / 100n, q96, q96 * 500n, q96 * 10_000_000n]) {
      const { amount0Max, amount1Max, ethPrice, ghostUsd } = lp.quoteBudgets(ratio, ethUsd);
      const ethN = amount0Max * ethPrice.numerator, ethD = ethPrice.denominator * 10n ** 18n;
      const ghostN = amount1Max * ghostUsd.numerator, ghostD = ghostUsd.denominator * 10n ** 18n;
      assert.ok(ethN <= 100n * ethD && ethN + ethPrice.numerator > 100n * ethD);
      assert.ok(ghostN <= 100n * ghostD && ghostN + ghostUsd.numerator > 100n * ghostD);
    }
  }
  const b = lp.quoteBudgets(q96 * 500n, '2500');
  assert.equal(b.amount0Max, 40_000_000_000_000_000n);
  assert.equal(b.amount1Max, 10_000n * 10n ** 18n);
  assert.deepEqual(b.ghostUsd, { numerator: 1n, denominator: 100n });
  for (const invalid of [2500, '2.5e3', '-1', '0', 'NaN', ' 1', '01', '1.'])
    assert.throws(() => lp.quoteBudgets(q96, invalid));
});

test('fixed liquidity stays inside both hard caps throughout the 0.5% price interval', () => {
  for (const quote of [q96 / 1000n, q96, q96 * 500n, q96 * 1_000_000n]) {
    const plan = lp.buildPlan({ ...standard, quoteSqrtPriceX96: quote }, ethers);
    const a = lp.sqrtRatioAtTick(plan.liquidity.tick_lower), b = lp.sqrtRatioAtTick(plan.liquidity.tick_upper);
    const low = BigInt(plan.liquidity.sqrt_price_lower), high = BigInt(plan.liquidity.sqrt_price_upper);
    assert.equal(plan.liquidity.range, 'full_range');
    assert.equal(plan.liquidity.tick_lower, -887220);
    assert.equal(plan.liquidity.tick_upper, 887220);
    assert.equal(plan.deadline, '1800000900');
    for (let i = 0n; i <= 100n; i++) {
      const price = low + (high - low) * i / 100n;
      const amounts = lp.amountsForLiquidity(price, a, b, plan.liquidity.units);
      assert.ok(amounts.amount0 <= BigInt(plan.liquidity.amount0_max));
      assert.ok(amounts.amount1 <= BigInt(plan.liquidity.amount1_max));
    }
    assert.equal(JSON.parse(JSON.stringify(plan)).maximum_total_usd, '200');
    assert.equal(plan.prices.eth_usd.decimal, standard.ethUsd);
    assert.ok(BigInt(plan.liquidity.expected_unused_amount0) >= 0n);
    assert.ok(BigInt(plan.liquidity.expected_unused_amount1) >= 0n);
  }
});

test('unsigned atomic init/mint uses the production manager, exact caps, fixed liquidity, and locked NFT/refund owner', () => {
  const plan = lp.buildPlan(standard, ethers), abi = ethers.AbiCoder.defaultAbiCoder();
  const tx = plan.unsigned_mint_transaction, manager = new ethers.Interface(lp.POSITION_MANAGER_ABI);
  assert.equal(tx.to.toLowerCase(), lp.CONSTANTS.positionManager);
  assert.equal(tx.from, lp.CONSTANTS.wallet);
  assert.equal(tx.chainId, 4663);
  assert.equal(tx.value, plan.liquidity.amount0_max);
  const outer = manager.parseTransaction({ data: tx.data });
  assert.equal(outer.name, 'multicall'); assert.equal(outer.args[0].length, 2);
  const initialize = manager.parseTransaction({ data: outer.args[0][0] });
  assert.equal(initialize.name, 'initializePool'); assert.equal(initialize.args[1], standard.quoteSqrtPriceX96);
  const mint = manager.parseTransaction({ data: outer.args[0][1] });
  assert.equal(mint.name, 'modifyLiquidities'); assert.equal(mint.args[1], BigInt(plan.deadline));
  const [actions, params] = abi.decode(['bytes', 'bytes[]'], mint.args[0]);
  assert.equal(actions, '0x020d14'); assert.equal(params.length, 3);
  const decoded = abi.decode(mintTypes, params[0]);
  assert.equal(decoded[0].currency0, ethers.ZeroAddress);
  assert.equal(decoded[0].currency1.toLowerCase(), lp.CONSTANTS.currency1);
  assert.equal(decoded[0].hooks, lp.CONSTANTS.hook);
  assert.equal(decoded[0].fee, 3000n); assert.equal(decoded[0].tickSpacing, 60n);
  assert.equal(decoded[1], -887220n); assert.equal(decoded[2], 887220n);
  assert.equal(decoded[3], BigInt(plan.liquidity.units));
  assert.equal(decoded[4], BigInt(plan.liquidity.amount0_max));
  assert.equal(decoded[5], BigInt(plan.liquidity.amount1_max));
  assert.equal(decoded[6], lp.CONSTANTS.wallet); assert.equal(decoded[7], '0x');
  const settle = abi.decode(['address', 'address'], params[1]);
  assert.equal(settle[0], ethers.ZeroAddress); assert.equal(settle[1], decoded[0].currency1);
  const sweep = abi.decode(['address', 'address'], params[2]);
  assert.equal(sweep[0], ethers.ZeroAddress); assert.equal(sweep[1], lp.CONSTANTS.wallet);
  assert.equal(plan.pool_id, ethers.keccak256(abi.encode([lp.POOL_KEY_TYPE], [decoded[0]])));
  assert.equal(plan.prices.ghost_per_eth.decimal, '250000');
});

test('approvals target Permit2 then PositionManager, cap the exact token amount, and expire in 15 minutes', () => {
  const plan = lp.buildPlan({ ...standard, currentErc20Allowance: (1n << 256n) - 1n }, ethers);
  assert.deepEqual(plan.approvals.map(t => t.kind), ['reset_token_allowance', 'approve_token_exact_cap', 'approve_position_manager_exact_cap']);
  const erc20 = new ethers.Interface(lp.ERC20_ABI), permit2 = new ethers.Interface(lp.PERMIT2_ABI);
  for (let index = 0; index < 2; index++) {
    const tx = plan.approvals[index], parsed = erc20.parseTransaction({ data: tx.data });
    assert.equal(tx.to.toLowerCase(), lp.CONSTANTS.currency1); assert.equal(tx.value, '0');
    assert.equal(parsed.args[0], lp.CONSTANTS.permit2);
    assert.equal(parsed.args[1], index === 0 ? 0n : BigInt(plan.liquidity.amount1_max));
  }
  const final = plan.approvals[2], parsed = permit2.parseTransaction({ data: final.data });
  assert.equal(final.to, lp.CONSTANTS.permit2); assert.equal(final.value, '0');
  assert.equal(parsed.args[0].toLowerCase(), lp.CONSTANTS.currency1);
  assert.equal(parsed.args[1].toLowerCase(), lp.CONSTANTS.positionManager);
  assert.equal(parsed.args[2], BigInt(plan.liquidity.amount1_max));
  assert.equal(parsed.args[3], BigInt(standard.blockTimestamp + 900));
  const exact = lp.buildPlan({ ...standard, currentErc20Allowance: plan.liquidity.amount1_max }, ethers);
  assert.equal(exact.approvals.length, 1);
});

test('existing pools omit initialization, and altered account or stale/different pool prices fail closed', () => {
  const plan = lp.buildPlan({ ...standard, initialized: true, currentSqrtPriceX96: standard.quoteSqrtPriceX96 }, ethers);
  assert.equal(new ethers.Interface(lp.POSITION_MANAGER_ABI).parseTransaction({ data: plan.unsigned_mint_transaction.data }).name, 'modifyLiquidities');
  for (const patch of [
    { wallet: ethers.ZeroAddress }, { initialized: undefined }, { blockTimestamp: 0 },
    { blockTimestamp: 1.5 }, { initialized: true, currentSqrtPriceX96: standard.quoteSqrtPriceX96 * 2n },
    { initialized: true, currentSqrtPriceX96: 0n }, { quoteSqrtPriceX96: 0n },
  ]) assert.throws(() => lp.buildPlan({ ...standard, ...patch }, ethers));
});

test('integer tick prices and rounded-up token deltas agree with unmodified Uniswap v4-core', { timeout: 60_000 }, async () => {
  const source = `// SPDX-License-Identifier: MIT
    pragma solidity 0.8.26;
    import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
    import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
    contract LiquidityMathVerifier {
      function sqrtPrice(int24 tick) external pure returns(uint160) { return TickMath.getSqrtPriceAtTick(tick); }
      function amounts(uint160 p,uint160 a,uint160 b,uint128 l) external pure returns(uint256 x,uint256 y) {
        if(p<a) p=a; if(p>b) p=b;
        x=SqrtPriceMath.getAmount0Delta(p,b,l,true);
        y=SqrtPriceMath.getAmount1Delta(a,p,l,true);
      }
    }`;
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Verifier.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }), {
    import: file => { const target = path.join(root, 'node_modules', file); return existsSync(target) ? { contents: readFileSync(target, 'utf8') } : { error: file }; },
  }));
  assert.deepEqual((output.errors ?? []).filter(e => e.severity === 'error'), []);
  await hre.network.provider.request({ method: 'hardhat_reset', params: [] });
  const provider = new ethers.BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  try {
    const artifact = output.contracts['Verifier.sol'].LiquidityMathVerifier;
    const verifier = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, await provider.getSigner()).deploy();
    await verifier.waitForDeployment();
    for (const tick of [-887272, -887220, -700001, -200001, -1, 0, 1, 200001, 700001, 887220, 887272])
      assert.equal(lp.sqrtRatioAtTick(tick), await verifier.sqrtPrice(tick), `tick ${tick}`);
    let seed = 20261023n;
    for (let i = 0; i < 30; i++) {
      seed = seed * 16807n % 2147483647n;
      const tick = Number(seed % 1774545n) - 887272;
      assert.equal(lp.sqrtRatioAtTick(tick), await verifier.sqrtPrice(tick), `random tick ${tick}`);
    }
    for (const [lower, upper] of [[-887220, 887220], [-120, 120], [100000, 110000]]) {
      const a = lp.sqrtRatioAtTick(lower), b = lp.sqrtRatioAtTick(upper);
      for (const tick of [lower - 1, lower, Math.trunc((lower + upper) / 2), upper, upper + 1]) {
        const p = lp.sqrtRatioAtTick(tick), l = 1234567890123456789n;
        const expected = lp.amountsForLiquidity(p, a, b, l), onchain = await verifier.amounts(p, a, b, l);
        assert.equal(expected.amount0, onchain[0], `amount0 ${lower}/${tick}/${upper}`);
        assert.equal(expected.amount1, onchain[1], `amount1 ${lower}/${tick}/${upper}`);
      }
    }
  } finally { await provider.destroy(); }
});
