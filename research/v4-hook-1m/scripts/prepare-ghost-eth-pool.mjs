// Read-only pair preparation. Exports exact integer price helpers for independent tests.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder, Contract, Interface, JsonRpcProvider, ZeroAddress, getAddress, keccak256, toBeHex } from 'ethers';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;
export const INITIALIZE_ABI = [
  'function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) returns (int24 tick)',
];
const abi = AbiCoder.defaultAbiCoder();

export function integerSqrt(value) {
  assert(value >= 0n, 'Cannot take a negative square root');
  if (value < 2n) return value;
  let result = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (result + value / result) >> 1n;
    if (next >= result) return result;
    result = next;
  }
}

export function decimalFraction(text) {
  assert(typeof text === 'string' && text.length <= 120 && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text),
    'Price must be a positive ordinary decimal string in GHOST per ETH, without exponent notation');
  const [whole, fraction = ''] = text.split('.');
  const numerator = BigInt(whole + fraction), denominator = 10n ** BigInt(fraction.length);
  assert(numerator > 0n, 'Price must be greater than zero');
  return { numerator, denominator };
}

export function ghostPerEthToSqrtPriceX96(text, ghostDecimals) {
  assert(Number.isInteger(ghostDecimals) && ghostDecimals >= 0 && ghostDecimals <= 255, 'Invalid token decimals');
  const { numerator, denominator } = decimalFraction(text);
  // Raw ratio = human GHOST/ETH * 10^GHOST_decimals / 10^18 native wei.
  const rawNumerator = numerator * 10n ** BigInt(ghostDecimals);
  const rawDenominator = denominator * 10n ** 18n;
  const sqrtPriceX96 = integerSqrt((rawNumerator << 192n) / rawDenominator);
  assert(sqrtPriceX96 >= MIN_SQRT_PRICE && sqrtPriceX96 < MAX_SQRT_PRICE, 'Price is outside v4 TickMath bounds');
  return sqrtPriceX96;
}

export function ghostEthPoolKey(token, hook, fee = 3000, tickSpacing = 60) {
  assert(Number.isInteger(fee) && fee >= 0 && fee < 1_000_000, 'Use a valid static LP fee below 100%');
  assert(Number.isInteger(tickSpacing) && tickSpacing >= 1 && tickSpacing <= 32767, 'Invalid tick spacing');
  const currency1 = getAddress(token), hooks = getAddress(hook);
  assert(currency1 !== ZeroAddress, 'GHOST token cannot be the native currency');
  assert((BigInt(hooks) & 0x3fffn) === 0x1040n, 'Hook permissions must be afterInitialize and afterSwap (0x1040)');
  return { currency0: ZeroAddress, currency1, fee, tickSpacing, hooks };
}

