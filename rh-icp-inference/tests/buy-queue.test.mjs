import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { decodeSwapReceipt, SWAP_ABI } from "../worker/swaps.mjs";
import { BUY_POOL, BUY_JOB_RESERVE, validatePonsBuy, createBuyQueue, enqueuePonsBuys,
  reserveNextBuy, observeBuyProgress, recordBuyDelivery, completeBuy, settleFailedBuy, buyBudget } from "../worker/buy-queue.mjs";
import { pendingBuyRecovery, markBuyRecoveryPending } from "../worker/buy-queue.mjs";
import { reactivateRecoveredBuy, reactivateParkedBuy, migrateBuyWorkerRecovery, migrateParkedWorkerResume } from "../worker/buy-queue.mjs";
import { markBuyOwnerDeferred, normalizeBuyCycleCap, resumeRetainedWorkerJob } from "../worker/buy-queue.mjs";
import { setBuyFailurePolicy, settleObservedFailedBuy, rejectBuyResult } from "../worker/buy-queue.mjs";

const T = 1_000_000_000_000n, NOW = Date.parse("2026-10-26T12:00:00Z");
const H = byte => "0x" + byte.repeat(32);
const iface = new Interface(SWAP_ABI), clone = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));
function swap(blockNumber = 100, logIndex = 1, byte = "ab", amount0 = -10_000_000_000_000n, amount1 = 323_515_226_282_140_870_077n) {
  const txHash = H(byte), blockHash = H("cd");
  const encoded = iface.encodeEventLog(iface.getEvent("Swap"), [BUY_POOL.pool_id,
    "0x204faca1764b154221e35c0d20abb3c525710498", amount0, amount1, 1n, 100n, 0, 0]);
  return decodeSwapReceipt({ status: 1, hash: txHash, blockNumber, blockHash,
    logs: [{ ...encoded, address: BUY_POOL.manager, index: logIndex, transactionHash: txHash, blockNumber, blockHash }] }, BUY_POOL, logIndex, 4663);
}
function verification(events, headBlockNumber = 1000) {
  return { headBlockNumber, canonicalBlockHashes: Object.fromEntries(events.map(e => [e.blockNumber, e.blockHash])) };
}
function state(options = {}) { return createBuyQueue({ startBlock: 100, ...options }); }
function queued(events = [swap()], options) { return enqueuePonsBuys(state(options), events, verification(events)).state; }
function reserve(input = queued(), nowMs = NOW, proof) {
  return reserveNextBuy(input, { nowMs, verification: proof ?? verification(input.entries.map(e => e.event)),
    balance: { cycles: (20n * T).toString(), observedAtMs: nowMs } });
}
function delivered(input, sourceId = input.activeSourceId) {
  return recordBuyDelivery(input, { sourceId, delivery: { sourceId, confirmed: true, canonical: true,
    transactionHash: H("55"), answerHash: H("66") } });
}
function completed(input, actualCycles = T, nowMs = NOW) {
  const sourceId = input.activeSourceId;
  return completeBuy(delivered(input), { sourceId, actualCycles, nowMs,
    publication: { sourceId, status: "posted", verified: true, postId: "2114700034747076865",
      callbackTransactionHash: H("55"), answerHash: H("66") }, proofRef: "verified-rh-icp-x.json" });
}

function recoverableQueue() {
  const a = swap(100, 1, "aa"), b = swap(101, 1, "bb");
  const started = reserve(queued([a, b], { dailyCycleBudget: 10n * T })).state;
  const failed = observeBuyProgress(started, { sourceId: a.id, status: "failed", reason: "model cap" });
  const result = settleFailedBuy(failed, { sourceId: a.id, outcome: "failed_final", actualCycles: "1900000000000",
    nowMs: NOW, proofRef: "old-cost.json" });
  Object.assign(result.entries[1], { status: "reserved", reserveCycles: BUY_JOB_RESERVE.toString(),
    reservedAtMs: NOW, reservedDay: "2026-10-26" });
  result.activeSourceId = b.id; result.lastStarted = b.id;
  return result;
}
function recoveryJob(event, { parked = false, carry = 2n * T, resumed = false } = {}) {
  return { request: { id: event.id, tx_hash: event.txHash, log_index: event.logIndex,
    block_hash: event.blockHash, block_number: event.blockNumber }, source: [event.source], phase: { Verified: null }, busy: false,
    model_cycles: parked || resumed ? "0" : carry.toString(), model_cycles_before: "0", chunks: 0,
    input_tokens: 0, output_tokens: 0, answer: "", digest: "", signer: "", signature: [], prompt_ingested: false,
    recovery: [{ total_budget: (carry + BUY_JOB_RESERVE).toString(), grants: parked || resumed ? 0 : 1,
      carry_cycles: parked || resumed ? "0" : carry.toString(), parked, rebuilding: !parked,
      requires_owner: false, resume_deadline: parked ? "0" : String(NOW / 1000 + 3600) }] };
}

test("direction comes from the decoded pinned PoolManager event, including the actual live buy signs", () => {
  const buy = swap();
  assert.equal(buy.context.amount0, "-10000000000000");
  assert.equal(buy.context.amount1, "323515226282140870077");
  const result = validatePonsBuy(buy, verification([buy]));
  assert.equal(result.direction, "buy");
  assert.equal(result.source.pool_id, BUY_POOL.pool_id);
  assert.equal(BUY_POOL.currency0, "0x" + "00".repeat(20));
  assert.equal(BUY_POOL.currency1, "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559");
  const sell = swap(101, 2, "ef", 10_000n, -30_000n);
  assert.equal(validatePonsBuy(sell, verification([sell])), null);
  const result2 = enqueuePonsBuys(state(), [buy, sell], verification([buy, sell]));
  assert.deepEqual(result2.accepted, [buy.id]);
  assert.equal(result2.ignored[0].reason, "sell");
});

