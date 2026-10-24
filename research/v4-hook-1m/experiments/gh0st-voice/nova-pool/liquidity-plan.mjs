// Local-only N0VA genesis-liquidity arithmetic. No RPC, accounts, signatures, or broadcasts.
// TickMath constants are the MIT-licensed Uniswap v4-core 1.0.2 constants.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

export const Q96 = 1n << 96n;
export const Q192 = Q96 * Q96;
export const WAD = 10n ** 18n;
export const FEE_DENOMINATOR = 1_000_000n;
export const MAX_UINT128 = (1n << 128n) - 1n;
export const TOTAL_SUPPLY = 1_000_000n * WAD;
export const INITIAL_ETH = WAD;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
const factors = [
  0xfffcb933bd6fad37aa2d162d1a594001n, 0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn, 0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n, 0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n, 0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n, 0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n, 0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n, 0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n, 0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n, 0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n, 0x48a170391f7dc42444e8fa2n,
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export function ceilDiv(a, b) {
  assert(typeof a === 'bigint' && typeof b === 'bigint' && a >= 0n && b > 0n, 'Invalid unsigned division');
  return (a + b - 1n) / b;
}
export function integerSqrt(n) {
  assert(typeof n === 'bigint' && n >= 0n, 'Invalid square root input');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) { const next = (x + n / x) >> 1n; if (next >= x) return x; x = next; }
}
export function decimalFraction(text) {
  assert(typeof text === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(text), 'Decimal string required');
  const [whole, fractional = ''] = text.split('.');
  return { numerator: BigInt(whole + fractional), denominator: 10n ** BigInt(fractional.length) };
}
export function decimal(numerator, denominator = WAD, places = 18) {
  assert(numerator >= 0n && denominator > 0n && Number.isInteger(places) && places >= 0 && places <= 80, 'Invalid display value');
  const s = (numerator * 10n ** BigInt(places) / denominator).toString().padStart(places + 1, '0');
  if (!places) return s;
  return `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, '');
}
export function sqrtRatioAtTick(tick) {
  assert(Number.isInteger(tick) && tick >= MIN_TICK && tick <= MAX_TICK, 'Invalid tick');
  let ratio = 1n << 128n;
  const absolute = Math.abs(tick);
  for (let bit = 0; bit < factors.length; bit++) if ((absolute & (1 << bit)) !== 0) ratio = ratio * factors[bit] >> 128n;
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  return ceilDiv(ratio, 1n << 32n);
}
export function tickAtSqrtRatio(sqrtPriceX96) {
  assert(sqrtPriceX96 >= sqrtRatioAtTick(MIN_TICK) && sqrtPriceX96 < sqrtRatioAtTick(MAX_TICK), 'Invalid sqrt price');
  let low = MIN_TICK, high = MAX_TICK;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (sqrtRatioAtTick(mid) <= sqrtPriceX96) low = mid; else high = mid - 1;
  }
  return low;
}
export function amount0Delta(a, b, liquidity, roundUp = true) {
  if (a > b) [a, b] = [b, a];
  assert(a > 0n && liquidity >= 0n, 'Invalid amount0 arguments');
  const numerator = liquidity * Q96 * (b - a), denominator = b * a;
  return roundUp ? ceilDiv(numerator, denominator) : numerator / denominator;
}
export function amount1Delta(a, b, liquidity, roundUp = true) {
  if (a > b) [a, b] = [b, a];
  assert(a > 0n && liquidity >= 0n, 'Invalid amount1 arguments');
  const numerator = liquidity * (b - a);
  return roundUp ? ceilDiv(numerator, Q96) : numerator / Q96;
}
export function amountsForLiquidity(price, lower, upper, liquidity, roundUp = true) {
  assert(lower > 0n && lower < upper && price > 0n && liquidity >= 0n && liquidity <= MAX_UINT128, 'Invalid position');
  if (price <= lower) return { amount0: amount0Delta(lower, upper, liquidity, roundUp), amount1: 0n };
  if (price >= upper) return { amount0: 0n, amount1: amount1Delta(lower, upper, liquidity, roundUp) };
  return { amount0: amount0Delta(price, upper, liquidity, roundUp), amount1: amount1Delta(lower, price, liquidity, roundUp) };
}
export function liquidityForAmounts(price, lower, upper, amount0, amount1) {
  assert(lower < price && price < upper && amount0 >= 0n && amount1 >= 0n, 'Price must be inside range');
  // Exact rational maxima; floor is safe with the round-up mint amounts.
  const l0 = amount0 * price * upper / (Q96 * (upper - price));
  const l1 = amount1 * Q96 / (price - lower);
  const liquidity = l0 < l1 ? l0 : l1;
  assert(liquidity > 0n && liquidity <= MAX_UINT128, 'Invalid liquidity amount');
  return liquidity;
}
export function quoteExactInputSingleStep({ sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96, liquidity, fee = 3000, zeroForOne, amountIn }) {
  assert(Number.isInteger(fee) && fee >= 0 && fee < 1_000_000, 'Invalid fee');
  assert(typeof zeroForOne === 'boolean' && amountIn > 0n && liquidity > 0n, 'Invalid swap');
  assert(sqrtPriceLowerX96 <= sqrtPriceX96 && sqrtPriceX96 <= sqrtPriceUpperX96, 'Price outside position');
  const target = zeroForOne ? sqrtPriceLowerX96 : sqrtPriceUpperX96;
  const feePips = BigInt(fee);
  const afterFee = amountIn * (FEE_DENOMINATOR - feePips) / FEE_DENOMINATOR;
  const required = zeroForOne ? amount0Delta(target, sqrtPriceX96, liquidity) : amount1Delta(sqrtPriceX96, target, liquidity);
  const reachedBoundary = afterFee >= required;
  let next = target;
  if (!reachedBoundary) {
    next = zeroForOne
      ? ceilDiv(liquidity * Q96 * sqrtPriceX96, liquidity * Q96 + afterFee * sqrtPriceX96)
      : sqrtPriceX96 + afterFee * Q96 / liquidity;
  }
  // v4 SwapMath deliberately keeps the whole after-fee input when input is exhausted.
  // Recomputing it from the rounded sqrt price would misattribute a few wei to fees.
  const netAmountIn = reachedBoundary ? required : afterFee;
  const feeAmount = reachedBoundary ? ceilDiv(netAmountIn * feePips, FEE_DENOMINATOR - feePips) : amountIn - netAmountIn;
  const amountOut = zeroForOne ? amount1Delta(next, sqrtPriceX96, liquidity, false) : amount0Delta(sqrtPriceX96, next, liquidity, false);
  assert(netAmountIn + feeAmount <= amountIn, 'Swap rounded over input budget');
  return { sqrtPriceX96: next, amountIn: netAmountIn + feeAmount, netAmountIn, feeAmount, amountOut,
    unspentAmountIn: amountIn - netAmountIn - feeAmount, reachedBoundary };
}
export function quoteExactInput({ sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96, liquidity,
  fee = 3000, zeroForOne, amountIn, tickSpacing = 1, currentTick }) {
  assert(Number.isInteger(fee) && fee >= 0 && fee < 1_000_000, 'Invalid fee');
  assert(Number.isInteger(tickSpacing) && tickSpacing > 0 && tickSpacing <= 32767, 'Invalid tick spacing');
  assert(typeof zeroForOne === 'boolean' && amountIn > 0n && liquidity > 0n, 'Invalid swap');
  const lowerTick = tickAtSqrtRatio(sqrtPriceLowerX96), upperTick = tickAtSqrtRatio(sqrtPriceUpperX96);
  assert(sqrtRatioAtTick(lowerTick) === sqrtPriceLowerX96 && sqrtRatioAtTick(upperTick) === sqrtPriceUpperX96,
    'Position endpoints must be TickMath values');
  assert(lowerTick % tickSpacing === 0 && upperTick % tickSpacing === 0, 'Position endpoints must align with tick spacing');
  assert(sqrtPriceLowerX96 <= sqrtPriceX96 && sqrtPriceX96 <= sqrtPriceUpperX96, 'Price outside position');
  let tick = currentTick ?? tickAtSqrtRatio(sqrtPriceX96);
  assert(Number.isInteger(tick) && (tick === tickAtSqrtRatio(sqrtPriceX96)
    || tick + 1 === tickAtSqrtRatio(sqrtPriceX96) && sqrtRatioAtTick(tick + 1) === sqrtPriceX96), 'Invalid current tick');
  let price = sqrtPriceX96, remaining = amountIn, netAmountIn = 0n, feeAmount = 0n, amountOut = 0n, steps = 0;
  const finalTarget = zeroForOne ? sqrtPriceLowerX96 : sqrtPriceUpperX96;
  // Match Pool.swap's empty bitmap-word traversal, because each SwapMath step rounds separately.
  // There are only two initialized ticks: this immutable position's lower and upper endpoints.
  while (remaining > 0n && price !== finalTarget) {
    assert(steps++ < 20000, 'Swap step bound exceeded');
    const compressed = Math.floor(tick / tickSpacing);
    let nextTick;
    if (zeroForOne) {
      const wordStart = Math.floor(compressed / 256) * 256;
      nextTick = Math.max(lowerTick, wordStart * tickSpacing);
    } else {
      const wordEnd = Math.floor((compressed + 1) / 256) * 256 + 255;
      nextTick = Math.min(upperTick, wordEnd * tickSpacing);
    }
    const stepTarget = sqrtRatioAtTick(nextTick);
    const step = quoteExactInputSingleStep({ sqrtPriceX96: price,
      sqrtPriceLowerX96: zeroForOne ? stepTarget : sqrtPriceLowerX96,
      sqrtPriceUpperX96: zeroForOne ? sqrtPriceUpperX96 : stepTarget,
      liquidity, fee, zeroForOne, amountIn: remaining });
    price = step.sqrtPriceX96;
    remaining -= step.amountIn;
    netAmountIn += step.netAmountIn;
    feeAmount += step.feeAmount;
    amountOut += step.amountOut;
    tick = price === stepTarget ? (zeroForOne ? nextTick - 1 : nextTick) : tickAtSqrtRatio(price);
  }
  return { sqrtPriceX96: price, amountIn: amountIn - remaining, netAmountIn, feeAmount, amountOut,
    unspentAmountIn: remaining, reachedBoundary: price === finalTarget, currentTick: tick, steps };
}
export function fdvAtPrice(sqrtPriceX96, ethUsd) {
  const usd = decimalFraction(ethUsd);
  return decimal(TOTAL_SUPPLY * usd.numerator * Q192, WAD * usd.denominator * sqrtPriceX96 * sqrtPriceX96, 12);
}
export function buildLiquidityPlan({ ethUsd = '2359.235', targetFdvUsd = '25000', upsideMultiple = 100, searchTicks = 200 } = {}) {
  const usd = decimalFraction(ethUsd), fdv = decimalFraction(targetFdvUsd);
  assert(usd.numerator > 0n && fdv.numerator > 0n, 'Positive price required');
  assert(Number.isInteger(upsideMultiple) && upsideMultiple > 1 && upsideMultiple <= 10000, 'Invalid upside multiple');
  assert(Number.isInteger(searchTicks) && searchTicks >= 0 && searchTicks <= 2000, 'Invalid tick search');
  // currency1/currency0 = total N0VA supply * ETHUSD / targetFDV; both currencies use 18 decimals.
  const priceNumerator = TOTAL_SUPPLY * usd.numerator * fdv.denominator;
  const priceDenominator = WAD * usd.denominator * fdv.numerator;
  const sqrtPriceX96 = integerSqrt(priceNumerator * Q192 / priceDenominator);
  const currentTick = tickAtSqrtRatio(sqrtPriceX96);
  const idealLower = integerSqrt(sqrtPriceX96 * sqrtPriceX96 / BigInt(upsideMultiple));
  const referenceLowerTick = tickAtSqrtRatio(idealLower);
  let best;
  for (let tickLower = referenceLowerTick - searchTicks; tickLower <= referenceLowerTick + searchTicks; tickLower++) {
    const lower = sqrtRatioAtTick(tickLower);
    // Solve the upper endpoint that consumes exactly both real token budgets, before tick rounding.
    const numerator = TOTAL_SUPPLY * Q192 * sqrtPriceX96;
    const denominator = TOTAL_SUPPLY * Q192 - INITIAL_ETH * sqrtPriceX96 * (sqrtPriceX96 - lower);
    if (denominator <= 0n) continue;
    const idealUpper = numerator / denominator;
    const referenceUpperTick = tickAtSqrtRatio(idealUpper);
    for (const tickUpper of [referenceUpperTick, referenceUpperTick + 1]) {
      const upper = sqrtRatioAtTick(tickUpper);
      if (!(lower < sqrtPriceX96 && sqrtPriceX96 < upper)) continue;
      const liquidity = liquidityForAmounts(sqrtPriceX96, lower, upper, INITIAL_ETH, TOTAL_SUPPLY);
      const amounts = amountsForLiquidity(sqrtPriceX96, lower, upper, liquidity);
      const dust0 = INITIAL_ETH - amounts.amount0, dust1 = TOTAL_SUPPLY - amounts.amount1;
      const loss = dust0 * TOTAL_SUPPLY + dust1 * INITIAL_ETH;
      if (!best || loss < best.loss) best = { tickLower, tickUpper, lower, upper, liquidity, amounts, dust0, dust1, loss };
    }
  }
  assert(best && best.dust0 >= 0n && best.dust1 >= 0n, 'No valid range');
  assert(best.dust0 * 1000n <= INITIAL_ETH && best.dust1 * 1000n <= TOTAL_SUPPLY, 'More than 0.1 percent unallocated principal');
  const base = { sqrtPriceX96, sqrtPriceLowerX96: best.lower, sqrtPriceUpperX96: best.upper, liquidity: best.liquidity, fee: 3000 };
  const buyToBoundary = quoteExactInput({ ...base, amountIn: MAX_UINT128, zeroForOne: true });
  const sellToBoundary = quoteExactInput({ ...base, amountIn: MAX_UINT128, zeroForOne: false });
  const describe = (q, isBuy) => ({
    direction: isBuy ? 'BUY_N0VA_WITH_ETH' : 'SELL_N0VA_FOR_ETH',
    amount_in: decimal(q.amountIn), amount_out: decimal(q.amountOut), fee: decimal(q.feeAmount),
    unspent_input: decimal(q.unspentAmountIn), reached_range_boundary: q.reachedBoundary,
    ending_sqrt_price_x96: q.sqrtPriceX96, ending_fdv_usd: fdvAtPrice(q.sqrtPriceX96, ethUsd),
  });
  const buyQuotes = ['0.001', '0.01', '0.1', '1'].map(value => {
    const f = decimalFraction(value);
    const q = quoteExactInput({ ...base, amountIn: f.numerator * WAD / f.denominator, zeroForOne: true });
    const sellBack = quoteExactInput({ ...base, sqrtPriceX96: q.sqrtPriceX96, amountIn: q.amountOut, zeroForOne: false });
    return { ...describe(q, true), immediate_sell_all_received: describe(sellBack, false) };
  });
  const hypotheticalSellQuotes = ['100', '1000', '10000', '100000'].map(value => {
    const f = decimalFraction(value);
    return describe(quoteExactInput({ ...base, amountIn: f.numerator * WAD / f.denominator, zeroForOne: false }), false);
  });
  return {
    schema_version: 1, status: 'LOCAL_UNSIGNED_PLAN_NOT_DEPLOYED',
    price_provenance: { eth_usd: ethUsd, role: 'Explicit scenario input, not a live oracle price', target_fdv_usd: targetFdvUsd },
    currency0: '0x0000000000000000000000000000000000000000', currency1: 'N0VA_ERC20_ADDRESS_FROM_LOCAL_DEPLOYMENT',
    currency0_decimals: 18, currency1_decimals: 18, total_supply_wei: TOTAL_SUPPLY, initial_eth_wei: INITIAL_ETH,
    fee_pips: 3000, fee_percent: '0.3', protocol_fee_pips: 0, tick_spacing: 1,
    initial_sqrt_price_x96: sqrtPriceX96, initial_tick: currentTick,
    initial_nova_per_eth: decimal(sqrtPriceX96 * sqrtPriceX96, Q192, 18), initial_nova_usd: decimal(usd.numerator * Q192, usd.denominator * sqrtPriceX96 * sqrtPriceX96, 18),
    initial_fdv_usd: fdvAtPrice(sqrtPriceX96, ethUsd),
    tick_lower: best.tickLower, tick_upper: best.tickUpper, sqrt_price_lower_x96: best.lower, sqrt_price_upper_x96: best.upper,
    liquidity: best.liquidity, active_principal_eth_wei: best.amounts.amount0, active_principal_nova_wei: best.amounts.amount1,
    locked_dust_eth_wei: best.dust0, locked_dust_nova_wei: best.dust1,
    active_principal_eth: decimal(best.amounts.amount0), active_principal_nova: decimal(best.amounts.amount1),
    locked_dust_eth: decimal(best.dust0), locked_dust_nova: decimal(best.dust1),
    range_search: { target_upside_multiple: upsideMultiple, reference_lower_tick: referenceLowerTick, tested_lower_ticks: searchTicks * 2 + 1,
      objective: 'Minimize sum of fractional unused ETH and N0VA funding over floor/ceil upper ticks' },
    range_boundaries: {
      buy_direction: 'ETH in/N0VA out lowers sqrt price and tick, increasing N0VA USD price',
      sell_direction: 'N0VA in/ETH out raises sqrt price and tick, decreasing N0VA USD price',
      lower_tick_max_fdv_usd: fdvAtPrice(best.lower, ethUsd), upper_tick_min_fdv_usd: fdvAtPrice(best.upper, ethUsd),
      gross_eth_to_buy_boundary: decimal(buyToBoundary.amountIn),
      hypothetical_gross_nova_to_sell_boundary: decimal(sellToBoundary.amountIn),
    },
    buy_quotes: buyQuotes, hypothetical_initial_sell_quotes: hypotheticalSellQuotes,
    notes: [
      'No RPC or signing is used by this module. The dollar values are scenarios at the explicit ETHUSD input.',
      'FDV is marginal spot price times fixed supply; it is not cash backing or realizable exit value.',
      'All 1,000,000 N0VA are assigned to the locked vault. Tiny integer/tick dust stays permanently locked outside active pool principal.',
      'Initially no N0VA is held externally. A buyer can resell immediately, and selling need not wait for later holders.',
      'Quoted initial sells are stress scenarios, not proof that a genesis holder owns that inventory.',
      'Swap quotes include v4-core 1.0.2 bitmap-word step rounding, a 3000-pip LP fee, and zero protocol fee.',
      'Only one position is modelled. At a range boundary active liquidity ends; strict router execution must reject partial fills.',
      'Fees remain in the pool; a vault with no withdrawal/fee-collection function permanently locks principal and its accrued fees.',
    ],
  };
}
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  const plan = buildLiquidityPlan();
  if (destination) await writeFile(destination, json(plan)); else process.stdout.write(json(plan));
}
