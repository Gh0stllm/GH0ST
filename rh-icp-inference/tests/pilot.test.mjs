import test from "node:test";
import assert from "node:assert/strict";
import { parseSwapTarget, matchesSwapTarget } from "../worker/pilot.mjs";

const hash = "0x" + "aB".repeat(32);
test("single-swap selector is opt-in and accepts global receipt log index zero", () => {
  assert.equal(parseSwapTarget({}), null);
  assert.equal(parseSwapTarget({ TARGET_SWAP_TX_HASH: "", TARGET_SWAP_LOG_INDEX: "" }), null);
  assert.deepEqual(parseSwapTarget({ TARGET_SWAP_TX_HASH: hash, TARGET_SWAP_LOG_INDEX: "0" }), {
    transactionHash: hash.toLowerCase(), logIndex: 0,
  });
});

test("single-swap selector rejects partial or malformed targets before startup", () => {
  assert.throws(() => parseSwapTarget({ TARGET_SWAP_TX_HASH: hash }), /both/);
  assert.throws(() => parseSwapTarget({ TARGET_SWAP_LOG_INDEX: "7" }), /both/);
  for (const invalid of ["0x1234", "0x" + "0".repeat(64), "not-a-hash"])
    assert.throws(() => parseSwapTarget({ TARGET_SWAP_TX_HASH: invalid, TARGET_SWAP_LOG_INDEX: "7" }), /TX_HASH/);
  for (const invalid of ["-1", "1.5", "0x7", "1e3", "9007199254740992"])
    assert.throws(() => parseSwapTarget({ TARGET_SWAP_TX_HASH: hash, TARGET_SWAP_LOG_INDEX: invalid }), /LOG_INDEX/);
});

test("single-swap selector excludes other transactions, sibling swap logs and requests", () => {
  const target = parseSwapTarget({ TARGET_SWAP_TX_HASH: hash, TARGET_SWAP_LOG_INDEX: "7" });
  const item = { kind: "swap", txHash: hash, logIndex: 7 };
  assert.equal(matchesSwapTarget(item, target), true);
  assert.equal(matchesSwapTarget({ ...item, txHash: "0x" + "cd".repeat(32) }, target), false);
  assert.equal(matchesSwapTarget({ ...item, logIndex: 8 }, target), false);
  assert.equal(matchesSwapTarget({ ...item, kind: "request" }, target), false);
  assert.equal(matchesSwapTarget({ ...item, txHash: undefined }, target), false);
  assert.equal(matchesSwapTarget(item, null), true);
});
