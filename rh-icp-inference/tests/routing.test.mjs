import test from "node:test";
import assert from "node:assert/strict";
import { callbackFor } from "../worker/routing.mjs";
import { swapSourceId } from "../worker/swaps.mjs";
import { id } from "ethers";

test("existing swap selects source-bound callback without a request transaction", () => {
  const source = {
    manager: "0x3333333333333333333333333333333333333333",
    pool_id: id("pool"),
    transaction_hash: id("transaction"),
    log_index: 7n,
  };
  const requestId = swapSourceId(4663, source);
  const item = { kind: "swap", id: requestId, source };
  const job = { request: { id: requestId }, source: [source] };
  const signed = {
    result: { requestId },
    answer: "A thought",
    signature: "0xsignature",
  };
  const call = callbackFor(item, job, 4663, signed);
  assert.equal(call.method, "fulfillSwapInference");
  assert.equal(call.args[0].transactionHash, source.transaction_hash);
  assert.equal(call.args[2], signed.answer);
  assert.throws(() => callbackFor(item, { ...job, source: [] }, 4663, signed));
  assert.throws(() => callbackFor(item, job, 1, signed));
  assert.throws(() =>
    callbackFor(
      { ...item, source: { ...source, log_index: 8n } },
      job,
      4663,
      signed,
    ),
  );
  assert.throws(() =>
    callbackFor({ ...item, kind: "request" }, job, 4663, signed),
  );
});
test("explicit requests retain their original callback", () => {
  const requestId = id("manual");
  const signed = {
    result: { requestId },
    answer: "A thought",
    signature: "0xsignature",
  };
  assert.equal(
    callbackFor(
      { kind: "request", id: requestId },
      { request: { id: requestId }, source: [] },
      4663,
      signed,
    ).method,
    "fulfillInference",
  );
  assert.throws(() =>
    callbackFor(
      { kind: "request", id: id("other") },
      { request: { id: requestId }, source: [] },
      4663,
      signed,
    ),
  );
});
