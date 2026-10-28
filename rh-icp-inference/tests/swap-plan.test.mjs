import assert from "node:assert/strict";
import { test } from "node:test";
import { AbiCoder, Interface, Transaction, toQuantity } from "ethers";
import { validatePlan, checkFresh } from "../scripts/manual-wallet.mjs";
import { prepareSwapPlan } from "../scripts/prepare-swap.mjs";
import { SWAP_OWNER, SWAP_ROUTER, SWAP_ROUTER_HASH, SWAP_POOL_ID,
  SWAP_ROUTE_ID, SWAP_KEY, SWAP_CONTRACTS, SWAP_ABI, KEY_TYPE,
  SWAP_INPUT_WEI, SWAP_HOOK_FEE_BPS, SWAP_CREATOR_TAX_BPS,
  ponsPriceImpact, pinnedBuyCalldata } from "../scripts/swap-plan.mjs";

const coder = AbiCoder.defaultAbiCoder();
const router = new Interface(SWAP_ABI.router);

function fixture() {
  const createdAt = Date.now(), timestamp = Math.floor(createdAt / 1000), deadline = timestamp + 120;
  const sqrt = 450637540998814664370904260284855n;
  const output = 315427345625087348326n, minimum = output * 9950n / 10000n;
  const unsigned = Transaction.from({ type: 2, chainId: 4663n, nonce: 12, to: SWAP_ROUTER,
    value: SWAP_INPUT_WEI, gasLimit: 200000n, maxFeePerGas: 40000000n, maxPriorityFeePerGas: 0n,
    data: pinnedBuyCalldata(minimum, deadline) });
  const contracts = structuredClone(SWAP_CONTRACTS);
  for (const name of ["router", "quoter", "stateView", "hook"])
    contracts[name].poolManager = SWAP_CONTRACTS.manager.address;
  return { schema: "gh0st-manual-rh-v1", operation: "swap", broadcast: false, chainId: "4663",
    owner: SWAP_OWNER, router: SWAP_ROUTER, routerCodeHash: SWAP_ROUTER_HASH,
    routeId: SWAP_ROUTE_ID, poolId: SWAP_POOL_ID, poolKey: { ...SWAP_KEY }, hookData: "0x", contracts,
    slippageBps: 50, amountInWei: SWAP_INPUT_WEI.toString(),
    sourceBlock: { number: 98397240, hash: "0x" + "ab".repeat(32), timestamp },
    quoteExpiresAt: createdAt + 120000,
    quote: { amountIn: SWAP_INPUT_WEI.toString(), amountOut: output.toString(), minimumOutput: minimum.toString(),
      zeroForOne: true, poolId: SWAP_POOL_ID, hookData: "0x", createdAt, deadline, blockNumber: 98397240,
      slippageBps: 50, sqrtPriceX96: sqrt.toString(), ...ponsPriceImpact(sqrt, output),
      hookFeeBps: SWAP_HOOK_FEE_BPS, creatorTaxBps: SWAP_CREATOR_TAX_BPS },
    poolState: { sqrtPriceX96: sqrt.toString(), liquidity: "29277002188455996411301", protocolFee: 0,
      lpFee: 0, registered: true, hookFeeBps: 100, creatorTaxBps: 150 },
    approvalTransactions: [], simulation: { success: true, output: "0x" },
    swap: { unsignedSerialized: unsigned.unsignedSerialized, unsignedHash: unsigned.unsignedHash,
      walletRequest: { method: "eth_sendTransaction", params: [{ from: SWAP_OWNER, to: SWAP_ROUTER,
        data: unsigned.data, value: toQuantity(SWAP_INPUT_WEI), type: "0x2", chainId: "0x1237",
        nonce: "0xc", gas: toQuantity(unsigned.gasLimit), maxFeePerGas: toQuantity(unsigned.maxFeePerGas), maxPriorityFeePerGas: "0x0" }] } },
  };
}

