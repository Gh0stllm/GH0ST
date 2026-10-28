import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JsonRpcProvider, formatEther } from "ethers";
import { compile } from "./compile.mjs";
import { executeActions, unlockKeystore, executionMessage } from "./execute-rh.mjs";
import { checkFresh } from "./manual-wallet.mjs";
import { RECOVERY as R, validateRecoveryManifest, validateRecoveryWasm, validateRecoveryPlan,
  prepareRecoveryRegistration, verifyRecoveryGateway, rolloutProfile } from "./prepare-recovery-rollout.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const KEYSTORE = "/Users/abhijith/Documents/ChatGPT/GH0ST/recovered-model/research/v4-hook-1m/experiments/multichain-gpt2/deployments/canary-signer.json";
const digest = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
class GatewayExecutionError extends Error {}
const fail = message => { throw new GatewayExecutionError(message); };

function readPrivate(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      typeof process.getuid === "function" && stat.uid !== process.getuid())
    fail("Recovery files must be private regular files owned by this user.");
  const bytes = fs.readFileSync(file);
  return { path: file, sha256: digest(bytes), value: JSON.parse(bytes) };
}

function savePrivate(file, value, { exclusive = false } = {}) {
  if (exclusive && fs.existsSync(file)) fail("Refusing to replace an existing recovery plan.");
  if (fs.existsSync(file)) readPrivate(file);
  const temporary = file + "." + randomBytes(6).toString("hex") + ".tmp";
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, json(value) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (exclusive) { fs.linkSync(temporary, file); fs.unlinkSync(temporary); } else fs.renameSync(temporary, file);
  const parent = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}

export function loadRecoveryBundle(directory) {
  const dir = path.resolve(directory);
  const manifest = readPrivate(path.join(dir, "artifact-manifest.json"));
  const review = readPrivate(path.join(dir, "recovery-review.json"));
  const deploy = readPrivate(path.join(dir, "rh-deploy-plan.json"));
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "build/mainnet-v2/artifact-manifest.json"), "utf8"));
  const ids = validateRecoveryManifest(manifest.value, baseline);
  const profile = rolloutProfile(manifest.value);
  validateRecoveryWasm(fs.readFileSync(path.join(dir, "coordinator.wasm")), ids.coordinatorHash, { profile: profile.name });
  if (digest(fs.readFileSync(path.join(root, "contracts/GH0STInferenceGateway.sol"))) !== manifest.value.gateway_source_sha256)
    fail("Gateway source differs from the reviewed recovery manifest.");
  if (review.value.schema !== "gh0st-recovery-rollout-v1" || review.value.broadcast !== false ||
      review.value.artifactHash !== ids.artifactHash || review.value.coordinatorHash !== ids.coordinatorHash ||
      review.value.canister !== R.coordinator || review.value.installMode !== "upgrade" ||
      review.value.recoverySourceId !== profile.recoverySourceId || review.value.queuedSourceId !== profile.queuedSourceId ||
      (review.value.profile ?? "bounded-recovery") !== profile.name)
    fail("Recovery review does not match the selected manifest and preserved jobs.");
  const artifact = compile();
  const actions = validateRecoveryPlan(deploy.value, { artifact, manifest: manifest.value, baseline });
  if (deploy.value.operation !== "deploy" || actions.length !== 1 ||
      deploy.value.recoveryEvidence?.recoverySourceId !== profile.recoverySourceId ||
      deploy.value.recoveryEvidence?.queuedSourceId !== profile.queuedSourceId)
    fail("Deployment is not the exact reviewed recovery plan.");
  for (const field of ["jobsSha256", "voiceSha256", "configSha256", "originalSourceSha256", "workerJournalSha256"]) {
    const expected = review.value[field];
    if ((field !== "workerJournalSha256" || expected !== undefined) && !/^[0-9a-f]{64}$/.test(expected ?? "") ||
        deploy.value.recoveryEvidence?.[field] !== expected)
      fail("Deployment state evidence differs from the reviewed snapshot.");
  }
  return { directory: dir, manifest: manifest.value, baseline, artifact, deploy, actions,
    binding: { schema: "gh0st-recovery-gateway-v1", deployPlanSha256: deploy.sha256,
      manifestSha256: manifest.sha256, reviewSha256: review.sha256, artifactHash: ids.artifactHash,
      coordinatorHash: ids.coordinatorHash, owner: R.owner, gateway: deploy.value.deployment.predictedGateway,
      ...(profile.name === "unlimited-generation" ? { profile: profile.name, recoverySourceId: profile.recoverySourceId } : {}) } };
}

