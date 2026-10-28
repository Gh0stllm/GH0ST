import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { id } from "ethers";
import { compile } from "../scripts/compile.mjs";
import { RECOVERY as R, UNLIMITED_SOURCE_ID, deriveRecoveryManifest, validateRecoveryManifest, prepareRecoveryDeployment } from "../scripts/prepare-recovery-rollout.mjs";
import { loadRecoveryBundle, runRecoveryGatewayFlow, main } from "../scripts/execute-recovery-gateway.mjs";

const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/recovery-baseline-manifest.json", import.meta.url), "utf8"));
function wasmFixture(unlimited = false) {
  const leb = number => { const values = []; do { let b = number & 127; number >>>= 7; if (number) b |= 128; values.push(b); } while (number); return values; };
  const names = ["canister_pre_upgrade", "canister_post_upgrade", "canister_update recover_job", "canister_update resume_job", "canister_update rebind_gateway"];
  if (unlimited) names.push("canister_update enable_unlimited_swaps", "canister_update defer_failed_swap", "canister_update resume_retained_job");
  const section = [names.length, ...names.flatMap(name => [...leb(name.length), ...Buffer.from(name), 0, 0])];
  return Buffer.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,7,...leb(section.length),...section,10,4,1,2,0,11]);
}

async function bundleFixture(t, { unlimited = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-recovery-gateway-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wasm = wasmFixture(unlimited), manifest = deriveRecoveryManifest(baseline, digest(wasm),
    { profile: unlimited ? "unlimited-generation" : "bounded-recovery" }), artifact = compile();
  const source = (id, phase) => ({ request: { id }, phase: { [phase]: null }, busy: false, source: [{}], voice: [{}],
    chunks: 0, input_tokens: "0", output_tokens: "0", model_cycles: "0", prompt_ingested: false, answer: "", signature: [] });
  const snapshot = { paused: true, capturedAt: new Date().toISOString(), signerAddress: R.signer,
    recoverySourceId: R.recoverySourceId, queuedSourceId: R.queuedSourceId,
    config: { gateway: R.oldGateway, artifact_hash: R.oldArtifactHash, model_id: R.modelId, model_wasm_hash: "0x" + R.modelHash,
      model_canister: R.model, worker: "fixture", rpc_urls: ["https://private.invalid"], chain_id: "4663", confirmations: "12", ecdsa_key_name: "key_1", model_cycle_budget: "2000000000000" },
    jobs: [source(R.recoverySourceId, "Failed"), source(R.queuedSourceId, "Verified")], voiceState: { remembering: [] },
    coordinatorStatus: { id: R.coordinator, status: "Running", module_hash: "0x" + R.oldCoordinatorHash, settings: { controllers: [R.deployer] } },
    modelStatus: { id: R.model, status: "Running", module_hash: "0x" + R.modelHash, settings: { controllers: [R.deployer, R.coordinator] } } };
  if (unlimited) {
    snapshot.recoverySourceId = UNLIMITED_SOURCE_ID; snapshot.queuedSourceId = null;
    snapshot.jobs = [source(R.recoverySourceId, "Failed"), source(UNLIMITED_SOURCE_ID, "Failed"),
      ...Array.from({ length: 7 }, (_, i) => source(id("complete-" + i), "Complete"))];
  }
  const provider = { send: async () => "0x1237", getTransactionCount: async () => 6300, getCode: async () => "0x",
    getFeeData: async () => ({ maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateGas: async () => 1_000_000n, getBalance: async () => 10n ** 18n };
  const plan = await prepareRecoveryDeployment({ provider, artifact, manifest, baseline, snapshot });
  const ids = validateRecoveryManifest(manifest, baseline);
  const review = { schema: "gh0st-recovery-rollout-v1", broadcast: false, ...ids,
    ...(unlimited ? { profile: "unlimited-generation" } : {}),
    canister: R.coordinator, installMode: "upgrade", recoverySourceId: R.recoverySourceId, queuedSourceId: R.queuedSourceId,
    ...plan.recoveryEvidence };
  for (const [name, value] of [["artifact-manifest.json", manifest], ["recovery-review.json", review], ["rh-deploy-plan.json", plan]])
    fs.writeFileSync(path.join(directory, name), json(value), { mode: 0o600 });
  fs.writeFileSync(path.join(directory, "coordinator.wasm"), wasm, { mode: 0o600 });
  return { directory, plan, manifest, review };
}

test("gateway wrapper dry review validates the exact bundle without a provider, unlock or mutation", async t => {
  const f = await bundleFixture(t);
  const bundle = loadRecoveryBundle(f.directory);
  assert.equal(bundle.actions[0].nonce, 6300); assert.equal(bundle.binding.artifactHash, f.review.artifactHash);
  const before = fs.readdirSync(f.directory).sort();
  await main(["--directory", f.directory]);
  assert.deepEqual(fs.readdirSync(f.directory).sort(), before);
  await assert.rejects(main(["--directory", f.directory, "--private-key", "forbidden"]), /No passwords or keys/);
});

test("gateway wrapper validates isolated unlimited profile without loosening RH fee caps", async t => {
  const f = await bundleFixture(t, { unlimited: true });
  const bundle = loadRecoveryBundle(f.directory);
  assert.equal(bundle.binding.profile, "unlimited-generation");
  assert.equal(bundle.binding.recoverySourceId, UNLIMITED_SOURCE_ID);
  assert.equal(bundle.manifest.limits.model_cycle_budget, "0");
  assert.ok(bundle.actions[0].maxCostWei <= 250000000000000n);
});

test("gateway wrapper rejects changed constructor, manifest, queue evidence and nonprivate plans", async t => {
  const f = await bundleFixture(t), file = path.join(f.directory, "rh-deploy-plan.json");
  const original = fs.readFileSync(file);
  for (const mutate of [plan => { plan.artifactHash = R.oldArtifactHash; }, plan => { plan.recoveryEvidence.queuedSourceId = R.recoverySourceId; },
    plan => { plan.deployment.predictedGateway = R.owner; }]) {
    const changed = JSON.parse(original); mutate(changed); fs.writeFileSync(file, json(changed));
    assert.throws(() => loadRecoveryBundle(f.directory));
  }
  fs.writeFileSync(file, original); fs.chmodSync(file, 0o644);
  assert.throws(() => loadRecoveryBundle(f.directory), /private/);
});

function flow() {
  const state = {}, calls = [], saved = [];
  const registration = { path: "exact-registration", sha256: "registration-hash" };
  let hasRegistration = false;
  const ops = {
    hasDeploymentJournal: async () => true, hasRegistrationJournal: async () => true,
    executeDeployment: async () => { calls.push("deploy-exact"); return { transactionHash: "deploy-hash" }; },
    verifyDeployment: async () => { calls.push("verify-deploy"); },
    existingRegistration: async () => hasRegistration ? registration : null,
    prepareRegistration: async () => { calls.push("fresh-registration"); hasRegistration = true; return registration; },
    executeRegistration: async ref => {
      calls.push("register-exact"); assert.equal(ref.sha256, registration.sha256);
      assert.equal(saved.at(-1).registration.sha256, registration.sha256, "checkpoint must precede signing");
      return { transactionHash: "register-hash" };
    },
    verifyRegistration: async () => { calls.push("verify-register"); },
  };
  const save = value => saved.push(structuredClone(value));
  return { state, ops, calls, save, saved };
}

test("gateway flow verifies canonical deployment before preparing one Pons registration", async () => {
  const f = flow(); await runRecoveryGatewayFlow(f);
  assert.deepEqual(f.calls, ["deploy-exact", "verify-deploy", "fresh-registration", "register-exact", "verify-register"]);
  assert.equal(f.state.stage, "complete");
});

test("uncertain deployment stops before registration; restart reconciles same deployment", async () => {
  const f = flow(), execute = f.ops.executeDeployment;
  f.ops.executeDeployment = async () => { f.calls.push("deploy-uncertain"); throw Error("private RPC detail"); };
  await assert.rejects(runRecoveryGatewayFlow(f));
  assert.equal(f.calls.includes("fresh-registration"), false);
  assert.equal(JSON.stringify(f.saved).includes("private RPC detail"), false);
  f.ops.executeDeployment = execute; await runRecoveryGatewayFlow(f);
  assert.equal(f.calls.filter(c => c === "fresh-registration").length, 1);
});

test("uncertain registration reuses the original plan without fresh nonce or another preparation", async () => {
  const f = flow(), execute = f.ops.executeRegistration;
  f.ops.executeRegistration = async () => { throw Error("uncertain"); };
  await assert.rejects(runRecoveryGatewayFlow(f)); assert.ok(f.state.registration);
  f.ops.executeRegistration = execute; await runRecoveryGatewayFlow(f);
  assert.equal(f.calls.filter(c => c === "fresh-registration").length, 1);
  f.ops.hasDeploymentJournal = async () => false;
  await assert.rejects(runRecoveryGatewayFlow(f), /deployment journal is missing/);
});

test("missing or altered saved registration cannot be replaced or sign another pool", async () => {
  const f = flow(); f.state.registration = { path: "old", sha256: "original" };
  await assert.rejects(runRecoveryGatewayFlow(f), /plan is missing/);
  assert.equal(f.calls.includes("fresh-registration"), false);
  const g = flow(); g.state.registration = { path: "old", sha256: "original" };
  g.ops.existingRegistration = async () => ({ path: "new", sha256: "changed" });
  await assert.rejects(runRecoveryGatewayFlow(g), /plan changed/);
  assert.equal(g.calls.includes("register-exact"), false);
});
