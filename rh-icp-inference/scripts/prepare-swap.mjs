import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as ethers from "ethers";
import { paddedGas } from "./manual-rh-core.mjs";
import { SWAP_OWNER, SWAP_INPUT_WEI, SWAP_GAS_CAP, SWAP_FEE_CAP_WEI, SWAP_POOL_ID,
  SWAP_ROUTE_ID, SWAP_KEY, SWAP_CONTRACTS, SWAP_ABI, SWAP_HOOK_DATA, SWAP_QUOTE_TTL_MS,
  SWAP_DEADLINE_SECONDS, SWAP_HOOK_FEE_BPS, SWAP_CREATOR_TAX_BPS,
  ponsPriceImpact, pinnedBuyCalldata, validateSwapPlan } from "./swap-plan.mjs";

const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
const interfaces = Object.fromEntries(Object.entries(SWAP_ABI).map(([name, abi]) => [name, new ethers.Interface(abi)]));
const launchInterface = new ethers.Interface(["function launches(bytes32 poolId) view returns (bool registered,bool memecoinIsCurrency0,address memecoin,address quoteToken,address creator,address buybackCreatorRecipient,address protocolFeeRecipient,uint16 creatorTaxBps,uint16 protocolFeeShareBps,uint16 buybackBurnBps,uint16 hookFeeBps,uint16 maxInternalPriceImpactBps,bool buybackEnabled)"]);

async function callAt(provider, target, iface, method, args, blockNumber, extra = {}) {
  const value = await provider.call({ to: target, data: iface.encodeFunctionData(method, args), blockTag: blockNumber, ...extra });
  return iface.decodeFunctionResult(method, value);
}