/** A replay always reconciles the SAME deployment and registration journals.
 * It never creates a replacement deployment or regenerates a saved registration.
 */
export async function runRecoveryGatewayFlow({ state, ops, save }) {
  try {
    state.stage = "deployment"; await save(state);
    if (state.deploymentConfirmed && !await ops.hasDeploymentJournal()) fail("The confirmed deployment journal is missing; preserve evidence and stop.");
    const deployment = await ops.executeDeployment();
    await ops.verifyDeployment(deployment);
    state.deploymentConfirmed = deployment; state.stage = "registration"; await save(state);
    let registration = await ops.existingRegistration();
    if (state.registration && !registration) fail("The saved registration plan is missing; no replacement was prepared.");
    if (!registration) registration = await ops.prepareRegistration(deployment);
    if (registration.alreadyRegistered) {
      state.registrationAlreadyVerified = true;
    } else {
      if (state.registration && state.registration.sha256 !== registration.sha256)
        fail("The saved registration plan changed; preserve its signed journal.");
      state.registration = { path: registration.path, sha256: registration.sha256 }; await save(state);
      if (state.registrationConfirmed && !await ops.hasRegistrationJournal(registration))
        fail("The confirmed registration journal is missing; preserve evidence and stop.");
      state.registrationConfirmed = await ops.executeRegistration(registration);
    }
    await ops.verifyRegistration();
    state.stage = "complete"; state.completedAt ??= new Date().toISOString(); delete state.lastError; await save(state);
    return state;
  } catch (error) {
    state.lastError = { stage: state.stage, message: error instanceof GatewayExecutionError ? error.message : executionMessage(error) };
    await save(state); throw error;
  }
}