test("rejects wrong pools, chains, source IDs, aliases and invalid signed amounts", () => {
  const buy = swap();
  for (const mutate of [e => { e.source.pool_id = H("ef"); }, e => { e.source.manager = "0x" + "aa".repeat(20); },
    e => { e.chainId = 1; }, e => { e.id = H("ef"); }, e => { e.source.transaction_hash = H("ef"); },
    e => { e.source.log_index = "2"; }, e => { e.context.amount0 = "0"; }, e => { e.context.amount1 = "-1"; },
    e => { e.context.amount1 = (1n << 127n).toString(); }, e => { e.context.amount0 = " 1"; },
    e => { e.context.amount0 = 10; }, e => { e.logIndex = 1.1; }]) {
    const changed = clone(buy); mutate(changed);
    assert.throws(() => validatePonsBuy(changed, verification([buy])));
  }
});

test("requires twelve descendants and an independent canonical block hash", () => {
  const buy = swap();
  assert.equal(validatePonsBuy(buy, verification([buy], 112)).id, buy.id);
  assert.throws(() => validatePonsBuy(buy, verification([buy], 111)), /confirmation/);
  assert.throws(() => validatePonsBuy(buy, { headBlockNumber: 112 }), /canonical block hash/);
  assert.throws(() => validatePonsBuy(buy, { headBlockNumber: 112, canonicalBlockHashes: { 100: H("ee") } }), /reorganized/);
  for (const field of ["removed", "canonical", "confirmed"]) {
    assert.throws(() => validatePonsBuy({ ...buy, [field]: field === "removed" }, verification([buy])));
  }
});

test("FIFO orders confirmed buys by block then global log index, not incoming batch order", () => {
  const a = swap(101, 2, "aa"), b = swap(100, 9, "bb"), c = swap(101, 1, "cc");
  const input = state(), original = clone(input);
  const result = enqueuePonsBuys(input, [a, b, c], verification([a, b, c]));
  assert.deepEqual(input, original);
  assert.deepEqual(result.state.entries.map(e => e.event.id), [b.id, c.id, a.id]);
  assert.equal(reserve(result.state).decision.intent.sourceId, b.id);
});

test("identical duplicates are idempotent across scans and JSON restart", () => {
  const buy = swap(); const first = enqueuePonsBuys(state(), [buy, buy], verification([buy]));
  assert.equal(first.accepted.length, 1); assert.equal(first.state.entries.length, 1);
  const next = enqueuePonsBuys(clone(first.state), [buy], verification([buy]));
  assert.equal(next.accepted.length, 0); assert.deepEqual(next.state, first.state);
  const active = reserve(next.state), restarted = reserve(clone(active.state));
  assert.equal(restarted.decision.kind, "blocked");
  assert.equal(restarted.decision.reason, "unresolved_buy");
});

test("conflicting duplicate bytes and canonical log positions reject atomically", () => {
  const buy = swap(), input = queued([buy]), saved = clone(input);
  const changed = clone(buy); changed.context.amount1 = "1";
  assert.throws(() => enqueuePonsBuys(input, [changed], verification([changed])), /Conflicting observation/);
  const other = swap(100, 1, "ef");
  assert.throws(() => enqueuePonsBuys(input, [other], verification([other])), /log position/);
  const reorg = clone(buy); reorg.blockHash = H("ef");
  assert.throws(() => enqueuePonsBuys(input, [reorg], verification([reorg])), /Conflicting observation/);
  assert.deepEqual(input, saved);
});

test("imported tombstones and explicit activation block prevent historical replay", () => {
  const old = swap(99, 0, "aa"), seen = swap(100, 1, "bb"), fresh = swap(101, 2, "cc");
  const result = enqueuePonsBuys(state({ completedSourceIds: [seen.id] }), [old, seen, fresh], verification([old, seen, fresh]));
  assert.deepEqual(result.accepted, [fresh.id]);
  assert.deepEqual(result.ignored.map(e => e.reason), ["before_activation", "already_seen"]);
  assert.throws(() => createBuyQueue({}), /activation/);
  assert.throws(() => state({ completedSourceIds: [seen.id, seen.id] }), /Duplicate/);
});

test("rechecks canonical evidence immediately before reserving a waiting buy", () => {
  const input = queued(), saved = clone(input);
  assert.throws(() => reserve(input, NOW, { headBlockNumber: 1000, canonicalBlockHashes: { 100: H("ef") } }), /reorganized/);
  assert.throws(() => reserve(input, NOW, verification([swap()], 111)), /confirmation/);
  assert.deepEqual(input, saved);
});

test("new older observations cannot jump behind an already activated FIFO source", () => {
  const newer = swap(102, 4, "aa"), older = swap(101, 1, "bb");
  const active = reserve(queued([newer])).state;
  assert.throws(() => enqueuePonsBuys(active, [older], verification([older])), /FIFO/);
  const later = swap(103, 0, "cc");
  assert.equal(enqueuePonsBuys(active, [later], verification([later])).accepted[0], later.id);
});

