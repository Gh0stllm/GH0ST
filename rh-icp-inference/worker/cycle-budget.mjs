import fs from "node:fs";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const ICP_CLI = "/Users/abhijith/.cargo/bin/icp";
export const FUNDING_CANISTERS = Object.freeze({
  model: "6obed-qaaaa-aaaaj-a65ja-cai", coordinator: "6jacx-5yaaa-aaaaj-a65jq-cai",
});
export const FUNDING_DEPLOYER = "uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe";
export const MODEL_JOB_RESERVE = 2_000_000_000_000n;
export const MODEL_MINIMUM_REMAINING = 3_000_000_000_000n;
export const COORDINATOR_JOB_RESERVE = 100_000_000_000n;
export const COORDINATOR_MINIMUM_REMAINING = 300_000_000_000n;
export const FUNDING_SNAPSHOT_MAX_AGE_MS = 60_000;
export const UNLIMITED_ADMISSION_POLICY = Object.freeze({
  schema: "gh0st-generation-unlimited-v1", cycle_limit: null, chunk_limit: null, time_limit: null,
  retry_limit: null, quality_retry_limit: null, scope: "swap jobs", per_call_tokens: 4,
  prefill_method: "run_update_full", continuation_method: "run_update",
  funding: "existing canister balance only", admission_estimate: "2000000000000",
  zero_cycle_budget_semantics: "no per-job generation ceiling",
  format_and_output_bounds: "retain the existing exact-thought format and output bounds",
  profile_overrides: "swap generation ceilings override historical embedded persona profile limits; profile bytes and seeds are unchanged",
  accounting: "preserve all measured cycles across restart and recovery segments",
  identity: "recover the same source, prompt and seed", policy_authorization: "owner-only while paused",
});

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultExecFile = promisify(nodeExecFile);
class FundingHalt extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const halt = reason => { throw new FundingHalt(reason); };
const time = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253_402_300_799_999) halt("invalid_snapshot_time");
  return value;
};
function number(value, reason) {
  if (typeof value === "bigint") {
    if (value < 0n) halt(reason);
    return value;
  }
  // CLI formats Candid Nat values with grouped underscores. Never use Number.
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:_\d{3})+)$/.test(value)) halt(reason);
  return BigInt(value.replaceAll("_", ""));
}
function checkedManifest(manifest) {
  const configured = manifest?.limits?.model_cycle_budget;
  const executionLimit = configured === undefined ? null : number(configured, "invalid_manifest");
  if (!manifest || !/^[0-9a-f]{64}$/.test(manifest.model_wasm_sha256 ?? "") ||
      !/^[0-9a-f]{64}$/.test(manifest.coordinator_wasm_sha256 ?? "") ||
      ![0n, MODEL_JOB_RESERVE].includes(executionLimit) ||
      (manifest.limits?.model_admission_reserve !== undefined &&
        number(manifest.limits.model_admission_reserve, "invalid_manifest") !== MODEL_JOB_RESERVE))
    halt("invalid_manifest");
  if (executionLimit === 0n && (manifest.limits.max_chunks !== null ||
      Object.keys(manifest.generation_policy ?? {}).length !== Object.keys(UNLIMITED_ADMISSION_POLICY).length ||
      Object.entries(UNLIMITED_ADMISSION_POLICY).some(([key, value]) => manifest.generation_policy?.[key] !== value)))
    halt("invalid_unlimited_policy");
  return manifest;
}
function loadManifest() {
  try { return checkedManifest(JSON.parse(fs.readFileSync(new URL("../build/artifact-manifest.json", import.meta.url), "utf8"))); }
  catch (error) { if (error instanceof FundingHalt) throw error; halt("manifest_unavailable"); }
}

export function validateFundingStatus(name, status, manifest) {
  checkedManifest(manifest);
  if (!Object.hasOwn(FUNDING_CANISTERS, name)) halt("invalid_canister_name");
  const controllers = status?.settings?.controllers;
  const expected = name === "model" ? [FUNDING_DEPLOYER, FUNDING_CANISTERS.coordinator] : [FUNDING_DEPLOYER];
  const expectedHash = name === "model" ? manifest.model_wasm_sha256 : manifest.coordinator_wasm_sha256;
  if (status?.id !== FUNDING_CANISTERS[name] || status.status !== "Running" || status.module_hash !== "0x" + expectedHash ||
      !Array.isArray(controllers) || controllers.some(value => typeof value !== "string") ||
      JSON.stringify([...controllers].sort()) !== JSON.stringify([...expected].sort())) halt("canister_binding_mismatch");
  return { id: status.id, moduleHash: status.module_hash, controllers: [...controllers],
    cycles: number(status.cycles, "missing_or_invalid_cycle_balance").toString(),
    reservedCycles: number(status.reserved_cycles, "missing_or_invalid_reserved_balance").toString() };
}

