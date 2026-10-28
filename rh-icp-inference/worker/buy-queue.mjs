import { swapSourceId, validatePool } from "./swaps.mjs";

// Pure admission/state transitions: no RPC, timers, signing, or file writes.
// The caller owns an exclusive journal lock and MUST persist each returned state
// before acting on its intent. Canonical block hashes come from independently
// checked RPC receipts, not from the candidate event itself.
export const BUY_CHAIN_ID = 4663;
export const BUY_CONFIRMATIONS = 12;
export const BUY_JOB_RESERVE = 2_000_000_000_000n;
export const BUY_POOL = Object.freeze(validatePool({
  manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  pool_id: "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01",
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559",
  fee: 0, tick_spacing: 200, hook: "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044",
}));
const SCHEMA = "gh0st-pons-buy-queue-v1";
const ACTIVE = new Set(["reserved", "submitted", "generating", "signed", "awaiting_publication", "failed", "ambiguous"]);
const HELD = new Set([...ACTIVE, "parked"]);
const TERMINAL = new Set(["completed", "not_executed", "failed_final"]);
// These settle accounting, not a delivered thought. The default policy blocks
// later buys; an explicitly recorded skip policy may move past terminal work.
const UNFULFILLED_SETTLEMENTS = new Set(["not_executed", "failed_final"]);
const OWNER_DEFERRED_SOURCE = "0x0f3ab702125c658e4bbed3c7549b0eed269f8b7c4ba78e6759a336dd5aadda64";
const PROGRESS = ["reserved", "submitted", "generating", "signed"];
const hash = (value, label) => {
  if (typeof value !== "string" || !/^0x[\da-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value))
    throw Error(`Invalid ${label}`);
  return value.toLowerCase();
};
const integer = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error(`Invalid ${label}`);
  return value;
};
const unsigned = (value, label) => {
  if (typeof value === "bigint") value = value.toString();
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw Error(`Invalid ${label}`);
  return BigInt(value);
};
const amount = (value, label) => {
  if (typeof value === "bigint") value = value.toString();
  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)$/.test(value)) throw Error(`Invalid ${label}`);
  const result = BigInt(value);
  if (result < -(1n << 127n) || result >= 1n << 127n) throw Error(`Invalid ${label}`);
  return result;
};
const proofRef = value => {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw Error("A durable proof reference is required");
  return value;
};
const position = (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const day = nowMs => {
  integer(nowMs, "timestamp");
  if (nowMs > 253_402_300_799_999) throw Error("Timestamp outside supported range");
  return new Date(nowMs).toISOString().slice(0, 10);
};

function normalizeEvent(event) {
  if (!event || event.kind !== "swap" || event.removed === true || event.canonical === false || event.confirmed === false ||
      (event.chainId != null && String(event.chainId) !== String(BUY_CHAIN_ID)) ||
      event.source?.manager?.toLowerCase() !== BUY_POOL.manager || event.source?.pool_id?.toLowerCase() !== BUY_POOL.pool_id)
    throw Error("Only canonical selected Pons swap events are accepted");
  const txHash = hash(event.txHash, "transaction hash"), blockHash = hash(event.blockHash, "block hash");
  const logIndex = integer(event.logIndex, "log index"), blockNumber = integer(event.blockNumber, "block number");
  if (event.source.transaction_hash?.toLowerCase() !== txHash ||
      unsigned(event.source.log_index, "source log index") !== BigInt(logIndex)) throw Error("Event and source disagree");
  const source = { manager: BUY_POOL.manager, pool_id: BUY_POOL.pool_id, transaction_hash: txHash, log_index: String(logIndex) };
  const id = swapSourceId(BUY_CHAIN_ID, source);
  if (hash(event.id, "source ID") !== id) throw Error("Noncanonical source ID");
  const amount0 = amount(event.context?.amount0, "native amount"), amount1 = amount(event.context?.amount1, "GH0ST amount");
  // worker/swaps.mjs preserves the PoolManager Swap event's signed deltas.
  // For this pinned key, currency0 is native ETH and currency1 is GH0ST.
  // The live verified buy was amount0 < 0 and amount1 > 0: ETH enters while
  // GH0ST leaves the pool. Gross amount1 precedes the hook's output taxes.
  if (!((amount0 < 0n && amount1 > 0n) || (amount0 > 0n && amount1 < 0n)))
    throw Error("Swap amounts do not describe a nonzero Pons buy or sell");
  return { id, kind: "swap", source, txHash, logIndex, blockNumber, blockHash,
    context: { amount0: amount0.toString(), amount1: amount1.toString() }, direction: amount1 > 0n ? "buy" : "sell" };
}

function verifyCanonical(event, verification) {
  const head = integer(verification?.headBlockNumber, "confirmation head");
  if (event.blockNumber > head - BUY_CONFIRMATIONS) throw Error("Swap lacks twelve confirmation descendants");
  const hashes = verification?.canonicalBlockHashes;
  const expected = hashes instanceof Map ? hashes.get(event.blockNumber) : hashes?.[String(event.blockNumber)];
  if (hash(expected, "independently verified canonical block hash") !== event.blockHash)
    throw Error("Swap was reorganized or canonical block evidence differs");
}

export function validatePonsBuy(event, verification) {
  const normalized = normalizeEvent(event);
  verifyCanonical(normalized, verification);
  return normalized.direction === "buy" ? normalized : null;
}

// Zero means uncapped. The 2T reservation is only an admission estimate and
// never truncates a running thought or its measured actual cost.
export function normalizeBuyCycleCap(value) {
  if (value == null || value === "") return null;
  const cap = unsigned(value, "daily cycle budget");
  return cap === 0n ? null : cap.toString();
}

export function createBuyQueue({ startBlock, completedSourceIds = [], dailyCycleBudget = null, minimumRemainingCycles = "0" }) {
  integer(startBlock, "explicit activation block");
  if (!Array.isArray(completedSourceIds)) throw Error("Invalid imported tombstones");
  const tombstones = completedSourceIds.map(id => hash(id, "completed source ID"));
  if (new Set(tombstones).size !== tombstones.length) throw Error("Duplicate imported source ID");
  const budget = normalizeBuyCycleCap(dailyCycleBudget);
  return { schema: SCHEMA, chainId: BUY_CHAIN_ID, poolId: BUY_POOL.pool_id, startBlock,
    policy: { dailyCycleBudget: budget, minimumRemainingCycles: unsigned(minimumRemainingCycles, "cycle floor").toString() },
    tombstones, entries: [], activeSourceId: null, lastStarted: null };
}

function checkedState(input) {
  if (!input || input.schema !== SCHEMA || input.chainId !== BUY_CHAIN_ID || input.poolId !== BUY_POOL.pool_id ||
      !Array.isArray(input.entries) || !Array.isArray(input.tombstones)) throw Error("Buy queue binding differs");
  integer(input.startBlock, "activation block");
  if (!input.policy || (input.policy.dailyCycleBudget !== null && unsigned(input.policy.dailyCycleBudget, "daily budget") === 0n))
    throw Error("Invalid buy budget policy");
  unsigned(input.policy.minimumRemainingCycles, "cycle floor");
  if (input.policy.skipFailedBuys !== undefined && typeof input.policy.skipFailedBuys !== "boolean")
    throw Error("Invalid failed-buy policy");
  if (input.policy.skipFailedBuys === true) {
    const authorization = input.policy.failurePolicyAuthorization;
    if (!authorization || authorization.schema !== "gh0st-failed-buy-policy-v1") throw Error("Missing failed-buy policy authorization");
    day(authorization.atMs); proofRef(authorization.authorizationRef); proofRef(authorization.reason);
  }
  const state = structuredClone(input), seen = new Set(state.tombstones.map(id => hash(id, "tombstone"))), positions = new Set();
  if (seen.size !== state.tombstones.length) throw Error("Duplicate tombstones");
  let active = null, previous = null;
  for (const entry of state.entries) {
    const event = normalizeEvent(entry.event), key = `${event.blockNumber}:${event.logIndex}`;
    if (event.direction !== "buy" || event.blockNumber < state.startBlock || !same(event, entry.event) || seen.has(event.id) || positions.has(key))
      throw Error("Changed or duplicate buy queue source");
    seen.add(event.id); positions.add(key);
    if (previous && position(event, previous) <= 0) throw Error("Buy queue is not in canonical FIFO order");
    previous = event;
    if (entry.status !== "queued" && !HELD.has(entry.status) && !TERMINAL.has(entry.status)) throw Error("Invalid buy status");
    let priorCycles = 0n;
    if (entry.costHistory !== undefined && !Array.isArray(entry.costHistory)) throw Error("Invalid retained cost history");
    for (const segment of entry.costHistory ?? []) {
      if (day(segment.reservedAtMs) !== segment.reservedDay || integer(segment.settledAtMs, "historical settlement") < segment.reservedAtMs)
        throw Error("Invalid retained cost interval");
      proofRef(segment.proofRef); priorCycles += unsigned(segment.actualCycles, "historical model cost");
    }
    if (unsigned(entry.costBaseline ?? "0", "cumulative cost baseline") !== priorCycles)
      throw Error("Retained costs differ from the cumulative baseline");
    if (entry.status === "queued") {
      if (entry.reserveCycles !== "0" || entry.actualCycles !== null || entry.reservedDay !== null) throw Error("Queued buy has an invalid reservation");
    } else {
      if (entry.reserveCycles !== BUY_JOB_RESERVE.toString() || day(entry.reservedAtMs) !== entry.reservedDay) throw Error("Changed buy reservation");
      if (HELD.has(entry.status)) {
        if (entry.actualCycles !== null) throw Error("Unresolved buy prematurely released its budget");
        if (ACTIVE.has(entry.status)) {
          if (active !== null) throw Error("More than one unresolved buy or premature budget release");
          active = event.id;
        }
      } else {
        unsigned(entry.actualCycles, "settled cost"); proofRef(entry.proofRef);
        if (integer(entry.settledAtMs, "settlement timestamp") < entry.reservedAtMs)
          throw Error("Settlement predates the buy reservation");
        day(entry.settledAtMs);
        if (entry.status === "not_executed" && entry.actualCycles !== "0") throw Error("No-execution settlement spent cycles");
        if (entry.cumulativeActualCycles !== undefined && unsigned(entry.cumulativeActualCycles, "cumulative actual cost") !==
            priorCycles + unsigned(entry.actualCycles, "segment cost")) throw Error("Cumulative cost double counted or lost");
      }
    }
    if (entry.delivery) deliveryProof(entry.delivery, event.id);
    if (entry.rejectedResult) {
      if (entry.status !== "failed_final" || entry.rejectedResult.published !== false)
        throw Error("Rejected result cannot be completed or published");
      hash(entry.rejectedResult.answerHash, "rejected answer hash");
      proofRef(entry.rejectedResult.reason); proofRef(entry.rejectedResult.proofRef);
      if (entry.rejectedResult.duplicateOf !== null) hash(entry.rejectedResult.duplicateOf, "duplicate source ID");
      if (entry.delivery && entry.delivery.answerHash !== entry.rejectedResult.answerHash)
        throw Error("Rejected result differs from delivered answer");
    }
    if (entry.ownerDeferral) {
      const deferral = entry.ownerDeferral;
      if (event.id !== OWNER_DEFERRED_SOURCE || deferral.schema !== "gh0st-owner-deferral-v1" ||
          deferral.sourceId !== event.id || entry.status !== "failed_final") throw Error("Invalid owner-deferred source");
      day(deferral.atMs); proofRef(deferral.authorizationRef); proofRef(deferral.reason);
    }
    if (entry.status === "awaiting_publication" && !entry.delivery) throw Error("Missing confirmed delivery");
    if (entry.status === "completed" && (!entry.delivery || entry.publication?.sourceId !== event.id ||
        entry.publication.status !== "posted" || entry.publication.verified !== true ||
        !/^[1-9]\d{0,19}$/.test(entry.publication.postId ?? "") ||
        entry.publication.callbackTransactionHash !== entry.delivery.transactionHash || entry.publication.answerHash !== entry.delivery.answerHash))
      throw Error("Completed buy lacks matching delivery and publication proofs");
  }
  if (state.activeSourceId !== active) throw Error("Active buy pointer differs from unresolved job");
  if (state.recoveryHold != null && (state.recoveryHold.status !== "pending" ||
      !state.entries.some(entry => entry.event.id === hash(state.recoveryHold.sourceId, "recovery source ID"))))
    throw Error("Invalid pending recovery marker");
  if (state.lastStarted !== null) {
    const started = state.entries.find(entry => entry.event.id === state.lastStarted);
    if (!started || started.status === "queued" || state.entries.some(entry => entry.status !== "queued" && position(entry.event, started.event) > 0))
      throw Error("Invalid FIFO activation watermark");
    if (state.entries.some(entry => entry.status === "queued" && position(entry.event, started.event) <= 0))
      throw Error("Queued source precedes the activation watermark");
  } else if (state.entries.some(entry => entry.status !== "queued")) throw Error("Missing FIFO activation watermark");
  return state;
}

export function pendingBuyRecovery(input) {
  const state = checkedState(input);
  if (state.policy.skipFailedBuys === true) return null;
  const entry = state.entries.find(value => UNFULFILLED_SETTLEMENTS.has(value.status) && !value.ownerDeferral);
  return entry ? { sourceId: entry.event.id, status: entry.status, activeSourceId: state.activeSourceId } : null;
}

// Explicit owner policy, independent of whether any particular job is failed.
// This never clears an active reservation or makes an ambiguous call terminal.
export function setBuyFailurePolicy(input, { skipFailedBuys, nowMs, authorizationRef, reason }) {
  const state = checkedState(input);
  if (typeof skipFailedBuys !== "boolean") throw Error("Invalid failed-buy policy");
  day(nowMs);
  const authorization = { schema: "gh0st-failed-buy-policy-v1", atMs: nowMs,
    authorizationRef: proofRef(authorizationRef), reason: proofRef(reason) };
  state.policy.skipFailedBuys = skipFailedBuys;
  state.policy.failurePolicyAuthorization = authorization;
  state.failurePolicyHistory ??= [];
  state.failurePolicyHistory.push({ skipFailedBuys, ...authorization });
  if (skipFailedBuys && state.recoveryHold) {
    const held = state.entries.find(entry => entry.event.id === state.recoveryHold.sourceId);
    if (!UNFULFILLED_SETTLEMENTS.has(held?.status)) throw Error("Cannot bypass an unresolved recovery hold");
    state.recoveryHoldHistory ??= [];
    state.recoveryHoldHistory.push({ ...state.recoveryHold, releasedAtMs: nowMs, authorizationRef });
    state.recoveryHold = null;
  }
  return checkedState(state);
}

// This single deferral records the owner's explicit instruction to move past
// this exact failed source. It does not erase its outcome/cost, reset any job,
// or grant permission to skip another failed buy.
export function markBuyOwnerDeferred(input, { sourceId, nowMs, authorizationRef, reason }) {
  const state = checkedState(input), id = hash(sourceId, "owner-deferred source ID");
  const entry = state.entries.find(value => value.event.id === id);
  if (id !== OWNER_DEFERRED_SOURCE || !entry || entry.status !== "failed_final")
    throw Error("Only the explicitly owner-deferred failed third source may be deferred");
  day(nowMs);
  const record = { schema: "gh0st-owner-deferral-v1", sourceId: id, atMs: nowMs,
    authorizationRef: proofRef(authorizationRef), reason: proofRef(reason) };
  if (entry.ownerDeferral && !same(entry.ownerDeferral, record)) throw Error("Owner deferral is already recorded");
  entry.ownerDeferral = record;
  return checkedState(state);
}

// Operator bookkeeping only: preserve source, costs, settled status and any
// later active pointer. This does NOT reset a canister job, authorize a retry,
// or create another active entry. Reconcile existing ingress/model work first.
export function markBuyRecoveryPending(input, { sourceId, nowMs, evidenceRef }) {
  const state = checkedState(input), pending = pendingBuyRecovery(state);
  if (!pending || pending.sourceId !== hash(sourceId, "recovery source ID"))
    throw Error("Recover the earliest unfulfilled buy first");
  day(nowMs);
  state.recoveryHold = { sourceId: pending.sourceId, status: "pending", markedAtMs: nowMs, evidenceRef: proofRef(evidenceRef) };
  return state;
}

function sameSourceJob(job, event, phase = "Verified") {
  const source = job?.source?.[0];
  if (!job || job.request?.id !== event.id || job.request.tx_hash !== event.txHash ||
      Number(job.request.log_index) !== event.logIndex || job.request.block_hash !== event.blockHash ||
      Number(job.request.block_number) !== event.blockNumber || source?.manager !== BUY_POOL.manager ||
      source.pool_id !== BUY_POOL.pool_id || source.transaction_hash !== event.txHash || Number(source.log_index) !== event.logIndex)
    throw Error("Owner recovery evidence belongs to another source");
  if (job.busy || !Object.hasOwn(job.phase ?? {}, phase)) throw Error("Owner recovery job has an unexpected phase or is busy");
  const recovery = job.recovery?.[0];
  if (!recovery)
    throw Error("Explicit owner recovery evidence is required");
  return recovery;
}

function zeroFootprint(job) {
  return [job.model_cycles, job.model_cycles_before, job.chunks, job.input_tokens, job.output_tokens]
    .every(value => String(value) === "0") && !job.answer && !job.digest && !job.signer && !job.prompt_ingested &&
    (job.signature?.length ?? 0) === 0;
}

// Offline journal migration AFTER owner-only on-chain recovery. Snapshots and
// costs are retained; this function does not call recover_job or resume_job.
export function reactivateRecoveredBuy(input, { sourceId, recoveredJob, parkedJob, nowMs, evidenceRef }) {
  const state = checkedState(input), pending = pendingBuyRecovery(state);
  if (!pending || pending.sourceId !== hash(sourceId, "recovery source ID")) throw Error("Recover the earliest unfulfilled buy first");
  const entry = state.entries.find(value => value.event.id === sourceId), recovery = sameSourceJob(recoveredJob, entry.event);
  const carry = unsigned(recoveredJob.model_cycles, "recovered cumulative cycles"), total = unsigned(recovery.total_budget, "owner total budget");
  const unlimited = total === 0n;
  if (recovery.parked || recovery.requires_owner || recovery.accounting_uncertain || !recovery.rebuilding || !Number.isSafeInteger(recovery.grants) || recovery.grants < 1 ||
      unsigned(recovery.carry_cycles, "retained owner cycles") !== carry || (!unlimited && (total > 4n * 1_000_000_000_000n ||
      total <= carry || total - carry > BUY_JOB_RESERVE || unsigned(recovery.resume_deadline, "recovery deadline") <= BigInt(Math.floor(nowMs / 1000)))))
    throw Error("Owner recovery grant or retained cycles are invalid");
  day(nowMs); proofRef(evidenceRef);
  const previousCost = unsigned(entry.costBaseline ?? "0", "prior baseline") + unsigned(entry.actualCycles, "prior settled cycles");
  if (carry < previousCost) throw Error("Recovery would erase previously charged cycles");
  const previous = structuredClone(entry);
  delete previous.recoveryHistory;
  if (state.activeSourceId && state.activeSourceId !== entry.event.id) {
    const later = state.entries.find(value => value.event.id === state.activeSourceId);
    if (!later || position(later.event, entry.event) <= 0 || later.delivery || later.publication)
      throw Error("Later active buy cannot be parked safely");
    const parked = sameSourceJob(parkedJob, later.event);
    if (!parked.parked || !zeroFootprint(parkedJob)) throw Error("Later canister job lacks an owner-confirmed zero-footprint park");
    later.parkHistory ??= [];
    later.parkHistory.push({ status: later.status, atMs: nowMs, evidenceRef });
    later.status = "parked";
  }
  entry.recoveryHistory ??= [];
  entry.recoveryHistory.push({ previousEntry: previous, grant: structuredClone(recovery), atMs: nowMs, evidenceRef,
    previousRecoveryHold: state.recoveryHold ?? null });
  entry.costHistory ??= [];
  entry.costHistory.push({ reservedAtMs: previous.reservedAtMs, reservedDay: previous.reservedDay,
    settledAtMs: previous.settledAtMs, actualCycles: previous.actualCycles, proofRef: previous.proofRef });
  if (carry > previousCost) entry.costHistory.push({ reservedAtMs: previous.reservedAtMs, reservedDay: previous.reservedDay,
    settledAtMs: nowMs, actualCycles: (carry - previousCost).toString(), proofRef: evidenceRef });
  entry.costBaseline = carry.toString(); entry.status = "reserved"; entry.actualCycles = null;
  entry.reserveCycles = BUY_JOB_RESERVE.toString(); entry.reservedAtMs = nowMs; entry.reservedDay = day(nowMs);
  entry.recoveryAdmissionNeeded = true;
  delete entry.settledAtMs; delete entry.proofRef; delete entry.cumulativeActualCycles;
  state.activeSourceId = entry.event.id; state.recoveryHold = null;
  return checkedState(state);
}

export function reactivateParkedBuy(input, { sourceId, resumedJob, nowMs, evidenceRef }) {
  const state = checkedState(input);
  if (state.activeSourceId || pendingBuyRecovery(state)) throw Error("Earlier work remains unresolved");
  const entry = state.entries.find(value => value.status === "queued" || value.status === "parked");
  if (!entry || entry.event.id !== hash(sourceId, "resumed source") || entry.status !== "parked") throw Error("Resume the earliest parked buy first");
  const recovery = sameSourceJob(resumedJob, entry.event);
  if (recovery.parked || recovery.requires_owner || recovery.accounting_uncertain || !zeroFootprint(resumedJob) ||
      (unsigned(recovery.total_budget, "resumed budget") !== 0n && unsigned(recovery.resume_deadline, "resume deadline") <= BigInt(Math.floor(nowMs / 1000))))
    throw Error("Owner has not resumed this parked source safely");
  day(nowMs); proofRef(evidenceRef);
  entry.parkHistory ??= []; entry.parkHistory.push({ status: "owner_resumed", atMs: nowMs, evidenceRef });
  entry.status = "reserved"; entry.recoveryAdmissionNeeded = true; state.activeSourceId = entry.event.id;
  return checkedState(state);
}

function archiveWorkerItem(item, evidenceRef, nowMs) {
  if (item.delivery || item.publication || item.rawTransaction || item.result)
    throw Error("A delivered, published or signed worker item cannot be reset for model recovery");
  const previous = structuredClone(item);
  delete previous.operatorRecoveryHistory;
  item.operatorRecoveryHistory ??= [];
  item.operatorRecoveryHistory.push({ previous, atMs: nowMs, evidenceRef });
  delete item.error; delete item.buyHalt; delete item.pendingUpdate; delete item.cacheCleaned;
}

// Pure whole-journal migration. The caller must hold the stopped worker's lock,
// verify the supplied certified on-chain snapshots, then atomically save once.
export function migrateBuyWorkerRecovery(input, options) {
  const state = structuredClone(input);
  if (!state.buyQueue || !Array.isArray(state.requests)) throw Error("Missing worker buy journal");
  const oldActive = state.buyQueue.activeSourceId;
  state.buyQueue = reactivateRecoveredBuy(state.buyQueue, options);
  const item = state.requests.find(value => value.id === options.sourceId);
  if (!item || state.requests.filter(value => value.id === options.sourceId).length !== 1)
    throw Error("Recovered source is absent or duplicated in worker journal");
  archiveWorkerItem(item, options.evidenceRef, options.nowMs);
  item.state = "queued"; item.phase = "Verified"; item.modelCycles = String(options.recoveredJob.model_cycles);
  if (oldActive && oldActive !== options.sourceId) {
    const parked = state.requests.find(value => value.id === oldActive);
    if (!parked || state.requests.filter(value => value.id === oldActive).length !== 1)
      throw Error("Parked source is absent or duplicated in worker journal");
    archiveWorkerItem(parked, options.evidenceRef, options.nowMs);
    parked.state = "parked"; parked.phase = "Verified"; parked.modelCycles = String(options.parkedJob.model_cycles);
  }
  return state;
}

export function migrateParkedWorkerResume(input, options) {
  const state = structuredClone(input);
  state.buyQueue = reactivateParkedBuy(state.buyQueue, options);
  const item = state.requests.find(value => value.id === options.sourceId);
  if (!item || item.state !== "parked") throw Error("Worker item is not parked");
  archiveWorkerItem(item, options.evidenceRef, options.nowMs);
  item.state = "queued"; item.phase = "Verified"; item.modelCycles = String(options.resumedJob.model_cycles);
  return state;
}

// Same-cache continuation under an explicit owner-enabled unlimited policy.
// Unlike a rebuild, the existing reservation and accounting baseline remain
// unchanged: all eventual cumulative cycles are charged exactly once.
export function resumeRetainedWorkerJob(input, { sourceId, resumedJob, expectedCycles, expectedChunks,
  cacheEvidenceHash, nowMs, evidenceRef }) {
  const state = structuredClone(input), queue = checkedState(state.buyQueue);
  const id = hash(sourceId, "retained source ID"), entry = queue.entries.find(value => value.event.id === id);
  if (!entry || queue.activeSourceId !== id || !["failed", "ambiguous"].includes(entry.status))
    throw Error("Only the current held source may resume its retained cache");
  if (queue.entries.some(value => position(value.event, entry.event) < 0 && value.status !== "completed" && !value.ownerDeferral))
    throw Error("An earlier source still requires resolution");
  const recovery = sameSourceJob(resumedJob, entry.event, "Running");
  const cycles = unsigned(expectedCycles, "owner-attested cycles"), chunks = integer(expectedChunks, "owner-attested chunks");
  if (unsigned(resumedJob.model_cycles, "resumed cycles") !== cycles || resumedJob.chunks !== chunks ||
      unsigned(recovery.total_budget, "resumed policy") !== 0n || recovery.requires_owner || recovery.accounting_uncertain ||
      recovery.parked || recovery.rebuilding || recovery.max_chunks !== 0 || unsigned(recovery.resume_deadline, "resume deadline") !== 0n ||
      recovery.cache_evidence_hash?.[0] !== hash(cacheEvidenceHash, "cache evidence hash"))
    throw Error("Owner-retained cache proof, counters or unlimited policy differ");
  const item = state.requests?.find(value => value.id === id);
  if (!item || state.requests.filter(value => value.id === id).length !== 1 || unsigned(item.modelCycles ?? "0", "saved model cost") > cycles ||
      unsigned(entry.costBaseline ?? "0", "retained cost baseline") > cycles)
    throw Error("Retained worker cost or source differs from the observed job");
  day(nowMs); proofRef(evidenceRef);
  const previousEntry = structuredClone(entry); delete previousEntry.ownerResumeHistory;
  entry.ownerResumeHistory ??= [];
  entry.ownerResumeHistory.push({ previousEntry, expectedCycles: cycles.toString(), expectedChunks: chunks,
    cacheEvidenceHash, atMs: nowMs, evidenceRef });
  archiveWorkerItem(item, evidenceRef, nowMs);
  entry.status = "generating";
  item.state = "queued"; item.phase = "Running"; item.modelCycles = cycles.toString();
  state.buyQueue = checkedState(queue);
  return state;
}

// Idempotent observation: identical repeats add nothing. Conflicting receipt
// data or log positions throw; callers must stop instead of advancing a cursor.
export function enqueuePonsBuys(input, events, verification) {
  const state = checkedState(input);
  if (!Array.isArray(events)) throw Error("Invalid event batch");
  const observed = new Map(), positions = new Map(), accepted = [], ignored = [];
  for (const entry of state.entries) { observed.set(entry.event.id, entry.event); positions.set(`${entry.event.blockNumber}:${entry.event.logIndex}`, entry.event.id); }
  for (const raw of events) {
    const event = normalizeEvent(raw); verifyCanonical(event, verification);
    const key = `${event.blockNumber}:${event.logIndex}`, prior = observed.get(event.id);
    if (prior && !same(prior, event)) throw Error("Conflicting observation of an existing source");
    if (positions.has(key) && positions.get(key) !== event.id) throw Error("Conflicting canonical log position");
    observed.set(event.id, event); positions.set(key, event.id);
    if (prior || state.tombstones.includes(event.id)) { ignored.push({ id: event.id, reason: "already_seen" }); continue; }
    if (event.direction !== "buy") { ignored.push({ id: event.id, reason: "sell" }); continue; }
    if (event.blockNumber < state.startBlock) { ignored.push({ id: event.id, reason: "before_activation" }); continue; }
    const watermark = state.entries.find(entry => entry.event.id === state.lastStarted)?.event;
    if (watermark && position(event, watermark) <= 0) throw Error("Late source would violate FIFO; reconcile the scan cursor");
    state.entries.push({ event, status: "queued", reserveCycles: "0", actualCycles: null, reservedDay: null });
    accepted.push(event.id);
  }
  state.entries.sort((a, b) => position(a.event, b.event));
  return { state, accepted, ignored };
}

export function buyBudget(input, utcDay) {
  const state = checkedState(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDay) || day(Date.parse(utcDay + "T00:00:00Z")) !== utcDay)
    throw Error("Invalid UTC budget day");
  let spent = 0n, reserved = 0n;
  // A job may span midnight while generating, delivering or awaiting X. Hold
  // its full reservation on every touched UTC day; once resolved, conservatively
  // charge its full measured model cost to each of those days. We do not have
  // per-call UTC consumption data and must not invent an exact daily split.
  for (const entry of state.entries) {
    for (const segment of entry.costHistory ?? [])
      if (segment.reservedDay <= utcDay && utcDay <= day(segment.settledAtMs)) spent += unsigned(segment.actualCycles, "retained segment cost");
    if (entry.reservedDay <= utcDay && HELD.has(entry.status)) reserved += BUY_JOB_RESERVE;
    if (entry.reservedDay !== null && entry.reservedDay <= utcDay && TERMINAL.has(entry.status) && utcDay <= day(entry.settledAtMs))
      spent += unsigned(entry.actualCycles, "actual cost");
  }
  const budget = state.policy.dailyCycleBudget == null ? null : BigInt(state.policy.dailyCycleBudget);
  return { day: utcDay, budget: budget?.toString() ?? null, spent: spent.toString(), reserved: reserved.toString(),
    available: budget == null ? null : (budget > spent + reserved ? budget - spent - reserved : 0n).toString(),
    overBudget: budget != null && spent + reserved > budget };
}

