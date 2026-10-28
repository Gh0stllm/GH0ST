import test from "node:test";
import assert from "node:assert/strict";
import { failurePolicyDecision, qualityRetryReason, publicationUncertain, deliveryUncertain } from "../worker/failure-policy.mjs";

const item = () => ({ id: "source", state: "queued" });
const job = (extra = {}) => ({ request: { id: "source" }, phase: { Failed: null }, busy: false,
  model_cycles: 1984626103023n, error: "model cycle/chunk budget reached", recovery: [], ...extra });

test("a terminal model failure preserves its measured cost for queue settlement", () => {
  assert.deepEqual(failurePolicyDecision(item(), job()), { action: "settle_failed",
    reason: "model cycle/chunk budget reached", actualCycles: "1984626103023" });
});

test("uncertain ingress, accounting, RH delivery and X sends are never auto-skipped", () => {
  for (const [changedItem, changedJob, reason] of [
    [item(), job({ busy: true }), "job_in_flight"],
    [{ ...item(), pendingUpdate: { operation: "advance" } }, job(), "unresolved_ingress"],
    [{ ...item(), pendingResume: {} }, job(), "unresolved_ingress"],
    [{ ...item(), buyHalt: {} }, job(), "unresolved_ingress"],
    [item(), job({ recovery: [{ accounting_uncertain: true }] }), "uncertain_model_accounting"],
    [{ ...item(), rawTransaction: "retained signed bytes" }, job(), "unresolved_delivery"],
    [{ ...item(), publication: { status: "sending", attempt: 1 } }, job(), "unresolved_publication"],
    [{ ...item(), media: { status: "needs_reconciliation" } }, job(), "unresolved_publication"],
  ]) assert.deepEqual(failurePolicyDecision(changedItem, changedJob), { action: "wait", reason });
});

test("one attempt means rejecting a requested quality repair before its next model call", () => {
  const retry = job({ phase: { Verified: null }, error: "", voice: [{ attempt: 2, quality_error: "repeated thought" }] });
  assert.equal(failurePolicyDecision(item(), retry).action, "abort");
  assert.match(qualityRetryReason(retry), /repeated thought/);
  assert.equal(failurePolicyDecision(item(), { ...retry, phase: { Complete: null } }).action, "reject_result");
  assert.equal(qualityRetryReason({ voice: [{ attempt: 255, generation: [256n], quality_error: "" }] }),
    "single_attempt_policy: another model attempt was requested");
});

test("a first attempt continues, and a different source cannot be settled", () => {
  assert.deepEqual(failurePolicyDecision(item(), job({ phase: { Running: null }, error: "",
    voice: [{ attempt: 1, quality_error: "" }] })), { action: "continue" });
  assert.throws(() => failurePolicyDecision(item(), job({ request: { id: "different" } })), /another source/);
});

test("confirmed RH delivery can be withheld from X, but a post attempt stays ambiguous", () => {
  const confirmed = { ...item(), rawTransaction: "retained", transactionHash: "tx", delivery: { confirmed: true },
    publication: { status: "ready", attempt: 0 } };
  assert.equal(deliveryUncertain(confirmed), false);
  assert.equal(publicationUncertain(confirmed), false);
  assert.equal(publicationUncertain({ ...confirmed, publication: { status: "posted", postId: "123" } }), true);
  assert.equal(failurePolicyDecision(confirmed, job({ phase: { Complete: null }, error: "",
    voice: [{ attempt: 2, quality_error: "" }] })).action, "reject_result");
});