test("one active buy holds the queue throughout generation, delivery and X publication", () => {
  const a = swap(100, 1, "aa"), b = swap(101, 2, "bb");
  let active = reserve(queued([a, b])).state;
  for (const status of ["submitted", "generating", "signed"]) {
    active = observeBuyProgress(active, { sourceId: a.id, status });
    assert.equal(reserve(active).decision.reason, "unresolved_buy");
  }
  active = delivered(active);
  assert.equal(active.entries[0].status, "awaiting_publication");
  assert.equal(reserve(active).decision.kind, "blocked");
  const done = completed(active);
  assert.equal(done.activeSourceId, null);
  assert.equal(reserve(done).decision.intent.sourceId, b.id);
  assert.equal(enqueuePonsBuys(done, [a], verification([a])).accepted.length, 0);
});

test("failed and ambiguous outcomes remain reserved across midnight and cannot silently resubmit", () => {
  for (const status of ["failed", "ambiguous"]) {
    const active = reserve().state, id = active.activeSourceId;
    const blocked = observeBuyProgress(active, { sourceId: id, status, reason: "Outcome requires reconciliation" });
    assert.equal(reserve(clone(blocked), NOW + 86_400_000).decision.reason, "unresolved_buy");
    assert.equal(buyBudget(blocked, "2026-10-26").reserved, BUY_JOB_RESERVE.toString());
    assert.equal(buyBudget(blocked, "2026-10-27").reserved, BUY_JOB_RESERVE.toString());
    assert.throws(() => observeBuyProgress(blocked, { sourceId: id, status: "submitted" }), /retry/);
  }
});

test("publication must match confirmed callback, source and exact answer hash", () => {
  const active = reserve().state, id = active.activeSourceId;
  assert.throws(() => completeBuy(active, { sourceId: id }), /publication/);
  const ready = delivered(active);
  const request = { sourceId: id, actualCycles: T, nowMs: NOW, proofRef: "proof.json", publication: { sourceId: id,
    status: "posted", verified: true, postId: "123", callbackTransactionHash: H("55"), answerHash: H("66") } };
  for (const mutate of [r => { r.publication.status = "sending"; }, r => { r.publication.verified = false; },
    r => { r.publication.sourceId = H("77"); }, r => { r.publication.callbackTransactionHash = H("77"); },
    r => { r.publication.answerHash = H("77"); }, r => { r.publication.postId = "0"; }, r => { r.proofRef = ""; }]) {
    const changed = { ...request, publication: { ...request.publication } }; mutate(changed);
    assert.throws(() => completeBuy(ready, changed));
  }
  assert.equal(completeBuy(ready, request).entries[0].status, "completed");
});

test("conflicting delivery and outcomes for another source never release the active job", () => {
  const active = reserve().state, id = active.activeSourceId;
  assert.throws(() => observeBuyProgress(active, { sourceId: H("77"), status: "submitted" }), /active buy/);
  const ready = delivered(active);
  assert.throws(() => recordBuyDelivery(ready, { sourceId: id, delivery: { sourceId: id,
    confirmed: true, canonical: true, transactionHash: H("77"), answerHash: H("66") } }), /changed/);
  assert.throws(() => recordBuyDelivery(active, { sourceId: id, delivery: { sourceId: id,
    confirmed: false, canonical: true, transactionHash: H("55"), answerHash: H("66") } }), /proof/);
});

test("explicit failure settlement preserves the source tombstone and accounts spent cycles", () => {
  const active = reserve().state, id = active.activeSourceId;
  const failed = observeBuyProgress(active, { sourceId: id, status: "failed", reason: "preflight rejected" });
  const done = settleFailedBuy(failed, { sourceId: id, outcome: "not_executed", actualCycles: "0", nowMs: NOW, proofRef: "verified-no-call.json" });
  assert.equal(done.activeSourceId, null);
  assert.equal(enqueuePonsBuys(done, [swap()], verification([swap()])).accepted.length, 0);
  assert.throws(() => settleFailedBuy(failed, { sourceId: id, outcome: "not_executed", actualCycles: "1", proofRef: "proof" }), /No-execution/);
  const sent = observeBuyProgress(delivered(active), { sourceId: id, status: "ambiguous", reason: "X timeout" });
  assert.throws(() => settleFailedBuy(sent, { sourceId: id, outcome: "not_executed", actualCycles: "0", proofRef: "proof" }), /No-execution/);
  const terminal = settleFailedBuy(sent, { sourceId: id, outcome: "failed_final", actualCycles: T, nowMs: NOW, proofRef: "reconciled-X-and-RH.json" });
  assert.equal(terminal.entries[0].actualCycles, T.toString());
});

test("accounting settlement never skips an unfulfilled buy", () => {
  for (const outcome of ["failed_final", "not_executed"]) {
    const input = queued([swap(100, 1, "aa"), swap(101, 1, "bb")]);
    const first = reserve(input).state, sourceId = first.activeSourceId;
    const failed = observeBuyProgress(first, { sourceId, status: "failed", reason: "Job exhausted its cap" });
    const settled = settleFailedBuy(failed, { sourceId, outcome, actualCycles: outcome === "not_executed" ? "0" : T,
      nowMs: NOW, proofRef: "failure-accounting.json" });
    const next = reserve(settled);
    assert.equal(next.decision.reason, "unfulfilled_prior_buy");
    assert.equal(next.decision.sourceId, sourceId);
    assert.equal(next.state.entries[1].status, "queued");
    assert.deepEqual(next.state, settled);
  }
});

