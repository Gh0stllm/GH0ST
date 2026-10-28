import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFresh } from "../scripts/manual-wallet.mjs";

function fixture() {
  const provider = {
    send: async () => "0x1237",
    getTransactionCount: async () => 7,
    getFeeData: async () => ({ maxFeePerGas: 48_000_000n, maxPriorityFeePerGas: 0n }),
    getBlock: async () => ({ baseFeePerGas: 24_000_000n }),
    estimateGas: async () => 21_000n,
    getBalance: async () => 10n ** 18n,
  };
  const action = { nonce: 7, maxCostWei: 21_000n * 40_000_000n, transaction: {
    to: "0x70325205B97393Aac0a8E3FcA6ccD5C744321523", data: "0x1234", value: "0x0",
    gas: "0x5208", maxFeePerGas: "0x2625a00", maxPriorityFeePerGas: "0x0",
  } };
  return { provider, action };
}

test("suggested fee headroom may rise while the real base fee still fits the signed cap", async () => {
  const { provider, action } = fixture();
  const before = structuredClone(action);
  await checkFresh(provider, action);
  assert.deepEqual(action, before, "the exact transaction and fee cap must not change");
});

test("base fee or required priority beyond the planned cap stops before signing", async () => {
  const { provider, action } = fixture();
  provider.getBlock = async () => ({ baseFeePerGas: 40_000_001n });
  await assert.rejects(checkFresh(provider, action), /Current fees exceed/);
  provider.getBlock = async () => ({ baseFeePerGas: 24_000_000n });
  provider.getFeeData = async () => ({ maxPriorityFeePerGas: 1n });
  await assert.rejects(checkFresh(provider, action), /Current fees exceed/);
  provider.getBlock = async () => ({});
  await assert.rejects(checkFresh(provider, action), /Current fees exceed/);
});
