import test from "node:test";
import assert from "node:assert/strict";
import { listCoordinatorJobs, readRetentionStatus, normalizeRetentionStatus } from "../worker/job-history.mjs";
import { createCollector } from "../scripts/live-stats.mjs";
import { createRecoveryOperations, RECOVERY_REASON } from "../server/delegated-recovery.mjs";
import { swapSourceId } from "../worker/swaps.mjs";

const source = n => "0x" + n.toString(16).padStart(64, "0");
const makeJobs = n => Array.from({ length: n }, (_, i) => ({ request: { id: source(i + 1) },
  phase: { [i % 11 === 0 ? "Failed" : "Complete"]: null }, busy: false,
  answer: "Preserved answer " + i, signature: new Uint8Array([i % 255]), model_cycles: BigInt(i * 1000), recovery: [] }));
function status(jobs) {
  const counts = { retained: BigInt(jobs.length), completed: 0n, failed: 0n, open: 0n, busy: 0n };
  for (const job of jobs) {const p=Object.keys(job.phase)[0];counts[p === "Complete" ? "completed" : p === "Failed" ? "failed" : "open"]++;if(job.busy)counts.busy++;}
  return { ...counts, paused: false, verifying: false, active: [], blocked_failed: false,
    admission_allowed: counts.open === 0n && counts.busy === 0n };
}
function paged(jobs) {
  const calls = { pages: [], statuses: 0, legacy: 0 };
  const actor = { retention_status: async () => { calls.statuses++; return status(jobs); },
    list_jobs: async () => { calls.legacy++; throw Error("unbounded query forbidden"); },
    list_jobs_page: async (after, limit) => { calls.pages.push({ after, limit });
      const start = after.length ? jobs.findIndex(job => job.request.id === after[0]) + 1 : 0;
      const rows = jobs.slice(start,start+limit);
      return { jobs: rows, next: start+rows.length<jobs.length?[rows.at(-1).request.id]:[], total: BigInt(jobs.length) };
    } };
  return {actor,calls};
}