test("a legacy skipped failure blocks even a later active reservation without creating two active entries", () => {
  const a = swap(100, 1, "aa"), b = swap(101, 1, "bb");
  const active = reserve(queued([a, b])).state;
  const failed = observeBuyProgress(active, { sourceId: a.id, status: "failed", reason: "Exhausted cap" });
  const legacy = settleFailedBuy(failed, { sourceId: a.id, outcome: "failed_final", actualCycles: T,
    nowMs: NOW, proofRef: "retained-cost.json" });
  Object.assign(legacy.entries[1], { status: "reserved", reserveCycles: BUY_JOB_RESERVE.toString(),
    reservedAtMs: NOW, reservedDay: "2026-10-26" });
  legacy.activeSourceId = b.id; legacy.lastStarted = b.id;
  const before = clone(legacy), decision = reserve(legacy).decision;
  assert.equal(decision.reason, "unfulfilled_prior_buy");
  assert.equal(decision.sourceId, a.id); assert.equal(decision.activeSourceId, b.id);
  const marked = markBuyRecoveryPending(legacy, { sourceId: a.id, nowMs: NOW, evidenceRef: "operator-review.json" });
  assert.deepEqual(pendingBuyRecovery(marked), { sourceId: a.id, status: "failed_final", activeSourceId: b.id });
  assert.equal(marked.entries.filter(entry => entry.status === "reserved").length, 1);
  assert.equal(marked.entries[0].actualCycles, T.toString());
  delete marked.recoveryHold;
  assert.deepEqual(marked, before);
  assert.deepEqual(legacy, before);
  assert.throws(() => markBuyRecoveryPending(legacy, { sourceId: b.id, nowMs: NOW, evidenceRef: "wrong" }), /earliest/);
});

test("explicit owner deferral preserves the exact third failure and cannot bypass other failures", () => {
  const third = { kind: "swap", id: "0x0f3ab702125c658e4bbed3c7549b0eed269f8b7c4ba78e6759a336dd5aadda64",
    txHash: "0x0a1f851eaeb4cd25df785647fc8fce9acf210907502b688d0d61699c02ef1e45", logIndex: 80,
    blockNumber: 98465902, blockHash: "0xa2051dc9187f4bd5bc46d1ba4b49771c9004317ef1c3fa5d34500d983423a186",
    source: { manager: BUY_POOL.manager, pool_id: BUY_POOL.pool_id,
      transaction_hash: "0x0a1f851eaeb4cd25df785647fc8fce9acf210907502b688d0d61699c02ef1e45", log_index: "80" },
    context: { amount0: "-10430069756648895", amount1: "226484932458221706418700" } };
  const later = swap(98465903, 1, "ef"), proof = verification([third, later], 98466000);
  const enqueued = enqueuePonsBuys(createBuyQueue({ startBlock: third.blockNumber }), [third, later], proof).state;
  const started = reserveNextBuy(enqueued, { nowMs: NOW, verification: proof }).state;
  const failed = observeBuyProgress(started, { sourceId: third.id, status: "failed", reason: "model cap" });
  const settled = settleFailedBuy(failed, { sourceId: third.id, outcome: "failed_final", actualCycles: "1979000000000",
    nowMs: NOW, proofRef: "original-failure.json" });
  assert.equal(pendingBuyRecovery(settled).sourceId, third.id);
  const marked = markBuyOwnerDeferred(settled, { sourceId: third.id, nowMs: NOW,
    authorizationRef: "owner: no recovery move forward no delay", reason: "Owner explicitly chose to continue" });
  const preserved = clone(marked.entries[0]); delete preserved.ownerDeferral;
  assert.deepEqual(preserved, settled.entries[0]);
  assert.equal(pendingBuyRecovery(marked), null);
  const next = reserveNextBuy(marked, { nowMs: NOW, verification: proof });
  assert.equal(next.decision.intent.sourceId, later.id);
  const laterFailed = observeBuyProgress(next.state, { sourceId: later.id, status: "failed", reason: "later failure" });
  const laterSettled = settleFailedBuy(laterFailed, { sourceId: later.id, outcome: "failed_final", actualCycles: "1", nowMs: NOW, proofRef: "later.json" });
  assert.equal(pendingBuyRecovery(laterSettled).sourceId, later.id);
  assert.throws(() => markBuyOwnerDeferred(laterSettled, { sourceId: later.id, nowMs: NOW,
    authorizationRef: "not authorized for this source", reason: "wrong source" }), /exact|third/);
  assert.equal(settled.entries[0].ownerDeferral, undefined);
});