function rewriteUnsigned(plan, update) {
  const tx = Transaction.from(plan.swap.unsignedSerialized);
  update(tx);
  plan.swap.unsignedSerialized = tx.unsignedSerialized;
  plan.swap.unsignedHash = tx.unsignedHash;
  Object.assign(plan.swap.walletRequest.params[0], { data: tx.data, value: toQuantity(tx.value),
    gas: toQuantity(tx.gasLimit), maxFeePerGas: toQuantity(tx.maxFeePerGas),
    maxPriorityFeePerGas: toQuantity(tx.maxPriorityFeePerGas) });
}

test("Pons small buy validates its explicit pool, exact input, net quote and no approvals", () => {
  const actions = validatePlan(fixture());
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, "swap");
  assert.equal(actions[0].routeId, SWAP_ROUTE_ID);
  assert.equal(actions[0].poolId, SWAP_POOL_ID);
  assert.equal(actions[0].valueEth, "0.00001");
  assert.equal(BigInt(actions[0].transaction.value), SWAP_INPUT_WEI);
});

test("Pons transaction encodes exact input, empty hook data, settlement, output minimum and native refund", () => {
  const plan = fixture(), decoded = router.decodeFunctionData("execute", plan.swap.walletRequest.params[0].data);
  assert.equal(decoded.commands, "0x1004");
  assert.equal(decoded.deadline, BigInt(plan.quote.deadline));
  const [actions, params] = coder.decode(["bytes", "bytes[]"], decoded.inputs[0]);
  assert.equal(actions, "0x060c0f");
  const [swap] = coder.decode([`tuple(${KEY_TYPE} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`], params[0]);
  assert.equal(swap.poolKey.hooks.toLowerCase(), SWAP_KEY.hooks);
  assert.equal(swap.poolKey.fee, 0n); assert.equal(swap.poolKey.tickSpacing, 200n);
  assert.equal(swap.zeroForOne, true); assert.equal(swap.amountIn, SWAP_INPUT_WEI);
  assert.equal(swap.amountOutMinimum, BigInt(plan.quote.minimumOutput));
  assert.equal(swap.minHopPriceX36, 0n); assert.equal(swap.hookData, "0x");
  assert.deepEqual(Array.from(coder.decode(["address", "uint256"], params[1])), [SWAP_KEY.currency0, SWAP_INPUT_WEI]);
  const [outputToken, minimum] = coder.decode(["address", "uint256"], params[2]);
  assert.equal(outputToken.toLowerCase(), SWAP_KEY.currency1); assert.equal(minimum, BigInt(plan.quote.minimumOutput));
  const [refundToken, refundTo, refundMinimum] = coder.decode(["address", "address", "uint256"], decoded.inputs[1]);
  assert.equal(refundToken, SWAP_KEY.currency0); assert.equal(refundTo, SWAP_OWNER); assert.equal(refundMinimum, 0n);
});

test("old sentence pool, engine witness and SPK1 data cannot become the Pons route", () => {
  for (const mutate of [
    p => { p.poolId = "0x90fbab7e58f154bff561fb7ee00f2aaa59ba66b77b0c4e1535f1b1c26a00f7d7"; },
    p => { p.engineSourceSha256 = "legacy"; },
    p => { p.hookData = "0x53504b31"; },
    p => { p.quote.hookData = "0x53504b31"; },
    p => { p.poolKey.fee = 3000; p.poolKey.tickSpacing = 60; },
  ]) { const p = fixture(); mutate(p); assert.throws(() => validatePlan(p)); }
});

test("all six contract pins and all four pool-manager links are required", () => {
  for (const name of Object.keys(SWAP_CONTRACTS)) {
    const p = fixture(); p.contracts[name].codeHash = "0x" + "cc".repeat(32);
    assert.throws(() => validatePlan(p), /code pin/);
  }
  for (const name of ["router", "quoter", "stateView", "hook"]) {
    const p = fixture(); p.contracts[name].poolManager = SWAP_OWNER;
    assert.throws(() => validatePlan(p), /pool manager/);
  }
});