export function reserveNextBuy(input, { nowMs, verification, balance }) {
  const state = checkedState(input), utcDay = day(nowMs);
  const recovery = pendingBuyRecovery(state);
  if (recovery) return { state, decision: { kind: "blocked", reason: "unfulfilled_prior_buy", ...recovery } };
  if (state.activeSourceId) return { state, decision: { kind: "blocked", reason: "unresolved_buy", sourceId: state.activeSourceId } };
  const entry = state.entries.find(entry => entry.status === "queued" || entry.status === "parked");
  if (!entry) return { state, decision: { kind: "idle" } };
  if (entry.status === "parked") return { state, decision: { kind: "blocked", reason: "parked_job_requires_owner_resume", sourceId: entry.event.id } };
  verifyCanonical(entry.event, verification); // Recheck after time spent waiting.
  if (state.policy.dailyCycleBudget !== null || BigInt(state.policy.minimumRemainingCycles) > 0n) {
    if (!balance || !Number.isSafeInteger(balance.observedAtMs) || balance.observedAtMs > nowMs + 5000 || nowMs - balance.observedAtMs > 60_000)
      return { state, decision: { kind: "blocked", reason: "stale_cycle_balance" } };
    if (unsigned(balance.cycles, "current model balance") < BUY_JOB_RESERVE + BigInt(state.policy.minimumRemainingCycles))
      return { state, decision: { kind: "blocked", reason: "minimum_cycle_balance" } };
    if (state.policy.dailyCycleBudget !== null && BigInt(buyBudget(state, utcDay).available) < BUY_JOB_RESERVE)
      return { state, decision: { kind: "blocked", reason: "daily_cycle_budget" } };
  }
  Object.assign(entry, { status: "reserved", reserveCycles: BUY_JOB_RESERVE.toString(), reservedAtMs: nowMs, reservedDay: utcDay });
  state.activeSourceId = entry.event.id; state.lastStarted = entry.event.id;
  return { state, decision: { kind: "start", intent: { sourceId: entry.event.id, transactionHash: entry.event.txHash,
    logIndex: entry.event.logIndex, reserveCycles: BUY_JOB_RESERVE.toString() } } };
}

