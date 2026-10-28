import test from "node:test";
import assert from "node:assert/strict";
import { swapSourceId } from "../worker/swaps.mjs";
import { CADENCE_INTERVAL_MS as INTERVAL, CADENCE_JOB_RESERVE as RESERVE,
  CADENCE_POOL_ID, CADENCE_MANAGER, cadenceSlot, latestConfirmedPonsSwap,
  createCadenceState, cadenceBudget, admitCadence, observeCadence, settleCadence } from "../worker/cadence.mjs";

const START = Date.parse("2026-10-26T12:00:00Z"), T = 1_000_000_000_000n;
const clone = value => JSON.parse(JSON.stringify(value));
function state(budget = 6n * T) {
  return createCadenceState({ dailyCycleBudget: budget.toString(), minimumRemainingCycles: (3n * T).toString() });
}
function swap(blockNumber = 100, logIndex = 0, salt = "ab") {
  const txHash = "0x" + salt.repeat(32);
  const source = { manager: CADENCE_MANAGER, pool_id: CADENCE_POOL_ID,
    transaction_hash: txHash, log_index: String(logIndex) };
  return { id: swapSourceId(4663, source), kind: "swap", source, txHash, logIndex, blockNumber,
    blockHash: "0x" + "cc".repeat(32), canonical: true, confirmed: true };
}
function context(nowMs = START, swaps = [swap()], balanceCycles = 10n * T) {
  return { nowMs, headBlockNumber: 1000, swaps,
    balance: { cycles: balanceCycles.toString(), observedAtMs: nowMs } };
}
function admitted(input = state(), ctx = context()) {
  const result = admitCadence(input, ctx);
  assert.equal(result.decision.kind, "admit");
  return result;
}
function finish(admission, cost = T, outcome = "completed") {
  const { slotId, sourceId } = admission.decision.intent;
  return settleCadence(admission.state, { slotId, sourceId, outcome,
    actualCycles: cost.toString(), jobId: sourceId, proofRef: "verified-receipt-and-cycle-snapshot.json" });
}

test("cadence uses fixed UTC half-hour slots including exact boundaries and day rollover", () => {
  const first = cadenceSlot(START), last = cadenceSlot(START + INTERVAL - 1);
  assert.equal(first.slotId, last.slotId);
  assert.equal(cadenceSlot(START + INTERVAL).slotId, first.slotId + 1);
  assert.equal(cadenceSlot(Date.parse("2026-10-26T23:59:59.999Z")).day, "2026-10-26");
  assert.equal(cadenceSlot(Date.parse("2026-10-27T00:00:00Z")).day, "2026-10-27");
  for (const invalid of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => cadenceSlot(invalid));
});

test("selects latest unseen canonical confirmed Pons swap with required depth", () => {
  const old = swap(100, 0, "aa"), latest = swap(110, 7, "bb"), sibling = swap(110, 6, "dd");
  const tooNew = swap(995, 0, "ee"), unconfirmed = { ...swap(120, 0, "ff"), confirmed: false };
  const uncanonical = { ...swap(125, 0, "01"), canonical: false };
  assert.equal(latestConfirmedPonsSwap([old, sibling, latest, tooNew, unconfirmed, uncanonical], { headBlockNumber: 1000 }).id, latest.id);
  assert.equal(latestConfirmedPonsSwap([old, latest, sibling], { headBlockNumber: 1000, seenSourceIds: [latest.id] }).id, sibling.id);
  assert.equal(latestConfirmedPonsSwap([tooNew], { headBlockNumber: 1000 }), null);
  assert.equal(latestConfirmedPonsSwap([swap(988)], { headBlockNumber: 1000 }).blockNumber, 988);
});

test("rejects foreign pools, wrong IDs and conflicting confirmed observations", () => {
  const foreign = swap(); foreign.source.pool_id = "0x" + "dd".repeat(32);
  assert.throws(() => latestConfirmedPonsSwap([foreign], { headBlockNumber: 1000 }), /selected Pons/);
  const wrongId = swap(); wrongId.id = "0x" + "ef".repeat(32);
  assert.throws(() => latestConfirmedPonsSwap([wrongId], { headBlockNumber: 1000 }), /canonical/);
  assert.throws(() => latestConfirmedPonsSwap([{ ...swap(), chainId: 1 }], { headBlockNumber: 1000 }), /Pons/);
  const changedBlock = { ...swap(), blockHash: "0x" + "de".repeat(32) };
  assert.throws(() => latestConfirmedPonsSwap([swap(), changedBlock], { headBlockNumber: 1000 }), /Conflicting/);
  assert.throws(() => latestConfirmedPonsSwap([swap(100, 0, "ab"), swap(100, 0, "cd")], { headBlockNumber: 1000 }), /log position/);
});

