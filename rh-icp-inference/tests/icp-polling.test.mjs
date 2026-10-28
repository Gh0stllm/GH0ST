import test from "node:test";
import assert from "node:assert/strict";
import { coordinatorCallTransform, ICP_POLL_INTERVAL_MS, ICP_CALL_TIMEOUT_MS } from "../worker/icp-polling.mjs";

test("each ingress call gets a fresh fixed-delay receipt strategy without changing trust or retry settings", async () => {
  const created = [], waits = [];
  const strategy = {
    throttle(ms) { const fn = async () => waits.push(ms); created.push(["throttle", ms, fn]); return fn; },
    timeout(ms) { const fn = async () => {}; created.push(["timeout", ms, fn]); return fn; },
    chain(...steps) { return async (...args) => { for (const step of steps) await step(...args); }; },
  };
  const transform = coordinatorCallTransform({ strategy });
  assert.deepEqual(created, []); // No timeout starts at worker startup.
  const first = transform("advance", ["source"]), second = transform("advance", ["source"]);
  assert.notEqual(first.pollingOptions.strategy, second.pollingOptions.strategy);
  assert.deepEqual(Object.keys(first), ["pollingOptions"]);
  assert.deepEqual(Object.keys(first.pollingOptions), ["strategy"]);
  assert.deepEqual(created.map(([kind, ms]) => [kind, ms]), [
    ["throttle", 1000], ["timeout", 300000], ["throttle", 1000], ["timeout", 300000],
  ]);
  for (let i = 0; i < 30; i++) await first.pollingOptions.strategy(null, null, "processing");
  await second.pollingOptions.strategy(null, null, "received");
  assert.deepEqual(waits, Array(31).fill(1000));
  assert.equal(ICP_POLL_INTERVAL_MS, 1000); assert.equal(ICP_CALL_TIMEOUT_MS, 300000);
});
