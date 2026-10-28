import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Contract, ContractFactory, Interface, JsonRpcProvider, getCreateAddress, id, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import { compile } from "./compile.mjs";
import { validatePlan } from "./manual-wallet.mjs";
import { assertRhChain, confirmedReceipt, prepareUnsigned, receiptCost, sameRuntime } from "./manual-rh-core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");
const textHash = value => keccak256(toUtf8Bytes(JSON.stringify(value)));
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const HASH = /^0x[0-9a-f]{64}$/;
const HEX = /^[0-9a-f]{64}$/;
class RecoveryPreparationError extends Error {}
const fail = message => { throw new RecoveryPreparationError(message); };

export const RECOVERY = Object.freeze({
  owner: "0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6",
  signer: "0x8156899f88e9e45163e3770145a473923ace2ff1",
  oldGateway: "0xd97050e59B3d5af516Fa4061EE1A3281075c734B",
  oldArtifactHash: "0x24ea60626b743087a22ffb6f0c8c9e86562080a7d5e429f9ad2becce3197d840",
  oldCoordinatorHash: "7e57af5c383986244e3ff38bd0f874822ca1a3e1f0d4ec6faa349dd30b15e05c",
  modelHash: "964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5",
  coordinator: "6jacx-5yaaa-aaaaj-a65jq-cai", model: "6obed-qaaaa-aaaaj-a65ja-cai",
  deployer: "uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe",
  modelId: "0x169670d418d7032d6b7429b6b8d27e6cb6d755be6fce5d36e9f7c9bd74471005",
  manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  poolId: "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01",
  recoverySourceId: "0x0f3ab702125c658e4bbed3c7549b0eed269f8b7c4ba78e6759a336dd5aadda64",
  queuedSourceId: "0x6e6c911c102ac4d695ce6b1c858cb42c310f2f42f12f7bd00facc971cbeb11f1",
  feeCapGwei: "0.05", deploymentGasCap: "5000000", registrationGasCap: "250000",
});

export const RECOVERY_POLICY = Object.freeze({
  schema: "gh0st-recovery-v1",
  normal_job_budget: "2000000000000",
  maximum_additional_budget: "2000000000000",
  maximum_cumulative_budget: "4000000000000",
  budget_formula: "max(prior ceiling, prior spent plus owner grant); reject above 4000000000000",
  resume_deadline_seconds: "3600",
  deadline_semantics: "preserve original request deadline; grant a separate bounded recovery deadline",
  authorization: "recover/rebind: owner-only while paused; resume: owner while paused or worker while unpaused",
  accounting: "retain prior segments and costs",
  identity: "same source, prompt and seed",
  queued_jobs: "park unstarted Verified jobs; resume after recovered job completes",
});

export const UNLIMITED_POLICY = Object.freeze({
  schema: "gh0st-generation-unlimited-v1",
  cycle_limit: null, chunk_limit: null, time_limit: null, retry_limit: null,
  quality_retry_limit: null, scope: "swap jobs", per_call_tokens: 4,
  prefill_method: "run_update_full", continuation_method: "run_update",
  funding: "existing canister balance only",
  admission_estimate: "2000000000000",
  zero_cycle_budget_semantics: "no per-job generation ceiling",
  format_and_output_bounds: "retain the existing exact-thought format and output bounds",
  profile_overrides: "swap generation ceilings override historical embedded persona profile limits; profile bytes and seeds are unchanged",
  accounting: "preserve all measured cycles across restart and recovery segments",
  identity: "recover the same source, prompt and seed",
  policy_authorization: "owner-only while paused",
});
export const UNLIMITED_SOURCE_ID = "0xb0bd66593ec1b6b189f6defc8e07048df187dac7d8dd09f21a24d6935ef94cef";

export function rolloutProfile(manifest) {
  return manifest?.generation_policy?.schema === UNLIMITED_POLICY.schema
    ? { name: "unlimited-generation", recoverySourceId: UNLIMITED_SOURCE_ID, queuedSourceId: null }
    : { name: "bounded-recovery", recoverySourceId: RECOVERY.recoverySourceId, queuedSourceId: RECOVERY.queuedSourceId };
}