test("calldata reconstruction catches a changed minimum even with a new matching unsigned hash", () => {
  const p = fixture();
  rewriteUnsigned(p, tx => { tx.data = pinnedBuyCalldata(BigInt(p.quote.minimumOutput) - 1n, p.quote.deadline); });
  assert.throws(() => validatePlan(p), /calldata/);
});

test("recipient tampering is rejected even with matching transaction serialization", () => {
  const p = fixture(), tx = p.swap.walletRequest.params[0];
  const decoded = router.decodeFunctionData("execute", tx.data);
  const inputs = Array.from(decoded.inputs);
  inputs[1] = coder.encode(["address", "address", "uint256"], [SWAP_KEY.currency0, SWAP_ROUTER, 0n]);
  rewriteUnsigned(p, value => { value.data = router.encodeFunctionData("execute", [decoded.commands, inputs, decoded.deadline]); });
  assert.throws(() => validatePlan(p), /calldata/);
});

test("input, slippage, time, approval, simulation, gas and fee guards fail closed", () => {
  for (const mutate of [
    p => { p.swap.walletRequest.params[0].value = "0x0"; },
    p => { p.swap.walletRequest.params[0].to = SWAP_OWNER; },
    p => { p.slippageBps = 500; },
    p => { p.quote.minimumOutput = "1"; },
    p => { p.quote.deadline += 1; },
    p => { p.quoteExpiresAt += 1; },
    p => { p.approvalTransactions.push({}); },
    p => { p.simulation.success = false; },
    p => { rewriteUnsigned(p, tx => { tx.gasLimit = 9000001n; }); },
    p => { rewriteUnsigned(p, tx => { tx.maxFeePerGas = 100000001n; }); },
  ]) { const p = fixture(); mutate(p); assert.throws(() => validatePlan(p)); }
});

test("Pons price impact subtracts the two output fees with separate rounding", () => {
  const sqrt = 2n ** 96n, gross = SWAP_INPUT_WEI;
  const net = gross - gross * 100n / 10000n - gross * 150n / 10000n;
  assert.deepEqual(ponsPriceImpact(sqrt, net), { spotOutputBeforeFees: gross.toString(),
    spotOutputAfterFees: net.toString(), priceImpactBps: 0 });
  assert.equal(ponsPriceImpact(sqrt, net * 9899n / 10000n).priceImpactBps, 101);
  assert.throws(() => ponsPriceImpact(0n, 1n));
  const p = fixture(); p.quote.creatorTaxBps = 0;
  assert.throws(() => validatePlan(p), /quote/);
  const p2 = fixture(); p2.quote.spotOutputAfterFees = p2.quote.spotOutputBeforeFees;
  assert.throws(() => validatePlan(p2), /price-impact/);
});

test("expired, future-dated or router-expired quote rejects before RPC or unlock", async () => {
  const provider = new Proxy({}, { get() { throw Error("must reject before RPC"); } });
  for (const adjust of [
    action => { action.quoteExpiresAt = Date.now() - 1000; },
    action => { action.quoteExpiresAt = Date.now() + 126000; },
    action => { action.deadline = Math.floor(Date.now() / 1000) - 1; },
  ]) {
    const action = validatePlan(fixture())[0]; adjust(action);
    await assert.rejects(checkFresh(provider, action), /Swap quote expired/);
  }
});

test("preparer refuses implicit or old pool selection and any other amount before RPC", async () => {
  const provider = new Proxy({}, { get() { throw Error("must reject before RPC"); } });
  for (const options of [
    { amountEth: "0.00001", feeCapGwei: "0.1" },
    { poolId: "0x90fbab7e58f154bff561fb7ee00f2aaa59ba66b77b0c4e1535f1b1c26a00f7d7", amountEth: "0.00001", feeCapGwei: "0.1" },
    { poolId: SWAP_POOL_ID, amountEth: "0.001", feeCapGwei: "0.1" },
    { poolId: SWAP_POOL_ID, amountEth: "0.00001", feeCapGwei: "0.11" },
  ]) await assert.rejects(prepareSwapPlan(provider, options), /explicit Pons|exactly|Fee cap/);
});
