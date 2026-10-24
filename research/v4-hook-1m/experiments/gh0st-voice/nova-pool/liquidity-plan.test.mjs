import test from 'node:test';
import assert from 'node:assert/strict';
import { Q96, Q192, WAD, TOTAL_SUPPLY, INITIAL_ETH, integerSqrt, sqrtRatioAtTick, tickAtSqrtRatio,
  amountsForLiquidity, liquidityForAmounts, quoteExactInput, buildLiquidityPlan } from './liquidity-plan.mjs';

test('integer square root is exact at large boundaries', () => {
  for (const root of [0n, 1n, 17n, (1n << 192n) + 313n]) {
    assert.equal(integerSqrt(root * root), root);
    if (root) assert.equal(integerSqrt(root * root - 1n), root - 1n);
    assert.equal(integerSqrt(root * root + root), root);
  }
});
test('TickMath known constants and inverse intervals', () => {
  assert.equal(sqrtRatioAtTick(0), Q96);
  assert.equal(sqrtRatioAtTick(-887272), 4295128739n);
  assert.equal(sqrtRatioAtTick(887272), 1461446703485210103287273052203988822378723970342n);
  for (const tick of [-887271, -100000, -1, 0, 1, 68602, 114552, 887270]) {
    assert.equal(tickAtSqrtRatio(sqrtRatioAtTick(tick)), tick);
    assert.equal(tickAtSqrtRatio(sqrtRatioAtTick(tick + 1) - 1n), tick);
  }
});
const plan = buildLiquidityPlan();
const position = { sqrtPriceX96: plan.initial_sqrt_price_x96, sqrtPriceLowerX96: plan.sqrt_price_lower_x96,
  sqrtPriceUpperX96: plan.sqrt_price_upper_x96, liquidity: plan.liquidity, fee: plan.fee_pips };
test('25k target is encoded at original rational price, not rounded to a tick', () => {
  const square = plan.initial_sqrt_price_x96 ** 2n;
  const targetNumerator = 943694n * Q192;
  assert(square * 10n <= targetNumerator);
  assert((plan.initial_sqrt_price_x96 + 1n) ** 2n * 10n > targetNumerator);
  assert.equal(plan.initial_fdv_usd, '25000');
  assert(plan.tick_lower < plan.initial_tick && plan.initial_tick < plan.tick_upper);
});
test('both full budgets are bounded and virtually all principal is active', () => {
  const { amount0, amount1 } = amountsForLiquidity(position.sqrtPriceX96, position.sqrtPriceLowerX96, position.sqrtPriceUpperX96, position.liquidity);
  assert(amount0 <= INITIAL_ETH && amount1 <= TOTAL_SUPPLY);
  assert.equal(amount0 + plan.locked_dust_eth_wei, INITIAL_ETH);
  assert.equal(amount1 + plan.locked_dust_nova_wei, TOTAL_SUPPLY);
  assert(plan.locked_dust_eth_wei * 100_000n < INITIAL_ETH);
  assert(plan.locked_dust_nova_wei * 100_000n < TOTAL_SUPPLY);
  const higher = amountsForLiquidity(position.sqrtPriceX96, position.sqrtPriceLowerX96, position.sqrtPriceUpperX96, position.liquidity + 1n);
  assert(higher.amount0 > INITIAL_ETH || higher.amount1 > TOTAL_SUPPLY);
});
test('liquidity sizing obeys both budgets across independent ranges and funding ratios', () => {
  let seed = 0x99f13011n;
  const random = limit => { seed = (seed * 1664525n + 1013904223n) & 0xffffffffn; return Number(seed % BigInt(limit)); };
  for (let i = 0; i < 100; i++) {
    const currentTick = random(600001) - 300000;
    const lower = sqrtRatioAtTick(currentTick - random(40000) - 1);
    const upper = sqrtRatioAtTick(currentTick + random(40000) + 1);
    const current = sqrtRatioAtTick(currentTick);
    const budget0 = BigInt(random(10000) + 1) * WAD;
    const budget1 = BigInt(random(10000) + 1) * WAD;
    const liquidity = liquidityForAmounts(current, lower, upper, budget0, budget1);
    const amounts = amountsForLiquidity(current, lower, upper, liquidity);
    assert(amounts.amount0 <= budget0 && amounts.amount1 <= budget1);
    const tooMuch = amountsForLiquidity(current, lower, upper, liquidity + 1n);
    assert(tooMuch.amount0 > budget0 || tooMuch.amount1 > budget1);
  }
});
test('each buyer can immediately sell its acquired N0VA, losing only spread/fees/rounding', () => {
  for (const amount of [10n ** 12n, 10n ** 15n, WAD / 100n, WAD / 10n, WAD, 10n * WAD]) {
    const buy = quoteExactInput({ ...position, amountIn: amount, zeroForOne: true });
    assert(!buy.reachedBoundary);
    assert(buy.sqrtPriceX96 < position.sqrtPriceX96);
    assert(buy.amountOut > 0n && buy.amountOut < TOTAL_SUPPLY);
    const sell = quoteExactInput({ ...position, sqrtPriceX96: buy.sqrtPriceX96, amountIn: buy.amountOut, zeroForOne: false });
    assert(!sell.reachedBoundary);
    assert(sell.amountOut > 0n && sell.amountOut < amount);
    assert(sell.sqrtPriceX96 > buy.sqrtPriceX96);
    assert(sell.sqrtPriceX96 < position.sqrtPriceX96);
    assert(sell.amountOut <= buy.amountIn + plan.active_principal_eth_wei);
  }
});
test('extreme buys and sells stop at boundaries and identify unused input', () => {
  for (const zeroForOne of [true, false]) {
    const quote = quoteExactInput({ ...position, amountIn: TOTAL_SUPPLY * 1000n, zeroForOne });
    assert(quote.reachedBoundary && quote.unspentAmountIn > 0n);
    assert.equal(quote.sqrtPriceX96, zeroForOne ? position.sqrtPriceLowerX96 : position.sqrtPriceUpperX96);
    assert(quote.amountOut <= (zeroForOne ? plan.active_principal_nova_wei : plan.active_principal_eth_wei));
  }
});
test('invalid bounds, fees, prices, and non-exact decimal input are rejected', () => {
  assert.throws(() => buildLiquidityPlan({ ethUsd: '2e3' }));
  assert.throws(() => buildLiquidityPlan({ ethUsd: '0' }));
  assert.throws(() => buildLiquidityPlan({ searchTicks: -1 }));
  assert.throws(() => quoteExactInput({ ...position, amountIn: 0n, zeroForOne: true }));
  assert.throws(() => quoteExactInput({ ...position, amountIn: 1n, zeroForOne: true, fee: 1_000_000 }));
  assert.throws(() => liquidityForAmounts(Q96, Q96, Q96, 1n, 1n));
});
