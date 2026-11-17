// Address discovery uses the existing Watcher source and official Robinhood
// token docs. Every price, balance and identity check below is a parent RPC read.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AbiCoder, Interface, keccak256, formatUnits, toBeHex, ZeroAddress } from '/root/dispute/node_modules/ethers/lib.esm/index.js';
import { createReader, resolveEndpoint } from './public-reader.mjs';

export const addresses = Object.freeze({
  token: '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559',
  weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  manager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  position: '0x58daec3116aae6d93017baaea7749052e8a04fa7',
  quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  hook: '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044',
});
export const poolId = '0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01';
const runtimePins = Object.freeze({
  token: '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164',
  manager: '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626',
  position: '0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2',
  quoter: '0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6',
  hook: '0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db',
});
const keyType = '(address,address,uint24,int24,address)';
const abi = new Interface([
  'function poolManager() view returns (address)',
  'function poolKeys(bytes25) view returns (address,address,uint24,int24,address)',
  'function extsload(bytes32) view returns (bytes32)',
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  `function quoteExactInputSingle((${keyType},bool,uint128,bytes)) returns (uint256,uint256)`,
  `function quoteExactOutputSingle((${keyType},bool,uint128,bytes)) returns (uint256,uint256)`,
  'function launches(bytes32) view returns (bool registered,bool memecoinIsCurrency0,address memecoin,address quoteToken,address creator,address buybackCreatorRecipient,address protocolFeeRecipient,uint16 creatorTaxBps,uint16 protocolFeeShareBps,uint16 buybackBurnBps,uint16 hookFeeBps,uint16 maxInternalPriceImpactBps,bool buybackEnabled)',
]);
const coder = AbiCoder.defaultAbiCoder();
const Q96 = 1n << 96n, Q192 = 1n << 192n, SCALE = 10n ** 18n;
const equal = (a, b) => a.toLowerCase() === b.toLowerCase();
const json = value => JSON.stringify(value, (_, x) => typeof x === 'bigint' ? String(x) : x, 2) + '\n';
export function decodeSlot0(word) {
  const value = BigInt(word), unsignedTick = (value >> 160n) & 0xffffffn;
  return { sqrtPriceX96: value & ((1n << 160n) - 1n),
    tick: Number(unsignedTick >= 0x800000n ? unsignedTick - 0x1000000n : unsignedTick),
    protocolFee: Number((value >> 184n) & 0xffffffn), lpFee: Number((value >> 208n) & 0xffffffn) };
}
export function rateAndVirtualReserves(sqrtPriceX96, liquidity) {
  const sqrt = BigInt(sqrtPriceX96), l = BigInt(liquidity);
  if (sqrt <= 0n || l <= 0n) throw Error('Pool has no positive price and active liquidity');
  return { gh0stPerEthX18: sqrt * sqrt * SCALE / Q192,
    virtualEthWei: l * Q96 / sqrt, virtualGh0stUnits: l * sqrt / Q96 };
}
export async function readMarket(read, endpointSource) {
  if (BigInt(await read('eth_chainId')) !== 4663n) throw Error('Wrong parent chain');
  const head = BigInt(await read('eth_blockNumber'));
  const tag = '0x' + (head - 12n).toString(16);
  const block = await read('eth_getBlockByNumber', [tag, false]);
  async function call(to, name, args = []) {
    return abi.decodeFunctionResult(name, await read('eth_call', [{ to, data: abi.encodeFunctionData(name, args) }, tag]));
  }
  const contracts = {};
  const codeReads = await Promise.allSettled(Object.entries(addresses).map(async ([name, address]) => {
    const code = await read('eth_getCode', [address, tag]);
    if (code === '0x') throw Error('Required contract missing');
    const hash = keccak256(code), expected = runtimePins[name];
    if (expected && hash !== expected) throw Error('Runtime identity mismatch');
    return [name, { address, runtimeBytes: (code.length - 2) / 2, runtimeKeccak256: hash,
      matchesHistoricalRuntimePin: expected ? hash === expected : null,
      officialAddressSource: name === 'weth' ? 'https://docs.robinhood.com/chain/contracts/' : null }];
  }));
  for (const result of codeReads) {
    if (result.status !== 'fulfilled') throw Error('Contract runtime check failed');
    contracts[result.value[0]] = result.value[1];
  }
  const mapped = await call(addresses.position, 'poolKeys', [poolId.slice(0, 52)]);
  const key = [mapped[0], mapped[1], Number(mapped[2]), Number(mapped[3]), mapped[4]];
  if (keccak256(coder.encode([keyType], [key])) !== poolId || key[0] !== ZeroAddress ||
      !equal(key[1], addresses.token) || !equal(key[4], addresses.hook)) throw Error('Pool key mismatch');
  const stateSlot = keccak256(coder.encode(['bytes32', 'uint256'], [poolId, 6n]));
  const liquiditySlot = toBeHex(BigInt(stateSlot) + 3n, 32);
  const reads = await Promise.allSettled([
    call(addresses.manager, 'extsload', [stateSlot]), call(addresses.manager, 'extsload', [liquiditySlot]),
    call(addresses.hook, 'launches', [poolId]),
    call(addresses.position, 'poolManager'), call(addresses.quoter, 'poolManager'),
    call(addresses.token, 'decimals'), call(addresses.weth, 'decimals'),
    call(addresses.weth, 'name'), call(addresses.weth, 'symbol'), call(addresses.weth, 'totalSupply'),
    read('eth_getBalance', [addresses.weth, tag]),
    call(addresses.token, 'balanceOf', [addresses.manager]), read('eth_getBalance', [addresses.manager, tag]),
  ]);
  if (reads.some(x => x.status !== 'fulfilled')) throw Error('Pool or WETH read failed');
  const [raw0, rawL, launch, positionManager, quoterManager, tokenDecimals, wethDecimals, wethName, wethSymbol,
    wethSupply, wethUnderlyingEth, singletonTokenBalance, singletonEthBalance] = reads.map(x => x.value);
  if (!equal(positionManager[0], addresses.manager) || !equal(quoterManager[0], addresses.manager) ||
    !launch.registered || launch.memecoinIsCurrency0 || !equal(launch.memecoin, addresses.token) ||
    launch.quoteToken !== ZeroAddress || Number(tokenDecimals[0]) !== 18 || Number(wethDecimals[0]) !== 18) {
    throw Error('Pool references or token metadata mismatch');
  }
  const slot0 = decodeSlot0(raw0[0]), liquidity = BigInt(rawL[0]) & ((1n << 128n) - 1n);
  const derived = rateAndVirtualReserves(slot0.sqrtPriceX96, liquidity);
  // Independent eth_call quotations. No persisted swap or state override is used.
  const referenceCostWei = 10n ** 15n;
  const referenceGh0st = referenceCostWei * derived.gh0stPerEthX18 / SCALE;
  const quotes = [];
  for (const [direction, zeroForOne, amount] of [
    ['ETH to GH0ST', true, referenceCostWei], ['GH0ST to ETH', false, referenceGh0st],
  ]) {
    try {
      const [output, quotedGas] = await call(addresses.quoter, 'quoteExactInputSingle', [[key, zeroForOne, amount, '0x']]);
      if (output <= 0n) throw Error('No output');
      quotes.push({ direction, status: 'quoted', inputUnits: amount, outputUnits: output,
        quotedExecutionGas: quotedGas, persistsState: false,
        effectiveGh0stPerEthX18: zeroForOne ? output * SCALE / amount : amount * SCALE / output,
        feeAndImpactBpsVersusSpot: zeroForOne
          ? (referenceGh0st - output) * 10000n / referenceGh0st
          : (referenceCostWei - output) * 10000n / referenceCostWei });
    } catch { quotes.push({ direction, status: 'read-only quote unavailable', persistsState: false }); }
  }
  try {
    const [requiredInput, quotedGas] = await call(addresses.quoter, 'quoteExactOutputSingle', [[key, false, referenceCostWei, '0x']]);
    if (requiredInput <= 0n) throw Error('No input');
    const [crossCheckOutput] = await call(addresses.quoter, 'quoteExactInputSingle', [[key, false, requiredInput, '0x']]);
    quotes.push({ direction: 'GH0ST input for exact 0.001 ETH output', status: 'quoted',
      requestedOutputEthWei: referenceCostWei, requiredInputGh0stUnits: requiredInput,
      effectiveGh0stPerEthX18: requiredInput * SCALE / referenceCostWei,
      quotedExecutionGas: quotedGas, persistsState: false,
      exactInputCrossCheckEthOutputWei: crossCheckOutput,
      exactInputCrossCheckRecoversRequestedETH: crossCheckOutput >= referenceCostWei,
      note: 'Independent exact-output quotation includes current hook behavior and price impact, excludes transaction gas; no conversion was submitted.' });
  } catch { quotes.push({ direction: 'GH0ST input for exact 0.001 ETH output', status: 'read-only quote unavailable', persistsState: false }); }
  const checkedAtUTC = new Date().toISOString(), blockTime = Number(BigInt(block.timestamp));
  const finalBlock = await read('eth_getBlockByNumber', [tag, false]);
  if (finalBlock.hash !== block.hash) throw Error('Sampled parent block changed');
  const result = {
    scope: 'Read-only current GH0ST/ETH pool and canonical Robinhood WETH snapshot; fee-pricer research, not trading or deployment',
    checkedAtUTC, observedAtUTC: new Date(blockTime * 1000).toISOString(), endpointSource,
    chainId: 4663, blockNumber: Number(BigInt(block.number)), blockHash: block.hash,
    blockRechecked: true, finalityProven: false, contracts,
    pool: { id: poolId, key: { currency0: key[0], currency1: key[1], fee: key[2], tickSpacing: key[3], hooks: key[4] },
      identitySource: 'Current PositionManager.poolKeys(bytes25), full PoolId hash, manager references and hook registration',
      actualQuoteCurrency: 'Native ETH at address(0), not WETH; aggregator WETH labels are not used',
      stateSlot, rawSlot0: raw0[0], rawLiquiditySlot: rawL[0], ...slot0, activeLiquidity: liquidity,
      ...derived, gh0stPerEth: formatUnits(derived.gh0stPerEthX18, 18),
      virtualEth: formatUnits(derived.virtualEthWei, 18), virtualGh0st: formatUnits(derived.virtualGh0stUnits, 18),
      virtualReservesAreActualTokenBalances: false,
      actualPoolSpecificTokenReservesVerified: false,
      reserveLimit: 'Uniswap v4 singleton balances span pools. Virtual reserves describe current active-liquidity curvature, not withdrawable or pool-attributable balances.',
      singletonAggregateEthBalanceWei: BigInt(singletonEthBalance), singletonAggregateGh0stBalanceUnits: singletonTokenBalance[0],
      hook: { registered: launch.registered, creatorTaxBps: launch.creatorTaxBps, hookFeeBps: launch.hookFeeBps,
        protocolFeeShareBps: launch.protocolFeeShareBps, buybackEnabled: launch.buybackEnabled } },
    weth: { address: addresses.weth, name: wethName[0], symbol: wethSymbol[0], decimals: Number(wethDecimals[0]),
      totalSupplyUnits: wethSupply[0], contractNativeEthBalanceWei: BigInt(wethUnderlyingEth),
      fullWethImplementationAuditComplete: false,
      SDKCustomParentField: 'contracts.weth.address',
      defaultBondReference: 'SDK v3.2 stakeToken=getWethAddress(parent); baseStake=1e18; custom parent must supply its WETH address. These defaults are configurable.' },
    quotes,
    manualPricerProposal: { selected: false, automaticOracle: false, productionTWAP: false,
      spotReferenceGh0stPerEthX18: derived.gh0stPerEthX18, initialExchangeRateX18: null,
      maxSnapshotAgeSeconds: 300,
      referenceParentCostWei: referenceCostWei,
      proposedLiquidityGuard: { selected: false, minVirtualEthToReferenceParentCostRatio: 1000,
        observedRatio: derived.virtualEthWei / referenceCostWei,
        passesProposedRatio: derived.virtualEthWei >= referenceCostWei * 1000n,
        note: 'Pool depth observation only, not a bond or deposit requirement; no amount is allocated. Quotes must also succeed and price changes need review.' },
      risks: ['Spot is manipulable within one block and is not a secure oracle',
        'Hook/creator fees and market impact can make spot reimbursement insufficient',
        'A manual rate becomes stale; it must be refreshed from a canonical block before selection',
        'Active tick liquidity can change or disappear; virtual reserves are not total reserves',
        'No continuous monitoring or production freshness enforcement is deployed'] },
    credentialURLLogged: false, privateKeysLoadedOrUsed: false, transactionRequestsCreated: 0,
    transactionsSubmitted: 0, tokenApprovalsOrTransfersSubmitted: 0,
  };
  return JSON.parse(json(result));
}
async function main() {
  const { endpoint, source } = resolveEndpoint();
  const report = await readMarket(createReader(endpoint), source);
  if (process.argv.includes('--write')) writeFileSync(new URL('./snapshot.json', import.meta.url), json(report));
  console.log(json(report));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Read-only market preflight failed; no swap, approval, transfer or deployment was submitted.'); process.exitCode = 1; });
}