export function deriveRecoveryManifest(baseline, coordinatorHash, { profile = "bounded-recovery" } = {}) {
  if (textHash(baseline) !== RECOVERY.oldArtifactHash || baseline.coordinator_wasm_sha256 !== RECOVERY.oldCoordinatorHash ||
      baseline.model_wasm_sha256 !== RECOVERY.modelHash || id(baseline.model?.id ?? "") !== RECOVERY.modelId ||
      baseline.limits?.model_cycle_budget !== RECOVERY_POLICY.normal_job_budget)
    fail("The baseline is not the preserved live v2 manifest.");
  if (!HEX.test(coordinatorHash) || coordinatorHash === RECOVERY.oldCoordinatorHash)
    fail("Recovery requires a distinct, valid coordinator Wasm hash.");
  if (profile === "unlimited-generation") return { ...baseline,
    limits: { ...baseline.limits, model_cycle_budget: "0", max_chunks: null },
    coordinator_wasm_sha256: coordinatorHash, generation_policy: { ...UNLIMITED_POLICY } };
  if (profile !== "bounded-recovery") fail("Unknown rollout profile.");
  return { ...baseline, coordinator_wasm_sha256: coordinatorHash, recovery_policy: { ...RECOVERY_POLICY } };
}

export function validateRecoveryManifest(candidate, baseline) {
  const profile = rolloutProfile(candidate);
  const expected = deriveRecoveryManifest(baseline, candidate.coordinator_wasm_sha256, { profile: profile.name });
  if (JSON.stringify(candidate) !== JSON.stringify(expected))
    fail("Recovery manifest changes fields beyond coordinator code and the explicit recovery policy.");
  return { modelId: RECOVERY.modelId, artifactHash: textHash(candidate),
    coordinatorHash: candidate.coordinator_wasm_sha256, modelHash: RECOVERY.modelHash };
}

const principal = value => typeof value?.toText === "function" ? value.toText()
  : value && typeof value === "object" && Object.keys(value).length === 1 && typeof value.__principal__ === "string"
    ? value.__principal__ : value;
const phase = job => typeof job?.phase === "string" ? job.phase : Object.keys(job?.phase ?? {})[0];
const emptyOption = value => value == null || Array.isArray(value) && value.length === 0;
const stable = value => JSON.stringify(value, (_, item) => {
  if (typeof item === "bigint") return item.toString();
  if (typeof item?.toText === "function") return item.toText();
  if (item && typeof item === "object" && Object.keys(item).length === 1 && typeof item.__principal__ === "string") return item.__principal__;
  if (item instanceof Uint8Array) return [...item];
  if (item && typeof item === "object" && !Array.isArray(item))
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  return item;
});