export async function prepareSwapPlan(provider, { amountEth, feeCapGwei, poolId }) {
  if (poolId !== SWAP_POOL_ID) throw Error(`This pilot requires explicit Pons --pool-id ${SWAP_POOL_ID}`);
  if (amountEth !== "0.00001") throw Error("This pilot authorizes exactly --amount-eth 0.00001");
  const feeCap = ethers.parseUnits(String(feeCapGwei), "gwei");
  if (feeCap <= 0n || feeCap > SWAP_FEE_CAP_WEI) throw Error("Fee cap must be positive and at most 0.1 gwei");
  if (BigInt(await provider.send("eth_chainId", [])) !== 4663n) throw Error("Read provider is on the wrong chain");
  const block = await provider.getBlock("latest");
  if (!block || Date.now() - block.timestamp * 1000 > SWAP_QUOTE_TTL_MS || block.timestamp * 1000 - Date.now() > 5000)
    throw Error("The RH source block is stale or future-dated");
  const b = block.number;
  const contracts = Object.fromEntries(await Promise.all(Object.entries(SWAP_CONTRACTS).map(async ([name, pin]) => {
    const code = await provider.getCode(pin.address, b);
    if (code === "0x" || ethers.keccak256(code) !== pin.codeHash) throw Error(`Pons ${name} code verification failed`);
    const result = { address: pin.address, codeHash: pin.codeHash };
    if (["router", "quoter", "stateView", "hook"].includes(name)) {
      const [manager] = await callAt(provider, pin.address, interfaces.managerLink, "poolManager", [], b);
      if (ethers.getAddress(manager) !== ethers.getAddress(SWAP_CONTRACTS.manager.address))
        throw Error(`Pons ${name} points to another pool manager`);
      result.poolManager = manager;
    }
    return [name, result];
  })));
  const [slot, [liquidity], [decimals], launch] = await Promise.all([
    callAt(provider, SWAP_CONTRACTS.stateView.address, interfaces.state, "getSlot0", [SWAP_POOL_ID], b),
    callAt(provider, SWAP_CONTRACTS.stateView.address, interfaces.state, "getLiquidity", [SWAP_POOL_ID], b),
    callAt(provider, SWAP_CONTRACTS.token.address, interfaces.token, "decimals", [], b),
    callAt(provider, SWAP_CONTRACTS.hook.address, launchInterface, "launches", [SWAP_POOL_ID], b),
  ]);
  if (slot[0] <= 0n || liquidity <= 0n) throw Error("The selected Pons pool has no active liquidity");
  if (Number(decimals) !== 18 || Number(slot[2]) !== 0 || Number(slot[3]) !== 0)
    throw Error("Pons token decimals or pool-level fees differ from this route");
  if (!launch.registered || launch.memecoinIsCurrency0 ||
      ethers.getAddress(launch.memecoin) !== ethers.getAddress(SWAP_KEY.currency1) ||
      ethers.getAddress(launch.quoteToken) !== ethers.getAddress(SWAP_KEY.currency0) ||
      Number(launch.hookFeeBps) !== SWAP_HOOK_FEE_BPS || Number(launch.creatorTaxBps) !== SWAP_CREATOR_TAX_BPS)
    throw Error("Pons registration, currencies or snapshotted output fees differ from the selected pool");
  const [amountOut, quoterGasEstimate] = await callAt(provider, SWAP_CONTRACTS.quoter.address,
    interfaces.quoter, "quoteExactInputSingle", [[SWAP_KEY, true, SWAP_INPUT_WEI, SWAP_HOOK_DATA]], b, { gasLimit: 30_000_000n });
  if (amountOut <= 0n) throw Error("Pons returned no GH0ST output");
  const minimumOutput = amountOut * 9950n / 10000n;
  const pricing = ponsPriceImpact(slot[0], amountOut);
  if (minimumOutput <= 0n || pricing.priceImpactBps > 100)
    throw Error("Pons quote has more than 1% price impact after its fixed output fees");
  const createdAt = Date.now(), deadline = block.timestamp + SWAP_DEADLINE_SECONDS;
  const quote = { amountIn: SWAP_INPUT_WEI.toString(), amountOut: amountOut.toString(),
    minimumOutput: minimumOutput.toString(), zeroForOne: true, poolId: SWAP_POOL_ID,
    hookData: SWAP_HOOK_DATA, slippageBps: 50, createdAt, deadline, blockNumber: b,
    amountOutFormatted: ethers.formatUnits(amountOut, 18), minimumOutputFormatted: ethers.formatUnits(minimumOutput, 18),
    inputSymbol: "ETH", outputSymbol: "GH0ST", gasEstimate: quoterGasEstimate.toString(),
    sqrtPriceX96: slot[0].toString(), ...pricing,
    hookFeeBps: SWAP_HOOK_FEE_BPS, creatorTaxBps: SWAP_CREATOR_TAX_BPS };
  const tx = { from: SWAP_OWNER, to: SWAP_CONTRACTS.router.address, value: SWAP_INPUT_WEI,
    data: pinnedBuyCalldata(minimumOutput, deadline) };
  const simulation = await provider.call({ ...tx, blockTag: b });
  const [estimatedGas, fees, balanceWei, nonce, canonicalBlock] = await Promise.all([
    provider.estimateGas(tx), provider.getFeeData(), provider.getBalance(SWAP_OWNER),
    provider.getTransactionCount(SWAP_OWNER, "pending"), provider.getBlock(b),
  ]);
  if (canonicalBlock?.hash !== block.hash) throw Error("The Pons quote block changed during preparation");
  const gasLimit = paddedGas(estimatedGas, SWAP_GAS_CAP);
  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null || fees.maxFeePerGas > feeCap)
    throw Error("Current network fees exceed the explicit fee cap");
  const maximumFee = gasLimit * fees.maxFeePerGas;
  if (balanceWei < SWAP_INPUT_WEI + maximumFee) throw Error("Wallet cannot cover the exact input plus maximum gas fee");
  const unsigned = ethers.Transaction.from({ type: 2, chainId: 4663n, nonce, to: tx.to, value: SWAP_INPUT_WEI,
    data: tx.data, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  const plan = { schema: "gh0st-manual-rh-v1", operation: "swap", preparedAt: new Date().toISOString(),
    broadcast: false, owner: SWAP_OWNER, chainId: "4663", router: tx.to, routerCodeHash: SWAP_CONTRACTS.router.codeHash,
    routeId: SWAP_ROUTE_ID, poolId: SWAP_POOL_ID, poolKey: { ...SWAP_KEY }, hookData: SWAP_HOOK_DATA, contracts,
    amountInWei: SWAP_INPUT_WEI.toString(), slippageBps: 50, quote,
    quoteExpiresAt: createdAt + SWAP_QUOTE_TTL_MS,
    sourceBlock: { number: b, hash: block.hash, timestamp: block.timestamp },
    poolState: { liquidity: liquidity.toString(), sqrtPriceX96: slot[0].toString(), tick: Number(slot[1]),
      protocolFee: Number(slot[2]), lpFee: Number(slot[3]), registered: true,
      hookFeeBps: Number(launch.hookFeeBps), creatorTaxBps: Number(launch.creatorTaxBps) },
    simulation: { success: true, output: simulation, kind: "read-only eth_call plus eth_estimateGas" },
    swap: { walletRequest: { method: "eth_sendTransaction", params: [{ from: SWAP_OWNER, to: tx.to,
      data: tx.data, value: ethers.toQuantity(SWAP_INPUT_WEI), type: "0x2", chainId: "0x1237",
      nonce: ethers.toQuantity(nonce), gas: ethers.toQuantity(gasLimit),
      maxFeePerGas: ethers.toQuantity(fees.maxFeePerGas), maxPriorityFeePerGas: ethers.toQuantity(fees.maxPriorityFeePerGas) }] },
      unsignedSerialized: unsigned.unsignedSerialized, unsignedHash: unsigned.unsignedHash,
      cost: { estimatedGas, gasLimit, maxFeePerGas: fees.maxFeePerGas, maximumFeeWei: maximumFee,
        inputWei: SWAP_INPUT_WEI, maximumInputAndFeeWei: SWAP_INPUT_WEI + maximumFee } },
    approvalTransactions: [],
    notes: ["Only the explicitly selected Pons pool; existing pools and liquidity are unchanged.",
      "Native buy needs no token allowance; unspent native input is swept back to this wallet.",
      "Pons deducts a 1% hook fee and 1.5% creator tax from GH0ST output. The quote includes them.",
      "The 0.5% minimum-output bound applies to that net quote; quote and router deadline expire within 120 seconds.",
      "Successful simulation is not an executed swap. ICP thought delivery is a later separate transaction."],
  };
  validateSwapPlan(plan);
  return plan;
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--amount-eth", "--fee-cap-gwei", "--pool-id", "--out"].includes(args[i]) || !args[i + 1])
      throw Error("Usage: prepare-swap.mjs --pool-id PONS_POOL_ID --amount-eth 0.00001 --fee-cap-gwei 0.1 [--out FILE]");
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!process.env.RH_RPC_URL) throw Error("Private RH_RPC_URL is required");
  const provider = new ethers.JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const plan = await prepareSwapPlan(provider, { amountEth: options["amount-eth"], feeCapGwei: options["fee-cap-gwei"], poolId: options["pool-id"] });
    const output = path.resolve(options.out ?? `build/manual-rh/pons-swap-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, json(plan) + "\n", { mode: 0o600, flag: "wx" });
    console.log(json({ output, broadcast: false, routeId: plan.routeId, poolId: plan.poolId, inputEth: "0.00001",
      quotedGhost: plan.quote.amountOutFormatted, minimumGhost: plan.quote.minimumOutputFormatted,
      hookFeeBps: plan.quote.hookFeeBps, creatorTaxBps: plan.quote.creatorTaxBps,
      gasEstimate: plan.swap.cost.estimatedGas, maximumFeeEth: ethers.formatEther(plan.swap.cost.maximumFeeWei),
      quoteExpiresAt: new Date(plan.quoteExpiresAt).toISOString(), deadline: plan.quote.deadline }));
  } finally { provider.destroy(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(() => { console.error("Pons small-buy preparation failed; private RPC details withheld. Check explicit pool, amount, current quote and fee cap."); process.exitCode = 1; });
