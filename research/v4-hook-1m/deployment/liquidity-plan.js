// Pure, unsigned native ETH/GH0ST liquidity planning. No RPC, keys, or signing.
// Browser: GH0STLiquidity.buildPlan(input, ethers). Node: import this file, then use globalThis.GH0STLiquidity.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GH0STLiquidity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const Q96 = 1n << 96n, Q192 = 1n << 192n;
  const MAX_UINT128 = (1n << 128n) - 1n;
  const MIN_SQRT_PRICE = 4295128739n;
  const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;
  const CONSTANTS = Object.freeze({
    chainId: 4663,
    wallet: '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6',
    poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    positionManager: '0x58daec3116aae6d93017baaea7749052e8a04fa7',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559',
    hook: '0x25E6366C490225358625d941C7B147360b155040',
    fee: 3000, tickSpacing: 60, tickLower: -887220, tickUpper: 887220,
    maximumUsdEach: '100', slippageBps: 50, deadlineSeconds: 900,
  });
  const POOL_KEY_TYPE = 'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
  const POSITION_MANAGER_ABI = [
    `function initializePool(${POOL_KEY_TYPE} key,uint160 sqrtPriceX96) payable returns (int24)`,
    'function modifyLiquidities(bytes unlockData,uint256 deadline) payable',
    'function multicall(bytes[] data) payable returns (bytes[])',
    'function poolManager() view returns (address)',
    'function permit2() view returns (address)',
    'function nextTokenId() view returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function getPositionLiquidity(uint256 tokenId) view returns (uint128)',
    `function getPoolAndPositionInfo(uint256 tokenId) view returns (${POOL_KEY_TYPE},uint256)`,
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  ];
  const PERMIT2_ABI = [
    'function approve(address token,address spender,uint160 amount,uint48 expiration)',
    'function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)',
  ];
  const ERC20_ABI = [
    'function approve(address spender,uint256 amount) returns (bool)',
    'function allowance(address owner,address spender) view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
  ];
  function invariant(condition, message) { if (!condition) throw new Error(message); }
  function uint(value, name) {
    invariant(typeof value !== 'number' || Number.isSafeInteger(value), `${name} must be an exact integer`);
    let n; try { n = BigInt(value); } catch (_) { throw new Error(`${name} must be an exact integer`); }
    invariant(n >= 0n, `${name} must not be negative`); return n;
  }
  function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
  function rational(numerator, denominator) {
    invariant(denominator > 0n, 'Denominator must be positive');
    const divisor = gcd(numerator, denominator);
    return { numerator: numerator / divisor, denominator: denominator / divisor };
  }
  function decimalFraction(value) {
    invariant(typeof value === 'string' && value.length <= 120 && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value),
      'Price must be an ordinary positive decimal string');
    const [whole, fraction = ''] = value.split('.');
    const result = rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
    invariant(result.numerator > 0n, 'Price must be positive'); return result;
  }
  function decimalString(numerator, denominator, places = 18) {
    invariant(Number.isInteger(places) && places >= 0 && places <= 80, 'Invalid display precision');
    const scaled = (numerator * 10n ** BigInt(places)) / denominator;
    if (places === 0) return scaled.toString();
    const digits = scaled.toString().padStart(places + 1, '0');
    return (digits.slice(0, -places) + '.' + digits.slice(-places)).replace(/\.?0+$/, '');
  }
  function integerSqrt(n) {
    n = uint(n, 'Square root input'); if (n < 2n) return n;
    let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
    for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
  }
  const ceilDiv = (a, b) => (a + b - 1n) / b;
  function checkedPrice(value) {
    const n = uint(value, 'Sqrt price');
    invariant(n >= MIN_SQRT_PRICE && n < MAX_SQRT_PRICE, 'Sqrt price outside v4 bounds'); return n;
  }
  // Exact BigInt port of Uniswap v4-core TickMath.getSqrtPriceAtTick (MIT).
  function sqrtRatioAtTick(tick) {
    invariant(Number.isInteger(tick) && Math.abs(tick) <= 887272, 'Invalid tick');
    const abs = Math.abs(tick);
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
    let ratio = 1n << 128n;
    for (let bit = 0; bit < factors.length; bit++) if ((abs & (1 << bit)) !== 0) ratio = (ratio * factors[bit]) >> 128n;
    if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
    return ceilDiv(ratio, 1n << 32n);
  }
  function orderedBounds(a, b) {
    a = uint(a, 'Lower sqrt price'); b = uint(b, 'Upper sqrt price');
    if (a > b) [a, b] = [b, a];
    invariant(a > 0n && b > a, 'Price bounds must be positive and distinct'); return [a, b];
  }
  function liquidityForAmounts(price, a, b, amount0, amount1) {
    price = checkedPrice(price); [a, b] = orderedBounds(a, b);
    amount0 = uint(amount0, 'Amount0'); amount1 = uint(amount1, 'Amount1');
    const l0 = (lo, hi) => amount0 * ((lo * hi) / Q96) / (hi - lo);
    const l1 = (lo, hi) => amount1 * Q96 / (hi - lo);
    const result = price <= a ? l0(a, b) : price >= b ? l1(a, b) : (l0(price, b) < l1(a, price) ? l0(price, b) : l1(a, price));
    invariant(result <= MAX_UINT128, 'Liquidity exceeds uint128'); return result;
  }
  // Mint amounts round UP, matching Pool.modifyLiquidity and SqrtPriceMath.
  function amountsForLiquidity(price, a, b, liquidity) {
    price = checkedPrice(price); [a, b] = orderedBounds(a, b);
    liquidity = uint(liquidity, 'Liquidity'); invariant(liquidity <= MAX_UINT128, 'Liquidity exceeds uint128');
    const amount0 = (lo, hi) => ceilDiv((liquidity << 96n) * (hi - lo), hi * lo);
    const amount1 = (lo, hi) => ceilDiv(liquidity * (hi - lo), Q96);
    return price <= a ? { amount0: amount0(a, b), amount1: 0n }
      : price >= b ? { amount0: 0n, amount1: amount1(a, b) }
      : { amount0: amount0(price, b), amount1: amount1(a, price) };
  }
  function quoteBudgets(quoteSqrtPriceX96, ethUsd) {
    const price = checkedPrice(quoteSqrtPriceX96), ethPrice = decimalFraction(ethUsd);
    const ghostPerEth = rational(price * price, Q192);
    const ghostUsd = rational(ethPrice.numerator * Q192, ethPrice.denominator * price * price);
    const amount0Max = 100n * ethPrice.denominator * 10n ** 18n / ethPrice.numerator;
    const amount1Max = 100n * ethPrice.denominator * 10n ** 18n * price * price / (ethPrice.numerator * Q192);
    invariant(amount0Max > 0n && amount1Max > 0n, 'Budget rounds to zero');
    invariant(amount0Max <= MAX_UINT128 && amount1Max <= MAX_UINT128, 'Budget exceeds uint128');
    return { amount0Max, amount1Max, ethPrice, ghostUsd, ghostPerEth };
  }
  function priceBounds(quoteSqrtPriceX96) {
    const price = checkedPrice(quoteSqrtPriceX96), square = price * price;
    const lower = integerSqrt(square * 9950n / 10000n);
    const highSquared = ceilDiv(square * 10050n, 10000n);
    const highFloor = integerSqrt(highSquared);
    const upper = highFloor * highFloor === highSquared ? highFloor : highFloor + 1n;
    invariant(lower >= MIN_SQRT_PRICE && upper < MAX_SQRT_PRICE, 'Slippage bounds exceed v4 bounds');
    return { lower, upper };
  }
  function stringify(value) { return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)); }
  function buildPlan(input, ethersLibrary) {
    const ethers = ethersLibrary || globalThis.ethers;
    invariant(ethers?.AbiCoder && ethers?.Interface, 'The reviewed ethers library is required');
    invariant(input && typeof input.initialized === 'boolean', 'Explicit live initialization state is required');
    invariant(typeof input.wallet === 'string' && input.wallet.toLowerCase() === CONSTANTS.wallet.toLowerCase(), 'Select the confirmed liquidity wallet');
    invariant(Number.isSafeInteger(input.blockTimestamp) && input.blockTimestamp > 0, 'Live block timestamp is required');
    const quotePrice = checkedPrice(input.quoteSqrtPriceX96);
    const price = input.initialized ? checkedPrice(input.currentSqrtPriceX96) : quotePrice;
    const { lower, upper } = priceBounds(quotePrice);
    invariant(price >= lower && price <= upper, 'Live pool price differs from the source quote by more than 0.5%');
    const a = sqrtRatioAtTick(CONSTANTS.tickLower), b = sqrtRatioAtTick(CONSTANTS.tickUpper);
    invariant(lower > a && upper < b, 'Quote must be inside the full-range position');
    const budget = quoteBudgets(quotePrice, input.ethUsd);
    const atLow = liquidityForAmounts(lower, a, b, budget.amount0Max, budget.amount1Max);
    const atHigh = liquidityForAmounts(upper, a, b, budget.amount0Max, budget.amount1Max);
    const liquidity = atLow < atHigh ? atLow : atHigh;
    invariant(liquidity > 0n, 'Budget is too small to mint liquidity');
    for (const p of [lower, price, upper]) {
      const amounts = amountsForLiquidity(p, a, b, liquidity);
      invariant(amounts.amount0 <= budget.amount0Max && amounts.amount1 <= budget.amount1Max, 'Liquidity would exceed the authorized budget');
    }
    const estimate = amountsForLiquidity(price, a, b, liquidity);
    const wallet = ethers.getAddress(CONSTANTS.wallet), deadline = BigInt(input.blockTimestamp + CONSTANTS.deadlineSeconds);
    const key = { currency0: CONSTANTS.currency0, currency1: ethers.getAddress(CONSTANTS.currency1),
      fee: CONSTANTS.fee, tickSpacing: CONSTANTS.tickSpacing, hooks: ethers.getAddress(CONSTANTS.hook) };
    const coder = ethers.AbiCoder.defaultAbiCoder(), manager = new ethers.Interface(POSITION_MANAGER_ABI);
    const params = [
      coder.encode([POOL_KEY_TYPE, 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'],
        [key, CONSTANTS.tickLower, CONSTANTS.tickUpper, liquidity, budget.amount0Max, budget.amount1Max, wallet, '0x']),
      coder.encode(['address', 'address'], [key.currency0, key.currency1]),
      coder.encode(['address', 'address'], [key.currency0, wallet]),
    ];
    const unlockData = coder.encode(['bytes', 'bytes[]'], ['0x020d14', params]);
    const mintData = manager.encodeFunctionData('modifyLiquidities', [unlockData, deadline]);
    const mintCalls = input.initialized ? [mintData] : [manager.encodeFunctionData('initializePool', [key, quotePrice]), mintData];
    const transaction = (kind, to, data, value = 0n) => ({ kind, chainId: CONSTANTS.chainId, from: wallet, to: ethers.getAddress(to), data, value });
    const erc20 = new ethers.Interface(ERC20_ABI), permit2 = new ethers.Interface(PERMIT2_ABI);
    const currentApproval = uint(input.currentErc20Allowance ?? 0n, 'Current ERC20 allowance');
    const approvals = [];
    if (currentApproval !== budget.amount1Max) {
      if (currentApproval > 0n) approvals.push(transaction('reset_token_allowance', key.currency1, erc20.encodeFunctionData('approve', [CONSTANTS.permit2, 0n])));
      approvals.push(transaction('approve_token_exact_cap', key.currency1, erc20.encodeFunctionData('approve', [CONSTANTS.permit2, budget.amount1Max])));
    }
    // Always replace the spender allowance with the exact cap and this plan's 15-minute expiry.
    approvals.push(transaction('approve_position_manager_exact_cap', CONSTANTS.permit2,
      permit2.encodeFunctionData('approve', [key.currency1, CONSTANTS.positionManager, budget.amount1Max, deadline])));
    const mintTransaction = transaction(input.initialized ? 'mint_liquidity' : 'initialize_and_mint_liquidity', CONSTANTS.positionManager,
      input.initialized ? mintData : manager.encodeFunctionData('multicall', [mintCalls]), budget.amount0Max);
    return stringify({ schema_version: 1, status: 'PREPARED_UNSIGNED_NOT_BROADCAST', chain_id: CONSTANTS.chainId,
      wallet, recipient: wallet, refund_recipient: wallet, observed_block: input.observedBlock ?? null,
      pool_manager: ethers.getAddress(CONSTANTS.poolManager), position_manager: ethers.getAddress(CONSTANTS.positionManager),
      permit2: ethers.getAddress(CONSTANTS.permit2), pool_key: key,
      pool_id: ethers.keccak256(coder.encode([POOL_KEY_TYPE], [key])), initialized: input.initialized,
      quote_sqrt_price_x96: quotePrice, planned_sqrt_price_x96: price,
      maximum_usd_each: CONSTANTS.maximumUsdEach, maximum_total_usd: '200', gas_additional: true,
      prices: {
        eth_usd: { ...budget.ethPrice, decimal: decimalString(budget.ethPrice.numerator, budget.ethPrice.denominator, 18) },
        ghost_usd: { ...budget.ghostUsd, decimal: decimalString(budget.ghostUsd.numerator, budget.ghostUsd.denominator, 24) },
        ghost_per_eth: { ...budget.ghostPerEth, decimal: decimalString(budget.ghostPerEth.numerator, budget.ghostPerEth.denominator, 18) },
      },
      liquidity: { units: liquidity, tick_lower: CONSTANTS.tickLower, tick_upper: CONSTANTS.tickUpper,
        range: 'full_range', slippage_bps: CONSTANTS.slippageBps, sqrt_price_lower: lower, sqrt_price_upper: upper,
        amount0_max: budget.amount0Max, amount1_max: budget.amount1Max,
        expected_amount0: estimate.amount0, expected_amount1: estimate.amount1,
        expected_unused_amount0: budget.amount0Max - estimate.amount0,
        expected_unused_amount1: budget.amount1Max - estimate.amount1 },
      deadline, allowance_expiration: deadline, actions: '0x020d14', approvals,
      unsigned_mint_transaction: mintTransaction,
      cleanup_transactions: [transaction('revoke_position_manager_allowance', CONSTANTS.permit2,
        permit2.encodeFunctionData('approve', [key.currency1, CONSTANTS.positionManager, 0n, 0n])),
      transaction('revoke_token_allowance', key.currency1, erc20.encodeFunctionData('approve', [CONSTANTS.permit2, 0n]))],
      notes: ['All values are quote-time maximums; gas is additional.',
        'Actual liquidity may use less than either maximum. Unused native ETH is swept to the confirmed wallet; unspent GH0ST remains there.',
        'The fixed liquidity amount and both token caps constrain execution. Refresh price, balances, deployment verification and gas before signing.',
        'Approval transactions do not mint liquidity. The position NFT is minted only by the final confirmed transaction.'],
      sources: ['https://developers.uniswap.org/docs/protocols/v4/deployments',
        'https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/mint-position',
        'https://developers.uniswap.org/docs/protocols/v4/guides/create-pool',
        'https://github.com/Uniswap/v4-periphery/blob/main/src/libraries/LiquidityAmounts.sol',
        'https://github.com/Uniswap/permit2/blob/main/src/interfaces/IAllowanceTransfer.sol'],
    });
  }
  return Object.freeze({ CONSTANTS, POOL_KEY_TYPE, POSITION_MANAGER_ABI, PERMIT2_ABI, ERC20_ABI,
    decimalFraction, decimalString, integerSqrt, sqrtRatioAtTick, liquidityForAmounts, amountsForLiquidity,
    quoteBudgets, priceBounds, buildPlan });
});