test("owner-granted recovery restores earliest source, parks later work and preserves every old cost", () => {
  const old = recoverableQueue(), before = clone(old), [a, b] = old.entries.map(e => e.event);
  const recovered = reactivateRecoveredBuy(old, { sourceId: a.id, recoveredJob: recoveryJob(a),
    parkedJob: recoveryJob(b, { parked: true }), nowMs: NOW + 1000, evidenceRef: "owner-recovery.json" });
  assert.equal(recovered.activeSourceId, a.id);
  assert.equal(recovered.entries[1].status, "parked");
  assert.equal(recovered.entries.filter(e => e.status === "reserved").length, 1);
  assert.equal(recovered.entries[0].recoveryHistory[0].previousEntry.actualCycles, "1900000000000");
  assert.equal(recovered.entries[0].costBaseline, "2000000000000");
  assert.equal(recovered.entries[0].actualCycles, null);
  assert.equal(recovered.entries[0].recoveryAdmissionNeeded, true);
  assert.deepEqual(buyBudget(recovered, "2026-10-26"), { day: "2026-10-26", budget: "10000000000000",
    spent: "2000000000000", reserved: "4000000000000", available: "4000000000000", overBudget: false });
  const finished = completed(recovered, 3_500_000_000_000n, NOW + 2000);
  assert.equal(finished.entries[0].actualCycles, "1500000000000");
  assert.equal(finished.entries[0].cumulativeActualCycles, "3500000000000");
  assert.equal(buyBudget(finished, "2026-10-26").spent, "3500000000000");
  assert.equal(buyBudget(finished, "2026-10-26").reserved, "2000000000000");
  assert.equal(reserve(finished).decision.reason, "parked_job_requires_owner_resume");
  const resumed = reactivateParkedBuy(finished, { sourceId: b.id, resumedJob: recoveryJob(b, { resumed: true }),
    nowMs: NOW + 3000, evidenceRef: "owner-resume.json" });
  assert.equal(resumed.activeSourceId, b.id); assert.equal(resumed.entries[1].reservedAtMs, old.entries[1].reservedAtMs);
  assert.equal(buyBudget(resumed, "2026-10-26").reserved, "2000000000000");
  assert.deepEqual(old, before);
});

test("recovery refuses missing owner grant, excessive budget, wrong source and nonzero later work", () => {
  const input = recoverableQueue(), [a, b] = input.entries.map(e => e.event);
  for (const mutate of [o => { o.recoveredJob.recovery[0].requires_owner = true; },
    o => { o.recoveredJob.recovery[0].total_budget = "4000000000001"; },
    o => { o.recoveredJob.recovery[0].grants = 0; }, o => { o.recoveredJob.model_cycles = "1"; },
    o => { o.recoveredJob.request.id = b.id; }, o => { o.parkedJob.chunks = 1; },
    o => { o.parkedJob.busy = true; }, o => { o.parkedJob.recovery[0].parked = false; }]) {
    const options = { sourceId: a.id, recoveredJob: recoveryJob(a), parkedJob: recoveryJob(b, { parked: true }),
      nowMs: NOW + 1000, evidenceRef: "owner-proof" };
    mutate(options); assert.throws(() => reactivateRecoveredBuy(input, options));
  }
});

test("whole-worker recovery archives errors and pending markers without deleting source or cost history", () => {
  const queue = recoverableQueue(), [a, b] = queue.entries.map(e => e.event);
  const journal = { binding: { gateway: "preserved" }, nextBlock: 200, buyQueue: queue, requests: [
    { ...a, state: "failed", error: "model cap", modelCycles: "1900000000000" },
    { ...b, state: "queued", pendingUpdate: { operation: "submit" } },
  ] };
  const before = clone(journal);
  const recovered = migrateBuyWorkerRecovery(journal, { sourceId: a.id, recoveredJob: recoveryJob(a),
    parkedJob: recoveryJob(b, { parked: true }), nowMs: NOW + 1000, evidenceRef: "verified-owner-proof" });
  assert.deepEqual(recovered.binding, journal.binding); assert.equal(recovered.nextBlock, 200);
  assert.equal(recovered.requests[0].state, "queued"); assert.equal(recovered.requests[1].state, "parked");
  assert.equal(recovered.requests[0].operatorRecoveryHistory[0].previous.error, "model cap");
  assert.equal(recovered.requests[1].operatorRecoveryHistory[0].previous.pendingUpdate.operation, "submit");
  const completedQueue = completed(recovered.buyQueue, 3_500_000_000_000n, NOW + 2000);
  const resumed = migrateParkedWorkerResume({ ...recovered, buyQueue: completedQueue }, {
    sourceId: b.id, resumedJob: recoveryJob(b, { resumed: true }), nowMs: NOW + 3000, evidenceRef: "resume-proof" });
  assert.equal(resumed.requests[1].state, "queued"); assert.equal(resumed.buyQueue.activeSourceId, b.id);
  assert.deepEqual(journal, before);
});

test("daily budget reserves 2T and charges actual cost, preserving holds over UTC midnight", () => {
  const a = swap(100, 1, "aa"), b = swap(101, 1, "bb");
  const input = queued([a, b], { dailyCycleBudget: 3n * T, minimumRemainingCycles: 2n * T });
  const active = reserve(input).state;
  assert.equal(buyBudget(active, "2026-10-26").reserved, BUY_JOB_RESERVE.toString());
  assert.equal(reserve(active, NOW + 86_400_000).decision.reason, "unresolved_buy");
  const done = completed(active, 1_400_000_000_000n);
  assert.equal(buyBudget(done, "2026-10-26").spent, "1400000000000");
  assert.equal(reserve(done).decision.reason, "daily_cycle_budget");
  assert.equal(reserve(done, NOW + 86_400_000).decision.kind, "start");
});

test("overnight jobs conservatively charge every touched UTC day and cannot reset their budget at midnight", () => {
  const late = Date.parse("2026-10-26T23:59:00Z"), afterMidnight = Date.parse("2026-10-27T00:15:00Z");
  const input = queued([swap(100, 1, "aa"), swap(101, 1, "bb")], { dailyCycleBudget: 3n * T });
  const active = reserve(input, late).state;
  assert.equal(buyBudget(active, "2026-10-27").reserved, BUY_JOB_RESERVE.toString());
  assert.equal(buyBudget(active, "2026-10-25").reserved, "0");
  const done = completed(active, 1_400_000_000_000n, afterMidnight);
  for (const day of ["2026-10-26", "2026-10-27"])
    assert.equal(buyBudget(done, day).spent, "1400000000000");
  assert.equal(buyBudget(done, "2026-10-28").spent, "0");
  assert.equal(reserve(done, afterMidnight).decision.reason, "daily_cycle_budget");
  assert.equal(reserve(done, Date.parse("2026-10-28T00:00:00Z")).decision.kind, "start");
});