function activeEntry(state, sourceId) {
  const id = hash(sourceId, "outcome source ID"), entry = state.entries.find(item => item.event.id === id);
  if (state.activeSourceId !== id || !entry || !ACTIVE.has(entry.status)) throw Error("Outcome is not for the active buy");
  return entry;
}
export function observeBuyProgress(input, { sourceId, status, reason }) {
  const state = checkedState(input), entry = activeEntry(state, sourceId);
  if (["failed", "ambiguous"].includes(status)) { entry.status = status; entry.reason = proofRef(reason); }
  else {
    const before = PROGRESS.indexOf(entry.status), after = PROGRESS.indexOf(status);
    if (before < 0 || after < before || after < 1) throw Error("Cannot regress or silently retry an unresolved buy");
    entry.status = status;
  }
  return state;
}

// Only after the caller has read the same source's changed, non-busy canister
// job. This reconciles an uncertain update; it never submits or resets a job.
export function reconcileObservedBuyProgress(input, { sourceId, status, evidenceRef }) {
  const state = checkedState(input), entry = activeEntry(state, sourceId);
  if (!["ambiguous", "reserved", "submitted", "generating", "signed"].includes(entry.status) ||
      !["submitted", "generating", "signed", "failed"].includes(status))
    throw Error("Observed progress cannot reconcile this active buy");
  entry.updateReconciliations ??= [];
  entry.updateReconciliations.push({ from: entry.status, to: status, evidenceRef: proofRef(evidenceRef) });
  entry.status = status;
  return state;
}

