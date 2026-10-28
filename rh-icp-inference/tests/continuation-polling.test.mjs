import test from "node:test";
import assert from "node:assert/strict";
import { generationProgress, canContinueGeneration } from "../worker/continuation-polling.mjs";

function job(overrides = {}) {
  return { request: { id: "source-one" }, phase: { Running: null }, busy: false,
    input_tokens: 120n, output_tokens: 4n, prompt_ingested: true,
    voice: [{ attempt: 1 }], recovery: [], ...overrides };
}

test("normal generation can continue at the same four-token boundaries without retaining a mutable snapshot", () => {
  const result = job(), before = generationProgress(result);
  result.output_tokens = 8n;
  assert.equal(canContinueGeneration(before, result), true);
  assert.equal(before.output, 4n);
});

test("busy, recovery and terminal results always keep the normal polling delay", () => {
  const before = generationProgress(job());
  for (const override of [
    { busy: true },
    { phase: { Complete: null } },
    { phase: { Failed: null } },
    { recovery: [{ requires_owner: true }] },
    { recovery: [{ accounting_uncertain: true }] },
    { recovery: [{ parked: true }] },
    { recovery: [{ retry_after: 101n }] },
  ]) assert.equal(canContinueGeneration(before, job({ output_tokens: 8n, ...override }), 100_000), false);
});

test("changed sources, restarted attempts, regressed counters and accounting-only changes do not count as progress", () => {
  const before = generationProgress(job());
  for (const override of [
    { request: { id: "source-two" }, output_tokens: 8n },
    { voice: [{ attempt: 2 }], output_tokens: 8n },
    { input_tokens: 119n, output_tokens: 8n },
    { output_tokens: 3n },
    { phase: { Verified: null }, output_tokens: 8n },
    { prompt_ingested: false, output_tokens: 8n },
    { model_cycles: 100n },
    { output_tokens: null },
  ]) assert.equal(canContinueGeneration(before, job(override)), false);
});
