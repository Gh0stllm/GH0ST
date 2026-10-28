import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Interface, ContractFactory, JsonRpcProvider, getAddress, keccak256, toUtf8Bytes, formatEther } from "ethers";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { idlFactory } from "../worker/candid.mjs";
import { executeActions, unlockKeystore, executionMessage, validateSigned } from "./execute-rh.mjs";
import { validatePlan, checkFresh } from "./manual-wallet.mjs";
import { REGISTRATION as R, validateRegistrationPlan, prepareRegistrationContinuation } from "./prepare-registration.mjs";
import { SWAP_POOL_ID, validateSwapPlan } from "./swap-plan.mjs";
import { main as prepareManualRh } from "./manual-rh.mjs";
import { decodeSwapReceipt, loadSources, SWAP_TOPIC } from "../worker/swaps.mjs";
import { assertRhChain } from "./manual-rh-core.mjs";
import { inspectFulfillment } from "../worker/delivery.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const mainnet = path.join(root, "build/mainnet-v2");
const checkpointPath = path.join(mainnet, "rh-pilot.json");
const workerJournal = path.join(root, ".state/rh-pilot-v2-worker.json");
const keystore = "/Users/abhijith/Documents/ChatGPT/GH0ST/recovered-model/research/v4-hook-1m/experiments/multichain-gpt2/deployments/canary-signer.json";
const PONS_POOL = "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01";
const CANISTERS = Object.freeze({ coordinator: "6jacx-5yaaa-aaaaj-a65jq-cai", model: "6obed-qaaaa-aaaaj-a65ja-cai" });
const DEPLOYER = "uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe";
const FIXED_COORDINATOR_HASH = "0x7e57af5c383986244e3ff38bd0f874822ca1a3e1f0d4ec6faa349dd30b15e05c";
const EXISTING_SWAP_TX = "0xc28f82412c4beea4ced077fe3bb9247a308cca51d9a210baec0d556f4914209a";
const EXISTING_SOURCE_ID = "0x45cafa1ecafdaa1a64d69820d57902ed2d3624b0d10d73ae0c7020c8220393d6";
const binding = Object.freeze({ chainId: 4663, owner: R.owner, gateway: R.gateway, poolId: PONS_POOL, inputWei: "10000000000000" });
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
class PilotError extends Error {}
const fail = message => { throw new PilotError(message); };
const safeMessage = error => error instanceof PilotError ? error.message : executionMessage(error);
const execFileAsync = promisify(execFile);

export function validateCycleStatus(name, status, manifest) {
  const expectedControllers = name === "model" ? [DEPLOYER, CANISTERS.coordinator] : [DEPLOYER];
  const expectedHash = name === "model" ? manifest.model_wasm_sha256 : manifest.coordinator_wasm_sha256;
  const controllers = status.settings?.controllers;
  if (status.id !== CANISTERS[name] || status.status !== "Running" || status.module_hash !== "0x" + expectedHash ||
      !Array.isArray(controllers) || JSON.stringify([...controllers].sort()) !== JSON.stringify(expectedControllers.sort()) ||
      !/^[\d_]+$/.test(status.cycles ?? "") || !/^[\d_]+$/.test(status.reserved_cycles ?? ""))
    fail("ICP status, module or controller binding differs from the approved deployment.");
  return { id: status.id, moduleHash: status.module_hash, controllers,
    cycles: BigInt(status.cycles.replaceAll("_", "")).toString(),
    reservedCycles: BigInt(status.reserved_cycles.replaceAll("_", "")).toString() };
}
export function cycleDecrease(before, after) {
  const balance = snapshot => Object.values(snapshot.canisters).reduce((sum, status) => sum + BigInt(status.cycles) + BigInt(status.reservedCycles), 0n);
  return (balance(before) - balance(after)).toString();
}
async function cycleSnapshot() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "build/artifact-manifest.json"), "utf8"));
  for (const [field, file] of [["coordinator_wasm_sha256", "build/coordinator.wasm"],
    ["model_wasm_sha256", "vendor/llama_cpp_canister/build/llama_cpp.wasm"]])
    if (digest(fs.readFileSync(path.join(root, file))) !== manifest[field]) fail("Local canister artifact differs from the deployment manifest.");
  const mappings = JSON.parse(fs.readFileSync(path.join(root, ".icp/data/mappings/production.ids.json"), "utf8"));
  if (mappings.model !== CANISTERS.model || mappings.coordinator !== CANISTERS.coordinator || process.env.ICP_COORDINATOR !== CANISTERS.coordinator)
    fail("ICP production canister mapping differs from the approved pilot.");
  const canisters = {};
  // Sequential status calls avoid the CLI identity/settings lock. These are
  // management status reads, never inference calls or model generation.
  for (const name of ["coordinator", "model"]) {
    const { stdout } = await execFileAsync("/Users/abhijith/.cargo/bin/icp", ["canister", "status", name,
      "-e", "production", "--identity", "gh0st-deployer", "--json"], { cwd: root, timeout: 30_000, maxBuffer: 1024 * 1024 });
    canisters[name] = validateCycleStatus(name, JSON.parse(stdout), manifest);
  }
  return { at: new Date().toISOString(), canisters };
}