/** Snapshot is private input. Reports contain only hashes/public pins, never rpc_urls. */
export function validateRecoverySnapshot(snapshot, { expectedCoordinatorHash = RECOVERY.oldCoordinatorHash, paused = false,
  profile = "bounded-recovery" } = {}) {
  const unlimited = profile === "unlimited-generation";
  if (!["bounded-recovery", "unlimited-generation"].includes(profile)) fail("Unknown rollout snapshot profile.");
  const targetId = unlimited ? UNLIMITED_SOURCE_ID : RECOVERY.recoverySourceId;
  const queuedId = unlimited ? null : RECOVERY.queuedSourceId;
  if (snapshot?.schema === "gh0st-recovery-snapshot-v1") {
    snapshot = { ...snapshot, capturedAt: snapshot.at, paused: snapshot.paused === true || paused,
      coordinatorStatus: snapshot.balances?.canisters?.coordinator, modelStatus: snapshot.balances?.canisters?.model,
      voiceState: snapshot.voice, signerAddress: snapshot.signerAddress ?? RECOVERY.signer,
      recoverySourceId: snapshot.recoverySourceId ?? targetId,
      queuedSourceId: snapshot.queuedSourceId ?? queuedId };
  }
  if (!snapshot || snapshot.paused !== true || !Number.isFinite(Date.parse(snapshot.capturedAt ?? "")))
    fail("Capture a paused coordinator snapshot before recovery preparation.");
  const c = snapshot.config;
  if (!c || !same(c.gateway, RECOVERY.oldGateway) || c.artifact_hash !== RECOVERY.oldArtifactHash ||
      c.model_id !== RECOVERY.modelId || c.model_wasm_hash !== "0x" + RECOVERY.modelHash ||
      principal(c.model_canister) !== RECOVERY.model || String(c.chain_id) !== "4663" ||
      String(c.confirmations) !== "12" || c.ecdsa_key_name !== "key_1" ||
      String(c.model_cycle_budget) !== RECOVERY_POLICY.normal_job_budget ||
      !same(snapshot.signerAddress, RECOVERY.signer)) fail("Snapshot coordinator configuration differs from the live deployment.");
  if (typeof principal(c.worker) !== "string" || !Array.isArray(c.rpc_urls) || c.rpc_urls.length < 1)
    fail("Snapshot omits the existing worker or RPC configuration.");
  for (const [name, expectedId, expectedHash, controllers] of [
    ["coordinator", RECOVERY.coordinator, expectedCoordinatorHash, [RECOVERY.deployer]],
    ["model", RECOVERY.model, RECOVERY.modelHash, [RECOVERY.deployer, RECOVERY.coordinator]],
  ]) {
    const status = snapshot[name + "Status"];
    if (!status || status.id !== expectedId || status.status !== "Running" || status.module_hash !== "0x" + expectedHash ||
        stable([...(status.settings?.controllers ?? [])].sort()) !== stable([...controllers].sort()))
      fail("Snapshot canister module, identity or controller set is incorrect.");
  }
  if (!Array.isArray(snapshot.jobs) || snapshot.jobs.length < 2 || snapshot.jobs.length > 256 ||
      snapshot.jobs.some(j => j.busy !== false || ["Running", "ReadyToSign"].includes(phase(j))))
    fail("Recovery requires complete retained jobs with no model call in flight.");
  const ids = snapshot.jobs.map(j => j.request?.id);
  if (ids.some(value => !HASH.test(value ?? "")) || new Set(ids).size !== ids.length)
    fail("Snapshot jobs contain invalid or duplicate source identities.");
  const failed = snapshot.jobs.find(j => j.request.id === snapshot.recoverySourceId);
  const queued = snapshot.jobs.find(j => j.request.id === snapshot.queuedSourceId);
  if (!failed || phase(failed) !== "Failed" || !failed.source?.length || !failed.voice?.length)
    fail("Snapshot must retain the exact failed source for this rollout.");
  if (unlimited) {
    if (snapshot.recoverySourceId !== targetId || snapshot.queuedSourceId != null ||
        snapshot.jobs.length !== 9 || snapshot.jobs.filter(job => phase(job) === "Complete").length !== 7 ||
        snapshot.jobs.filter(job => phase(job) === "Failed").length !== 2 ||
        !snapshot.jobs.some(job => job.request.id === RECOVERY.recoverySourceId && phase(job) === "Failed"))
      fail("Unlimited rollout must preserve seven complete jobs and both failed sources, with no other active job.");
  } else if (snapshot.recoverySourceId !== targetId || snapshot.queuedSourceId !== queuedId ||
      !queued || phase(queued) !== "Verified" || !queued.source?.length || !queued.voice?.length ||
      failed === queued || BigInt(queued.chunks ?? -1) !== 0n || BigInt(queued.input_tokens ?? -1) !== 0n ||
      BigInt(queued.output_tokens ?? -1) !== 0n || BigInt(queued.model_cycles ?? -1) !== 0n || queued.prompt_ingested !== false ||
      queued.answer !== "" || (queued.signature?.length ?? 0) !== 0)
    fail("Snapshot must retain the failed source and the untouched queued Verified source.");
  if (!snapshot.voiceState || !emptyOption(snapshot.voiceState.remembering))
    fail("Voice acknowledgement must be idle before recovery.");
  const normalizedJobs = snapshot.jobs.map(job => {
    const copy = { ...job };
    if (emptyOption(copy.recovery)) delete copy.recovery;
    return copy;
  });
  return { capturedAt: snapshot.capturedAt, jobs: ids.length, recoverySourceId: snapshot.recoverySourceId,
    queuedSourceId: snapshot.queuedSourceId, jobsSha256: sha(stable(normalizedJobs)),
    voiceSha256: sha(stable(snapshot.voiceState)), configSha256: sha(stable(c)),
    worker: principal(c.worker), signerAddress: RECOVERY.signer,
    ...(unlimited ? { recoveryModelCycles: String(failed.model_cycles), recoveryChunks: failed.chunks,
      deferredModelCycles: String(snapshot.jobs.find(job => job.request.id === RECOVERY.recoverySourceId).model_cycles) } : {}),
    ...(snapshot.worker ? { workerJournalSha256: sha(stable(snapshot.worker)) } : {}),
    originalSourceSha256: sha(stable({ request: failed.request, source: failed.source, voice: failed.voice })) };
}