test("reserves two trillion cycles before returning an intent and supports durable JSON roundtrip", () => {
  const before = state(), original = clone(before), result = admitted(before);
  assert.deepEqual(before, original);
  assert.equal(result.decision.intent.reserveCycles, RESERVE.toString());
  assert.equal(result.state.slots[0].status, "reserved");
  assert.deepEqual(cadenceBudget(clone(result.state), "2026-10-26"), {
    day: "2026-10-26", budget: (6n * T).toString(), spent: "0", reserved: RESERVE.toString(), available: (4n * T).toString(), overBudget: false });
  const duplicate = admitCadence(clone(result.state), context(START + 1000));
  assert.equal(duplicate.decision.kind, "noop");
  assert.equal(duplicate.decision.reason, "slot_already_sealed");
  assert.deepEqual(duplicate.state, result.state);
});

test("quiet slots are sealed without inventing a thought and do not admit late swaps", () => {
  const quiet = admitCadence(state(), context(START, []));
  assert.equal(quiet.decision.reason, "no_new_confirmed_pons_swap");
  assert.equal(quiet.state.slots[0].source, null);
  assert.equal(admitCadence(quiet.state, context(START + 60_000)).decision.kind, "noop");
  assert.equal(admitCadence(quiet.state, context(START + INTERVAL)).decision.kind, "admit");
});

test("missed slots never produce a catchup burst and a backward clock cannot replay them", () => {
  const completed = finish(admitted());
  const later = admitted(completed, context(START + 8 * INTERVAL, [swap(200, 3, "bb"), swap(210, 0, "dd")]));
  assert.equal(later.state.slots.length, 2);
  assert.equal(later.state.slots[1].slotId - later.state.slots[0].slotId, 8);
  assert.equal(later.decision.intent.sourceId, swap(210, 0, "dd").id);
  const backwards = admitCadence(later.state, context(START + INTERVAL));
  assert.equal(backwards.decision.reason, "clock_regression");
  assert.deepEqual(backwards.state, later.state);
});

test("submitted, failed and ambiguous outcomes hold their reservation and block all new jobs", () => {
  const admission = admitted(), { slotId, sourceId } = admission.decision.intent;
  const submitted = observeCadence(admission.state, { slotId, sourceId, jobId: sourceId, status: "submitted" });
  for (const status of ["submitted", "failed", "ambiguous"]) {
    const pending = status === "submitted" ? submitted : observeCadence(submitted, { slotId, sourceId, status, reason: "reconciliation required" });
    assert.equal(cadenceBudget(pending, "2026-10-26").reserved, RESERVE.toString());
    const blocked = admitCadence(pending, context(START + INTERVAL, [swap(200, 0, "cd")]));
    assert.equal(blocked.decision.reason, "unresolved_job");
    assert.equal(blocked.state.slots[0].status, status);
    assert.equal(blocked.state.slots[1].status, "skipped");
    if (status !== "submitted") assert.throws(() => observeCadence(pending, { slotId, sourceId, jobId: sourceId, status: "submitted" }), /resubmit/);
  }
});

test("unresolved reservation survives UTC midnight and stays charged to its original day", () => {
  const admission = admitted(state(), context(Date.parse("2026-10-26T23:30:00Z")));
  const afterMidnight = admitCadence(admission.state, context(Date.parse("2026-10-27T00:00:00Z"), [swap(200, 1, "cd")]));
  assert.equal(afterMidnight.decision.reason, "unresolved_job");
  assert.equal(cadenceBudget(afterMidnight.state, "2026-10-26").reserved, RESERVE.toString());
  assert.equal(cadenceBudget(afterMidnight.state, "2026-10-27").reserved, "0");
});