function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--execute" && !args.execute) args.execute = true;
    else if (argv[i] === "--directory" && !args.directory && argv[i + 1] && !argv[i + 1].startsWith("--")) args.directory = argv[++i];
    else fail("Use --directory REVIEWED_BUNDLE [--execute]. No passwords or keys are accepted as arguments.");
  }
  if (!args.directory) fail("A reviewed recovery bundle directory is required.");
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parse(argv), bundle = loadRecoveryBundle(args.directory);
  console.log(json({ execute: Boolean(args.execute), owner: R.owner, gateway: bundle.binding.gateway,
    artifactHash: bundle.binding.artifactHash, deploymentPlanSha256: bundle.deploy.sha256,
    deployment: bundle.actions.map(action => ({ nonce: action.nonce, unsignedHash: action.unsignedHash, maximumFeeEth: action.maxCostEth })),
    registration: { poolId: R.poolId, maximumFeeEth: "0.0000125", freshQuoteAfterConfirmedDeployment: true },
    totalHardMaximumFeeEth: "0.0002625", inputEth: "0" }));
  if (!args.execute) return;
  if (!process.env.RH_RPC_URL) fail("A private RH RPC is required for execution.");
  const globalLock = path.join(root, ".state/recovery-gateway-wrapper.lock");
  fs.mkdirSync(path.dirname(globalLock), { recursive: true, mode: 0o700 });
  let lock;
  try { lock = fs.openSync(globalLock, "wx", 0o600); } catch { fail("Another recovery gateway process holds the lock; reconcile it before retrying."); }
  fs.writeFileSync(lock, String(process.pid)); fs.fsyncSync(lock);
  let provider, signer, stopped = false;
  const stop = () => { stopped = true; };
  const active = () => { if (stopped) fail("Recovery execution was interrupted; saved hashes remain available for reconciliation."); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const checkpoint = path.join(bundle.directory, "gateway-execution.json");
  const registrationPath = path.join(bundle.directory, "rh-recovery-pons-register.json");
  try {
    provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
    if (fs.existsSync(registrationPath) && !fs.existsSync(bundle.deploy.path + ".signed-journal.json"))
      fail("Registration exists but the original deployment journal is missing; preserve evidence and stop.");
    const state = fs.existsSync(checkpoint) ? readPrivate(checkpoint).value : { binding: bundle.binding };
    if (json(state.binding) !== json(bundle.binding)) fail("Recovery checkpoint belongs to another reviewed deployment.");
    const currentBundle = () => {
      const current = loadRecoveryBundle(bundle.directory);
      if (json(current.binding) !== json(bundle.binding)) fail("Recovery bundle changed while execution was active.");
      return current;
    };
    const getSigner = async () => {
      active();
      if (!signer) {
        const { nativeMacPasswordPrompt } = await import("./native-unlock.mjs");
        signer = await unlockKeystore(KEYSTORE, R.owner, () => nativeMacPasswordPrompt({ purpose: "recovery" }));
      }
      active(); return signer;
    };
    const execute = async (ref, actions) => {
      active(); currentBundle();
      return executeActions({ planPath: ref.path, planHash: ref.sha256, owner: R.owner, actions, provider, getSigner,
        freshCheck: async (p, action) => { active(); currentBundle(); await checkFresh(p, action); active(); },
        log: message => { if (typeof message === "string" && !message.includes("http")) console.log(message); } });
    };
    const verify = async () => {
      active();
      const info = await verifyRecoveryGateway({ provider, ...bundle,
        gateway: bundle.binding.gateway, deploymentTx: state.deploymentConfirmed.transactionHash });
      active(); return info;
    };
    await runRecoveryGatewayFlow({ state, save: value => savePrivate(checkpoint, value), ops: {
      hasDeploymentJournal: () => fs.existsSync(bundle.deploy.path + ".signed-journal.json"),
      executeDeployment: async () => {
        const journal = await execute(bundle.deploy, bundle.actions), entry = journal.actions[0];
        return { transactionHash: entry.hash, ...entry.receipt };
      },
      verifyDeployment: async deployment => {
        await verifyRecoveryGateway({ provider, ...bundle, gateway: bundle.binding.gateway, deploymentTx: deployment.transactionHash }); active();
      },
      existingRegistration: async () => {
        if (!fs.existsSync(registrationPath)) {
          if (fs.existsSync(registrationPath + ".signed-journal.json")) fail("Registration signed journal exists without its exact plan.");
          return null;
        }
        const ref = readPrivate(registrationPath);
        validateRecoveryPlan(ref.value, bundle);
        if (ref.value.gateway.toLowerCase() !== bundle.binding.gateway.toLowerCase()) fail("Registration targets another gateway.");
        return ref;
      },
      prepareRegistration: async deployment => {
        active(); const plan = await prepareRecoveryRegistration({ provider, ...bundle,
          gateway: bundle.binding.gateway, deploymentTx: deployment.transactionHash }); active();
        if (plan.alreadyRegistered) return plan;
        savePrivate(registrationPath, plan, { exclusive: true }); return readPrivate(registrationPath);
      },
      hasRegistrationJournal: ref => fs.existsSync(ref.path + ".signed-journal.json"),
      executeRegistration: async ref => {
        const actions = validateRecoveryPlan(ref.value, bundle), journal = await execute(ref, actions), entry = journal.actions[0];
        return { transactionHash: entry.hash, ...entry.receipt };
      },
      verifyRegistration: async () => {
        const { contract } = await verify();
        const key = contract.interface.getAbiCoder().encode(["address", "bytes32"], [R.manager, R.poolId]);
        const { keccak256 } = await import("ethers");
        if (!await contract.authorizedSwapPool(keccak256(key))) fail("Pons registration is not confirmed on the reviewed gateway."); active();
      },
    } });
    const total = BigInt(state.deploymentConfirmed.feeWei) + BigInt(state.registrationConfirmed?.feeWei ?? 0);
    console.log(json({ complete: true, gateway: bundle.binding.gateway,
      deploymentTx: state.deploymentConfirmed.transactionHash, registrationTx: state.registrationConfirmed?.transactionHash ?? null,
      actualFeeWei: total.toString(), actualFeeEth: formatEther(total), checkpoint }));
  } finally {
    signer = undefined;
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    provider?.destroy(); fs.closeSync(lock); fs.unlinkSync(globalLock);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error(error instanceof GatewayExecutionError ? error.message : executionMessage(error)); process.exitCode = 1; });