/** Called immediately after upgrade and before owner rebind/recover mutations. */
export function verifyRecoveryStatePreserved(before, after, coordinatorHash, { paused = false, profile = "bounded-recovery" } = {}) {
  const first = validateRecoverySnapshot(before, { paused, profile });
  const second = validateRecoverySnapshot(after, { expectedCoordinatorHash: coordinatorHash, paused, profile });
  for (const field of ["jobsSha256", "voiceSha256", "configSha256", "originalSourceSha256", "recoverySourceId", "queuedSourceId", "workerJournalSha256"])
    if (first[field] !== second[field]) fail("Upgrade changed retained jobs, voice memory or coordinator configuration.");
  return { preserved: true, ...second };
}

export function validateRecoveryWasm(bytes, expectedHash, { profile = "bounded-recovery" } = {}) {
  if (!(bytes instanceof Uint8Array) || sha(bytes) !== expectedHash || !WebAssembly.validate(bytes))
    fail("Recovery Wasm is invalid or differs from the candidate manifest.");
  const exports = new Set(WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(item => item.name));
  const required = ["canister_pre_upgrade", "canister_post_upgrade", "canister_update rebind_gateway",
    ...(profile === "unlimited-generation" ? ["canister_update enable_unlimited_swaps", "canister_update defer_failed_swap",
      "canister_update resume_retained_job"] : ["canister_update recover_job", "canister_update resume_job"])];
  for (const name of required)
    if (!exports.has(name)) fail("Recovery Wasm lacks required state-preserving recovery exports.");
  return true;
}

export async function prepareRecoveryDeployment({ provider, artifact, manifest, baseline, snapshot, paused = false, now = () => new Date().toISOString() }) {
  const identifiers = validateRecoveryManifest(manifest, baseline), evidence = validateRecoverySnapshot(snapshot, { paused, profile: rolloutProfile(manifest).name });
  await assertRhChain(provider);
  const [latest, pending] = await Promise.all([provider.getTransactionCount(RECOVERY.owner, "latest"), provider.getTransactionCount(RECOVERY.owner, "pending")]);
  if (!Number.isSafeInteger(latest) || latest < 0 || latest !== pending) fail("Owner nonce is pending or inconsistent; no recovery deployment was prepared.");
  const expectedGateway = getCreateAddress({ from: RECOVERY.owner, nonce: latest });
  if (await provider.getCode(expectedGateway) !== "0x") fail("Predicted successor gateway already has code.");
  const tx = await new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object)
    .getDeployTransaction(RECOVERY.owner, RECOVERY.signer, RECOVERY.modelId, identifiers.artifactHash);
  const deployment = await prepareUnsigned(provider, { owner: RECOVERY.owner, data: tx.data,
    feeCapGwei: RECOVERY.feeCapGwei, gasLimitCap: BigInt(RECOVERY.deploymentGasCap), nonce: latest });
  const plan = { schema: "gh0st-manual-rh-v1", preparedAt: now(), chainId: "4663", broadcast: false,
    operation: "deploy", owner: RECOVERY.owner, icpSigner: RECOVERY.signer, modelId: RECOVERY.modelId,
    artifactHash: identifiers.artifactHash, deployment, recoveryEvidence: evidence };
  validateRecoveryPlan(plan, { artifact, manifest, baseline });
  if (await provider.getTransactionCount(RECOVERY.owner, "pending") !== latest) fail("Owner nonce changed during preparation.");
  return plan;
}

