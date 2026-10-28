// Observation only. No canister calls, credentials, transactions, or worker
// mutations live here. The runner must persist returned raw log deltas before
// persisting the cursor, and keep these artifacts private.
const SCHEMA = "gh0st-skipped-capture-v1";
const HASH = /^0x[0-9a-f]{64}$/;
const PHASES = ["Verified", "Running", "ReadyToSign", "Complete", "Failed"];
const nat = value => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw Error("Unsafe capture integer");
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw Error("Invalid capture integer");
  return text;
};
const timestamp = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("Invalid observation time");
  return value;
};
function validate(state) {
  if (state?.schema !== SCHEMA || !state.sources || !Array.isArray(state.logGaps)) throw Error("Invalid capture state");
}
export function createSkippedCapture() {
  return { schema: SCHEMA, sources: {}, logLastIndex: null, logLastTimestampNs: null,
    logGaps: [], firstLogIndex: null, lastObservedAt: null };
}

/** Cache markers bind a log segment to a source; bare token fragments do not. */
export function modelLogCacheIdentity(content) {
  if (typeof content !== "string") return null;
  const match = /\.canister_cache\/6jacx-5yaaa-aaaaj-a65jq-cai\/sessions\/gh0st-([0-9a-f]{64})-(a[1-9][0-9]*|g[0-9a-f]{64})\.cache/.exec(content);
  return match ? { sourceId: "0x" + match[1], cacheTag: match[2],
    generation: match[2][0] === "a" ? match[2].slice(1) : null } : null;
}

/** Returns a de-duplicated raw delta, never a claimed reconstruction of output.
 * All indices/timestamps remain decimal strings to avoid JSON precision loss.
 * A first window is incomplete even when later windows are contiguous.
 */
export function captureLogBatch(state, payload, observedAt = Date.now()) {
  validate(state); timestamp(observedAt);
  const rows = Array.isArray(payload) ? payload : payload?.log_records;
  if (!Array.isArray(rows) || rows.length > 10000) throw Error("Invalid model log batch");
  const byIndex = new Map();
  for (const row of rows) {
    const index = nat(row.index), timestampNs = nat(row.timestamp);
    let content = row.content ?? row.message;
    if (Array.isArray(content) && content.every(v => Number.isInteger(v) && v >= 0 && v <= 255))
      content = Buffer.from(content).toString("utf8");
    if (typeof content !== "string" || Buffer.byteLength(content) > 65536) throw Error("Invalid model log content");
    const normalized = { index, timestamp: timestampNs, content };
    const duplicate = byIndex.get(index);
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(normalized)) throw Error("Conflicting model log index");
    byIndex.set(index, normalized);
  }
  const sorted = [...byIndex.values()].sort((a, b) => BigInt(a.index) < BigInt(b.index) ? -1 : 1);
  const records = [], gaps = [];
  for (const row of sorted) {
    if (state.logLastIndex !== null && BigInt(row.index) <= BigInt(state.logLastIndex)) continue;
    if (state.logLastIndex === null) {
      state.firstLogIndex = row.index;
      const gap = { kind: "initial_window", firstAvailableIndex: row.index, observedAt };
      state.logGaps.push(gap); gaps.push(gap);
    } else if (BigInt(row.index) !== BigInt(state.logLastIndex) + 1n) {
      const gap = { kind: "missing_records", afterIndex: state.logLastIndex, beforeIndex: row.index,
        count: (BigInt(row.index) - BigInt(state.logLastIndex) - 1n).toString(), observedAt };
      state.logGaps.push(gap); gaps.push(gap);
    }
    const binding = modelLogCacheIdentity(row.content);
    records.push({ ...row, observedAt, ...(binding ? { binding } : {}) });
    state.logLastIndex = row.index; state.logLastTimestampNs = row.timestamp;
  }
  state.lastObservedAt = observedAt;
  return { records, gaps, nextIndex: state.logLastIndex === null ? null : (BigInt(state.logLastIndex) + 1n).toString(),
    complete: false, reason: "Raw logs contain prompts and diagnostics as well as tokens; they are not a proven full response." };
}

/** The coordinator clears rejected text inside the finishing advance call.
 * Retain every different observed prefix, including a prefix lost at reset.
 * Only ReadyToSign/Complete snapshots prove a complete accepted candidate.
 */
export function captureJobSnapshot(state, job, observedAt = Date.now()) {
  validate(state); timestamp(observedAt);
  const sourceId = job?.request?.id?.toLowerCase();
  const phase = Object.keys(job?.phase ?? {})[0];
  if (!HASH.test(sourceId ?? "") || !PHASES.includes(phase) || Object.keys(job.phase).length !== 1 ||
      typeof job.answer !== "string" || typeof job.busy !== "boolean") throw Error("Invalid captured coordinator job");
  const voice = job.voice?.[0], generation = nat(voice?.generation?.[0] ?? voice?.attempt ?? 1);
  const source = state.sources[sourceId] ??= { sourceId, currentGeneration: generation, generations: {} };
  const reason = typeof voice?.quality_error === "string" ? voice.quality_error : "";
  if (source.currentGeneration !== generation) {
    const previous = source.generations[source.currentGeneration];
    if (previous) {
      previous.supersededAt = observedAt;
      if (reason) { previous.skipped = true; previous.skipReason = reason; }
    }
    source.currentGeneration = generation;
  }
  const record = source.generations[generation] ??= { sourceId, generation, firstObservedAt: observedAt,
    lastObservedAt: observedAt, text: "", textStatus: "observed_prefix", observations: [], skipped: false };
  const observation = { at: observedAt, phase, busy: job.busy, text: job.answer,
    outputTokens: nat(job.output_tokens), inputTokens: nat(job.input_tokens), chunks: nat(job.chunks),
    ...(reason ? { qualityError: reason } : {}), ...(job.error ? { error: String(job.error) } : {}) };
  const prior = record.observations.at(-1);
  if (!prior || JSON.stringify({ ...prior, at: 0 }) !== JSON.stringify({ ...observation, at: 0 }))
    record.observations.push(observation);
  if (job.answer.length >= record.text.length) record.text = job.answer;
  else if (job.answer !== record.text) record.prefixResetObserved = true;
  if (["ReadyToSign", "Complete"].includes(phase) && !job.busy && job.answer.length) {
    record.text = job.answer; record.textStatus = "complete_accepted_candidate_observed";
  }
  if (phase === "Failed") { record.skipped = true; record.skipReason = String(job.error || reason || "coordinator job failed"); }
  record.phase = phase; record.busy = job.busy; record.lastObservedAt = observedAt;
  state.lastObservedAt = observedAt;
  return structuredClone(record);
}

export function skippedCaptureReport(state) {
  validate(state);
  return { schema: SCHEMA, lastObservedAt: state.lastObservedAt, logLastIndex: state.logLastIndex,
    logGaps: structuredClone(state.logGaps), sources: structuredClone(state.sources),
    limitation: "Rejected candidates may be cleared between queries. Captured prefixes and raw logs are partial unless an explicit complete candidate snapshot was observed." };
}
