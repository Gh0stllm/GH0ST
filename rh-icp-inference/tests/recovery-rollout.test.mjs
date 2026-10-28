import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { AbiCoder, ContractFactory, Interface, Transaction, getCreateAddress, id } from "ethers";
import { compile } from "../scripts/compile.mjs";
import { RECOVERY as R, RECOVERY_POLICY, UNLIMITED_POLICY, UNLIMITED_SOURCE_ID, deriveRecoveryManifest, validateRecoveryManifest, validateRecoverySnapshot,
  verifyRecoveryStatePreserved, validateRecoveryWasm, prepareRecoveryDeployment, prepareRecoveryRegistration,
  validateRecoveryPlan } from "../scripts/prepare-recovery-rollout.mjs";

const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/recovery-baseline-manifest.json", import.meta.url), "utf8"));
const newHash = "ab".repeat(32);
const manifest = deriveRecoveryManifest(baseline, newHash);
const artifact = compile();
const hash = "0x" + "12".repeat(32);
const clone = value => structuredClone(value);
function snapshot() {
  const job = (id, phase) => ({ request: { id, prompt: "unchanged prompt", prompt_hash: hash }, phase: { [phase]: null },
    busy: false, source: [{ manager: R.manager, pool_id: R.poolId, transaction_hash: hash, log_index: "9" }],
    voice: [{ seed: 17, base_prompt: "unchanged seed and prompt" }], input_tokens: "0", output_tokens: "0",
    model_cycles: phase === "Failed" ? "1979265355131" : "0", chunks: phase === "Failed" ? 67 : 0,
    answer: "", signature: [], prompt_ingested: false });
  return { paused: true, capturedAt: "2026-10-26T14:48:38.235Z", signerAddress: R.signer,
    recoverySourceId: R.recoverySourceId, queuedSourceId: R.queuedSourceId,
    config: { gateway: R.oldGateway, artifact_hash: R.oldArtifactHash, model_id: R.modelId,
      model_wasm_hash: "0x" + R.modelHash, model_canister: R.model, chain_id: "4663", confirmations: "12",
      ecdsa_key_name: "key_1", model_cycle_budget: "2000000000000", worker: "fixture-worker", rpc_urls: ["https://private.invalid/never-output"] },
    jobs: [job(R.recoverySourceId, "Failed"), job(R.queuedSourceId, "Verified")],
    voiceState: { remembering: [], revision: "3", memories: [{ text: "preserved memory" }] },
    coordinatorStatus: { id: R.coordinator, status: "Running", module_hash: "0x" + R.oldCoordinatorHash,
      settings: { controllers: [R.deployer] } },
    modelStatus: { id: R.model, status: "Running", module_hash: "0x" + R.modelHash,
      settings: { controllers: [R.coordinator, R.deployer] } } };
}
function provider(overrides = {}) {
  return { send: async () => "0x1237", getTransactionCount: async () => 6300, getCode: async () => "0x",
    getFeeData: async () => ({ maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateGas: async () => 1_000_000n, getBalance: async () => 10n ** 18n, ...overrides };
}
function unlimitedSnapshot() {
  const s = snapshot(), earlier = s.jobs[0], current = clone(earlier);
  current.request.id = UNLIMITED_SOURCE_ID;
  s.recoverySourceId = UNLIMITED_SOURCE_ID; s.queuedSourceId = null;
  s.jobs = [earlier, current, ...Array.from({ length: 7 }, (_, i) => ({ ...clone(earlier),
    request: { ...earlier.request, id: id("completed-" + i) }, phase: { Complete: null } }))];
  return s;
}

test("unlimited profile removes swap ceilings while preserving model, persona and bounded history", () => {
  const unlimited = deriveRecoveryManifest(baseline, newHash, { profile: "unlimited-generation" });
  assert.equal(unlimited.limits.model_cycle_budget, "0"); assert.equal(unlimited.limits.max_chunks, null);
  assert.equal(unlimited.limits.explicit_request_max_chunks, baseline.limits.explicit_request_max_chunks);
  assert.deepEqual(unlimited.persona_profile, baseline.persona_profile);
  assert.deepEqual(unlimited.generation_policy, UNLIMITED_POLICY); assert.equal(unlimited.recovery_policy, undefined);
  for (const field of ["cycle_limit", "chunk_limit", "time_limit", "retry_limit", "quality_retry_limit"])
    assert.equal(unlimited.generation_policy[field], null);
  const ids = validateRecoveryManifest(unlimited, baseline);
  assert.notEqual(ids.artifactHash, validateRecoveryManifest(manifest, baseline).artifactHash);
  assert.throws(() => validateRecoveryManifest({ ...unlimited, generation_policy: { ...UNLIMITED_POLICY, cycle_limit: "4000000000000" } }, baseline), /beyond/);
  assert.equal(validateRecoveryManifest(manifest, baseline).artifactHash, validateRecoveryManifest(deriveRecoveryManifest(baseline, newHash), baseline).artifactHash);
});

test("unlimited snapshot preserves the exact current failure and all seven complete plus deferred jobs", () => {
  const before = unlimitedSnapshot(), after = clone(before); after.coordinatorStatus.module_hash = "0x" + newHash;
  const evidence = validateRecoverySnapshot(before, { profile: "unlimited-generation" });
  assert.equal(evidence.jobs, 9); assert.equal(evidence.recoverySourceId, UNLIMITED_SOURCE_ID); assert.equal(evidence.queuedSourceId, null);
  assert.equal(evidence.recoveryModelCycles, "1979265355131");
  assert.equal(verifyRecoveryStatePreserved(before, after, newHash, { profile: "unlimited-generation" }).preserved, true);
  for (const mutate of [s => { s.jobs.pop(); }, s => { s.jobs[0].request.id = id("lost-old-deferred"); },
    s => { s.jobs[2].phase = { Verified: null }; }, s => { s.queuedSourceId = R.queuedSourceId; },
    s => { s.jobs[1].busy = true; }]) { const changed = clone(before); mutate(changed); assert.throws(() => validateRecoverySnapshot(changed, { profile: "unlimited-generation" })); }
  after.jobs[1].model_cycles = "0";
  assert.throws(() => verifyRecoveryStatePreserved(before, after, newHash, { profile: "unlimited-generation" }), /changed/);
});

test("unlimited deployment keeps zero value and the original RH owner fee bounds", async () => {
  const unlimited = deriveRecoveryManifest(baseline, newHash, { profile: "unlimited-generation" });
  const plan = await prepareRecoveryDeployment({ provider: provider(), artifact, manifest: unlimited, baseline, snapshot: unlimitedSnapshot() });
  assert.equal(plan.recoveryEvidence.recoverySourceId, UNLIMITED_SOURCE_ID); assert.equal(plan.recoveryEvidence.queuedSourceId, null);
  assert.equal(Transaction.from(plan.deployment.unsignedSerialized).value, 0n);
  assert.equal(validateRecoveryPlan(plan, { artifact, manifest: unlimited, baseline }).length, 1);
});

test("recovery manifest retains normal 2T/model/persona while explicitly declaring bounded retained-cost recovery", () => {
  const ids = validateRecoveryManifest(manifest, baseline);
  assert.equal(manifest.limits.model_cycle_budget, "2000000000000");
  assert.deepEqual(manifest.recovery_policy, RECOVERY_POLICY);
  assert.notEqual(ids.artifactHash, R.oldArtifactHash); assert.equal(ids.modelId, R.modelId);
  for (const change of [{ limits: { ...manifest.limits, model_cycle_budget: "4000000000000" } },
    { model_wasm_sha256: "cd".repeat(32) }, { persona_profile: { voice: "different" } },
    { recovery_policy: { ...RECOVERY_POLICY, maximum_cumulative_budget: "9000000000000" } }])
    assert.throws(() => validateRecoveryManifest({ ...manifest, ...change }, baseline), /beyond/);
  assert.throws(() => deriveRecoveryManifest(baseline, R.oldCoordinatorHash), /distinct/);
  assert.throws(() => deriveRecoveryManifest({ ...baseline, status: "changed" }, newHash), /baseline/);
});

test("snapshot requires paused pinned canisters and preserves exact failed/queued sources without leaking RPC", () => {
  const s = snapshot(), result = validateRecoverySnapshot(s);
  assert.equal(result.recoverySourceId, R.recoverySourceId); assert.equal(result.queuedSourceId, R.queuedSourceId);
  assert.equal(JSON.stringify(result).includes("private.invalid"), false);
  for (const mutate of [v => { v.paused = false; }, v => { v.config.gateway = R.owner; },
    v => { v.config.model_cycle_budget = "4000000000000"; }, v => { v.jobs[1].chunks = 1; },
    v => { v.jobs[0].busy = true; }, v => { v.voiceState.remembering = [R.queuedSourceId]; },
    v => { v.modelStatus.settings.controllers = [R.deployer]; }, v => { v.queuedSourceId = hash; }]) {
    const changed = clone(s); mutate(changed); assert.throws(() => validateRecoverySnapshot(changed));
  }
});

test("post-upgrade state comparison permits only empty new recovery options and rejects lost costs, jobs or voice", () => {
  const before = snapshot(), after = clone(before); after.coordinatorStatus.module_hash = "0x" + newHash;
  after.jobs.forEach(j => { j.recovery = []; });
  assert.equal(verifyRecoveryStatePreserved(before, after, newHash).preserved, true);
  after.jobs = after.jobs.map(j => Object.fromEntries(Object.entries(j).reverse()));
  assert.equal(verifyRecoveryStatePreserved(before, after, newHash).preserved, true);
  for (const mutate of [v => { v.jobs[0].model_cycles = "0"; }, v => { v.jobs[1].voice[0].seed = 18; },
    v => { v.jobs.pop(); }, v => { v.voiceState.memories = []; },
    v => { v.jobs[0].recovery = [{ generation: 1 }]; }]) {
    const changed = clone(after); mutate(changed); assert.throws(() => verifyRecoveryStatePreserved(before, changed, newHash));
  }
});

test("root snapshot shape needs explicit paused attestation and is normalized without copying private worker state", () => {
  const s = snapshot();
  const wrapped = { schema: "gh0st-recovery-snapshot-v1", at: s.capturedAt, config: s.config,
    jobs: s.jobs, voice: s.voiceState, balances: { canisters: { coordinator: s.coordinatorStatus, model: s.modelStatus } },
    worker: { signedBytes: "fixture-private-record" } };
  assert.throws(() => validateRecoverySnapshot(wrapped), /paused/);
  const result = validateRecoverySnapshot(wrapped, { paused: true });
  assert.equal(result.queuedSourceId, R.queuedSourceId); assert.ok(result.workerJournalSha256);
  assert.equal(JSON.stringify(result).includes("fixture-private-record"), false);
});

test("Wasm validation requires exact bytes and upgrade/recovery exports", () => {
  const leb = number => { const values = []; do { let b = number & 127; number >>>= 7; if (number) b |= 128; values.push(b); } while (number); return values; };
  const names = ["canister_pre_upgrade", "canister_post_upgrade", "canister_update recover_job", "canister_update resume_job", "canister_update rebind_gateway"];
  const exports = names.flatMap(name => [...leb(name.length), ...Buffer.from(name), 0, 0]);
  const section = [names.length, ...exports];
  const wasm = Buffer.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,7,...leb(section.length),...section,10,4,1,2,0,11]);
  const digest = createHash("sha256").update(wasm).digest("hex");
  assert.equal(validateRecoveryWasm(wasm, digest), true);
  assert.throws(() => validateRecoveryWasm(wasm, newHash), /differs/);
  const empty = Buffer.from([0,97,115,109,1,0,0,0]);
  assert.throws(() => validateRecoveryWasm(empty, createHash("sha256").update(empty).digest("hex")), /lacks/);
});