function deliveryProof(delivery, sourceId) {
  if (!delivery || delivery.sourceId !== sourceId || delivery.confirmed !== true || delivery.canonical !== true)
    throw Error("Canonical RH delivery proof for this source is required");
  return { sourceId, transactionHash: hash(delivery.transactionHash, "callback transaction"), answerHash: hash(delivery.answerHash, "answer hash"), confirmed: true, canonical: true };
}
export function recordBuyDelivery(input, { sourceId, delivery }) {
  const state = checkedState(input), entry = activeEntry(state, sourceId), proof = deliveryProof(delivery, entry.event.id);
  if (entry.delivery && !same(entry.delivery, proof)) throw Error("Canonical delivery changed");
  entry.delivery = proof; entry.status = "awaiting_publication";
  return state;
}

export function completeBuy(input, { sourceId, publication, actualCycles, proofRef: reference, nowMs }) {
  const state = checkedState(input), entry = activeEntry(state, sourceId);
  if (!entry.delivery || entry.status !== "awaiting_publication" || publication?.sourceId !== entry.event.id ||
      publication.status !== "posted" || publication.verified !== true || !/^[1-9]\d{0,19}$/.test(publication.postId ?? "") ||
      hash(publication.callbackTransactionHash, "publication callback") !== entry.delivery.transactionHash ||
      hash(publication.answerHash, "publication answer hash") !== entry.delivery.answerHash)
    throw Error("Verified X publication must match the delivered active thought");
  entry.publication = { sourceId: entry.event.id, postId: publication.postId,
    callbackTransactionHash: entry.delivery.transactionHash, answerHash: entry.delivery.answerHash, status: "posted", verified: true };
  const cumulative = unsigned(actualCycles, "actual model cycles"), baseline = unsigned(entry.costBaseline ?? "0", "cost baseline");
  if (cumulative < baseline) throw Error("Cumulative model cost fell below retained history");
  entry.status = "completed"; entry.actualCycles = (cumulative - baseline).toString(); entry.cumulativeActualCycles = cumulative.toString();
  if (integer(nowMs, "settlement timestamp") < entry.reservedAtMs) throw Error("Settlement predates the buy reservation");
  day(nowMs); entry.settledAtMs = nowMs;
  entry.proofRef = proofRef(reference); entry.reserveOverrun = BigInt(entry.actualCycles) > BUY_JOB_RESERVE;
  state.activeSourceId = null;
  return state;
}

