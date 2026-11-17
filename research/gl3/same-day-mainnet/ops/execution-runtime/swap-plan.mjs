import { AbiCoder, Interface, Transaction, getAddress, formatEther, keccak256 } from "ethers";

export const SWAP_OWNER = "0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6";
export const SWAP_ROUTE_ID = "pons-native-exact-input-v1";
export const SWAP_ROUTER = "0x204FAca1764B154221e35c0d20aBb3c525710498";
export const SWAP_ROUTER_HASH = "0x76b92a5bba2dd32019a64eb421f1750e78c6ba044dbfa6840b722eb5ac63d296";
export const SWAP_POOL_ID = "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01";
export const SWAP_INPUT_WEI = 10_000_000_000_000n;
export const SWAP_GAS_CAP = 9_000_000n;
export const SWAP_FEE_CAP_WEI = 100_000_000n;
export const SWAP_QUOTE_TTL_MS = 120_000;
export const SWAP_DEADLINE_SECONDS = 120;
export const SWAP_HOOK_DATA = "0x";
export const SWAP_HOOK_FEE_BPS = 100;
export const SWAP_CREATOR_TAX_BPS = 150;
export const SWAP_KEY = Object.freeze({
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559", fee: 0, tickSpacing: 200,
  hooks: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044",
});
export const SWAP_CONTRACTS = Object.freeze({
  manager: Object.freeze({ address: "0x8366a39cc670b4001a1121b8f6a443a643e40951", codeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626" }),
  router: Object.freeze({ address: SWAP_ROUTER, codeHash: SWAP_ROUTER_HASH }),
  quoter: Object.freeze({ address: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94", codeHash: "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6" }),
  stateView: Object.freeze({ address: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b", codeHash: "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6" }),
  token: Object.freeze({ address: SWAP_KEY.currency1, codeHash: "0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164" }),
  hook: Object.freeze({ address: SWAP_KEY.hooks, codeHash: "0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db" }),
});
export const KEY_TYPE = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export const SWAP_ABI = Object.freeze({
  router: ["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable", "function poolManager() view returns (address)"],
  managerLink: ["function poolManager() view returns (address)"],
  token: ["function decimals() view returns (uint8)"],
  state: ["function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)", "function getLiquidity(bytes32 poolId) view returns (uint128)"],
  quoter: [`function quoteExactInputSingle(tuple(${KEY_TYPE} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`],
});
const router = new Interface(SWAP_ABI.router);
const coder = AbiCoder.defaultAbiCoder();
if (keccak256(coder.encode([KEY_TYPE], [SWAP_KEY])) !== SWAP_POOL_ID)
  throw Error("Pinned Pons key does not hash to the selected pool");

// The hook deducts two independently rounded fees from exact-input output.
// Compare the quote with a spot output after those fees, not with gross output.
export function ponsPriceImpact(sqrtPriceX96, amountOut) {
  const sqrt = BigInt(sqrtPriceX96), output = BigInt(amountOut);
  if (sqrt <= 0n || sqrt >= 1n << 160n || output <= 0n)
    throw Error("Invalid Pons price or output");
  const gross = SWAP_INPUT_WEI * sqrt * sqrt / (1n << 192n);
  const net = gross - gross * BigInt(SWAP_HOOK_FEE_BPS) / 10000n -
    gross * BigInt(SWAP_CREATOR_TAX_BPS) / 10000n;
  if (net <= 0n) throw Error("Pons spot output is zero");
  const impact = output >= net ? 0n : ((net - output) * 10000n + net - 1n) / net;
  return { spotOutputBeforeFees: gross.toString(), spotOutputAfterFees: net.toString(),
    priceImpactBps: Number(impact) };
}

// Fixed Universal Router 2.1.2 native-buy path. TAKE_ALL pays the original
// caller; the final SWEEP refunds any unspent native input to this same owner.
export function pinnedBuyCalldata(minimumOutput, deadline) {
  const minimum = BigInt(minimumOutput);
  if (minimum <= 0n || minimum >= 1n << 128n || BigInt(deadline) <= 0n)
    throw Error("Invalid fixed-route output bound or deadline");
  const swap = coder.encode([
    `tuple(${KEY_TYPE} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`,
  ], [[SWAP_KEY, true, SWAP_INPUT_WEI, minimum, 0n, SWAP_HOOK_DATA]]);
  const v4 = coder.encode(["bytes", "bytes[]"], ["0x060c0f", [swap,
    coder.encode(["address", "uint256"], [SWAP_KEY.currency0, SWAP_INPUT_WEI]),
    coder.encode(["address", "uint256"], [SWAP_KEY.currency1, minimum])]]);
  const sweep = coder.encode(["address", "address", "uint256"], [SWAP_KEY.currency0, SWAP_OWNER, 0n]);
  return router.encodeFunctionData("execute", ["0x1004", [v4, sweep], BigInt(deadline)]);
}

export function validatePonsWitness(plan) {
  if (plan.routeId !== SWAP_ROUTE_ID || plan.poolId !== SWAP_POOL_ID ||
      plan.hookData !== SWAP_HOOK_DATA || Object.hasOwn(plan, "engineSourceSha256"))
    throw Error("Plan is not the explicitly selected fixed Pons route");
  const key = plan.poolKey;
  if (!key || getAddress(key.currency0) !== getAddress(SWAP_KEY.currency0) ||
      getAddress(key.currency1) !== getAddress(SWAP_KEY.currency1) ||
      getAddress(key.hooks) !== getAddress(SWAP_KEY.hooks) || key.fee !== 0 || key.tickSpacing !== 200)
    throw Error("Pons PoolKey differs from the selected pool");
  if (!plan.contracts || Object.keys(plan.contracts).length !== Object.keys(SWAP_CONTRACTS).length)
    throw Error("Pons route is missing its contract code pins");
  for (const [name, expected] of Object.entries(SWAP_CONTRACTS)) {
    const actual = plan.contracts[name];
    if (!actual || getAddress(actual.address) !== getAddress(expected.address) || actual.codeHash !== expected.codeHash)
      throw Error(`Pons ${name} code pin differs`);
    if (["router", "quoter", "stateView", "hook"].includes(name) &&
        getAddress(actual.poolManager) !== getAddress(SWAP_CONTRACTS.manager.address))
      throw Error(`Pons ${name} points at another pool manager`);
  }
}

export function validateSwapPlan(plan) {
  validatePonsWitness(plan);
  if (plan.schema !== "gh0st-manual-rh-v1" || plan.operation !== "swap" || plan.broadcast !== false ||
      String(plan.chainId) !== "4663" || getAddress(plan.owner) !== SWAP_OWNER ||
      getAddress(plan.router) !== SWAP_ROUTER || plan.routerCodeHash !== SWAP_ROUTER_HASH ||
      plan.slippageBps !== 50 || BigInt(plan.amountInWei) !== SWAP_INPUT_WEI ||
      !Array.isArray(plan.approvalTransactions) || plan.approvalTransactions.length !== 0 ||
      plan.simulation?.success !== true)
    throw Error("Swap plan differs from the authorized fixed Pons small-buy route");
  const quote = plan.quote, block = plan.sourceBlock;
  if (!quote || !block || !Number.isSafeInteger(block.number) || block.number < 0 ||
      !/^0x[0-9a-fA-F]{64}$/.test(block.hash ?? "") || !Number.isSafeInteger(block.timestamp) ||
      BigInt(quote.amountOut) <= 0n || BigInt(quote.amountOut) >= 1n << 128n ||
      BigInt(quote.minimumOutput) !== BigInt(quote.amountOut) * 9950n / 10000n ||
      BigInt(quote.minimumOutput) <= 0n || quote.poolId !== SWAP_POOL_ID || quote.hookData !== SWAP_HOOK_DATA ||
      quote.zeroForOne !== true || BigInt(quote.amountIn) !== SWAP_INPUT_WEI || quote.slippageBps !== 50 ||
      quote.blockNumber !== block.number || !Number.isSafeInteger(quote.createdAt) ||
      !Number.isSafeInteger(quote.deadline) || !Number.isSafeInteger(plan.quoteExpiresAt) ||
      plan.quoteExpiresAt !== quote.createdAt + SWAP_QUOTE_TTL_MS ||
      quote.deadline !== block.timestamp + SWAP_DEADLINE_SECONDS ||
      Math.abs(block.timestamp * 1000 - quote.createdAt) > SWAP_QUOTE_TTL_MS ||
      quote.hookFeeBps !== SWAP_HOOK_FEE_BPS || quote.creatorTaxBps !== SWAP_CREATOR_TAX_BPS ||
      !Number.isInteger(quote.priceImpactBps) || quote.priceImpactBps < 0 || quote.priceImpactBps > 100)
    throw Error("Pons quote, 0.5% minimum output or 120-second deadline is invalid");
  const pricing = ponsPriceImpact(quote.sqrtPriceX96, quote.amountOut);
  if (Object.entries(pricing).some(([key, value]) => quote[key] !== value) ||
      !plan.poolState || plan.poolState.sqrtPriceX96 !== quote.sqrtPriceX96 ||
      BigInt(plan.poolState.liquidity) <= 0n || plan.poolState.protocolFee !== 0 ||
      plan.poolState.lpFee !== 0 || plan.poolState.registered !== true ||
      plan.poolState.hookFeeBps !== SWAP_HOOK_FEE_BPS ||
      plan.poolState.creatorTaxBps !== SWAP_CREATOR_TAX_BPS)
    throw Error("Pons output-fee or price-impact witness differs from the quote");
  const entry = plan.swap, request = entry?.walletRequest;
  if (request?.method !== "eth_sendTransaction" || request.params?.length !== 1)
    throw Error("Swap must contain exactly one wallet transaction");
  const tx = request.params[0];
  const allowed = new Set(["from", "to", "data", "value", "type", "chainId", "nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas"]);
  if (Object.keys(tx).some(key => !allowed.has(key)) || getAddress(tx.from) !== SWAP_OWNER ||
      getAddress(tx.to) !== SWAP_ROUTER || BigInt(tx.value) !== SWAP_INPUT_WEI ||
      BigInt(tx.chainId) !== 4663n || BigInt(tx.type) !== 2n ||
      tx.data !== pinnedBuyCalldata(quote.minimumOutput, quote.deadline))
    throw Error("Swap transaction changes the fixed Pons input, router, pool, recipient or calldata");
  const unsigned = Transaction.from(entry.unsignedSerialized);
  if (unsigned.signature || unsigned.unsignedHash !== entry.unsignedHash || unsigned.chainId !== 4663n ||
      unsigned.data !== tx.data || unsigned.to !== SWAP_ROUTER || unsigned.value !== SWAP_INPUT_WEI ||
      unsigned.nonce !== Number(BigInt(tx.nonce)) || unsigned.gasLimit !== BigInt(tx.gas) ||
      unsigned.maxFeePerGas !== BigInt(tx.maxFeePerGas) || unsigned.maxPriorityFeePerGas !== BigInt(tx.maxPriorityFeePerGas) ||
      unsigned.gasLimit <= 0n || unsigned.gasLimit > SWAP_GAS_CAP || unsigned.maxFeePerGas <= 0n ||
      unsigned.maxFeePerGas > SWAP_FEE_CAP_WEI || unsigned.maxPriorityFeePerGas < 0n ||
      unsigned.maxPriorityFeePerGas > unsigned.maxFeePerGas)
    throw Error("Swap serialization or gas/fee bounds differ from the reviewed plan");
  const maxCostWei = unsigned.gasLimit * unsigned.maxFeePerGas;
  return [{ id: 0, kind: "swap", label: "Buy GH0ST through Pons with exactly 0.00001 ETH",
    transaction: tx, unsignedHash: entry.unsignedHash, destination: SWAP_ROUTER, nonce: unsigned.nonce,
    maxCostWei, maxCostEth: formatEther(maxCostWei), valueEth: "0.00001", poolId: SWAP_POOL_ID,
    quoteExpiresAt: plan.quoteExpiresAt, deadline: quote.deadline, routerCodeHash: SWAP_ROUTER_HASH,
    routeId: SWAP_ROUTE_ID, answer: null }];
}

export function assertSwapQuoteFresh(action, now = Date.now()) {
  if (action.kind !== "swap") return;
  if (!Number.isSafeInteger(action.quoteExpiresAt) || now >= action.quoteExpiresAt ||
      now < action.quoteExpiresAt - SWAP_QUOTE_TTL_MS - 5000 || now >= action.deadline * 1000)
    throw Error("Swap quote expired. Regenerate the exact Pons small-buy plan before signing.");
}
