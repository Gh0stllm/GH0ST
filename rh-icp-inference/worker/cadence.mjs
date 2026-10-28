import { swapSourceId } from "./swaps.mjs";

// Offline admission only. There are no timers, network calls, wallets or writes.
// The caller must hold an exclusive journal lock and durably save returned state
// BEFORE acting on an admitted intent. Retry from that saved state after a crash.
export const CADENCE_INTERVAL_MS = 1_800_000;
export const CADENCE_JOB_RESERVE = 2_000_000_000_000n;
export const CADENCE_CHAIN_ID = 4663;
export const CADENCE_CONFIRMATIONS = 12;
export const CADENCE_POOL_ID = "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01";
export const CADENCE_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const SCHEMA = "gh0st-pons-cadence-v1";
const UNRESOLVED = new Set(["reserved", "submitted", "failed", "ambiguous"]);
const SETTLED = new Set(["completed", "not_executed", "failed_final"]);
const MAX_BALANCE_AGE_MS = 60_000;
const integer = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error(`Invalid ${label}`);
  return value;
};
const cycles = (value, label) => {
  if (typeof value === "bigint") {
    if (value < 0n) throw Error(`Invalid ${label}`);
    return value;
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error(`Invalid ${label}`);
  return BigInt(value);
};
const hash = (value, label) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value))
    throw Error(`Invalid ${label}`);
  return value.toLowerCase();
};
const reasonText = value => {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) throw Error("Invalid outcome reason or proof reference");
  return value;
};
const dayForSlot = slot => new Date(slot * CADENCE_INTERVAL_MS).toISOString().slice(0, 10);

export function cadenceSlot(nowMs) {
  integer(nowMs, "UTC timestamp");
  if (nowMs > 253_402_300_799_999) throw Error("UTC timestamp outside supported range");
  const slotId = Math.floor(nowMs / CADENCE_INTERVAL_MS);
  return { slotId, startMs: slotId * CADENCE_INTERVAL_MS,
    endMs: (slotId + 1) * CADENCE_INTERVAL_MS, day: dayForSlot(slotId) };
}

function sourceRecord(value) {
  if (!value || value.kind !== "swap" || !value.source ||
      (value.chainId != null && String(value.chainId) !== String(CADENCE_CHAIN_ID)) ||
      value.source.manager?.toLowerCase() !== CADENCE_MANAGER ||
      value.source.pool_id?.toLowerCase() !== CADENCE_POOL_ID)
    throw Error("Cadence accepts only the selected Pons swap source");
  const txHash = hash(value.txHash, "swap transaction hash");
  const blockHash = hash(value.blockHash, "swap block hash");
  const logIndex = integer(value.logIndex, "swap log index");
  const blockNumber = integer(value.blockNumber, "swap block number");
  if (value.source.transaction_hash?.toLowerCase() !== txHash ||
      BigInt(value.source.log_index) !== BigInt(logIndex)) throw Error("Swap receipt and source disagree");
  const source = { manager: CADENCE_MANAGER, pool_id: CADENCE_POOL_ID,
    transaction_hash: txHash, log_index: String(logIndex) };
  const id = swapSourceId(CADENCE_CHAIN_ID, source);
  if (hash(value.id, "swap source ID") !== id) throw Error("Swap source ID is not canonical");
  return { id, kind: "swap", txHash, logIndex, blockNumber, blockHash, source };
}

// `canonical` and `confirmed` attestations must come from the caller's existing
// receipt/reorg verification, never from arbitrary API or social input. This
// function also checks the numerical depth against the caller's current head.
export function latestConfirmedPonsSwap(swaps, { headBlockNumber, seenSourceIds = [] }) {
  integer(headBlockNumber, "head block");
  if (!Array.isArray(swaps) || !Array.isArray(seenSourceIds)) throw Error("Invalid swap candidates");
  const seen = new Set(seenSourceIds.map(id => hash(id, "seen source ID")));
  const candidates = new Map(), positions = new Map();
  for (const input of swaps) {
    const candidate = sourceRecord(input); // Foreign pools fail closed, even if unconfirmed.
    if (input.canonical !== true || input.confirmed !== true ||
        candidate.blockNumber + CADENCE_CONFIRMATIONS > headBlockNumber || seen.has(candidate.id)) continue;
    const existing = candidates.get(candidate.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) throw Error("Conflicting confirmed source observations");
    const position = `${candidate.blockNumber}:${candidate.logIndex}`;
    if (positions.has(position) && positions.get(position) !== candidate.id) throw Error("Conflicting canonical log position");
    positions.set(position, candidate.id);
    candidates.set(candidate.id, candidate);
  }
  return [...candidates.values()].sort((a, b) => b.blockNumber - a.blockNumber ||
    b.logIndex - a.logIndex || b.txHash.localeCompare(a.txHash))[0] ?? null;
}