// Explicit accounting reconciliation. The source and all measured costs stay
// in the journal. Only the separate skip policy permits later work to proceed.
export function settleFailedBuy(input, { sourceId, outcome, actualCycles, proofRef: reference, nowMs }) {
  const state = checkedState(input), entry = activeEntry(state, sourceId);
  if (!["failed", "ambiguous"].includes(entry.status) || !["not_executed", "failed_final"].includes(outcome))
    throw Error("Only an explicitly reconciled failure can release this buy");
  const cumulative = unsigned(actualCycles, "reconciled model cycles"), baseline = unsigned(entry.costBaseline ?? "0", "cost baseline");
  if (cumulative < baseline) throw Error("Cumulative model cost fell below retained history");
  const cost = cumulative - baseline;
  if (outcome === "not_executed" && (cost !== 0n || entry.delivery)) throw Error("No-execution proof conflicts with recorded execution");
  entry.status = outcome; entry.actualCycles = cost.toString(); entry.cumulativeActualCycles = cumulative.toString(); entry.proofRef = proofRef(reference);
  if (integer(nowMs, "settlement timestamp") < entry.reservedAtMs) throw Error("Settlement predates the buy reservation");
  day(nowMs); entry.settledAtMs = nowMs;
  entry.reserveOverrun = cost > BUY_JOB_RESERVE; state.activeSourceId = null;
  return checkedState(state);
}