// Read-only management status calls, sequential to avoid the CLI identity lock.
// Fixed absolute executable + argument array; no shell, key export or inference.
export async function readCycleSnapshot({ manifest = loadManifest(), execFile = defaultExecFile,
  now = Date.now, cwd = projectRoot } = {}) {
  checkedManifest(manifest);
  const snapshot = { schema: "gh0st-funding-snapshot-v1", startedAtMs: time(now()), atMs: null, canisters: {} };
  for (const name of ["coordinator", "model"]) {
    if (process.env.GH0ST_SERVER_RUNTIME === "1") {
      const { readStatus } = await import("../server/read-only-icp.mjs");
      const status = await readStatus(FUNDING_CANISTERS[name]);
      validateFundingStatus(name, status, manifest);
      snapshot.canisters[name] = { ...status, observedAtMs: time(now()) };
      continue;
    }
    let response;
    try {
      response = await execFile(ICP_CLI, ["canister", "status", FUNDING_CANISTERS[name],
        "-e", "production", "--identity", "gh0st-deployer", "--json"],
      { cwd, timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
    } catch { halt("status_read_failed"); }
    let status;
    try { status = JSON.parse(response.stdout); } catch { halt("invalid_status_json"); }
    validateFundingStatus(name, status, manifest); // Public fallback lacks balances and fails closed.
    snapshot.canisters[name] = { ...status, observedAtMs: time(now()) };
  }
  snapshot.atMs = time(now());
  return snapshot;
}

function fundingDecision(snapshot, { manifest, nowMs, dailyCycleCap, dailyLedger }) {
  checkedManifest(manifest);
  time(nowMs);
  if (!snapshot || snapshot.schema !== "gh0st-funding-snapshot-v1") halt("invalid_snapshot");
  const started = time(snapshot.startedAtMs), finished = time(snapshot.atMs);
  if (started > finished || finished > nowMs + 5000 || nowMs - started > FUNDING_SNAPSHOT_MAX_AGE_MS)
    halt("stale_snapshot");
  const balances = {};
  for (const name of ["coordinator", "model"]) {
    const status = snapshot.canisters?.[name], observed = time(status?.observedAtMs);
    if (observed < started || observed > finished || observed > nowMs + 5000 ||
        nowMs - observed > FUNDING_SNAPSHOT_MAX_AGE_MS) halt("stale_snapshot");
    balances[name] = validateFundingStatus(name, status, manifest);
  }
  let reason = null;
  // Reserved cycles are not available to fund new work, so do not add them.
  if (BigInt(balances.model.cycles) < MODEL_JOB_RESERVE + MODEL_MINIMUM_REMAINING) reason = "model_funding_floor";
  else if (BigInt(balances.coordinator.cycles) < COORDINATOR_JOB_RESERVE + COORDINATOR_MINIMUM_REMAINING)
    reason = "coordinator_funding_floor";

  // Optional explicit MODEL-cycle cap. The queue's persisted ledger supplies
  // spent/reserved totals; this module never invents a cap or mutates its ledger.
  let dailyBudget = { enabled: false, scope: "model_cycles" };
  if (dailyCycleCap != null && number(dailyCycleCap, "invalid_daily_cycle_cap") !== 0n) {
    const cap = number(dailyCycleCap, "invalid_daily_cycle_cap");
    const today = new Date(nowMs).toISOString().slice(0, 10);
    if (!dailyLedger || dailyLedger.day !== today) halt("daily_ledger_missing_or_stale");
    const spent = number(dailyLedger.spent, "invalid_daily_ledger"), reserved = number(dailyLedger.reserved, "invalid_daily_ledger");
    const available = cap > spent + reserved ? cap - spent - reserved : 0n;
    dailyBudget = { enabled: true, scope: "model_cycles", day: today, cap: cap.toString(),
      spent: spent.toString(), reserved: reserved.toString(), available: available.toString(),
      nextJobReserve: MODEL_JOB_RESERVE.toString() };
    if (available < MODEL_JOB_RESERVE && reason === null) reason = "daily_cycle_cap";
  }
  return { allowed: reason === null, halt: reason !== null, reason, balances, snapshot,
    snapshotStamp: new Date(finished).toISOString(), dailyBudget,
    required: { model: (MODEL_JOB_RESERVE + MODEL_MINIMUM_REMAINING).toString(),
      coordinator: (COORDINATOR_JOB_RESERVE + COORDINATOR_MINIMUM_REMAINING).toString() } };
}

// Call immediately BEFORE persisting a new queue reservation. On any read,
// binding, freshness or funding failure, return a halt reason and do nothing.
// The caller remains responsible for holding the single-writer queue lock and
// recording/reconciling reservations. There is deliberately no auto-top-up.
export async function assertFundingAdmission({ snapshot, manifest, dailyCycleCap = null, dailyLedger = null,
  nowMs, now = Date.now, execFile = defaultExecFile, cwd = projectRoot } = {}) {
  try {
    manifest = manifest ?? loadManifest();
    snapshot = snapshot ?? await readCycleSnapshot({ manifest, execFile, now, cwd });
    return fundingDecision(snapshot, { manifest, nowMs: nowMs ?? now(), dailyCycleCap, dailyLedger });
  } catch (error) {
    return { allowed: false, halt: true, reason: error instanceof FundingHalt ? error.reason : "funding_check_failed",
      balances: null, snapshot: snapshot ?? null, snapshotStamp: null };
  }
}
