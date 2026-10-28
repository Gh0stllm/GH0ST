import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import {listCoordinatorJobs} from "./job-history.mjs";
import { fileURLToPath } from "node:url";
import { swapSourceId } from "./swaps.mjs";

export const FAILURE_DEFERRAL_CLI = "/Users/abhijith/.cargo/bin/icp";
export const FAILURE_DEFERRAL_COORDINATOR = "6jacx-5yaaa-aaaaj-a65jq-cai";
export const FAILURE_DEFERRAL_REASON = "user authorized skip failed generation";
const SCHEMA = "gh0st-failure-deferral-v1";
const defaultExecFile = promisify(nodeExecFile);
const cwd = fileURLToPath(new URL("../", import.meta.url));
const HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_NAT128 = (1n << 128n) - 1n;
function fault(message, code = "FAILURE_DEFERRAL_BLOCKED") { const e = Error(message); e.code = code; return e; }
function nat(value) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw fault("Invalid expected failed-job cycles");
  if (!["string", "number", "bigint"].includes(typeof value) || !/^(0|[1-9]\d*)$/.test(String(value))) throw fault("Invalid expected failed-job cycles");
  const n = BigInt(value);
  if (n > MAX_NAT128) throw fault("Failed-job cycles exceed Nat128");
  return n.toString();
}
function phase(job) {
  const keys = Object.keys(job?.phase ?? {});
  if (keys.length !== 1 || !["Complete", "Failed"].includes(keys[0]) || job.busy !== false)
    throw fault("Every coordinator job must be terminal and not busy before owner deferral");
  return keys[0];
}
function checkTarget(jobs, sourceId, expectedCycles, expectedSource) {
  if (!Array.isArray(jobs)) throw fault("Coordinator jobs are unavailable");
  for (const job of jobs) phase(job);
  const matches = jobs.filter(job => job.request?.id?.toLowerCase() === sourceId);
  if (matches.length !== 1 || phase(matches[0]) !== "Failed") throw fault("Exact failed coordinator job is unavailable");
  const job = matches[0];
  if (nat(job.model_cycles) !== expectedCycles || !Array.isArray(job.source) || job.source.length !== 1 ||
      swapSourceId(4663, job.source[0]) !== sourceId || swapSourceId(4663, expectedSource) !== sourceId)
    throw fault("Failed-job source or measured cycles changed");
  if (!Array.isArray(job.recovery) || job.recovery.length > 1 || job.recovery.some(r => r.accounting_uncertain !== false))
    throw fault("Failed-job cycle accounting is not reconciled");
  return job;
}
function findDeferral(records, sourceId, expectedCycles) {
  if (!Array.isArray(records)) throw fault("Deferred swap records are unavailable");
  const matches = records.filter(item => item.id?.toLowerCase() === sourceId);
  if (matches.length > 1) throw fault("Duplicate coordinator deferral records");
  if (!matches.length) return null;
  const item = matches[0];
  if (nat(item.model_cycles) !== expectedCycles || typeof item.reason !== "string" || !item.reason.trim())
    throw fault("Existing coordinator deferral does not match the failed-job cost");
  return { id: sourceId, modelCycles: expectedCycles, reason: item.reason, deferredAt: String(item.deferred_at) };
}
function acknowledged(stdout) {
  return /^\s*\(\s*variant\s*\{\s*Ok(?:\s*=\s*null)?\s*;?\s*\}\s*\)\s*$/.test(stdout ?? "");
}

/**
 * Narrow owner-only operation for an already terminal failed swap. The caller
 * must durably persist each returned intent before this helper runs an update.
 * Fixed executable, coordinator, identity, method allowlist, reason, and Nat
 * encoding prevent this from becoming a generic owner command runner.
 *
 * The canister itself enforces paused/not-verifying/no-busy/no-remembering and
 * target-not-active. Queries expose job phases, not the private active pointer;
 * therefore a successful defer_failed_swap reply and post-query are required.
 */