test("failure reconciliation across several days charges the measured cost and rejects backward settlement time", () => {
  const active = reserve(queued([swap()], { dailyCycleBudget: 3n * T })).state, id = active.activeSourceId;
  const failed = observeBuyProgress(active, { sourceId: id, status: "ambiguous", reason: "Unresolved call" });
  assert.throws(() => settleFailedBuy(failed, { sourceId: id, outcome: "failed_final", actualCycles: T,
    proofRef: "evidence", nowMs: NOW - 1 }), /predates/);
  const done = settleFailedBuy(failed, { sourceId: id, outcome: "failed_final", actualCycles: T,
    proofRef: "evidence", nowMs: Date.parse("2026-10-28T10:00:00Z") });
  for (const day of ["2026-10-26", "2026-10-27", "2026-10-28"])
    assert.equal(buyBudget(done, day).spent, T.toString());
  assert.throws(() => buyBudget(done, "2026-02-30"));
});

test("balance age and reserve floor block before intent without dropping the queued buy", () => {
  const input = queued([swap()], { dailyCycleBudget: 10n * T, minimumRemainingCycles: 3n * T });
  const ctx = { nowMs: NOW, verification: verification([swap()]), balance: { cycles: (5n * T).toString(), observedAtMs: NOW } };
  assert.equal(reserveNextBuy(input, ctx).decision.kind, "start");
  assert.equal(reserveNextBuy(input, { ...ctx, balance: { ...ctx.balance, cycles: (5n * T - 1n).toString() } }).decision.reason, "minimum_cycle_balance");
  for (const delta of [-60_001, 5_001]) assert.equal(reserveNextBuy(input, { ...ctx, balance: { ...ctx.balance, observedAtMs: NOW + delta } }).decision.reason, "stale_cycle_balance");
  assert.equal(input.entries[0].status, "queued");
  const floorOnly = queued([swap()], { minimumRemainingCycles: 3n * T });
  assert.equal(reserveNextBuy(floorOnly, { ...ctx, balance: { ...ctx.balance, cycles: "1" } }).decision.reason, "minimum_cycle_balance");
});

test("recorded costs never hide a reserve overrun", () => {
  const input = queued([swap()], { dailyCycleBudget: 2n * T });
  const done = completed(reserve(input).state, 2n * T + 1n);
  assert.equal(done.entries[0].reserveOverrun, true);
  assert.equal(buyBudget(done, "2026-10-26").overBudget, true);
});

test("zero daily cap is unlimited and large actual thought costs remain measured without truncation", () => {
  assert.equal(normalizeBuyCycleCap("0"), null);
  assert.equal(state({ dailyCycleBudget: "0" }).policy.dailyCycleBudget, null);
  const done = completed(reserve(queued([swap()], { dailyCycleBudget: "0" })).state, 9n * T);
  assert.equal(done.entries[0].status, "completed");
  assert.equal(done.entries[0].actualCycles, (9n * T).toString());
  assert.equal(buyBudget(done, "2026-10-26").spent, (9n * T).toString());
});

test("explicit unlimited owner recovery does not reintroduce a 4T or deadline cutoff", () => {
  const old = recoverableQueue(), [a, b] = old.entries.map(entry => entry.event);
  const recoveredJob = recoveryJob(a, { carry: 5n * T });
  recoveredJob.recovery[0].total_budget = "0";
  recoveredJob.recovery[0].resume_deadline = "0";
  const restored = reactivateRecoveredBuy(old, { sourceId: a.id, recoveredJob,
    parkedJob: recoveryJob(b, { parked: true }), nowMs: NOW + 1000, evidenceRef: "verified-uncapped-owner-policy" });
  assert.equal(restored.entries[0].costBaseline, (5n * T).toString());
  const done = completed(restored, 8n * T, NOW + 2000);
  assert.equal(done.entries[0].cumulativeActualCycles, (8n * T).toString());
  assert.equal(done.entries[0].actualCycles, (3n * T).toString());
  assert.equal(buyBudget(done, "2026-10-26").spent, (8n * T).toString());
});

function retainedFixture() {
  const first = swap(100, 1, "aa"), current = swap(101, 1, "bb"), next = swap(102, 1, "cc");
  let queue = completed(reserve(queued([first, current, next], { dailyCycleBudget: "0" })).state, T);
  queue = reserve(queue).state;
  queue = observeBuyProgress(queue, { sourceId: current.id, status: "failed", reason: "old model budget" });
  const job = recoveryJob(current, { carry: 1_984_626_103_023n });
  job.phase = { Running: null }; job.chunks = 47;
  Object.assign(job.recovery[0], { total_budget: "0", rebuilding: false, max_chunks: 0, resume_deadline: "0",
    cache_evidence_hash: [H("12")] });
  const journal = { binding: { gateway: "preserved" }, nextBlock: 110, buyQueue: queue,
    requests: [{ ...first, state: "fulfilled", publication: { status: "posted" } },
      { ...current, state: "failed", phase: "Failed", error: "old model budget", modelCycles: "1984626103023",
        buyHalt: { reason: "old limit" }, pendingUpdate: { operation: "advance" } }, next] };
  return { journal, options: { sourceId: current.id, resumedJob: job, expectedCycles: "1984626103023", expectedChunks: 47,
    cacheEvidenceHash: H("12"), nowMs: NOW + 1000, evidenceRef: "certified-retained-cache.json" } };
}