test("daily admission uses actual settled cost plus the full next-job reservation", () => {
  const first = admitted(state(3n * T));
  const completed = finish(first, 1_400_000_000_000n);
  const budget = cadenceBudget(completed, "2026-10-26");
  assert.equal(budget.spent, "1400000000000"); assert.equal(budget.reserved, "0");
  const denied = admitCadence(completed, context(START + INTERVAL, [swap(200, 0, "cd")]));
  assert.equal(denied.decision.reason, "daily_cycle_budget");
  const nextDay = admitCadence(denied.state, context(START + 24 * 60 * 60 * 1000, [swap(200, 0, "cd")]));
  assert.equal(nextDay.decision.kind, "admit");
});

test("fresh balance must leave the configured reserve floor after the whole two-trillion job", () => {
  assert.equal(admitCadence(state(), context(START, [swap()], 5n * T - 1n)).decision.reason, "minimum_cycle_balance");
  assert.equal(admitCadence(state(), context(START, [swap()], 5n * T)).decision.kind, "admit");
  for (const delta of [-60_001, 5_001]) {
    const ctx = context(); ctx.balance.observedAtMs += delta;
    assert.equal(admitCadence(state(), ctx).decision.reason, "stale_cycle_balance");
  }
});

test("explicit no-execution reconciliation releases held cycles but consumes source and slot forever", () => {
  const admission = admitted(), { slotId, sourceId } = admission.decision.intent;
  const uncertain = observeCadence(admission.state, { slotId, sourceId, status: "ambiguous", reason: "ingress outcome unknown" });
  assert.throws(() => settleCadence(uncertain, { slotId, sourceId, outcome: "not_executed", actualCycles: "0", proofRef: "" }), /proof/);
  const done = settleCadence(uncertain, { slotId, sourceId, outcome: "not_executed", actualCycles: "0", proofRef: "verified-no-job-no-ingress.json" });
  assert.equal(cadenceBudget(done, "2026-10-26").reserved, "0");
  assert.equal(admitCadence(done, context()).decision.kind, "noop");
  assert.equal(admitCadence(done, context(START + INTERVAL)).decision.reason, "no_new_confirmed_pons_swap");
  assert.throws(() => settleCadence(done, { slotId, sourceId, outcome: "not_executed", actualCycles: "0", proofRef: "again" }), /unresolved/);
});

test("settlement records a real reserve overrun without concealing it or permitting more spending", () => {
  const done = finish(admitted(state(2n * T)), 2n * T + 1n);
  assert.equal(done.slots[0].reserveOverrun, true);
  assert.equal(cadenceBudget(done, "2026-10-26").overBudget, true);
  assert.equal(admitCadence(done, context(START + INTERVAL, [swap(200, 0, "cd")])).decision.reason, "daily_cycle_budget");
});

test("outcomes are bound to the exact reserved slot, source and job", () => {
  const admission = admitted(), { slotId, sourceId } = admission.decision.intent;
  const wrong = swap(200, 0, "cd").id;
  assert.throws(() => observeCadence(admission.state, { slotId, sourceId: wrong, status: "failed", reason: "x" }), /unresolved/);
  assert.throws(() => observeCadence(admission.state, { slotId, sourceId, status: "submitted", jobId: wrong }), /change/);
  assert.throws(() => settleCadence(admission.state, { slotId, sourceId, jobId: wrong, outcome: "completed", actualCycles: "1", proofRef: "proof" }), /differs/);
  assert.throws(() => settleCadence(admission.state, { slotId, sourceId, outcome: "not_executed", actualCycles: "1", proofRef: "proof" }), /spent/);
});

test("corrupt or mixed-binding saved journals fail closed", () => {
  const good = admitted().state;
  for (const change of [
    s => { s.poolId = "0x" + "aa".repeat(32); },
    s => { s.intervalMs = 1000; },
    s => { s.slots[0].reserveCycles = "1"; },
    s => { s.slots.push(clone(s.slots[0])); },
    s => { s.slots[0].actualCycles = "0"; },
    s => { s.slots[0].intentId = "another"; },
  ]) { const bad = clone(good); change(bad); assert.throws(() => admitCadence(bad, context(START + INTERVAL))); }
  const extra = clone(good), second = swap(200, 0, "cd"), nextSlot = cadenceSlot(START + INTERVAL);
  extra.slots.push({ ...clone(extra.slots[0]), slotId: nextSlot.slotId, atMs: START + INTERVAL,
    source: second, intentId: `pons:${nextSlot.slotId}:${second.id}` });
  assert.throws(() => admitCadence(extra, context(START + 2 * INTERVAL)), /more than one unresolved/);
});