export function validateRecoveryPlan(plan, { artifact, manifest, baseline }) {
  const { artifactHash } = validateRecoveryManifest(manifest, baseline);
  if (!same(plan.owner, RECOVERY.owner) || !same(plan.icpSigner, RECOVERY.signer) ||
      plan.modelId !== RECOVERY.modelId || plan.artifactHash !== artifactHash || !["deploy", "register"].includes(plan.operation))
    fail("Recovery transaction plan differs from the reviewed deployment bindings.");
  const actions = validatePlan(plan);
  const iface = new Interface(artifact.abi);
  if (plan.operation === "deploy") {
    if (actions.length !== 1) fail("Recovery deployment must contain one contract creation.");
    const suffix = iface.encodeDeploy([RECOVERY.owner, RECOVERY.signer, RECOVERY.modelId, artifactHash]);
    const expectedData = "0x" + artifact.evm.bytecode.object + suffix.slice(2);
    const action = actions[0];
    if (action.transaction.data !== expectedData || action.transaction.to ||
        !same(plan.deployment.predictedGateway, getCreateAddress({ from: RECOVERY.owner, nonce: action.nonce })))
      fail("Recovery constructor or predicted address differs from the exact unsigned transaction.");
  } else if (actions.length !== 1 || plan.registrations[0].poolId !== RECOVERY.poolId ||
      !same(plan.registrations[0].manager, RECOVERY.manager) ||
      actions[0].transaction.data !== iface.encodeFunctionData("setSwapPool", [RECOVERY.manager, RECOVERY.poolId, true]))
    fail("Recovery registration may authorize only the existing Pons pool.");
  for (const action of actions) {
    const cap = BigInt(plan.operation === "deploy" ? RECOVERY.deploymentGasCap : RECOVERY.registrationGasCap);
    if (BigInt(action.transaction.gas) > cap || BigInt(action.transaction.maxFeePerGas) > parseUnits(RECOVERY.feeCapGwei, "gwei"))
      fail("Recovery transaction exceeds the fixed gas or fee cap.");
  }
  return actions;
}

export async function verifyRecoveryGateway({ provider, artifact, manifest, baseline, gateway, deploymentTx }) {
  const identifiers = validateRecoveryManifest(manifest, baseline);
  const receipt = await confirmedReceipt(provider, deploymentTx, 12), tx = await provider.getTransaction(deploymentTx);
  const expected = await new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object)
    .getDeployTransaction(RECOVERY.owner, RECOVERY.signer, RECOVERY.modelId, identifiers.artifactHash);
  if (!same(receipt.contractAddress, gateway) || !tx || !same(tx.from, RECOVERY.owner) || tx.to != null || tx.data !== expected.data ||
      !sameRuntime(artifact, await provider.getCode(gateway))) fail("Successor gateway lacks a matching canonical deployment and runtime.");
  const contract = new Contract(gateway, artifact.abi, provider);
  const [owner, signer, modelId, artifactHash] = await Promise.all([contract.owner(), contract.icpSigner(), contract.modelId(), contract.artifactHash()]);
  if (!same(owner, RECOVERY.owner) || !same(signer, RECOVERY.signer) || modelId !== RECOVERY.modelId || artifactHash !== identifiers.artifactHash)
    fail("Successor gateway getters differ from the recovery manifest.");
  return { contract, receipt, identifiers };
}