test("more than 256 historical jobs retain exact answers, signatures and cycles through bounded pages", async () => {
  const jobs=makeJobs(601),{actor,calls}=paged(jobs);const read=await listCoordinatorJobs(actor);
  assert.deepEqual(read,jobs);assert.equal(calls.pages.length,19);assert.equal(calls.statuses,2);assert.equal(calls.legacy,0);
  assert.ok(calls.pages.every(p=>p.limit===32));assert.deepEqual(calls.pages[0].after,[]);
  assert.deepEqual(calls.pages[1].after,[source(32)]);assert.equal((await readRetentionStatus(actor)).admission_allowed,true);
});
test("empty and exact page-boundary histories terminate without an extra unbounded read", async () => {
  for(const n of [0,1,32,64]) {const jobs=makeJobs(n),f=paged(jobs);assert.deepEqual(await listCoordinatorJobs(f.actor),jobs);assert.equal(f.calls.legacy,0);assert.equal(f.calls.pages.length,Math.max(1,Math.ceil(n/32)));}
});
test("byte-bounded short pages preserve complete history and keep their exclusive cursor", async () => {
  const jobs=makeJobs(101),f=paged(jobs),base=f.actor.list_jobs_page;
  f.actor.list_jobs_page=(after,limit)=>base(after,Math.min(limit,3));
  assert.deepEqual(await listCoordinatorJobs(f.actor),jobs);
  assert.equal(f.calls.pages.length,34);assert.equal(f.calls.legacy,0);
});
test("stuck, mismatched, missing-tail and duplicate/backward pages fail closed", async () => {
  const jobs=makeJobs(65);
  for(const mutate of [
    p=>({...p,next:[source(1)]}),
    p=>({...p,next:[]}),
    p=>({...p,jobs:[p.jobs[0],p.jobs[0],...p.jobs.slice(2)]}),
    p=>({...p,jobs:[...p.jobs].reverse()}),
    p=>({...p,jobs:[],next:[source(32)]}),
    p=>({...p,next:[source(32),source(33)]}),
  ]) {const f=paged(jobs),base=f.actor.list_jobs_page;f.actor.list_jobs_page=async(...args)=>mutate(await base(...args));await assert.rejects(listCoordinatorJobs(f.actor));assert.equal(f.calls.legacy,0);}
});
test("a changing total or changed lifecycle counts cannot produce a partial history decision", async () => {
  for(const mode of ["page-total","after-counts","after-active"]) {
    const jobs=makeJobs(65),f=paged(jobs),basePage=f.actor.list_jobs_page,baseStatus=f.actor.retention_status;
    if(mode==="page-total")f.actor.list_jobs_page=async(...args)=>({...await basePage(...args),total:66n});
    else f.actor.retention_status=async()=>{const s=await baseStatus();if(f.calls.statuses===2){if(mode==="after-counts"){s.completed--;s.failed++;}else{s.active=[source(65)];s.admission_allowed=false;}}return s;};
    await assert.rejects(listCoordinatorJobs(f.actor),/job_history_changed/);assert.equal(f.calls.legacy,0);
  }
});
test("new query rejection never falls back to legacy, and partial upgrades are rejected", async () => {
  const f=paged(makeJobs(1));f.actor.list_jobs_page=async()=>{throw Error("method unavailable");};
  await assert.rejects(listCoordinatorJobs(f.actor),/method unavailable/);assert.equal(f.calls.legacy,0);
  f.actor.retention_status=async()=>{throw Error("status unavailable");};await assert.rejects(readRetentionStatus(f.actor),/status unavailable/);assert.equal(f.calls.legacy,0);
  await assert.rejects(listCoordinatorJobs({list_jobs_page:async()=>{},list_jobs:async()=>[]}),/retention_query_unavailable/);
});
test("page and aggregate byte limits prevent oversized transport without a lifetime job count cap", async () => {
  const f=paged(makeJobs(64)),base=f.actor.list_jobs_page;
  await assert.rejects(listCoordinatorJobs(f.actor,{maxBytes:1}),/job_history_byte_bound/);
  f.actor.list_jobs_page=async()=>({jobs:makeJobs(33),next:[],total:64n});await assert.rejects(listCoordinatorJobs(f.actor));
  f.actor.list_jobs_page=base;await assert.rejects(listCoordinatorJobs(f.actor,{pageSize:33}),/invalid_history_read_bound/);
});
test("admission status rejects impossible counters and never uses historical total as admission capacity",async()=>{
  const allDone=makeJobs(700).map(j=>({...j,phase:{Complete:null}}));assert.equal((await readRetentionStatus(paged(allDone).actor)).admission_allowed,true);
  const s=status(allDone);assert.throws(()=>normalizeRetentionStatus({...s,failed:1n}),/invalid_retention_status/);
  assert.throws(()=>normalizeRetentionStatus({...s,busy:1n,admission_allowed:true}),/invalid_retention_status/);
  assert.throws(()=>normalizeRetentionStatus({...s,completed:699n,open:1n,admission_allowed:true}),/invalid_retention_status/);
  const injected={list_jobs:async()=>allDone};assert.equal((await readRetentionStatus(injected)).admission_allowed,true);
  assert.deepEqual(await listCoordinatorJobs(injected),allDone);
});
test("stats keep complete historical counts and pilot history after multiple bounded pages",async()=>{
  const jobs=makeJobs(400),f=paged(jobs);f.actor.get_config=async()=>({});f.actor.get_job=async()=>[];
  const collector=createCollector({actor:f.actor,journalPath:"/unused-main",sidecarPath:"/unused-proof",now:()=>1000,
    read:()=>({value:{buyQueue:{entries:[]},requests:[]},mtimeMs:1000}),health:()=>({status:"running"})});
  collector.readLocal();await collector.pollIcp();const snapshot=collector.snapshot();collector.stop();
  const complete=jobs.filter(j=>"Complete" in j.phase).length;assert.equal(snapshot.queue.coordinatorCompleted,complete);assert.equal(snapshot.queue.pilotCompleted,complete);assert.equal(snapshot.freshness.icp.stale,false);assert.equal(f.calls.legacy,0);assert.equal(f.calls.pages.length,13);
});
test("delegated recovery checks the failed source beyond 256 retained jobs before its fixed update",async()=>{
  const original={manager:"0x"+"11".repeat(20),pool_id:"0x"+"22".repeat(32),transaction_hash:"0x"+"33".repeat(32),log_index:0n};
  const sourceId=swapSourceId(4663,original),jobs=makeJobs(400).map(j=>({...j,phase:{Complete:null}}));
  jobs.push({request:{id:sourceId},phase:{Failed:null},busy:false,recovery:[],source:[original],model_cycles:123n});
  jobs.sort((a,b)=>a.request.id.localeCompare(b.request.id));
  assert.ok(jobs.findIndex(j=>j.request.id===sourceId)>256);
  const f=paged(jobs),updates=[];
  Object.assign(f.actor,{get_voice_state:async()=>({remembering:[]}),set_paused:async()=>({Ok:null}),
    defer_failed_swap:async(...args)=>{updates.push(args);return {Ok:null};}});
  const recovery=createRecoveryOperations({actor:f.actor,validateCredential:async()=>{}});
  assert.deepEqual(await recovery.defer_failed_swap(sourceId,123n,RECOVERY_REASON),{Ok:null});
  assert.deepEqual(updates,[[sourceId,123n,RECOVERY_REASON]]);assert.equal(f.calls.pages.length,13);assert.equal(f.calls.legacy,0);
});
