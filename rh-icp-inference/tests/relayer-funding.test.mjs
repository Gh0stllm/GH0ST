import { test } from "node:test";
import assert from "node:assert/strict";
import { FUNDING, prepareFundingPlan, validateFundingPlan, checkFundingFresh } from "../scripts/relayer-funding.mjs";

const recipient = "0x1111111111111111111111111111111111111111";
function provider(overrides = {}) {
  return {
    send: async () => "0x1237", getTransactionCount: async address => address === FUNDING.owner ? 12 : 0,
    getBalance: async address => address === FUNDING.owner ? 1_000_000_000_000_000n : 0n,
    getCode: async () => "0x", getBlock: async () => ({ baseFeePerGas: 20_000_000n }),
    getFeeData: async () => ({ maxFeePerGas: 40_000_000n, maxPriorityFeePerGas: 0n }),
    estimateGas: async () => 21_000n, ...overrides,
  };
}
test("funding creates an exact bounded EOA transfer without broadcasting", async () => {
  const plan = await prepareFundingPlan(provider(), recipient), action = validateFundingPlan(plan, recipient);
  assert.equal(plan.broadcast, false); assert.equal(action.transaction.value, "50000000000000");
  assert.equal(action.maxCostWei, 1_050_000_000_000n); assert.equal(action.valueEth, "0.00005");
  await checkFundingFresh(provider(), action);
});
test("funding plan rejects changed recipient, calldata, amount, nonce, fee, chain or hash", async () => {
  const plan = await prepareFundingPlan(provider(), recipient);
  for (const mutate of [
    p => { p.recipient = FUNDING.owner; }, p => { p.transaction.to = FUNDING.owner; },
    p => { p.transaction.data = "0x1234"; }, p => { p.transaction.value = "50000000000001"; },
    p => { p.transaction.nonce = -1; }, p => { p.transaction.maxFeePerGas = "50000001"; },
    p => { p.transaction.chainId = 1; }, p => { p.unsignedHash = "0x" + "00".repeat(32); },
  ]) { const altered = structuredClone(plan); mutate(altered); assert.throws(() => validateFundingPlan(altered, recipient)); }
});
test("funding rejects nonempty wallet and stale or unsafe chain observations", async () => {
  await assert.rejects(prepareFundingPlan(provider({ getBalance: async () => 1n }), recipient), /already funded/);
  const plan = await prepareFundingPlan(provider(), recipient), action = validateFundingPlan(plan, recipient);
  for (const unsafe of [
    { send: async () => "0x1" }, { getCode: async () => "0x01" },
    { getTransactionCount: async () => 13 }, { getBalance: async () => 0n },
    { getBalance: async address => address === FUNDING.owner ? 1_000_000_000_000_000n : 1n },
    { getBlock: async () => ({ baseFeePerGas: 50_000_001n }) }, { estimateGas: async () => 21_001n },
  ]) await assert.rejects(checkFundingFresh(provider(unsafe), action));
});
