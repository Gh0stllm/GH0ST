import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Contract, ContractFactory, JsonRpcProvider, getCreateAddress, id, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import { compile } from "./compile.mjs";
import { validatePlan, checkFresh } from "./manual-wallet.mjs";
import { assertRhChain, confirmedReceipt, prepareUnsigned, sameRuntime } from "./manual-rh-core.mjs";
import { executeActions, unlockKeystore, executionMessage } from "./execute-rh.mjs";
import { nativeMacPasswordPrompt } from "./native-unlock.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const pins = Object.freeze({ owner: "0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6",
  signer: "0x8156899f88e9e45163e3770145a473923ace2ff1", coordinator: "6jacx-5yaaa-aaaaj-a65jq-cai",
  model: "6obed-qaaaa-aaaaj-a65ja-cai", controller: "uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe",
  modelHash: "964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5",
  modelId: "0x169670d418d7032d6b7429b6b8d27e6cb6d755be6fce5d36e9f7c9bd74471005",
  manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951", poolId: "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01",
  feeCapGwei: "0.05", deploymentGasCap: 5000000n, registrationGasCap: 250000n });
const sha = value => createHash("sha256").update(value).digest("hex");
const artifactHash = value => keccak256(toUtf8Bytes(JSON.stringify(value)));
const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
const principal = value => typeof value?.toText === "function" ? value.toText() : value?.__principal__ ?? value;
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const stable = value => JSON.stringify(value, (_, v) => {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return [...v];
  if (v?.toText || v?.__principal__) return principal(v);
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]));
  return v;
});
const phase = job => Object.keys(job.phase ?? {})[0];
class ExactFilterRolloutError extends Error {}
const fail = message => { throw new ExactFilterRolloutError(message); };
function read(file) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink()) fail("Expected a regular rollout input file.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function write(file, value) {
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, typeof value === "string" || value instanceof Uint8Array ? value : json(value) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

export function snapshotDigests(snapshot, baseline, expectedCoordinatorHash = baseline.coordinator_wasm_sha256) {
  const c = snapshot?.config;
  if (snapshot?.paused !== true || snapshot.coordinator !== pins.coordinator || !c ||
      !/^0x[0-9a-f]{40}$/i.test(c.gateway ?? "") || c.artifact_hash !== artifactHash(baseline) ||
      c.model_id !== pins.modelId || id(baseline.model?.id ?? "") !== pins.modelId ||
      c.model_wasm_hash !== "0x" + pins.modelHash || baseline.model_wasm_sha256 !== pins.modelHash ||
      principal(c.model_canister) !== pins.model || String(c.chain_id) !== "4663" ||
      String(c.confirmations) !== "12" || c.ecdsa_key_name !== "key_1" ||
      String(c.model_cycle_budget) !== "0" || String(baseline.limits?.model_cycle_budget) !== "0" ||
      !same(snapshot.signerAddress, pins.signer)) fail("Snapshot does not match the paused current unlimited deployment.");
  for (const [name, canister, hash, controllers] of [["coordinator", pins.coordinator, expectedCoordinatorHash, [pins.controller]],
    ["model", pins.model, pins.modelHash, [pins.controller, pins.coordinator]]]) {
    const status = snapshot[name + "Status"] ?? snapshot.balances?.canisters?.[name];
    if (!status || status.id !== canister || status.status !== "Running" || status.module_hash !== "0x" + hash ||
        stable(status.settings?.controllers?.map(principal).sort()) !== stable(controllers.sort())) fail("Canister identity, controllers, or module changed.");
  }
  if (!Array.isArray(snapshot.jobs) || snapshot.jobs.some(j => j.busy !== false || !["Complete", "Failed"].includes(phase(j)) ||
      j.recovery?.some(r => r.accounting_uncertain) || phase(j) === "Complete" && j.voice?.some(v => !v.remembered)))
    fail("Wait for active jobs to finish and acknowledge completed thoughts before preparing an upgrade.");
  if (!snapshot.worker?.buyQueue || snapshot.worker.buyQueue.policy.skipFailedBuys !== true ||
      snapshot.worker.requests?.some(i => i.pendingUpdate || i.pendingResume || i.buyHalt)) fail("Worker skip policy or ingress reconciliation is incomplete.");
  const voice = snapshot.voiceState ?? snapshot.voice;
  if (!voice || voice.remembering?.length) fail("Thought-memory acknowledgement is still pending.");
  return { jobsSha256: sha(stable(snapshot.jobs)), voiceSha256: sha(stable(voice)), configSha256: sha(stable(c)),
    workerJournalSha256: sha(stable(snapshot.worker)),
    ...(snapshot.deferredSwaps ? { deferredSwapsSha256: sha(stable(snapshot.deferredSwaps)) } : {}),
    oldGateway: c.gateway, oldArtifactHash: c.artifact_hash, oldCoordinatorHash: expectedCoordinatorHash,
    workerPrincipal: principal(c.worker), jobs: snapshot.jobs.length };
}

export function deriveExactManifest(baseline, wasm, profile, { intent = "exact-filter" } = {}) {
  if (!WebAssembly.validate(wasm)) fail("Candidate is not valid WebAssembly.");
  const exports = new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(x => x.name));
  for (const name of ["canister_pre_upgrade", "canister_post_upgrade", "canister_update rebind_gateway", "canister_update defer_failed_swap"])
    if (!exports.has(name)) fail("Candidate lacks a state-preserving rollout export.");
  if (sha(wasm) === baseline.coordinator_wasm_sha256) fail("Candidate coordinator is unchanged.");
  if (intent === "remove-length-limit") {
    if (stable(profile) !== stable(baseline.persona_profile) || profile.sampling?.max_output_tokens !== 80 || baseline.limits?.answer_bytes !== 8192)
      fail("Length-only rollout must preserve the profile, 80-token allowance and 8192-byte transport bound.");
    return { ...baseline, coordinator_wasm_sha256: sha(wasm),
      output_length_policy: { schema: "gh0st-no-character-gate-v1", min_characters: null, max_characters: null,
        overrides_historical_profile_character_gate: true, profile_bytes_unchanged: true,
        model_output_tokens: 80, transport_answer_bytes: 8192, gateway_output_tokens: 128,
        exact_duplicate_guard: "unchanged", failed_buy_skip: "unchanged", historical_results: "immutable" } };
  }
  if (intent !== "exact-filter") fail("Unknown rollout policy intent.");
  return { ...baseline, coordinator_wasm_sha256: sha(wasm), persona_profile: profile,
    thought_policy: { schema: "gh0st-exact-thought-v1", duplicate_match: "exact whole UTF-8 output",
      delivery_guard: "persistent exact-text history before RH relay and X publication",
      failures: "retain cost and source, skip to next buy", historical_results: "immutable",
      prompt: "diversified source-derived cues without verbatim previous-thought priming" } };
}

