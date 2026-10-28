/** Bounded transport for the retained logical history. No record is removed. */
export const JOB_PAGE_SIZE = 32;
export const JOB_HISTORY_MAX_BYTES = 128 * 1024 * 1024;
const id = value => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[\x21-\x7e]+$/.test(value);
const fault = code => Object.assign(Error(code), { code });
const phase = job => typeof job?.phase === "string" ? job.phase : Object.keys(job?.phase ?? {})[0];
const nat = value => {
  if ((typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) ||
      (Number.isSafeInteger(value) && value >= 0)) return BigInt(value);
  throw fault("invalid_retention_status");
};
const option = value => {
  if (!Array.isArray(value) || value.length > 1 || value.some(x => !id(x))) throw fault("invalid_job_cursor");
  return value[0] ?? null;
};

export function retentionStatusType(IDL) {
  return IDL.Record({ retained: IDL.Nat64, completed: IDL.Nat64, failed: IDL.Nat64,
    open: IDL.Nat64, busy: IDL.Nat64, paused: IDL.Bool, verifying: IDL.Bool,
    active: IDL.Opt(IDL.Text), blocked_failed: IDL.Bool, admission_allowed: IDL.Bool });
}
export function jobPageType(IDL, Job) {
  return IDL.Record({ jobs: IDL.Vec(Job), next: IDL.Opt(IDL.Text), total: IDL.Nat64 });
}
export function normalizeRetentionStatus(value) {
  if (!value || typeof value !== "object") throw fault("invalid_retention_status");
  const out = Object.fromEntries(["retained", "completed", "failed", "open", "busy"].map(k => [k, nat(value[k])]));
  for (const key of ["paused", "verifying", "blocked_failed", "admission_allowed"]) {
    if (typeof value[key] !== "boolean") throw fault("invalid_retention_status"); out[key] = value[key];
  }
  const active = option(value.active); out.active = active === null ? [] : [active];
  if (out.completed + out.failed + out.open !== out.retained || out.busy > out.retained ||
      (out.admission_allowed && (out.paused || out.verifying || out.blocked_failed || out.open > 0n || out.busy > 0n || out.active.length)))
    throw fault("invalid_retention_status");
  return out;
}

/** Legacy support is exclusively for injected test doubles lacking the new
 * methods. Real actors expose those methods from Candid; a failed new query
 * always propagates and can never downgrade to the unbounded query. */
export async function readRetentionStatus(actor) {
  if (typeof actor?.retention_status === "function")
    return normalizeRetentionStatus(await actor.retention_status());
  if (typeof actor?.list_jobs_page === "function" || typeof actor?.list_jobs !== "function")
    throw fault("retention_query_unavailable");
  const jobs = await actor.list_jobs();
  if (!Array.isArray(jobs)) throw fault("invalid_job_history");
  const completed = jobs.filter(j => phase(j) === "Complete").length;
  const failed = jobs.filter(j => phase(j) === "Failed").length;
  const open = jobs.length - completed - failed, busy = jobs.filter(j => j?.busy === true).length;
  return { retained: BigInt(jobs.length), completed: BigInt(completed), failed: BigInt(failed),
    open: BigInt(open), busy: BigInt(busy), paused: false, verifying: false, active: [],
    blocked_failed: false, admission_allowed: open === 0 && busy === 0, legacyMock: true };
}

/** Read the same complete history previously returned by list_jobs, using
 * individually bounded pages. Append/change during a scan fails closed so an
 * admission/recovery decision never relies on a silently incomplete catalog. */
export async function listCoordinatorJobs(actor, { pageSize = JOB_PAGE_SIZE, maxBytes = JOB_HISTORY_MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > JOB_PAGE_SIZE ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw fault("invalid_history_read_bound");
  if (typeof actor?.list_jobs_page !== "function") {
    if (typeof actor?.retention_status === "function" || typeof actor?.list_jobs !== "function")
      throw fault("paged_history_unavailable");
    const legacy = await actor.list_jobs();
    if (!Array.isArray(legacy)) throw fault("invalid_job_history");
    return legacy;
  }
  if (typeof actor?.retention_status !== "function") throw fault("retention_query_unavailable");
  const before = await readRetentionStatus(actor), jobs = []; let after = null, bytes = 0;
  for (;;) {
    const page = await actor.list_jobs_page(after === null ? [] : [after], pageSize);
    if (!page || !Array.isArray(page.jobs) || page.jobs.length > pageSize || nat(page.total) !== before.retained)
      throw fault("job_history_changed");
    const next = option(page.next);
    for (const job of page.jobs) {
      const sourceId = job?.request?.id;
      if (!id(sourceId) || (after !== null && sourceId <= after)) throw fault("invalid_job_order");
      bytes += Buffer.byteLength(JSON.stringify(job, (_, v) => typeof v === "bigint" ? v.toString() : v));
      if (bytes > maxBytes) throw fault("job_history_byte_bound");
      after = sourceId; jobs.push(job);
      if (BigInt(jobs.length) > before.retained) throw fault("job_history_changed");
    }
    if (next === null) {
      if (BigInt(jobs.length) !== before.retained) throw fault("incomplete_job_history");
      break;
    }
    if (!page.jobs.length || next !== after || BigInt(jobs.length) >= before.retained)
      throw fault("invalid_job_cursor");
  }
  const final = await readRetentionStatus(actor);
  for (const key of ["retained", "completed", "failed", "open", "busy", "paused", "verifying", "blocked_failed", "admission_allowed"])
    if (before[key] !== final[key]) throw fault("job_history_changed");
  if (before.active[0] !== final.active[0]) throw fault("job_history_changed");
  const counts = { completed: 0n, failed: 0n, open: 0n, busy: 0n };
  for (const job of jobs) {
    const p = phase(job); if (!["Verified", "Running", "ReadyToSign", "Complete", "Failed"].includes(p)) throw fault("invalid_job_history");
    counts[p === "Complete" ? "completed" : p === "Failed" ? "failed" : "open"]++;
    if (job.busy === true) counts.busy++;
  }
  for (const key of Object.keys(counts)) if (counts[key] !== final[key]) throw fault("job_history_changed");
  return jobs;
}