function assertSettledSideEffects(entry, { pendingUpdate, deliveryUncertain, publicationUncertain }) {
  if (pendingUpdate || deliveryUncertain || publicationUncertain || entry.status === "ambiguous")
    throw Error("Uncertain update, delivery or publication must be reconciled before settlement");
  if (entry.publication) throw Error("A published or uncertain publication cannot be rejected as unpublished");
}

// Called only with a freshly observed terminal canister job. A known Failed
// phase can be skipped, but an in-flight or uncertain update retains its hold.
export function settleObservedFailedBuy(input, { sourceId, job, nowMs, evidenceRef,
  pendingUpdate = null, deliveryUncertain = false, publicationUncertain = false }) {
  const state = checkedState(input), entry = activeEntry(state, sourceId);
  assertSettledSideEffects(entry, { pendingUpdate, deliveryUncertain, publicationUncertain });
  const source = job?.source?.[0];
  if (!job || job.request?.id !== entry.event.id || job.request.tx_hash !== entry.event.txHash ||
      Number(job.request.log_index) !== entry.event.logIndex || job.request.block_hash !== entry.event.blockHash ||
      Number(job.request.block_number) !== entry.event.blockNumber || source?.manager !== BUY_POOL.manager ||
      source.pool_id !== BUY_POOL.pool_id || source.transaction_hash !== entry.event.txHash ||
      Number(source.log_index) !== entry.event.logIndex)
    throw Error("Failed job evidence belongs to another source");
  if (job.busy !== false || !Object.hasOwn(job.phase ?? {}, "Failed") || Object.keys(job.phase).length !== 1 ||
      job.recovery?.some(recovery => recovery.accounting_uncertain) || job.accounting_uncertain === true)
    throw Error("Failed job is busy, nonterminal or accounting is uncertain");
  const cumulative = unsigned(job.model_cycles, "observed cumulative model cycles");
  entry.status = "failed";
  entry.failureObservation = { evidenceRef: proofRef(evidenceRef), atMs: nowMs,
    cumulativeModelCycles: cumulative.toString(), phase: "Failed" };
  return settleFailedBuy(state, { sourceId, outcome: "failed_final", actualCycles: cumulative,
    proofRef: evidenceRef, nowMs });
}