export async function prepareRecoveryRegistration({ provider, artifact, manifest, baseline, gateway, deploymentTx, now = () => new Date().toISOString() }) {
  const { contract, receipt, identifiers } = await verifyRecoveryGateway({ provider, artifact, manifest, baseline, gateway, deploymentTx });
  const key = keccak256(contract.interface.getAbiCoder().encode(["address", "bytes32"], [RECOVERY.manager, RECOVERY.poolId]));
  if (await contract.authorizedSwapPool(key)) return { alreadyRegistered: true, gateway, deploymentTx };
  const [latest, pending] = await Promise.all([provider.getTransactionCount(RECOVERY.owner, "latest"), provider.getTransactionCount(RECOVERY.owner, "pending")]);
  if (latest !== pending) fail("Pending owner transaction blocks recovery registration preparation.");
  const prepared = await prepareUnsigned(provider, { owner: RECOVERY.owner, to: gateway,
    data: contract.interface.encodeFunctionData("setSwapPool", [RECOVERY.manager, RECOVERY.poolId, true]),
    feeCapGwei: RECOVERY.feeCapGwei, gasLimitCap: BigInt(RECOVERY.registrationGasCap), nonce: latest });
  const plan = { schema: "gh0st-manual-rh-v1", preparedAt: now(), chainId: "4663", broadcast: false,
    operation: "register", owner: RECOVERY.owner, icpSigner: RECOVERY.signer, gateway,
    modelId: RECOVERY.modelId, artifactHash: identifiers.artifactHash,
    registrations: [{ manager: RECOVERY.manager, poolId: RECOVERY.poolId, ...prepared }],
    deploymentEvidence: { transactionHash: deploymentTx, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, ...receiptCost(receipt) } };
  validateRecoveryPlan(plan, { artifact, manifest, baseline });
  if (await provider.getTransactionCount(RECOVERY.owner, "pending") !== latest)
    fail("Owner nonce changed during registration preparation.");
  return plan;
}

