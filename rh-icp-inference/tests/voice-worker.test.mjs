import test from "node:test";
import assert from "node:assert/strict";
import { id, keccak256, toUtf8Bytes } from "ethers";
import { acknowledgeVoice } from "../worker/voice.mjs";
const answer = "i rent my bones to the water. it pays in rumors.";
function fixture() {
  const requestId = id("voice");
  return {
    item: {
      id: requestId,
      kind: "swap",
      delivery: {
        confirmed: true,
        answer,
        answerHash: keccak256(toUtf8Bytes(answer)),
        transactionHash: id("callback"),
        logIndex: 9,
      },
    },
    job: {
      request: { id: requestId },
      phase: { Complete: null },
      voice: [{ remembered: false }],
      answer,
    },
  };
}
test("only confirmed exact thought is acknowledged once with actual callback log index", async () => {
  const { item, job } = fixture();
  let calls = 0;
  const c = {
    remember_delivered: async (...args) => {
      calls++;
      assert.deepEqual(args, [item.id, item.delivery.transactionHash, 9n]);
      return { Ok: {} };
    },
  };
  await acknowledgeVoice(item, job, c);
  await acknowledgeVoice(item, job, c);
  assert.equal(calls, 1);
  assert.equal(item.memoryAcknowledged, true);
});
test("ambiguous or rejected memory acknowledgement remains retryable", async () => {
  const { item, job } = fixture();
  await assert.rejects(
    acknowledgeVoice(item, job, {
      remember_delivered: async () => ({ Err: "RPC unavailable" }),
    }),
  );
  assert.equal(item.memoryAcknowledged, undefined);
  item.delivery.confirmed = false;
  await assert.rejects(acknowledgeVoice(item, job, {}));
  item.delivery.confirmed = true;
  item.delivery.answer = "changed";
  await assert.rejects(acknowledgeVoice(item, job, {}));
});
test("legacy and explicit jobs do not enter the new character memory", async () => {
  const { item, job } = fixture();
  job.voice = [];
  await acknowledgeVoice(item, job, {});
  assert.equal(item.memorySkipped, "explicit_or_legacy_job");
});
