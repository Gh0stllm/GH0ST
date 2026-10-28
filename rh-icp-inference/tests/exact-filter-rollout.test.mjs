import test from "node:test";
import assert from "node:assert/strict";
import { id, keccak256, toUtf8Bytes } from "ethers";
import { deriveExactManifest, snapshotDigests, verifyExactUpgrade } from "../scripts/exact-filter-rollout.mjs";
import { assertFundingAdmission, UNLIMITED_ADMISSION_POLICY, FUNDING_CANISTERS, FUNDING_DEPLOYER } from "../worker/cycle-budget.mjs";

const H = n => n.repeat(64), NOW = Date.parse("2026-10-26T18:00:00Z");
const source = "964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5";
const baseline = { model: { id: "qwen3-1.7b-q4_k_m" }, model_wasm_sha256: source,
  coordinator_wasm_sha256: H("a"), gateway_source_sha256: H("b"), limits: { model_cycle_budget: "0", max_chunks: null },
  persona_profile: { version: "same-profile" }, generation_policy: { ...UNLIMITED_ADMISSION_POLICY } };
const leb = n => { const bytes = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; bytes.push(b); } while(n); return bytes; };
function wasm() {
  const names = ["canister_pre_upgrade", "canister_post_upgrade", "canister_update rebind_gateway", "canister_update defer_failed_swap"];
  const exports = [names.length, ...names.flatMap(name => [...leb(name.length), ...Buffer.from(name), 0, 0])];
  return Uint8Array.from([0,97,115,109,1,0,0,0, 1,4,1,0x60,0,0, 3,2,1,0, 7,...leb(exports.length),...exports, 10,4,1,2,0,0x0b]);
}
function status(name, hash) {
  return { id: FUNDING_CANISTERS[name], status: "Running", module_hash: "0x"+hash,
    cycles: "10000000000000", reserved_cycles: "0", observedAtMs: NOW,
    settings: { controllers: name === "model" ? [FUNDING_DEPLOYER, FUNDING_CANISTERS.coordinator] : [FUNDING_DEPLOYER] } };
}
function snapshot() {
  return { paused: true, coordinator: FUNDING_CANISTERS.coordinator,
    signerAddress: "0x8156899f88e9e45163e3770145a473923ace2ff1",
    config: { gateway: "0x5fdd52c18a6fc128236478ab1398692a81bb4fdf", artifact_hash: keccak256(toUtf8Bytes(JSON.stringify(baseline))),
      model_id: id(baseline.model.id), model_wasm_hash: "0x"+source, model_canister: FUNDING_CANISTERS.model,
      chain_id: "4663", confirmations: "12", ecdsa_key_name: "key_1", model_cycle_budget: "0", worker: "same-worker" },
    coordinatorStatus: status("coordinator",baseline.coordinator_wasm_sha256), modelStatus: status("model",source),
    jobs: [{ request: { id: "0x"+H("c") }, phase: { Complete:null }, busy:false, voice:[{ remembered:true }], model_cycles:"123" }],
    voiceState: { remembering:[], memories:[{ text:"prior thought" }] }, deferredSwaps:[],
    worker: { buyQueue:{ policy:{skipFailedBuys:true} }, requests:[{state:"fulfilled",publication:{status:"posted"}}] } };
}
test("new manifest preserves unlimited admission contract and unchanged model", async () => {
  const candidate = deriveExactManifest(baseline,wasm(),baseline.persona_profile);
  assert.deepEqual(candidate.generation_policy,baseline.generation_policy);
  assert.deepEqual(candidate.limits,baseline.limits);
  assert.deepEqual(candidate.model,baseline.model);
  assert.equal(candidate.model_wasm_sha256,baseline.model_wasm_sha256);
  const result = await assertFundingAdmission({ manifest:candidate, nowMs:NOW, snapshot:{
    schema:"gh0st-funding-snapshot-v1",startedAtMs:NOW,atMs:NOW,
    canisters:{coordinator:status("coordinator",candidate.coordinator_wasm_sha256),model:status("model",source)} } });
  assert.equal(result.allowed,true);assert.equal(result.reason,null);
});
test("post-upgrade verification permits only the coordinator module change", () => {
  const before=snapshot(),candidate=deriveExactManifest(baseline,wasm(),baseline.persona_profile);
  const review={...snapshotDigests(before,baseline),coordinatorHash:candidate.coordinator_wasm_sha256};
  const after=structuredClone(before);after.coordinatorStatus.module_hash="0x"+candidate.coordinator_wasm_sha256;
  assert.equal(verifyExactUpgrade(review,after,baseline).preserved,true);
  for (const mutate of [s=>{s.jobs[0].model_cycles="0";},s=>{s.worker.requests=[];},s=>{s.voiceState.memories=[];},s=>{s.config.gateway="0x"+"11".repeat(20);},s=>{s.deferredSwaps.push({id:"changed"});}]) {
    const broken=structuredClone(after);mutate(broken);assert.throws(()=>verifyExactUpgrade(review,broken,baseline));
  }
});
test("preparation refuses active work, uncertain ingress and changed deployment bindings", () => {
  for (const mutate of [s=>{s.paused=false;},s=>{s.jobs[0].busy=true;},s=>{s.jobs[0].phase={Running:null};},
    s=>{s.jobs[0].voice[0].remembered=false;},s=>{s.worker.requests[0].pendingUpdate={operation:"advance"};},
    s=>{s.config.artifact_hash="0x"+H("d");},s=>{s.modelStatus.module_hash="0x"+H("e");},
    s=>{s.coordinatorStatus.settings.controllers=[];}]) {
    const broken=snapshot();mutate(broken);assert.throws(()=>snapshotDigests(broken,baseline));
  }
});

test("length-only rollout changes only coordinator hash and explicit character-gate policy", async () => {
  const original={...baseline, limits:{...baseline.limits,answer_bytes:8192},
    persona_profile:{...baseline.persona_profile,sampling:{max_output_tokens:80}},
    thought_policy:{schema:"gh0st-exact-thought-v1",duplicate_match:"exact whole UTF-8 output"}};
  const candidate=deriveExactManifest(original,wasm(),original.persona_profile,{intent:"remove-length-limit"});
  const restored={...candidate};delete restored.output_length_policy;
  assert.deepEqual(restored,{...original,coordinator_wasm_sha256:candidate.coordinator_wasm_sha256});
  assert.equal(candidate.output_length_policy.min_characters,null);
  assert.equal(candidate.output_length_policy.max_characters,null);
  assert.deepEqual(candidate.generation_policy,original.generation_policy);
  const result=await assertFundingAdmission({manifest:candidate,nowMs:NOW,snapshot:{schema:"gh0st-funding-snapshot-v1",
    startedAtMs:NOW,atMs:NOW,canisters:{coordinator:status("coordinator",candidate.coordinator_wasm_sha256),model:status("model",source)}}});
  assert.equal(result.allowed,true);
  assert.throws(()=>deriveExactManifest(original,wasm(),{...original.persona_profile,version:"changed"},{intent:"remove-length-limit"}),/preserve/);
  assert.throws(()=>deriveExactManifest({...original,limits:{...original.limits,answer_bytes:9000}},wasm(),original.persona_profile,{intent:"remove-length-limit"}),/preserve/);
  assert.throws(()=>deriveExactManifest(original,wasm(),original.persona_profile,{intent:"other"}),/Unknown/);
});