function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("Recovery input must be a regular file.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, json(value) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeBytes(file, bytes) {
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (!["--wasm", "--baseline", "--snapshot", "--out", "--quote", "--gateway", "--deployment-tx", "--paused", "--profile"].includes(name) || !argv[i + 1] || name in options)
      fail("Use --wasm FILE --snapshot FILE --out NEW_DIRECTORY; optional --quote deploy|register.");
    options[name] = argv[i + 1];
  }
  if (!options["--wasm"] || !options["--snapshot"] || !options["--out"]) fail("Wasm, paused snapshot and new output directory are required.");
  const baseline = read(options["--baseline"] ?? path.join(root, "build/mainnet-v2/artifact-manifest.json"));
  const wasm = fs.readFileSync(options["--wasm"]), snapshot = read(options["--snapshot"]);
  const manifest = deriveRecoveryManifest(baseline, sha(wasm), { profile: options["--profile"] ?? "bounded-recovery" });
  validateRecoveryWasm(wasm, manifest.coordinator_wasm_sha256, { profile: rolloutProfile(manifest).name });
  if (sha(fs.readFileSync(path.join(root, "vendor/llama_cpp_canister/build/llama_cpp.wasm"))) !== RECOVERY.modelHash ||
      sha(fs.readFileSync(path.join(root, "contracts/GH0STInferenceGateway.sol"))) !== manifest.gateway_source_sha256)
    fail("Local model or gateway source changed; recovery scope is coordinator-only.");
  if (options["--paused"] !== undefined && options["--paused"] !== "true") fail("--paused requires true after confirming owner pause.");
  const paused = options["--paused"] === "true";
  const profile = rolloutProfile(manifest);
  const evidence = validateRecoverySnapshot(snapshot, { paused, profile: profile.name }), identifiers = validateRecoveryManifest(manifest, baseline);
  const output = path.resolve(options["--out"]);
  let plan;
  if (options["--quote"]) {
    if (!["deploy", "register"].includes(options["--quote"]) || !process.env.RH_RPC_URL) fail("Explicit quote mode and private RH_RPC_URL are required.");
    const provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
    try {
      const artifact = compile();
      plan = options["--quote"] === "deploy"
        ? await prepareRecoveryDeployment({ provider, artifact, manifest, baseline, snapshot, paused })
        : await prepareRecoveryRegistration({ provider, artifact, manifest, baseline,
          gateway: options["--gateway"], deploymentTx: options["--deployment-tx"] });
    } finally { provider.destroy(); }
  }
  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
  writeBytes(path.join(output, "coordinator.wasm"), wasm);
  write(path.join(output, "artifact-manifest.json"), manifest);
  write(path.join(output, "recovery-review.json"), { schema: "gh0st-recovery-rollout-v1", broadcast: false,
    ...identifiers, ...evidence, ...(profile.name === "unlimited-generation" ? { profile: profile.name } : {}), oldGateway: RECOVERY.oldGateway, oldArtifactHash: RECOVERY.oldArtifactHash,
    canister: RECOVERY.coordinator, installMode: "upgrade", modelUnchanged: true,
    stateVerificationRequired: true, quoteStage: options["--quote"] ?? "offline",
    ownerApiReview: profile.name === "unlimited-generation" ? {
      rebind_gateway: { expected_gateway: RECOVERY.oldGateway, expected_artifact_hash: RECOVERY.oldArtifactHash,
        new_gateway: plan?.deployment?.predictedGateway ?? options["--gateway"] ?? null,
        new_artifact_hash: identifiers.artifactHash, requires: "paused, no in-flight calls; verify retained state first" },
      enable_unlimited_swaps: { expected_budget: RECOVERY_POLICY.normal_job_budget, new_budget: "0" },
      defer_failed_swap: { id: RECOVERY.recoverySourceId, expected_cycles: evidence.deferredModelCycles,
        reason: "Earlier failure retained as owner-deferred", requires: "retain the earlier owner-deferred failure" },
      resume_retained_job: { id: evidence.recoverySourceId, expected_cycles: evidence.recoveryModelCycles,
        expected_chunks: evidence.recoveryChunks, cache_evidence_hash: null,
        requires: "verify the same retained model cache and supply its evidence hash; no reset or replay" },
    } : {
      rebind_gateway: { expected_gateway: RECOVERY.oldGateway, expected_artifact_hash: RECOVERY.oldArtifactHash,
        new_gateway: plan?.deployment?.predictedGateway ?? options["--gateway"] ?? null,
        new_artifact_hash: identifiers.artifactHash, requires: "paused, no in-flight calls; verify retained state first" },
      recover_job: { id: evidence.recoverySourceId, maximum_additional_budget: RECOVERY_POLICY.maximum_additional_budget,
        requires: "explicit bounded grant, retained prior costs, park untouched queued source" },
      resume_job: { id: evidence.queuedSourceId, requires: "recovered source Complete before resuming the same queued source" },
    },
    maximumDeploymentAndPonsRegistrationWei: ((BigInt(RECOVERY.deploymentGasCap) + BigInt(RECOVERY.registrationGasCap)) * parseUnits(RECOVERY.feeCapGwei, "gwei")).toString() });
  if (plan) write(path.join(output, "rh-" + options["--quote"] + "-plan.json"), plan);
  console.log(json({ output, broadcast: false, artifactHash: identifiers.artifactHash, coordinatorHash: identifiers.coordinatorHash, quote: options["--quote"] ?? "none" }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof RecoveryPreparationError ? error.message : "Recovery preparation stopped; no transaction was signed or broadcast.");
    process.exitCode = 1;
  });