function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("Pilot state must be a private regular file owned by this user.");
}
function read(file) { privateFile(file); return JSON.parse(fs.readFileSync(file, "utf8")); }
export function saveCheckpoint(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) privateFile(file);
  const temporary = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, json(state) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
export function loadCheckpoint(file) {
  if (!fs.existsSync(file)) return { schema: "gh0st-rh-pilot-v1", binding, createdAt: new Date().toISOString(), registrationPlans: [] };
  const state = read(file);
  if (state.schema !== "gh0st-rh-pilot-v1" || json(state.binding) !== json(binding) || !Array.isArray(state.registrationPlans))
    fail("This checkpoint belongs to another pilot. Preserve it for review.");
  return state;
}
export function copyExactFile(source, destination) {
  privateFile(source);
  const bytes = fs.readFileSync(source), expected = digest(bytes);
  if (fs.existsSync(destination)) {
    privateFile(destination);
    if (digest(fs.readFileSync(destination)) !== expected) fail("The successor copy differs from the preserved original.");
  } else {
    const fd = fs.openSync(destination, "wx", 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  return expected;
}
export function bootstrapSuccessorCheckpoint() {
  if (fs.existsSync(checkpointPath)) return loadCheckpoint(checkpointPath);
  fs.mkdirSync(mainnet, { recursive: true, mode: 0o700 });
  const originalPath = path.join(root, "build/mainnet/rh-pilot.json");
  privateFile(originalPath);
  const originalBytes = fs.readFileSync(originalPath), original = JSON.parse(originalBytes);
  if (original.binding?.gateway !== "0x70325205B97393Aac0a8E3FcA6ccD5C744321523" || original.binding?.owner !== R.owner ||
      original.binding?.poolId !== PONS_POOL || original.source?.id !== EXISTING_SOURCE_ID || original.source?.txHash !== EXISTING_SWAP_TX ||
      original.source?.logIndex !== 47 || !original.swap || path.dirname(original.swap.path) !== path.join(root, "build/mainnet"))
    fail("The preserved pilot does not identify the exact confirmed swap required for recovery.");
  privateFile(original.swap.path);
  if (digest(fs.readFileSync(original.swap.path)) !== original.swap.sha256) fail("The original swap plan changed.");
  const actions = validateSwapPlan(read(original.swap.path));
  const journalPath = original.swap.path + ".signed-journal.json", journal = read(journalPath);
  const entry = journal.actions?.[0];
  if (journal.schema !== "gh0st-rh-signed-v1" || journal.planHash !== original.swap.sha256 || journal.owner !== R.owner ||
      journal.chainId !== 4663 || journal.actions.length !== 1 || entry.id !== 0 || entry.status !== "confirmed" ||
      entry.hash !== EXISTING_SWAP_TX || entry.receipt?.status !== 1 || entry.receipt?.transactionHash !== EXISTING_SWAP_TX ||
      entry.receipt?.blockHash !== original.source.blockHash || original.swapResult?.hashes?.[0] !== EXISTING_SWAP_TX)
    fail("The original swap signed journal or receipt is not the confirmed recovery source.");
  const signed = validateSigned(actions[0], entry.rawSignedTransaction, R.owner);
  if (signed.hash !== EXISTING_SWAP_TX || signed.nonce !== entry.nonce || entry.unsignedHash !== actions[0].unsignedHash)
    fail("The original swap signature changed.");
  const destination = path.join(mainnet, path.basename(original.swap.path));
  copyExactFile(original.swap.path, destination); copyExactFile(journalPath, destination + ".signed-journal.json");
  if (digest(fs.readFileSync(originalPath)) !== digest(originalBytes)) fail("Original checkpoint changed during recovery preparation.");
  const swap = { path: destination, sha256: original.swap.sha256 };
  const state = { schema: "gh0st-rh-pilot-v1", binding, createdAt: new Date().toISOString(),
    registrationPlans: [], registrationDone: false, reusedSwap: true, swap,
    swapResult: { ...original.swapResult, plan: swap }, source: original.source,
    priorAttempt: { checkpoint: originalPath, checkpointSha256: digest(originalBytes), gateway: original.binding.gateway,
      cyclesBefore: original.cyclesBefore }, stage: "successor_deployment_pending" };
  saveCheckpoint(checkpointPath, state); return state;
}

export async function validateSuccessorDeployment(plan) {
  if (plan.operation !== "deploy" || plan.owner !== R.owner || plan.icpSigner.toLowerCase() !== R.signer.toLowerCase() ||
      plan.modelId !== R.modelId || plan.artifactHash !== R.artifactHash ||
      plan.deployment?.predictedGateway.toLowerCase() !== R.gateway.toLowerCase()) fail("Successor deployment binding is invalid.");
  const actions = validatePlan(plan), action = actions[0];
  const artifact = JSON.parse(fs.readFileSync(path.join(root, "build/gateway.json"), "utf8"));
  const expected = await new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object)
    .getDeployTransaction(R.owner, R.signer, R.modelId, R.artifactHash);
  if (actions.length !== 1 || action.nonce !== 6277 || action.transaction.to || action.transaction.data !== expected.data ||
      BigInt(action.transaction.gas) > 5_000_000n || BigInt(action.transaction.maxFeePerGas) > 50_000_000n)
    fail("Successor creation code, nonce or fee caps differ from the approved deployment.");
  return actions;
}
export function successorConfigMatches(config, status) {
  return config.gateway?.toLowerCase() === R.gateway.toLowerCase() && config.artifact_hash === R.artifactHash &&
    config.model_id === R.modelId && config.model_canister?.toText() === CANISTERS.model &&
    config.model_wasm_hash === "0x964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5" &&
    status?.canisters?.coordinator?.moduleHash === FIXED_COORDINATOR_HASH;
}
function cleanStaleLock(file) {
  if (!fs.existsSync(file)) return;
  privateFile(file);
  const pid = Number(fs.readFileSync(file, "utf8").trim());
  if (!Number.isSafeInteger(pid) || pid < 1) fail("An unrecognized pilot lock requires review.");
  try { process.kill(pid, 0); } catch (error) {
    if (error.code === "ESRCH") { fs.unlinkSync(file); return; }
  }
  fail("Another pilot or worker session is still active.");
}
function acquireLock(file) {
  cleanStaleLock(file);
  const fd = fs.openSync(file, "wx", 0o600); fs.writeFileSync(fd, String(process.pid)); fs.fsyncSync(fd);
  return () => { fs.closeSync(fd); fs.unlinkSync(file); };
}
function newPlanPath(kind) { return path.join(mainnet, `${kind}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`); }
function refFor(file) { privateFile(file); return { path: file, sha256: digest(fs.readFileSync(file)) }; }
function planFor(ref) {
  if (!ref || typeof ref.path !== "string" || path.dirname(path.resolve(ref.path)) !== mainnet || !/^[a-f0-9]{64}$/.test(ref.sha256))
    fail("Pilot plan reference is invalid.");
  privateFile(ref.path);
  const bytes = fs.readFileSync(ref.path);
  if (digest(bytes) !== ref.sha256) fail("A saved pilot plan changed. Preserve its journal and stop.");
  return JSON.parse(bytes);
}
const signedPath = ref => ref.path + ".signed-journal.json";
const hasSigned = ref => fs.existsSync(signedPath(ref));
function writePlan(plan, kind) {
  const file = newPlanPath(kind); fs.writeFileSync(file, json(plan) + "\n", { flag: "wx", mode: 0o600 }); return refFor(file);
}
function assertCallback(plan, source, item) {
  if (plan.operation !== "callback" || getAddress(plan.owner) !== R.owner ||
      plan.gateway.toLowerCase() !== R.gateway.toLowerCase() || plan.icpSigner.toLowerCase() !== R.signer.toLowerCase() ||
      plan.modelId !== R.modelId || plan.artifactHash !== R.artifactHash || plan.callback.sourceId !== source.id ||
      !item.result || plan.callback.answer !== item.result.answer || plan.callback.answerHash !== keccak256(toUtf8Bytes(item.result.answer)))
    fail("Callback plan differs from the exact signed ICP thought.");
  const artifact = JSON.parse(fs.readFileSync(path.join(root, "build/gateway.json"), "utf8"));
  const iface = new Interface(artifact.abi);
  const data = iface.encodeFunctionData("fulfillSwapInference", [{ manager: source.source.manager, poolId: source.source.pool_id,
    transactionHash: source.txHash, logIndex: source.logIndex }, item.result.result, item.result.answer, item.result.signature]);
  const actions = validatePlan(plan);
  if (actions.length !== 1 || actions[0].transaction.data !== data || BigInt(actions[0].transaction.gas) > 5_000_000n ||
      BigInt(actions[0].transaction.maxFeePerGas) > 50_000_000n) fail("Callback calldata or fee limits differ from this pilot.");
  return actions;
}

/** Durable stage order; operations own chain checks and never receive a password. */
export async function runPilotFlow({ state, save, ops }) {
  let worker;
  const checkpoint = stage => { state.stage = stage; delete state.lastError; save(state); };
  try {
    if (state.completedAt) { await ops.verifyCompleted(state); return state; }
    if (!state.successorReady && ops.deploySuccessor) {
      checkpoint("successor_deployment"); await ops.deploySuccessor(state); state.successorReady = true; save(state);
    }
    if (!state.registrationDone) {
      checkpoint("registration"); await ops.register(state); state.registrationDone = true; save(state);
    }
    checkpoint("swap");
    if (state.swapResult && !ops.hasSigned(state.swap)) fail("The signed swap journal is missing; no new swap will be created.");
    if (!state.swap || !ops.hasSigned(state.swap)) {
      state.swap = await ops.prepareSwap(state.swap); save(state);
    }
    state.swapResult = await ops.execute(state.swap, "swap"); save(state);
    const source = await ops.source(state.swapResult, state.source);
    state.source = source; checkpoint("inference");
    worker = await ops.startWorker(source);
    const item = await ops.waitWorker("signed", source);
    if (!item.delivery?.confirmed) {
      checkpoint("callback");
      if (!state.callback || !ops.hasSigned(state.callback)) {
        state.callback = await ops.prepareCallback(state.callback, source, item); save(state);
      }
      state.callbackResult = await ops.execute(state.callback, "callback", source, item); save(state);
    }
    checkpoint("delivery");
    const delivered = await ops.waitWorker("delivered", source);
    await ops.stopWorker(worker); worker = null;
    state.summary = await ops.summary(state, delivered);
    state.completedAt = new Date().toISOString(); checkpoint("complete");
    return state;
  } catch (error) {
    state.lastError = { stage: state.stage, at: new Date().toISOString(), message: safeMessage(error) }; save(state);
    throw error;
  } finally { if (worker) await ops.stopWorker(worker); }
}

function workerEnvironment(source, env = process.env) {
  const result = { ...env, RH_GATEWAY: R.gateway, RH_CHAIN_ID: "4663", START_BLOCK: String(source.blockNumber),
    WATCH_SWAPS: "1", TARGET_SWAP_TX_HASH: source.txHash, TARGET_SWAP_LOG_INDEX: String(source.logIndex),
    JOURNAL: workerJournal, POLL_MS: "1000", X_ENABLED: "0", RH_RELAYER_PRIVATE_KEY: "", ONCE: "0", X_USER_ACCESS_TOKEN: "" };
  return result;
}
export { workerEnvironment };

export function redactWorkerLine(line, env = process.env) {
  let text = String(line);
  for (const [name, value] of Object.entries(env))
    if (value && value.length >= 8 && /(?:RPC|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)/.test(name)) text = text.split(value).join("[private]");
  return text.replace(/https?:\/\/[^\s"'<>)]*/g, "[endpoint]").replace(/\/v2\/[^\s"'?]+/g, "/v2/[redacted]");
}

async function main() {
  const args = process.argv.slice(2); let timeoutSeconds = 900, nativeUnlock = false, deploySuccessor = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--native-unlock" && !nativeUnlock) nativeUnlock = true;
    else if (args[i] === "--deploy-successor" && !deploySuccessor) deploySuccessor = true;
    else if (args[i] === "--worker-timeout-seconds" && args[i + 1]) timeoutSeconds = Number(args[++i]);
    else fail("Use only --native-unlock, --deploy-successor and --worker-timeout-seconds 30..900.");
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 900) fail("Worker timeout must be 30..900 seconds.");
  if (!nativeUnlock && (!process.stdin.isTTY || !process.stderr.isTTY)) fail("Use the explicit --native-unlock option for a private macOS password dialog.");
  if (SWAP_POOL_ID !== PONS_POOL || !process.env.RH_RPC_URL || !process.env.ICP_COORDINATOR || !process.env.ICP_IDENTITY_FILE ||
      (!deploySuccessor && process.env.RH_GATEWAY?.toLowerCase() !== R.gateway.toLowerCase())) fail("The approved Pons route or live pilot configuration is missing.");
  fs.mkdirSync(mainnet, { recursive: true, mode: 0o700 });
  const release = acquireLock(path.join(mainnet, "rh-pilot.lock"));
  try {
  const state = bootstrapSuccessorCheckpoint(), save = value => saveCheckpoint(checkpointPath, value);
  if (!deploySuccessor && !state.successorReady) fail("The preserved swap requires --deploy-successor; no new swap is authorized.");
  if (state.coordinator && state.coordinator !== process.env.ICP_COORDINATOR) fail("The pilot coordinator changed; preserve the existing checkpoint.");
  state.coordinator = process.env.ICP_COORDINATOR;
  save(state);
  const provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
  let signer, child, logFd, workerDeadline, stopped = false;
  const getSigner = async () => {
    active();
    if (signer) return signer;
    const nativePrompt = nativeUnlock ? (await import("./native-unlock.mjs")).nativeMacPasswordPrompt : undefined;
    const prompt = nativePrompt ? () => nativePrompt({ purpose: "successor" }) : undefined;
    signer = await unlockKeystore(keystore, R.owner, prompt); active(); return signer;
  };
  const interrupt = () => { stopped = true; child?.kill("SIGTERM"); };
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  const active = () => { if (stopped) fail("Pilot interrupted. Its saved hashes will be reconciled on resume."); };
  const execute = async (ref, kind, source, item, onlySigned = false) => {
    active(); const plan = planFor(ref);
    cleanStaleLock(signedPath(ref) + ".lock");
    let actions = kind === "deploy" ? await validateSuccessorDeployment(plan) : kind === "register" ? validateRegistrationPlan(plan) : kind === "swap" ? validateSwapPlan(plan) : assertCallback(plan, source, item);
    if (onlySigned) {
      const prior = read(signedPath(ref));
      if (!Array.isArray(prior.actions) || !prior.actions.length || prior.actions.some((entry, i) => entry.id !== i)) fail("Registration signed history is malformed.");
      actions = actions.slice(0, prior.actions.length);
    }
    const journal = await executeActions({ planPath: ref.path, planHash: ref.sha256, owner: R.owner, actions, provider, getSigner,
      freshCheck: async (client, action) => { active(); const result = await checkFresh(client, action); active(); return result; } });
    active();
    return { plan: ref, receipts: journal.actions.map(entry => entry.receipt), hashes: journal.actions.map(entry => entry.hash) };
  };
  const ensureUnused = async ref => {
    if (!ref) return;
    const plan = planFor(ref), actions = validatePlan(plan), nonce = actions[0].nonce;
    const [latest, pending] = await Promise.all([provider.getTransactionCount(R.owner, "latest"), provider.getTransactionCount(R.owner, "pending")]);
    if (latest !== nonce || pending !== nonce) fail("An unsigned pilot plan's nonce was used elsewhere. Review it before creating another plan.");
  };
  const verifyDelivery = async (source, item) => {
    if (!item?.delivery?.confirmed || !item.result) fail("Confirmed delivery evidence is missing.");
    const receipt = await provider.getTransactionReceipt(item.delivery.transactionHash);
    const block = receipt && await provider.getBlock(receipt.blockNumber);
    const artifact = JSON.parse(fs.readFileSync(path.join(root, "build/gateway.json"), "utf8"));
    const verified = inspectFulfillment(receipt, block, R.gateway, new Interface(artifact.abi), source.id,
      keccak256(toUtf8Bytes(item.result.answer)), item.result.answer, (await provider.getBlockNumber()) - 12);
    if (!verified || verified.transactionHash !== item.delivery.transactionHash || verified.logIndex !== item.delivery.logIndex)
      fail("The final callback receipt no longer matches the saved thought.");
    return verified;
  };
  const ops = {
    hasSigned,
    deploySuccessor: deploySuccessor ? async value => {
      if (!value.deployment || !hasSigned(value.deployment)) {
        await ensureUnused(value.deployment); await getSigner(); active();
        const file = newPlanPath("rh-successor-deploy");
        const plan = await prepareManualRh(["deploy", "--owner", R.owner, "--icp-signer", R.signer,
          "--fee-cap-gwei", "0.05", "--out", file]);
        await validateSuccessorDeployment(plan);
        value.deployment = refFor(file); save(value);
      }
      value.deploymentResult = await execute(value.deployment, "deploy"); save(value);
      await prepareManualRh(["verify", "--owner", R.owner, "--icp-signer", R.signer, "--gateway", R.gateway,
        "--tx-hash", value.deploymentResult.hashes[0], "--out", newPlanPath("rh-successor-verified")]);
      value.stage = "waiting_for_coordinator_migration"; save(value);
      console.log("Successor gateway is confirmed. Waiting for the coordinator migration and fixed runtime restoration.");
      const agent = await HttpAgent.create({ host: process.env.ICP_HOST ?? "https://icp-api.io" });
      const coordinator = Actor.createActor(idlFactory, { agent, canisterId: CANISTERS.coordinator });
      const deadline = Date.now() + 900_000;
      while (Date.now() < deadline) {
        active();
        try {
          const config = await coordinator.get_config();
          if (config.gateway?.toLowerCase() === R.gateway.toLowerCase() && config.artifact_hash === R.artifactHash) {
            const status = await cycleSnapshot();
            const job = (await coordinator.get_job(EXISTING_SOURCE_ID))[0];
            const source = job?.source?.[0];
            if (successorConfigMatches(config, status) && job.request.id === EXISTING_SOURCE_ID &&
                job.request.tx_hash.toLowerCase() === EXISTING_SWAP_TX && Number(job.request.log_index) === 47 &&
                source?.transaction_hash.toLowerCase() === EXISTING_SWAP_TX && Number(source.log_index) === 47 &&
                source.pool_id === PONS_POOL && source.manager.toLowerCase() === R.manager &&
                !job.busy && !("Failed" in job.phase) && job.error === "") {
              value.successorReadyProof = { checkedAt: new Date().toISOString(), gateway: config.gateway,
                artifactHash: config.artifact_hash, fixedCoordinatorHash: status.canisters.coordinator.moduleHash,
                sourceId: EXISTING_SOURCE_ID, status };
              save(value); console.log("Corrected coordinator runtime and recovered original swap are verified."); return;
            }
          }
        } catch (error) { active(); }
        await delay(5000);
      }
      fail("The coordinator migration is not yet verified. Resume this same successor command; no new swap will be created.");
    } : undefined,
    register: async value => {
      console.log("Checking confirmed registration history and remaining pools.");
      for (const ref of value.registrationPlans) {
        if (hasSigned(ref)) {
          const journal = read(signedPath(ref));
          if (journal.actions.some(entry => entry.status !== "confirmed")) await execute(ref, "register", null, null, true);
        }
      }
      const file = newPlanPath("rh-register-pilot");
      const result = await prepareRegistrationContinuation({ directory: mainnet, output: file, provider });
      const ref = refFor(file); value.registrationPlans.push(ref); save(value);
      if (result.remaining) await execute(ref, "register");
    },
    prepareSwap: async () => fail("Recovery only reuses the original confirmed swap. A new swap is not authorized."),
    execute,
    source: async (result, previous) => {
      const receipt = await provider.getTransactionReceipt(result.hashes[0]);
      const canonical = receipt && await provider.getBlock(receipt.blockNumber);
      if (!receipt || receipt.status !== 1 || canonical?.hash !== receipt.blockHash) fail("The confirmed swap receipt changed.");
      const matches = receipt.logs.filter(log => log.address.toLowerCase() === R.manager && log.topics[0]?.toLowerCase() === SWAP_TOPIC && log.topics[1]?.toLowerCase() === PONS_POOL);
      if (matches.length !== 1) fail("The swap receipt must contain exactly one selected Pons Swap event.");
      const pools = loadSources(JSON.parse(fs.readFileSync(path.join(root, "swap-sources.json"), "utf8")), 4663);
      const pool = pools.find(entry => entry.pool_id === PONS_POOL);
      const source = decodeSwapReceipt(receipt, pool, matches[0].index ?? matches[0].logIndex, 4663);
      if (previous && (previous.id !== source.id || previous.blockHash !== source.blockHash)) fail("The saved swap source changed; no new inference will be queued.");
      return source;
    },
    startWorker: async source => {
      active(); cleanStaleLock(workerJournal + ".lock");
      if (!state.cyclesBefore) { state.cyclesBefore = await cycleSnapshot(); save(state); }
      active();
      console.log("Generating the ICP thought for the confirmed Pons swap. X posting is disabled.");
      const logPath = path.join(mainnet, "rh-pilot-worker.log");
      if (fs.existsSync(logPath)) privateFile(logPath);
      logFd = fs.openSync(logPath, "a", 0o600);
      child = spawn(process.execPath, ["worker/main.mjs"], {
        cwd: root, env: workerEnvironment(source), stdio: ["ignore", "pipe", "pipe"],
      });
      for (const stream of [child.stdout, child.stderr]) {
        let pending = "";
        stream.setEncoding("utf8");
        stream.on("data", chunk => {
          pending += chunk;
          const lines = pending.split("\n"); pending = lines.pop();
          for (const line of lines) if (logFd !== undefined) fs.writeSync(logFd, redactWorkerLine(line) + "\n");
          if (pending.length > 64 * 1024) pending = "[oversized worker diagnostic omitted]";
        });
        stream.on("end", () => { if (pending && logFd !== undefined) fs.writeSync(logFd, redactWorkerLine(pending) + "\n"); });
      }
      child.on("error", () => { stopped = true; });
      workerDeadline = Date.now() + timeoutSeconds * 1000;
      return child;
    },
    waitWorker: async (wanted, source) => {
      let lastPhase;
      while (Date.now() < workerDeadline) {
        active();
        if (child.exitCode !== null || child.signalCode !== null) fail("The inference worker stopped. Preserve its journal and log for review.");
        if (fs.existsSync(workerJournal)) {
          const journal = read(workerJournal), b = journal.binding;
          if (b?.chainId !== 4663 || b.gateway !== R.gateway.toLowerCase() || b.canisterId !== process.env.ICP_COORDINATOR ||
              b.swapTarget?.transactionHash !== source.txHash || b.swapTarget.logIndex !== source.logIndex ||
              !Array.isArray(journal.requests) || journal.requests.some(item => item.id !== source.id)) fail("Worker journal belongs to another swap.");
          const item = journal.requests.find(entry => entry.id === source.id);
          if (item) {
            if (item.rawTransaction || ["failed", "callback_reverted", "expired_or_cancelled"].includes(item.state)) fail("The single inference job failed or has an unexpected transaction. No replacement job will be created.");
            if (item.phase && item.phase !== lastPhase) { console.log(`ICP generation: ${item.phase}`); lastPhase = item.phase; }
            if (wanted === "signed" && (item.state === "signed" && item.result || item.delivery?.confirmed)) return item;
            if (wanted === "delivered" && item.state === "fulfilled" && item.delivery?.confirmed && item.memoryAcknowledged) return item;
          }
        }
        await delay(1000);
      }
      fail("The bounded worker wait ended. Resume this same command to reconcile the same swap and job.");
    },
    prepareCallback: async (previous, source, item) => {
      await ensureUnused(previous); await getSigner(); active();
      const file = newPlanPath("rh-pilot-callback");
      const plan = await prepareManualRh(["callback", "--owner", R.owner, "--icp-signer", R.signer, "--gateway", R.gateway,
        "--journal", workerJournal, "--source-id", source.id, "--fee-cap-gwei", "0.05", "--out", file]);
      assertCallback(plan, source, item); return refFor(file);
    },
    stopWorker: async worker => {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGTERM");
        await Promise.race([new Promise(resolve => worker.once("exit", resolve)), delay(3000)]);
        if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
      }
      if (logFd !== undefined) { fs.closeSync(logFd); logFd = undefined; }
    },
    summary: async (value, item) => {
      if (item.delivery.answer !== item.result.answer || item.delivery.answerHash !== keccak256(toUtf8Bytes(item.result.answer))) fail("Confirmed delivery differs from the generated thought.");
      const delivery = await verifyDelivery(value.source, item);
      value.cyclesAfter = await cycleSnapshot(); save(value);
      const receipts = value.registrationPlans.flatMap(ref => hasSigned(ref) ? read(signedPath(ref)).actions.map(entry => entry.receipt) : []);
      const total = [...receipts, ...(value.deploymentResult?.receipts ?? []), ...value.swapResult.receipts]
        .reduce((sum, receipt) => sum + BigInt(receipt.feeWei), 0n) + BigInt(delivery.feeWei);
      return { sourceId: value.source.id, swapTransaction: value.source.txHash, swapLogIndex: value.source.logIndex,
        callbackTransaction: item.delivery.transactionHash, exactThought: item.delivery.answer,
        memoryAcknowledged: true, modelCycles: item.modelCycles, rhFeesThisPilotWei: total.toString(),
        rhFeesThisPilotEth: formatEther(total), icpObservedCycleDecrease: cycleDecrease(value.cyclesBefore, value.cyclesAfter),
        icpMeasurementIncludesIdleAndStatus: true, reusedOriginalSwap: true, xPosted: false };
    },
    verifyCompleted: async value => {
      if (!value.swap || !hasSigned(value.swap) || (value.callback && !hasSigned(value.callback))) fail("Completed pilot journals need review; no replacement transaction will be created.");
      if (value.deployment) await execute(value.deployment, "deploy");
      await execute(value.swap, "swap");
      const item = read(workerJournal).requests.find(entry => entry.id === value.source.id);
      if (value.callback) await execute(value.callback, "callback", value.source, item);
      if (!item?.memoryAcknowledged || !item.delivery?.confirmed) fail("Completed pilot delivery evidence is incomplete.");
      await verifyDelivery(value.source, item);
    },
  };
  try {
    await assertRhChain(provider); active();
    const final = await runPilotFlow({ state, save, ops });
    console.log(json(final.summary));
    console.log("Pilot complete. The exact thought is confirmed on RH; X posting remains disabled.");
  } finally {
    signer = undefined; provider.destroy(); process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  }
  } finally { release(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error(safeMessage(error)); process.exitCode = 1; });
