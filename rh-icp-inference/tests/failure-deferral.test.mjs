import test from "node:test";
import assert from "node:assert/strict";
import { deferFailedGeneration, FAILURE_DEFERRAL_CLI, FAILURE_DEFERRAL_COORDINATOR, FAILURE_DEFERRAL_REASON } from "../worker/failure-deferral.mjs";
import { swapSourceId } from "../worker/swaps.mjs";
const source = { manager: "0x" + "1".repeat(40), pool_id: "0x" + "2".repeat(64), transaction_hash: "0x" + "3".repeat(64), log_index: "7" };
const id = swapSourceId(4663, source);
const cycles = 11_042_969_123_456n;
const errorCode = code => error => error.code === code;
function fixture() {
  const job = { request: { id }, source: [source], phase: { Failed: null }, busy: false, model_cycles: cycles,
    recovery: [{ accounting_uncertain: false }] };
  const state = { jobs: [job], deferred: [], writes: [], calls: [], remembering: [], fail: null, loseDeferral: false };
  const coordinator = { list_jobs: async () => state.jobs, get_deferred_swaps: async () => state.deferred,
    get_voice_state: async () => ({ remembering: state.remembering }) };
  const execFile = async (file, args, options) => {
    state.calls.push({ file, args, options, lastPersist: state.writes.at(-1) });
    if (args[3] === "defer_failed_swap" && !state.loseDeferral) state.deferred.push({ id, model_cycles: cycles, reason: FAILURE_DEFERRAL_REASON, deferred_at: 1n });
    if (state.fail?.(args, state.calls.length)) throw Error("simulated transport failure");
    return { stdout: "(variant { Ok })\n" };
  };
  const options = { coordinator, canisterId: FAILURE_DEFERRAL_COORDINATOR, sourceId: id, expectedCycles: cycles,
    expectedSource: source, persist: async record => { state.writes.push(record); }, execFile, now: () => 1234 };
  return { state, job, options };
}
test("only fixed pause/defer/unpause commands run, each with a persisted intent", async () => {
  const { state, options } = fixture(); const result = await deferFailedGeneration(options);
  assert.equal(result.status, "deferred"); assert.equal(result.step, "complete");
  assert.deepEqual(state.calls.map(c => [c.args[3], c.lastPersist.step]), [["set_paused", "pausing"], ["defer_failed_swap", "deferring"], ["set_paused", "unpausing"]]);
  for (const call of state.calls) {
    assert.equal(call.file, FAILURE_DEFERRAL_CLI);
    assert.equal(call.args[2], FAILURE_DEFERRAL_COORDINATOR);
    assert.deepEqual(call.args.slice(5), ["-e", "production", "--identity", "gh0st-deployer"]);
    assert.equal(call.options.shell, undefined);
  }
  assert.equal(state.calls[1].args[4], `("${id}", ${cycles} : nat, "${FAILURE_DEFERRAL_REASON}")`);
});
test("preexisting matching deferral is idempotent and does not change an external pause", async () => {
  const { state, options } = fixture(); state.deferred.push({ id, model_cycles: cycles, reason: "earlier owner skip", deferred_at: 1n });
  const result = await deferFailedGeneration(options);
  assert.equal(result.status, "deferred"); assert.equal(result.preexisting, true); assert.equal(state.calls.length, 0);
  const again = await deferFailedGeneration({ ...options, existing: result });
  assert.equal(again.status, "deferred"); assert.equal(state.calls.length, 0);
});
test("busy, active phase, uncertain accounting, source mismatch and changed cycles block before any update", async () => {
  const mutations = [f => {f.job.busy = true;}, f => {f.job.phase = {Running:null};}, f => {f.job.recovery[0].accounting_uncertain = true;},
    f => {f.job.source[0] = {...source,log_index:"8"};}, f => {f.job.model_cycles++;}, f => {f.state.remembering = [id];}];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    await assert.rejects(deferFailedGeneration(f.options), errorCode("FAILURE_DEFERRAL_BLOCKED"));
    assert.equal(f.state.calls.length, 0);
  }
});
test("an unrelated nonterminal job blocks owner deferral", async () => {
  const { state, options } = fixture(); state.jobs.push({phase:{Verified:null},busy:false});
  await assert.rejects(deferFailedGeneration(options), /Every coordinator job must be terminal/);
  assert.equal(state.calls.length, 0);
});
test("lost deferral response is resolved by query without resending", async () => {
  const { state, options } = fixture(); state.fail = args => args[3] === "defer_failed_swap";
  const result = await deferFailedGeneration(options);
  assert.equal(result.status, "deferred"); assert.equal(state.calls.filter(c=>c.args[3] === "defer_failed_swap").length, 1);
});
test("uncommitted ambiguous deferral leaves pause in place and never blindly retries", async () => {
  const { state, options } = fixture(); state.loseDeferral = true; state.fail = args => args[3] === "defer_failed_swap";
  await assert.rejects(deferFailedGeneration(options), errorCode("FAILURE_DEFERRAL_AMBIGUOUS"));
  assert.equal(state.calls.length, 2); const existing = state.writes.at(-1);
  await assert.rejects(deferFailedGeneration({ ...options, existing }), errorCode("FAILURE_DEFERRAL_AMBIGUOUS"));
  assert.equal(state.calls.length, 2);
});
test("restart reconciles an earlier committed deferral then unpauses only once", async () => {
  const { state, options } = fixture(); state.deferred.push({id,model_cycles:cycles,reason:FAILURE_DEFERRAL_REASON,deferred_at:1n});
  const existing = { schema:"gh0st-failure-deferral-v1",canisterId:FAILURE_DEFERRAL_COORDINATOR,sourceId:id,expectedCycles:String(cycles),reason:FAILURE_DEFERRAL_REASON,status:"ambiguous",step:"deferring_ambiguous" };
  const result = await deferFailedGeneration({...options,existing});
  assert.equal(result.status,"deferred"); assert.equal(state.calls.length,1); assert.equal(state.calls[0].args[4],"(false)");
});
test("ambiguous pause and unpause outcomes require manual reconciliation", async () => {
  for (const target of [1,3]) {
    const { state, options }=fixture();state.fail=(_args,count)=>count===target;
    await assert.rejects(deferFailedGeneration(options), errorCode("FAILURE_DEFERRAL_AMBIGUOUS"));
    const existing=state.writes.at(-1), count=state.calls.length;
    await assert.rejects(deferFailedGeneration({...options,existing}), errorCode("FAILURE_DEFERRAL_AMBIGUOUS"));
    assert.equal(state.calls.length,count);
  }
});
test("acknowledged but absent deferral does not unpause", async () => {
  const {state,options}=fixture();state.loseDeferral=true;
  await assert.rejects(deferFailedGeneration(options),errorCode("FAILURE_DEFERRAL_AMBIGUOUS"));
  assert.equal(state.calls.length,2);
});
test("persistence failure prevents an update with no durable intent", async () => {
  const {state,options}=fixture();options.persist=async()=>{throw Error("disk full");};
  await assert.rejects(deferFailedGeneration(options),/disk full/); assert.equal(state.calls.length,0);
});
test("unsafe values, changed coordinator and missing persistence are rejected", async () => {
  for (const override of [{canisterId:"aaaaa-aa"},{sourceId:'bad"id'},{expectedCycles:-1n},{expectedCycles:2n**128n},{expectedCycles:Number.MAX_SAFE_INTEGER+1},{persist:null}]) {
    const {state,options}=fixture(); await assert.rejects(deferFailedGeneration({...options,...override}));assert.equal(state.calls.length,0);
  }
});
test("source or cost changes after pause are rechecked and prevent deferral", async () => {
  const {state,options,job}=fixture(),base=options.execFile;
  options.execFile=async(...args)=>{const r=await base(...args);if(state.calls.length===1)job.model_cycles++;return r;};
  await assert.rejects(deferFailedGeneration(options),/changed/);assert.equal(state.calls.length,1);
});
test("historical deferral cost mismatch and changed saved intent are rejected", async () => {
  const {state,options}=fixture();state.deferred=[{id,model_cycles:cycles+1n,reason:FAILURE_DEFERRAL_REASON,deferred_at:1n}];
  await assert.rejects(deferFailedGeneration(options),/does not match/);assert.equal(state.calls.length,0);
  state.deferred=[];await assert.rejects(deferFailedGeneration({...options,existing:{expectedCycles:"1"}}),/differs/);
});