export async function deferFailedGeneration({ coordinator, canisterId = FAILURE_DEFERRAL_COORDINATOR,
  sourceId, expectedCycles, expectedSource, existing, persist, execFile = defaultExecFile, now = Date.now } = {}) {
  if (canisterId !== FAILURE_DEFERRAL_COORDINATOR || typeof sourceId !== "string" || !HASH.test(sourceId) ||
      typeof persist !== "function" || typeof execFile !== "function" || typeof now !== "function" ||
      (typeof coordinator?.list_jobs_page !== "function" && typeof coordinator?.list_jobs !== "function") || typeof coordinator?.get_deferred_swaps !== "function")
    throw fault("Fixed coordinator, source, durable persistence, and query methods are required");
  sourceId = sourceId.toLowerCase();
  expectedCycles = nat(expectedCycles);
  if (swapSourceId(4663, expectedSource) !== sourceId) throw fault("Expected swap source ID differs");
  let state = { schema: SCHEMA, canisterId, sourceId, expectedCycles, reason: FAILURE_DEFERRAL_REASON,
    status: "pending", step: "planned", startedAt: now(), updatedAt: now(), ...existing };
  if (state.schema !== SCHEMA || state.canisterId !== canisterId || state.sourceId !== sourceId ||
      state.expectedCycles !== expectedCycles || state.reason !== FAILURE_DEFERRAL_REASON)
    throw fault("Stored owner-deferral intent differs from the exact failed job");
  async function save(fields) {
    state = { ...state, ...fields, updatedAt: now() };
    await persist({ ...state }); // Must resolve only after durable journal write.
  }
  async function readState() {
    const jobs = await listCoordinatorJobs(coordinator);
    checkTarget(jobs, sourceId, expectedCycles, expectedSource);
    if (typeof coordinator.get_voice_state === "function") {
      const voice = await coordinator.get_voice_state();
      if (!Array.isArray(voice.remembering) || voice.remembering.length) throw fault("Coordinator memory acknowledgement is still in flight");
    }
    return findDeferral(await coordinator.get_deferred_swaps(), sourceId, expectedCycles);
  }
  async function call(method, argument, pendingStep) {
    if (!["set_paused", "defer_failed_swap"].includes(method)) throw fault("Owner method is outside the deferral allowlist");
    await save({ step: pendingStep, status: "pending" });
    try {
      if (process.env.GH0ST_SERVER_RUNTIME === "1") {
        const { loadDelegatedRecovery } = await import("../server/delegated-recovery.mjs");
        const recovery = await loadDelegatedRecovery();
        let result;
        if (method === "set_paused") {
          if (!["(true)", "(false)"].includes(argument)) throw fault("Invalid fixed pause argument");
          result = await recovery.set_paused(argument === "(true)");
        } else {
          result = await recovery.defer_failed_swap(sourceId, BigInt(expectedCycles), FAILURE_DEFERRAL_REASON);
        }
        if (!result || !Object.hasOwn(result, "Ok") || result.Ok !== null)
          throw fault("Delegated update returned no unambiguous success acknowledgement", "FAILURE_DEFERRAL_AMBIGUOUS");
        return;
      }
      const response = await execFile(FAILURE_DEFERRAL_CLI,
        ["canister", "call", FAILURE_DEFERRAL_COORDINATOR, method, argument, "-e", "production", "--identity", "gh0st-deployer"],
        { cwd, timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
      if (!acknowledged(response.stdout)) throw fault("Owner update returned no unambiguous success acknowledgement", "FAILURE_DEFERRAL_AMBIGUOUS");
    } catch {
      await save({ step: pendingStep + "_ambiguous", status: "ambiguous" });
      throw fault("Owner update outcome requires read-only reconciliation; it will not be repeated", "FAILURE_DEFERRAL_AMBIGUOUS");
    }
  }

  let deferred = await readState();
  if (state.status === "deferred") {
    if (!deferred || state.step !== "complete") throw fault("Previously completed coordinator deferral no longer matches");
    return { ...state };
  }
  if (["pausing", "pausing_ambiguous", "unpausing", "unpausing_ambiguous"].includes(state.step))
    throw fault("Pause state has an ambiguous owner update; manual reconciliation is required", "FAILURE_DEFERRAL_AMBIGUOUS");
  if (["deferring", "deferring_ambiguous"].includes(state.step)) {
    if (!deferred) throw fault("Prior deferral update remains unresolved; it will not be repeated", "FAILURE_DEFERRAL_AMBIGUOUS");
    await save({ step: "deferred_verified", status: "pending", verification: deferred });
  } else if (deferred && state.step === "planned") {
    // This operation has not paused anything. An existing matching owner
    // deferral is sufficient, and must not toggle an externally managed pause.
    await save({ step: "complete", status: "deferred", verification: deferred, preexisting: true });
    return { ...state };
  } else if (!["planned", "paused", "deferred_verified"].includes(state.step)) {
    throw fault("Unknown stored owner-deferral step");
  }
  if (state.step === "planned") {
    await call("set_paused", "(true)", "pausing");
    await save({ step: "paused" });
  }
  if (state.step === "paused") {
    deferred = await readState(); // Recheck source, cost, and all terminal phases while paused.
    if (!deferred) {
      try {
        await call("defer_failed_swap", `("${sourceId}", ${expectedCycles} : nat, "${FAILURE_DEFERRAL_REASON}")`, "deferring");
      } catch (error) {
        // An interrupted update may have committed. Query once to reconcile;
        // never resubmit it merely because the CLI response was lost.
        deferred = await readState();
        if (!deferred) throw error;
      }
      deferred = await readState();
      if (!deferred) {
        await save({ step: "deferring_ambiguous", status: "ambiguous" });
        throw fault("Coordinator did not expose the acknowledged deferral", "FAILURE_DEFERRAL_AMBIGUOUS");
      }
    }
    await save({ step: "deferred_verified", status: "pending", verification: deferred });
  }
  if (state.step === "deferred_verified") {
    deferred = await readState();
    if (!deferred) throw fault("Verified deferral disappeared before unpause");
    await call("set_paused", "(false)", "unpausing");
    await save({ step: "complete", status: "deferred", verification: deferred });
  }
  return { ...state };
}
