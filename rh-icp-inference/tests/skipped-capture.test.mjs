import test from "node:test";
import assert from "node:assert/strict";
import { createSkippedCapture, captureLogBatch, captureJobSnapshot, modelLogCacheIdentity,
  skippedCaptureReport } from "../worker/skipped-capture.mjs";
const sourceId = "0x" + "ab".repeat(32);
const row = (index, content) => ({ index: String(index), timestamp: "1793032494193941709", content });
const job = (answer, { generation = 1, phase = "Running", quality = "", busy = false } = {}) => ({
  request: { id: sourceId }, phase: { [phase]: null }, answer, busy, output_tokens: 4n, input_tokens: 50n,
  chunks: 5, voice: [{ generation: [BigInt(generation)], attempt: generation, quality_error: quality }], error: "" });

test("raw logs preserve large indices/timestamps, de-duplicate polls and report loss", () => {
  const state = createSkippedCapture(), start = 9007199254740993n;
  let delta = captureLogBatch(state, { log_records: [row(start + 1n, " world"), row(start, "hello")] }, 1000);
  assert.equal(delta.records.map(r => r.content).join(""), "hello world");
  assert.equal(delta.records[0].timestamp, "1793032494193941709");
  assert.equal(delta.gaps[0].kind, "initial_window"); assert.equal(delta.complete, false);
  state.logLastIndex = JSON.parse(JSON.stringify(state)).logLastIndex;
  delta = captureLogBatch(state, [row(start, "hello"), row(start + 1n, " world"), row(start + 4n, "!")], 2000);
  assert.equal(delta.records.length, 1); assert.equal(delta.gaps[0].count, "2");
  assert.equal(delta.nextIndex, String(start + 5n));
  assert.throws(() => captureLogBatch(state, [row(start, "a"), row(start, "b")]), /Conflicting/);
  assert.throws(() => captureLogBatch(state, [{ index: Number(start), timestamp: "1", content: "x" }]), /Unsafe/);
});

test("source association requires the pinned coordinator cache marker", () => {
  const path = `.canister_cache/6jacx-5yaaa-aaaaj-a65jq-cai/sessions/gh0st-${sourceId.slice(2)}-a1.cache`;
  assert.deepEqual(modelLogCacheIdentity("saving final output to session file '" + path + "'"),
    { sourceId, cacheTag: "a1", generation: "1" });
  assert.equal(modelLogCacheIdentity("a token fragment"), null);
  assert.equal(modelLogCacheIdentity(path.replace("6jacx-5yaaa-aaaaj-a65jq-cai", "other-principal")), null);
});

test("quality reset retains the observed previous prefix but never claims its missing ending", () => {
  const state = createSkippedCapture();
  captureJobSnapshot(state, job("the last words are missing"), 1000);
  captureJobSnapshot(state, job("", { generation: 2, phase: "Verified", quality: "too long" }), 2000);
  const previous = skippedCaptureReport(state).sources[sourceId].generations["1"];
  assert.equal(previous.skipped, true); assert.equal(previous.text, "the last words are missing");
  assert.equal(previous.textStatus, "observed_prefix"); assert.equal(previous.skipReason, "too long");
});

test("only an idle complete candidate snapshot is marked complete; errors and busy snapshots remain partial", () => {
  for (const phase of ["Running", "Failed", "Complete"]) {
    const state = createSkippedCapture(), record = captureJobSnapshot(state, job("partial text", { phase, busy: true }), 1000);
    assert.equal(record.textStatus, "observed_prefix");
  }
  const state = createSkippedCapture();
  captureJobSnapshot(state, job("full exact text", { phase: "Complete" }), 1000);
  assert.equal(skippedCaptureReport(state).sources[sourceId].generations["1"].textStatus, "complete_accepted_candidate_observed");
  const report = skippedCaptureReport(state); report.sources[sourceId].generations["1"].text = "changed";
  assert.equal(state.sources[sourceId].generations["1"].text, "full exact text");
});