export function verifyExactUpgrade(review, after, baseline) {
  const observed = snapshotDigests(after, baseline, review.coordinatorHash);
  for (const key of ["jobsSha256", "voiceSha256", "configSha256", "workerJournalSha256", "deferredSwapsSha256"])
    if (observed[key] !== review[key]) fail("Upgrade changed retained jobs, configuration, memory or worker history.");
  return { preserved: true, checkedAt: new Date().toISOString(), ...observed };
}

function validateBundle(directory) {
  const baseline = read(path.join(directory, "baseline.json")), manifest = read(path.join(directory, "artifact-manifest.json"));
  const review = read(path.join(directory, "rollout-review.json")), wasm = fs.readFileSync(path.join(directory, "coordinator.wasm"));
  if (review.schema !== "gh0st-exact-filter-rollout-v1" || review.canister !== pins.coordinator || review.installMode !== "upgrade" ||
      review.oldArtifactHash !== artifactHash(baseline) || review.artifactHash !== artifactHash(manifest) ||
      review.coordinatorHash !== sha(wasm) || stable(manifest) !== stable(deriveExactManifest(baseline, wasm, manifest.persona_profile, { intent: review.intent ?? "exact-filter" })))
    fail("Rollout bundle changed or is not the reviewed current-deployment upgrade.");
  if (sha(fs.readFileSync(path.join(root, "contracts/GH0STInferenceGateway.sol"))) !== manifest.gateway_source_sha256)
    fail("Gateway source differs from the reviewed manifest.");
  return { baseline, manifest, review, artifact: compile(), directory };
}
function validateGatewayPlan(plan, bundle) {
  const { artifact, review } = bundle, actions = validatePlan(plan), iface = new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object).interface;
  if (actions.length !== 1 || !same(plan.owner, pins.owner) || plan.artifactHash !== review.artifactHash || plan.modelId !== pins.modelId || !same(plan.icpSigner, pins.signer))
    fail("Gateway plan identity differs from the rollout.");
  const a = actions[0];
  if (plan.operation === "deploy") {
    const expected = "0x" + artifact.evm.bytecode.object + iface.encodeDeploy([pins.owner, pins.signer, pins.modelId, review.artifactHash]).slice(2);
    if (a.transaction.data !== expected || a.transaction.to || !same(plan.deployment.predictedGateway, getCreateAddress({ from: pins.owner, nonce: a.nonce })))
      fail("Gateway deployment constructor differs.");
    if (review.deployPlanSha256 && sha(json(plan) + "\n") !== review.deployPlanSha256)
      fail("The reviewed deployment plan changed.");
    if (review.newGateway && !same(review.newGateway, plan.deployment.predictedGateway)) fail("Reviewed successor address changed.");
  } else if (plan.operation !== "register" || !same(plan.gateway, bundle.gateway ?? plan.gateway) ||
      a.transaction.data !== iface.encodeFunctionData("setSwapPool", [pins.manager, pins.poolId, true])) fail("Only the existing Pons pool may be registered.");
  if (BigInt(a.transaction.gas) > (plan.operation === "deploy" ? pins.deploymentGasCap : pins.registrationGasCap) ||
      BigInt(a.transaction.maxFeePerGas) > parseUnits(pins.feeCapGwei, "gwei")) fail("Gateway plan exceeds its reviewed fee ceiling.");
  return actions;
}
async function verifyOld(provider, bundle) {
  await assertRhChain(provider);
  const old = new Contract(bundle.review.oldGateway, bundle.artifact.abi, provider);
  const values = await Promise.all([old.owner(), old.icpSigner(), old.modelId(), old.artifactHash(), provider.getCode(bundle.review.oldGateway)]);
  if (!same(values[0], pins.owner) || !same(values[1], pins.signer) || values[2] !== pins.modelId || values[3] !== bundle.review.oldArtifactHash ||
      !sameRuntime(bundle.artifact, values[4])) fail("Current gateway does not match the snapshot and baseline.");
}
async function verifyNew(provider, bundle, gateway, hash) {
  const receipt = await confirmedReceipt(provider, hash, 12), tx = await provider.getTransaction(hash);
  const expected = await new ContractFactory(bundle.artifact.abi, "0x" + bundle.artifact.evm.bytecode.object)
    .getDeployTransaction(pins.owner, pins.signer, pins.modelId, bundle.review.artifactHash);
  const contract = new Contract(gateway, bundle.artifact.abi, provider);
  const values = await Promise.all([contract.owner(), contract.icpSigner(), contract.modelId(), contract.artifactHash(), provider.getCode(gateway)]);
  if (!same(receipt.contractAddress, gateway) || !same(tx?.from, pins.owner) || tx?.to != null || tx.data !== expected.data ||
      !same(values[0], pins.owner) || !same(values[1], pins.signer) || values[2] !== pins.modelId || values[3] !== bundle.review.artifactHash || !sameRuntime(bundle.artifact, values[4]))
    fail("Successor deployment or immutable fields differ from the reviewed artifact.");
  return contract;
}