export function createCadenceState({ dailyCycleBudget, minimumRemainingCycles }) {
  return { schema: SCHEMA, intervalMs: CADENCE_INTERVAL_MS, chainId: CADENCE_CHAIN_ID,
    poolId: CADENCE_POOL_ID, manager: CADENCE_MANAGER,
    policy: { dailyCycleBudget: cycles(dailyCycleBudget, "daily cycle budget").toString(),
      minimumRemainingCycles: cycles(minimumRemainingCycles, "minimum remaining cycles").toString() }, slots: [] };
}

function checkedState(input) {
  if (!input || input.schema !== SCHEMA || input.intervalMs !== CADENCE_INTERVAL_MS ||
      input.chainId !== CADENCE_CHAIN_ID || input.poolId !== CADENCE_POOL_ID || input.manager !== CADENCE_MANAGER ||
      !Array.isArray(input.slots)) throw Error("Cadence journal binding differs from the fixed Pons policy");
  cycles(input.policy?.dailyCycleBudget, "daily cycle budget");
  cycles(input.policy?.minimumRemainingCycles, "minimum remaining cycles");
  const state = structuredClone(input), seen = new Set();
  let previous = -1, pending = 0;
  for (const slot of state.slots) {
    integer(slot.slotId, "saved slot");
    if (slot.slotId <= previous || slot.day !== dayForSlot(slot.slotId)) throw Error("Duplicate, unordered or wrongly dated cadence slot");
    previous = slot.slotId;
    integer(slot.atMs, "saved timestamp");
    if (cadenceSlot(slot.atMs).slotId !== slot.slotId) throw Error("Saved intent is outside its UTC slot");
    if (slot.status === "skipped") {
      if (slot.source !== null || slot.reserveCycles !== "0" || slot.actualCycles !== "0") throw Error("Invalid skipped slot");
      continue;
    }
    if (!UNRESOLVED.has(slot.status) && !SETTLED.has(slot.status)) throw Error("Invalid cadence slot status");
    const source = sourceRecord(slot.source);
    if (seen.has(source.id) || slot.reserveCycles !== CADENCE_JOB_RESERVE.toString()) throw Error("Duplicate source or changed job reserve");
    seen.add(source.id);
    if (slot.intentId !== `pons:${slot.slotId}:${source.id}`) throw Error("Changed cadence intent ID");
    if (slot.jobId != null && slot.jobId !== source.id) throw Error("Cadence job does not match reserved source");
    if (UNRESOLVED.has(slot.status)) {
      pending++;
      if (slot.actualCycles !== null) throw Error("Unresolved outcome cannot release a reservation");
    } else {
      cycles(slot.actualCycles, "settled model cost");
      reasonText(slot.proofRef);
      if (slot.status === "not_executed" && slot.actualCycles !== "0") throw Error("No-execution proof has a nonzero cost");
    }
  }
  if (pending > 1) throw Error("Cadence has more than one unresolved job");
  return state;
}

