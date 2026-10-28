import test from "node:test";
import assert from "node:assert/strict";
import { Transaction } from "ethers";
import { confirmedReceipt, paddedGas, prepareUnsigned, receiptCost, requireAddress, sameRuntime } from "../scripts/manual-rh-core.mjs";

const owner = "0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6";
const hash = "0x" + "ab".repeat(32);
function provider(overrides = {}) {
  return {
    send: async (method) => { assert.equal(method, "eth_chainId"); return "0x1237"; },
    getFeeData: async () => ({ maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateGas: async () => 100001n,
    getTransactionCount: async () => 17,
    getBalance: async () => 1_000_000_000_000_000n,
    ...overrides,
  };
}
const inputs = { owner, data: "0x123456", feeCapGwei: "0.05" };

test("manual preparation requires an explicit nonzero ICP signer and bounded fee/gas", () => {
  assert.throws(() => requireAddress(undefined, "--icp-signer"), /Missing/);
  assert.throws(() => requireAddress("0x" + "0".repeat(40), "--icp-signer"), /zero/);
  assert.equal(paddedGas(100001n), 120002n);
  assert.throws(() => paddedGas(100001n, 120001n), /cap/);
});

test("manual deployment output is unsigned, zero value and exactly chain 4663", async () => {
  const prepared = await prepareUnsigned(provider(), inputs);
  const tx = Transaction.from(prepared.unsignedSerialized);
  assert.equal(tx.signature, null);
  assert.equal(tx.chainId, 4663n);
  assert.equal(tx.to, null);
  assert.equal(tx.value, 0n);
  assert.equal(tx.nonce, 17);
  assert.equal(tx.gasLimit, 120002n);
  assert.equal(prepared.walletRequest.params[0].chainId, "0x1237");
  assert.equal(prepared.cost.maxCostWei, 2400040000000n);
  assert.ok(prepared.predictedGateway);
});

test("manual preparation refuses wrong chain, missing fee cap, excess fees and insufficient funds", async () => {
  await assert.rejects(prepareUnsigned(provider({ send: async () => "0x1" }), inputs), /not Robinhood/);
  await assert.rejects(prepareUnsigned(provider(), { ...inputs, feeCapGwei: undefined }), /fee-cap/);
  await assert.rejects(prepareUnsigned(provider(), { ...inputs, feeCapGwei: "0.001" }), /exceeds/);
  await assert.rejects(prepareUnsigned(provider({ getBalance: async () => 1n }), inputs), /balance/);
});

test("runtime verification masks only compiler-declared immutable slots", () => {
  const artifact = { evm: { deployedBytecode: { object: "aabb0000ccdd", immutableReferences: { x: [{ start: 2, length: 2 }] } } } };
  assert.equal(sameRuntime(artifact, "0xaabb1234ccdd"), true);
  assert.equal(sameRuntime(artifact, "0xffbb1234ccdd"), false);
  assert.equal(sameRuntime(artifact, "0xaabb1234cc"), false);
});

test("manual receipt verification requires success, depth and canonical block", async () => {
  const receipt = { hash, status: 1, blockNumber: 100, blockHash: hash, gasUsed: 45678n, gasPrice: 24000000n };
  const p = provider({ getTransactionReceipt: async () => receipt, getBlock: async () => ({ hash }), getBlockNumber: async () => 112 });
  assert.equal(await confirmedReceipt(p, hash), receipt);
  assert.deepEqual(receiptCost(receipt), { gasUsed: 45678n, effectiveGasPrice: 24000000n, feeWei: 1096272000000n });
  await assert.rejects(confirmedReceipt({ ...p, getBlockNumber: async () => 111 }, hash), /descendant/);
  await assert.rejects(confirmedReceipt({ ...p, getBlock: async () => ({ hash: "0x" + "cd".repeat(32) }) }, hash), /canonical/);
  await assert.rejects(confirmedReceipt({ ...p, getTransactionReceipt: async () => ({ ...receipt, status: 0 }) }, hash), /reverted/);
});