test("retained cache resume keeps one reservation and every cost while archiving old failure markers", () => {
  const { journal, options } = retainedFixture(), before = structuredClone(journal);
  const resumed = resumeRetainedWorkerJob(journal, options), entry = resumed.buyQueue.entries[1], item = resumed.requests[1];
  assert.equal(entry.status, "generating"); assert.equal(entry.actualCycles, null);
  assert.equal(entry.reserveCycles, BUY_JOB_RESERVE.toString());
  assert.equal(entry.reservedAtMs, before.buyQueue.entries[1].reservedAtMs);
  assert.equal(entry.costBaseline, before.buyQueue.entries[1].costBaseline);
  assert.equal(entry.recoveryAdmissionNeeded, undefined);
  assert.equal(item.state, "queued"); assert.equal(item.phase, "Running");
  assert.equal(item.modelCycles, options.expectedCycles);
  assert.equal(item.error, undefined); assert.equal(item.pendingUpdate, undefined); assert.equal(item.buyHalt, undefined);
  assert.equal(item.operatorRecoveryHistory[0].previous.error, "old model budget");
  assert.deepEqual(resumed.requests[0], before.requests[0]);
  assert.deepEqual(resumed.buyQueue.entries[0], before.buyQueue.entries[0]);
  assert.equal(resumed.buyQueue.entries[2].status, "queued");
  assert.equal(buyBudget(resumed.buyQueue, "2026-10-26").reserved, (2n * T).toString());
  const done = completed(resumed.buyQueue, 7n * T, NOW + 2000);
  assert.equal(done.entries[1].actualCycles, (7n * T).toString());
  assert.equal(buyBudget(done, "2026-10-26").spent, (8n * T).toString());
  assert.deepEqual(journal, before);
});

test("retained resume refuses changed counters, cache, source, policy, or unresolved safety state", () => {
  for (const alter of [o => { o.expectedCycles = "1"; }, o => { o.expectedChunks++; },
    o => { o.cacheEvidenceHash = H("13"); }, o => { o.resumedJob.request.id = H("14"); },
    o => { o.resumedJob.busy = true; }, o => { o.resumedJob.phase = { Verified: null }; },
    o => { o.resumedJob.recovery[0].total_budget = "2000000000000"; },
    o => { o.resumedJob.recovery[0].max_chunks = 48; }, o => { o.resumedJob.recovery[0].resume_deadline = "99"; },
    ...["requires_owner", "accounting_uncertain", "parked", "rebuilding"].map(key => o => { o.resumedJob.recovery[0][key] = true; })]) {
    const { journal, options } = retainedFixture(); alter(options);
    assert.throws(() => resumeRetainedWorkerJob(journal, options));
  }
});

test("state rejects duplicate active jobs, changed reserves and reordered FIFO after restart", () => {
  const a = swap(100, 1, "aa"), b = swap(101, 2, "bb");
  const original = reserve(queued([a, b])).state;
  for (const mutate of [s => { s.entries.reverse(); }, s => { s.activeSourceId = b.id; },
    s => { s.entries[0].reserveCycles = "1"; }, s => { s.entries.push(clone(s.entries[0])); },
    s => { s.entries[0].actualCycles = "0"; }, s => { s.entries[0].status = "completed"; s.entries[0].actualCycles = "1"; s.entries[0].proofRef = "fake"; s.activeSourceId = null; }]) {
    const changed = clone(original); mutate(changed); assert.throws(() => reserve(changed));
  }
});

function skipFailures(input) {
  return setBuyFailurePolicy(input, { skipFailedBuys: true, nowMs: NOW,
    authorizationRef: "owner: skip failed jobs and move to next; never repeat a thought", reason: "Explicit owner policy" });
}
function failedJob(event, cycles = T) {
  const job = recoveryJob(event, { carry: cycles });
  job.phase = { Failed: null }; job.recovery[0].rebuilding = false;
  return job;
}

test("explicit skip policy advances past terminal failures while retaining costs and source tombstones", () => {
  for (const outcome of ["failed_final", "not_executed"]) {
    const first = swap(100, 1, "aa"), next = swap(101, 1, "bb");
    let queue = reserve(queued([first, next])).state;
    queue = observeBuyProgress(queue, { sourceId: first.id, status: "failed", reason: "terminal failure" });
    queue = settleFailedBuy(queue, { sourceId: first.id, outcome,
      actualCycles: outcome === "failed_final" ? T : "0", nowMs: NOW, proofRef: "terminal-proof.json" });
    const before = clone(queue);
    queue = skipFailures(queue);
    assert.deepEqual(queue.entries, before.entries);
    assert.equal(pendingBuyRecovery(queue), null);
    assert.equal(reserve(clone(queue)).decision.intent.sourceId, next.id);
    assert.equal(enqueuePonsBuys(queue, [first], verification([first])).accepted.length, 0);
    assert.equal(buyBudget(queue, "2026-10-26").spent, outcome === "failed_final" ? T.toString() : "0");
    assert.equal(queue.entries[0].status, outcome);
    assert.throws(() => reactivateRecoveredBuy(queue, { sourceId: first.id }), /earliest/);
  }
});