export function poolIdFor(key) {
  return keccak256(abi.encode(['address', 'address', 'uint24', 'int24', 'address'],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}

export function decodePoolSlot0(word) {
  const value = BigInt(word), rawTick = Number((value >> 160n) & 0xffffffn);
  return { sqrt_price_x96: (value & ((1n << 160n) - 1n)).toString(),
    tick: rawTick >= 0x800000 ? rawTick - 0x1000000 : rawTick,
    protocol_fee: Number((value >> 184n) & 0xffffffn), lp_fee: Number((value >> 208n) & 0xffffffn) };
}

export function initializationTransaction(manager, key, sqrtPriceX96, sender, chainId = 4663) {
  assert(sqrtPriceX96 >= MIN_SQRT_PRICE && sqrtPriceX96 < MAX_SQRT_PRICE, 'Price is outside v4 TickMath bounds');
  return { chainId, from: getAddress(sender), to: getAddress(manager),
    data: new Interface(INITIALIZE_ABI).encodeFunctionData('initialize', [key, sqrtPriceX96]), value: '0' };
}

export async function preparePair(argv = process.argv.slice(2)) {
  const option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const configPath = path.resolve(base, option('--config', 'deployment/ghost-eth-pool.json'));
  const config = JSON.parse(readFileSync(configPath));
  const deployment = JSON.parse(readFileSync(path.join(base, 'deployment/robinhood-mainnet-plan.json')));
  const key = ghostEthPoolKey(config.currency1, config.hook, Number(option('--fee', config.fee)),
    Number(option('--tick-spacing', config.tick_spacing)));
  const poolId = poolIdFor(key), rpcURL = option('--rpc', config.rpc_url);
  const provider = new JsonRpcProvider(rpcURL, undefined, { batchMaxCount: 1 });
  try {
    const network = await provider.getNetwork();
    assert.equal(network.chainId, BigInt(config.chain_id), 'RPC chain mismatch');
    const block = await provider.getBlock('latest');
    const manager = new Contract(config.pool_manager, ['function extsload(bytes32 slot) view returns (bytes32)'], provider);
    const token = new Contract(key.currency1, ['function decimals() view returns (uint8)',
      'function symbol() view returns (string)', 'function name() view returns (string)'], provider);
    const stateSlot = keccak256(abi.encode(['bytes32', 'uint256'], [poolId, 6]));
    const [managerCode, hookCode, modelCode, tokenCode, decimals, symbol, name, rawSlot] = await Promise.all([
      provider.getCode(config.pool_manager, block.number), provider.getCode(key.hooks, block.number),
      provider.getCode(deployment.model_address, block.number), provider.getCode(key.currency1, block.number),
      token.decimals({ blockTag: block.number }), token.symbol({ blockTag: block.number }),
      token.name({ blockTag: block.number }), manager.extsload(stateSlot, { blockTag: block.number }),
    ]);
    assert.equal(keccak256(managerCode), deployment.dependencies.pool_manager_code_hash, 'Canonical manager code mismatch');
    assert.notEqual(tokenCode, '0x', 'GHOST token has no code');
    if (config.currency1_runtime_code_hash)
      assert.equal(keccak256(tokenCode), config.currency1_runtime_code_hash, 'Token runtime changed');
    if (config.currency1_decimals !== null) assert.equal(Number(decimals), config.currency1_decimals, 'Token decimals changed');
    const expectedHook = deployment.transactions.find(tx => tx.kind === 'hook');
    const expectedModel = deployment.transactions.find(tx => tx.kind === 'model');
    const dependencies = { hook_deployed: hookCode !== '0x', model_deployed: modelCode !== '0x' };
    if (dependencies.hook_deployed) assert.equal(keccak256(hookCode), expectedHook.runtime_code_hash, 'Unexpected hook code');
    if (dependencies.model_deployed) assert.equal(keccak256(modelCode), expectedModel.runtime_code_hash, 'Unexpected model code');
    const poolState = decodePoolSlot0(rawSlot), initialized = BigInt(poolState.sqrt_price_x96) !== 0n;
    const price = option('--ghost-per-eth', config.initial_price_ghost_per_eth);
    const missing = [];
    if (!dependencies.model_deployed) missing.push('Deploy and verify the planned model.');
    if (!dependencies.hook_deployed) missing.push('Deploy and verify the planned hook and all model dependencies.');
    if (!price && !initialized) missing.push('Supply the initial GHOST-per-ETH price selected by the user.');
    let transaction = null, sqrtPrice = null, estimate = null;
    if (price && !initialized) {
      sqrtPrice = ghostPerEthToSqrtPriceX96(String(price), Number(decimals));
      transaction = initializationTransaction(config.pool_manager, key, sqrtPrice, deployment.sender.address, config.chain_id);
      if (dependencies.hook_deployed && dependencies.model_deployed)
        estimate = (await provider.estimateGas({ ...transaction, value: 0n })).toString();
    }
    const result = {
      schema_version: 1,
      status: initialized ? 'POOL_ALREADY_INITIALIZED' : missing.length ? 'PENDING_USER_INPUT_OR_DEPLOYMENT' : 'PREPARED_UNSIGNED_NOT_BROADCAST',
      chain_id: config.chain_id, observed_block: { number: block.number, hash: block.hash, timestamp: block.timestamp },
      token: { address: key.currency1, name, symbol, decimals: Number(decimals), runtime_code_hash: keccak256(tokenCode) },
      pool_manager: getAddress(config.pool_manager), hook: key.hooks, model: deployment.model_address,
      pool_key: key, pool_id: poolId, pool_state: poolState, already_initialized: initialized, dependencies,
      initial_price_ghost_per_eth: price ?? null, sqrt_price_x96: sqrtPrice?.toString() ?? null,
      fee_note: `${key.fee} pips (${key.fee / 10_000}%) static LP fee; tick spacing ${key.tickSpacing}.`,
      unsigned_initialize_transaction: transaction, public_gas_estimate: estimate, missing_requirements: missing,
      liquidity: { status: 'NOT_CONFIGURED', maximum_eth: null, maximum_ghost: null, tick_range: null,
        note: 'No liquidity amounts, token approvals, transfers or swaps are generated without user-supplied budgets and range.' },
      notes: ['Native ETH is currency0; GHOST is currency1. WETH is not used.',
        'Initializing a pool only sets its initial price. It does not fund the pool.',
        'Anyone can initialize this pool key; recheck live state immediately before signing. An initialized pool cannot be reinitialized.',
        'Changing fee, tick spacing or hook changes the pool ID and creates a different pool.'],
    };
    const out = path.resolve(base, option('--out', 'deployment/ghost-eth-pool-readiness.json'));
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ status: result.status, file: out, token: result.token, pool_id: poolId,
      dependencies, already_initialized: initialized, missing_requirements: missing }, null, 2));
    return result;
  } finally { await provider.destroy(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await preparePair();