test("read-only deployment quote pins exact new constructor, current nonce, zero value and fee caps", async () => {
  let sends = 0;
  const p = provider({ send: async method => { sends++; assert.equal(method, "eth_chainId"); return "0x1237"; } });
  const plan = await prepareRecoveryDeployment({ provider: p, artifact, manifest, baseline, snapshot: snapshot() });
  const actions = validateRecoveryPlan(plan, { artifact, manifest, baseline });
  const tx = Transaction.from(plan.deployment.unsignedSerialized);
  assert.equal(tx.signature, null); assert.equal(tx.to, null); assert.equal(tx.nonce, 6300); assert.equal(tx.value, 0n);
  assert.equal(actions.length, 1); assert.equal(plan.broadcast, false);
  assert.equal(plan.deployment.predictedGateway, getCreateAddress({ from: R.owner, nonce: 6300 }));
  assert.equal(sends, 2); assert.equal(JSON.stringify(plan, (_, value) => typeof value === "bigint" ? String(value) : value).includes("private.invalid"), false);
  for (const p of [provider({ getTransactionCount: async (_, tag) => tag === "latest" ? 6300 : 6301 }),
    provider({ estimateGas: async () => 5_000_000n }), provider({ getFeeData: async () => ({ maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 1n }) }),
    provider({ getCode: async () => "0x1234" })])
    await assert.rejects(prepareRecoveryDeployment({ provider: p, artifact, manifest, baseline, snapshot: snapshot() }));
});