// A duplicate or otherwise rejected answer is an explicit failed outcome,
// never a completed publication. Confirmed delivery may be retained, but a
// pending send/update must be resolved before this reservation is released.
export function rejectBuyResult(input, { sourceId, answerHash, reason, actualCycles, nowMs,
  proofRef: reference, duplicateOf = null, pendingUpdate = null, deliveryUncertain = false,
  publicationUncertain = false }) {
  const state = checkedState(input), entry = activeEntry(state, sourceId);
  assertSettledSideEffects(entry, { pendingUpdate, deliveryUncertain, publicationUncertain });
  const resultHash = hash(answerHash, "rejected answer hash");
  if (entry.delivery && entry.delivery.answerHash !== resultHash) throw Error("Rejected result differs from delivered answer");
  const duplicate = duplicateOf === null ? null : hash(duplicateOf, "duplicate source ID");
  if (duplicate === entry.event.id) throw Error("A duplicate must refer to an earlier source");
  const rejection = { answerHash: resultHash, reason: proofRef(reason),
    proofRef: proofRef(reference), duplicateOf: duplicate, published: false };
  entry.reason = rejection.reason;
  entry.status = "failed";
  const settled = settleFailedBuy(state, { sourceId, outcome: "failed_final", actualCycles, proofRef: reference, nowMs });
  settled.entries.find(value => value.event.id === entry.event.id).rejectedResult = rejection;
  return checkedState(settled);
}