async function main(argv) {
  const mode = argv.shift(), args = {};
  for (let i = 0; i < argv.length; i++) {
    if (["--quote", "--execute"].includes(argv[i])) args[argv[i]] = true;
    else if (["--snapshot", "--baseline", "--wasm", "--profile", "--out", "--directory", "--after", "--intent"].includes(argv[i]) && argv[i + 1]) args[argv[i]] = argv[++i];
    else fail("Invalid exact-filter rollout arguments.");
  }
  if (mode === "prepare") {
    const baseline = read(args["--baseline"]), snapshot = read(args["--snapshot"]), wasm = fs.readFileSync(args["--wasm"]);
    const intent = args["--intent"] ?? "exact-filter";
    const evidence = snapshotDigests(snapshot, baseline), manifest = deriveExactManifest(baseline, wasm, read(args["--profile"] ?? path.join(root, "persona-profile.json")), { intent });
    const directory = path.resolve(args["--out"]), review = { schema: "gh0st-exact-filter-rollout-v1", preparedAt: new Date().toISOString(),
      canister: pins.coordinator, modelCanister: pins.model, installMode: "upgrade", broadcast: false, intent,
      ...evidence, artifactHash: artifactHash(manifest), coordinatorHash: sha(wasm),
      maximumDeploymentAndRegistrationWei: ((pins.deploymentGasCap + pins.registrationGasCap) * parseUnits(pins.feeCapGwei, "gwei")).toString(),
      stateVerificationRequired: true, noModelChange: true, noSourceReplay: true };
    let plan;
    if (args["--quote"]) {
      if (!process.env.RH_RPC_URL) fail("Private RH_RPC_URL is required for a read-only quote.");
      const provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
      try {
        const artifact = compile(), bundle = { artifact, review };
        await verifyOld(provider, bundle);
        const latest = await provider.getTransactionCount(pins.owner, "latest"), pending = await provider.getTransactionCount(pins.owner, "pending");
        if (latest !== pending) fail("Owner nonce is pending; no replacement deployment was prepared.");
        const tx = await new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object).getDeployTransaction(pins.owner, pins.signer, pins.modelId, review.artifactHash);
        plan = { schema: "gh0st-manual-rh-v1", preparedAt: review.preparedAt, chainId: "4663", broadcast: false, operation: "deploy",
          owner: pins.owner, icpSigner: pins.signer, modelId: pins.modelId, artifactHash: review.artifactHash,
          deployment: await prepareUnsigned(provider, { owner: pins.owner, data: tx.data, feeCapGwei: pins.feeCapGwei, gasLimitCap: pins.deploymentGasCap, nonce: latest }) };
        validateGatewayPlan(plan, bundle);
        if (await provider.getCode(plan.deployment.predictedGateway) !== "0x" || await provider.getTransactionCount(pins.owner, "pending") !== latest)
          fail("Deployment address or owner nonce changed during preparation.");
        review.newGateway = plan.deployment.predictedGateway;
        review.deployPlanSha256 = sha(json(plan) + "\n");
      } finally { provider.destroy(); }
    }
    fs.mkdirSync(directory, { mode: 0o700 });
    write(path.join(directory, "baseline.json"), baseline); write(path.join(directory, "artifact-manifest.json"), manifest);
    write(path.join(directory, "coordinator.wasm"), wasm); write(path.join(directory, "rollout-review.json"), review);
    if (plan) write(path.join(directory, "rh-deploy-plan.json"), plan);
    console.log(json({ directory, ...review, next: "Upgrade only while paused, then check-upgrade before gateway execution or rebind." }));
    return;
  }
  const directory = path.resolve(args["--directory"]), bundle = validateBundle(directory);
  if (mode === "check-upgrade") {
    const after = verifyExactUpgrade(bundle.review, read(args["--after"]), bundle.baseline);
    write(path.join(directory, "state-preserved.json"), after);
    console.log("Coordinator state and worker history preserved; model and controllers unchanged."); return;
  }
  if (mode !== "gateway") fail("Use prepare, check-upgrade, or gateway.");
  const deployPath = path.join(directory, "rh-deploy-plan.json"), deploy = read(deployPath);
  const actions = validateGatewayPlan(deploy, bundle), gateway = deploy.deployment.predictedGateway;
  console.log(json({ execute: Boolean(args["--execute"]), gateway, artifactHash: bundle.review.artifactHash,
    deploymentMaximumFeeWei: actions[0].maxCostWei, totalHardMaximumFeeEth: "0.0002625", inputEth: "0" }));
  if (!args["--execute"]) return;
  const preserved = read(path.join(directory, "state-preserved.json"));
  if (!preserved.preserved || preserved.oldCoordinatorHash !== bundle.review.coordinatorHash) fail("Verify retained state after the candidate upgrade first.");
  if (!process.env.RH_RPC_URL) fail("Private RH_RPC_URL is required.");
  const provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
  const keystore = path.resolve(root, "../../recovered-model/research/v4-hook-1m/experiments/multichain-gpt2/deployments/canary-signer.json");
  let signer;
  const run = async (file, plan) => executeActions({ planPath: file, planHash: sha(fs.readFileSync(file)), owner: pins.owner,
    actions: validateGatewayPlan(plan, { ...bundle, gateway }), provider,
    getSigner: async () => signer ??= await unlockKeystore(keystore, pins.owner, () => nativeMacPasswordPrompt({ purpose: "recovery" })),
    freshCheck: async (p, action) => { validateBundle(directory); await verifyOld(p, bundle); await checkFresh(p, action); } });
  try {
    await verifyOld(provider, bundle);
    const deployed = await run(deployPath, deploy), deploymentTx = deployed.actions[0].hash;
    const contract = await verifyNew(provider, bundle, gateway, deploymentTx);
    const poolKey = keccak256(contract.interface.getAbiCoder().encode(["address", "bytes32"], [pins.manager, pins.poolId]));
    const registrationPath = path.join(directory, "rh-register-plan.json");
    if (!await contract.authorizedSwapPool(poolKey)) {
      let registration;
      if (fs.existsSync(registrationPath)) registration = read(registrationPath);
      else {
        if (fs.existsSync(registrationPath + ".signed-journal.json")) fail("Registration journal exists without its exact plan.");
        const latest = await provider.getTransactionCount(pins.owner, "latest");
        if (latest !== await provider.getTransactionCount(pins.owner, "pending")) fail("Pending owner nonce prevents registration.");
        registration = { schema: "gh0st-manual-rh-v1", preparedAt: new Date().toISOString(), chainId: "4663", broadcast: false,
          operation: "register", owner: pins.owner, icpSigner: pins.signer, modelId: pins.modelId, artifactHash: bundle.review.artifactHash, gateway,
          registrations: [{ manager: pins.manager, poolId: pins.poolId, ...await prepareUnsigned(provider, { owner: pins.owner, to: gateway,
            data: contract.interface.encodeFunctionData("setSwapPool", [pins.manager, pins.poolId, true]), nonce: latest,
            feeCapGwei: pins.feeCapGwei, gasLimitCap: pins.registrationGasCap }) }] };
        validateGatewayPlan(registration, { ...bundle, gateway }); write(registrationPath, registration);
      }
      await run(registrationPath, registration);
    }
    if (!await contract.authorizedSwapPool(poolKey)) fail("Pons pool registration is not confirmed.");
    const result = { gateway, deploymentTx, artifactHash: bundle.review.artifactHash,
      rebindArgs: [bundle.review.oldGateway, bundle.review.oldArtifactHash, gateway, bundle.review.artifactHash],
      next: "Owner rebind_gateway while still paused; verify config and retained history before updating worker binding and resuming." };
    const resultPath = path.join(directory, "gateway-result.json");
    if (!fs.existsSync(resultPath)) write(resultPath, result);
    console.log(json(result));
  } finally { signer = undefined; provider.destroy(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof ExactFilterRolloutError ? error.message : executionMessage(error)); process.exitCode = 1; });