export function cadenceBudget(stateInput, day) {
  const state = checkedState(stateInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Invalid UTC day");
  let spent = 0n, reserved = 0n;
  for (const slot of state.slots.filter(slot => slot.day === day)) {
    if (UNRESOLVED.has(slot.status)) reserved += CADENCE_JOB_RESERVE;
    if (SETTLED.has(slot.status)) spent += cycles(slot.actualCycles, "settled model cost");
  }
  const budget = cycles(state.policy.dailyCycleBudget, "daily cycle budget");
  return { day, budget: budget.toString(), spent: spent.toString(), reserved: reserved.toString(),
    available: (budget > spent + reserved ? budget - spent - reserved : 0n).toString(),
    overBudget: spent + reserved > budget };
}

// The first observation seals the CURRENT slot, including skips or denials.
// Missed slots are never queued. A stale/duplicate tick never returns an intent.
// Budget accounting is attached to the UTC day the intent was reserved; holds
// survive midnight. One unresolved job blocks admissions on every later day.
export function admitCadence(stateInput, { nowMs, headBlockNumber, swaps, balance }) {
  const state = checkedState(stateInput), clock = cadenceSlot(nowMs);
  const previous = state.slots.at(-1)?.slotId;
  if (previous != null && clock.slotId <= previous)
    return { state, decision: { kind: "noop", reason: clock.slotId === previous ? "slot_already_sealed" : "clock_regression", ...clock } };
  const skip = reason => {
    state.slots.push({ slotId: clock.slotId, day: clock.day, atMs: nowMs, status: "skipped", reason,
      source: null, reserveCycles: "0", actualCycles: "0" });
    return { state, decision: { kind: "skip", reason, ...clock } };
  };
  if (state.slots.some(slot => UNRESOLVED.has(slot.status))) return skip("unresolved_job");
  const source = latestConfirmedPonsSwap(swaps, { headBlockNumber,
    seenSourceIds: state.slots.flatMap(slot => slot.source ? [slot.source.id] : []) });
  if (!source) return skip("no_new_confirmed_pons_swap");
  if (!balance || !Number.isSafeInteger(balance.observedAtMs) || balance.observedAtMs > nowMs + 5000 ||
      nowMs - balance.observedAtMs > MAX_BALANCE_AGE_MS) return skip("stale_cycle_balance");
  const remaining = cycles(balance.cycles, "current cycle balance");
  const minimum = cycles(state.policy.minimumRemainingCycles, "minimum remaining cycles");
  if (remaining < CADENCE_JOB_RESERVE + minimum) return skip("minimum_cycle_balance");
  if (cycles(cadenceBudget(state, clock.day).available, "available daily budget") < CADENCE_JOB_RESERVE)
    return skip("daily_cycle_budget");
  const intentId = `pons:${clock.slotId}:${source.id}`;
  state.slots.push({ slotId: clock.slotId, day: clock.day, atMs: nowMs, status: "reserved", intentId,
    source, jobId: null, reserveCycles: CADENCE_JOB_RESERVE.toString(), actualCycles: null });
  return { state, decision: { kind: "admit", ...clock,
    intent: { intentId, slotId: clock.slotId, sourceId: source.id, transactionHash: source.txHash,
      logIndex: source.logIndex, reserveCycles: CADENCE_JOB_RESERVE.toString() } } };
}

function selectedUnresolved(state, slotId, sourceId) {
  integer(slotId, "outcome slot");
  const slot = state.slots.find(value => value.slotId === slotId);
  if (!slot || !UNRESOLVED.has(slot.status) || slot.source.id !== hash(sourceId, "outcome source ID"))
    throw Error("Outcome does not match the unresolved cadence intent");
  return slot;
}

// Observation, not permission to resubmit. Failures and ambiguous outcomes keep
// the full reservation and block all new jobs until explicitly reconciled.
export function observeCadence(stateInput, { slotId, sourceId, status, jobId, reason }) {
  const state = checkedState(stateInput), slot = selectedUnresolved(state, slotId, sourceId);
  if (!["submitted", "failed", "ambiguous"].includes(status)) throw Error("Invalid observed outcome");
  if (status === "submitted") {
    if (jobId !== slot.source.id || ["failed", "ambiguous"].includes(slot.status))
      throw Error("Cannot resubmit or change an unresolved job");
    slot.jobId = jobId;
  } else {
    slot.reason = reasonText(reason);
    if (jobId != null && jobId !== slot.source.id) throw Error("Outcome job differs from the reserved source");
    if (jobId != null) slot.jobId = jobId;
  }
  slot.status = status;
  return state;
}

// Only call after independently reconciling the job/receipt and actual cost.
// `proofRef` points to that durable evidence. No-execution/failed settlement
// consumes the slot AND source, so neither is silently replayed later.
export function settleCadence(stateInput, { slotId, sourceId, outcome, actualCycles, proofRef, jobId }) {
  const state = checkedState(stateInput), slot = selectedUnresolved(state, slotId, sourceId);
  if (!SETTLED.has(outcome)) throw Error("Invalid reconciled outcome");
  const actual = cycles(actualCycles, "actual model cost");
  if (outcome === "not_executed" && actual !== 0n) throw Error("No-execution outcome cannot have spent cycles");
  if (outcome !== "not_executed" && jobId !== slot.source.id) throw Error("Reconciled job differs from reserved source");
  slot.status = outcome;
  slot.actualCycles = actual.toString();
  slot.proofRef = reasonText(proofRef);
  if (jobId != null) {
    if (jobId !== slot.source.id) throw Error("Reconciled job differs from reserved source");
    slot.jobId = jobId;
  }
  slot.reserveOverrun = actual > CADENCE_JOB_RESERVE;
  return state;
}