test("registration is quoted only against canonical deployed successor and authorizes Pons alone", async () => {
  const iface = new Interface(artifact.abi), coder = AbiCoder.defaultAbiCoder();
  const gateway = getCreateAddress({ from: R.owner, nonce: 6299 });
  const { artifactHash } = validateRecoveryManifest(manifest, baseline);
  const creation = await new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object).getDeployTransaction(R.owner, R.signer, R.modelId, artifactHash);
  const p = provider({ estimateGas: async () => 60000n, getTransactionReceipt: async () => ({ hash, status: 1, blockNumber: 100, blockHash: hash,
    contractAddress: gateway, gasUsed: 1000000n, gasPrice: 20000000n }),
    getTransaction: async () => ({ from: R.owner, to: null, data: creation.data }),
    getBlock: async () => ({ hash }), getBlockNumber: async () => 112,
    getCode: async () => "0x" + artifact.evm.deployedBytecode.object,
    call: async tx => {
      const name = iface.parseTransaction({ data: tx.data }).name;
      return coder.encode(name === "owner" || name === "icpSigner" ? ["address"] : name === "authorizedSwapPool" ? ["bool"] : ["bytes32"],
        [({ owner: R.owner, icpSigner: R.signer, modelId: R.modelId, artifactHash, authorizedSwapPool: false })[name]]);
    } });
  const plan = await prepareRecoveryRegistration({ provider: p, artifact, manifest, baseline, gateway, deploymentTx: hash });
  assert.equal(plan.registrations.length, 1); assert.equal(plan.registrations[0].poolId, R.poolId);
  assert.equal(iface.parseTransaction({ data: plan.registrations[0].walletRequest.params[0].data }).args[2], true);
  assert.equal(validateRecoveryPlan(plan, { artifact, manifest, baseline }).length, 1);
  assert.throws(() => validateRecoveryPlan({ ...plan, registrations: [{ ...plan.registrations[0], poolId: "0x" + "ff".repeat(32) }] },
    { artifact, manifest, baseline }), /Pons/);
  await assert.rejects(prepareRecoveryRegistration({ provider: { ...p, getBlockNumber: async () => 111 }, artifact, manifest, baseline, gateway, deploymentTx: hash }), /descendant/);
});