test("skip policy archives a terminal recovery hold without dropping the failed record", () => {
  let queue = reserve(queued()).state, sourceId = queue.activeSourceId;
  queue = observeBuyProgress(queue, { sourceId, status: "failed", reason: "terminal" });
  queue = settleFailedBuy(queue, { sourceId, outcome: "failed_final", actualCycles: T, nowMs: NOW, proofRef: "failed.json" });
  queue = markBuyRecoveryPending(queue, { sourceId, nowMs: NOW, evidenceRef: "old recovery request" });
  const skipped = skipFailures(queue);
  assert.equal(skipped.recoveryHold, null);
  assert.equal(skipped.recoveryHoldHistory[0].sourceId, sourceId);
  assert.deepEqual(skipped.entries, queue.entries);
  assert.equal(queue.policy.skipFailedBuys, undefined);
  assert.throws(() => reserve({ ...skipped, policy: { ...skipped.policy, failurePolicyAuthorization: null } }), /authorization/);
});

test("observed terminal failure is source-bound and charges cumulative recovered costs exactly once", () => {
  const old = recoverableQueue(), [first, next] = old.entries.map(entry => entry.event);
  let restored = reactivateRecoveredBuy(old, { sourceId: first.id, recoveredJob: recoveryJob(first),
    parkedJob: recoveryJob(next, { parked: true }), nowMs: NOW, evidenceRef: "recovered.json" });
  restored = skipFailures(restored);
  const settled = settleObservedFailedBuy(restored, { sourceId: first.id, job: failedJob(first, 3_500_000_000_000n),
    nowMs: NOW + 1000, evidenceRef: "fresh-certified-failed-job.json" });
  assert.equal(settled.entries[0].status, "failed_final");
  assert.equal(settled.entries[0].actualCycles, "1500000000000");
  assert.equal(settled.entries[0].cumulativeActualCycles, "3500000000000");
  assert.equal(buyBudget(settled, "2026-10-26").spent, "3500000000000");
  assert.equal(settled.activeSourceId, null);
  assert.equal(pendingBuyRecovery(settled), null);
  assert.equal(settled.entries[0].failureObservation.phase, "Failed");
});

test("failure policy never releases busy, uncertain, wrong-source, or ambiguous work", () => {
  const queue = skipFailures(reserve(queued()).state), sourceId = queue.activeSourceId, event = queue.entries[0].event;
  for (const mutate of [o => { o.job.busy = true; }, o => { o.job.phase = { Running: null }; },
    o => { o.job.phase.Running = null; }, o => { o.job.recovery[0].accounting_uncertain = true; },
    o => { o.job.request.id = H("44"); }, o => { o.pendingUpdate = { operation: "advance" }; },
    o => { o.deliveryUncertain = true; }, o => { o.publicationUncertain = true; }]) {
    const options = { sourceId, job: failedJob(event), nowMs: NOW, evidenceRef: "failed.json" };
    mutate(options); assert.throws(() => settleObservedFailedBuy(queue, options));
    assert.equal(reserve(queue).decision.reason, "unresolved_buy");
  }
  const ambiguous = observeBuyProgress(queue, { sourceId, status: "ambiguous", reason: "update pending" });
  assert.throws(() => settleObservedFailedBuy(ambiguous, { sourceId, job: failedJob(event), nowMs: NOW, evidenceRef: "failed.json" }), /Uncertain/);
  assert.equal(reserve(ambiguous).decision.reason, "unresolved_buy");
});

test("duplicate result is failed-final with cost and no false completion or publication", () => {
  const first = swap(100, 1, "aa"), next = swap(101, 1, "bb");
  const queue = skipFailures(reserve(queued([first, next])).state), before = clone(queue);
  const rejected = rejectBuyResult(queue, { sourceId: first.id, answerHash: H("77"), duplicateOf: H("88"),
    reason: "DUPLICATE_THOUGHT", actualCycles: 3n * T, nowMs: NOW, proofRef: "duplicate-result.json" });
  assert.equal(rejected.entries[0].status, "failed_final");
  assert.equal(rejected.entries[0].rejectedResult.published, false);
  assert.equal(rejected.entries[0].rejectedResult.duplicateOf, H("88"));
  assert.equal(rejected.entries[0].publication, undefined);
  assert.equal(buyBudget(rejected, "2026-10-26").spent, (3n * T).toString());
  assert.equal(reserve(rejected).decision.intent.sourceId, next.id);
  assert.equal(enqueuePonsBuys(rejected, [first], verification([first])).accepted.length, 0);
  assert.deepEqual(queue, before);
});

test("duplicate rejection preserves confirmed delivery but refuses uncertain delivery or publication", () => {
  const active = skipFailures(delivered(reserve().state)), sourceId = active.activeSourceId;
  const options = { sourceId, answerHash: H("66"), reason: "DUPLICATE_THOUGHT", actualCycles: T,
    nowMs: NOW, proofRef: "duplicate-after-delivery.json" };
  const rejected = rejectBuyResult(active, options);
  assert.deepEqual(rejected.entries[0].delivery, active.entries[0].delivery);
  assert.equal(rejected.entries[0].status, "failed_final");
  for (const extra of [{ pendingUpdate: { operation: "sign" } }, { publicationUncertain: true }, { deliveryUncertain: true }, { answerHash: H("99") }, { duplicateOf: sourceId }])
    assert.throws(() => rejectBuyResult(active, { ...options, ...extra }));
  const ambiguous = observeBuyProgress(active, { sourceId, status: "ambiguous", reason: "X may have posted" });
  assert.throws(() => rejectBuyResult(ambiguous, options), /Uncertain/);
});
