import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AbiCoder, Contract, Interface, JsonRpcProvider, getAddress, keccak256 } from "ethers";
import { validatePlan } from "./manual-wallet.mjs";
import { validateSigned, waitCanonicalReceipt } from "./execute-rh.mjs";
import { assertRhChain, receiptCost } from "./manual-rh-core.mjs";
import { main as prepareManualRh } from "./manual-rh.mjs";

class PreparationError extends Error {}

const root = fileURLToPath(new URL("../", import.meta.url));
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const same = (left, right) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();
export const REGISTRATION = Object.freeze({
  owner: "0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6",
  signer: "0x8156899f88e9e45163e3770145a473923ace2ff1",
  gateway: "0xd97050e59B3d5af516Fa4061EE1A3281075c734B",
  modelId: "0x169670d418d7032d6b7429b6b8d27e6cb6d755be6fce5d36e9f7c9bd74471005",
  artifactHash: "0x24ea60626b743087a22ffb6f0c8c9e86562080a7d5e429f9ad2becce3197d840",
  manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  pools: Object.freeze([
    "0x90fbab7e58f154bff561fb7ee00f2aaa59ba66b77b0c4e1535f1b1c26a00f7d7",
    "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01",
  ]),
});
const iface = new Interface(["function setSwapPool(address manager, bytes32 poolId, bool allowed)"]);

export function validateRegistrationPlan(plan) {
  if (plan.schema !== "gh0st-manual-rh-v1" || plan.broadcast !== false || String(plan.chainId) !== "4663" ||
      plan.operation !== "register" || !same(plan.owner, REGISTRATION.owner) ||
      !same(plan.icpSigner, REGISTRATION.signer) || !same(plan.gateway, REGISTRATION.gateway) ||
      !same(plan.modelId, REGISTRATION.modelId) || !same(plan.artifactHash, REGISTRATION.artifactHash) ||
      !Array.isArray(plan.registrations))
    throw new PreparationError("Registration plan differs from the approved deployment");
  if (!plan.registrations.length) return [];
  const seen = new Set();
  const actions = validatePlan(plan);
  for (const [index, action] of actions.entries()) {
    const decoded = iface.parseTransaction({ data: action.transaction.data });
    const pool = decoded?.args.poolId.toLowerCase();
    if (!decoded || decoded.name !== "setSwapPool" || decoded.args.allowed !== true ||
        !same(decoded.args.manager, REGISTRATION.manager) || !REGISTRATION.pools.includes(pool) || seen.has(pool) ||
        !same(action.transaction.data, iface.encodeFunctionData("setSwapPool", [REGISTRATION.manager, pool, true])) ||
        !same(plan.registrations[index].manager, decoded.args.manager) ||
        !same(plan.registrations[index].poolId, pool) ||
        action.nonce !== actions[0].nonce + index ||
        BigInt(action.transaction.maxFeePerGas) > 50_000_000n || BigInt(action.transaction.gas) > 5_000_000n)
      throw new PreparationError("Registration action differs from the approved pools, nonce sequence or fee limits");
    seen.add(pool);
  }
  return actions;
}

function readFile(filename, privateFile = false) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || (privateFile && ((stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid()))))
    throw new PreparationError("Registration history must contain regular files owned by this user; signed journals must be private");
  const bytes = fs.readFileSync(filename);
  return { filename, hash: digest(bytes), value: JSON.parse(bytes) };
}

function assertUnchanged(files) {
  for (const file of files)
    if (digest(fs.readFileSync(file.filename)) !== file.hash)
      throw new PreparationError("Registration history changed during reconciliation; retry after the active session ends");
}

const historyNames = directory => fs.readdirSync(directory).filter(name =>
  /^rh-(?:register|registration).*\.json/.test(name) &&
  (name.endsWith(".signed-journal.json") || name.endsWith(".lock") || name.endsWith(".wallet-reports.json"))).sort();

function assertHistoryUnchanged(directory, names) {
  if (JSON.stringify(historyNames(directory)) !== JSON.stringify(names))
    throw new PreparationError("Registration history gained an active intent during preparation; retry after it is reconciled");
}

export async function reconcileRegistrationJournals({ directory, provider, confirmations = 12,
  validate = validateRegistrationPlan }) {
  await assertRhChain(provider);
  const names = historyNames(directory);
  if (names.some(name => name.endsWith(".lock") || name.endsWith(".wallet-reports.json")))
    throw new PreparationError("An active registration intent or wallet report requires reconciliation before a fresh plan");
  const files = [], confirmed = [], seenHashes = new Set(), seenNonces = new Set();
  for (const name of names.filter(name => name.endsWith(".signed-journal.json"))) {
    const journalFile = readFile(path.join(directory, name), true);
    const planFile = readFile(journalFile.filename.slice(0, -".signed-journal.json".length));
    files.push(...[journalFile, planFile].map(({ filename, hash }) => ({ filename, hash })));
    const journal = journalFile.value, plan = planFile.value, actions = validate(plan);
    if (journal.schema !== "gh0st-rh-signed-v1" || journal.planHash !== planFile.hash ||
        getAddress(journal.owner) !== getAddress(plan.owner) || String(journal.chainId) !== "4663" ||
        !Array.isArray(journal.actions) || !journal.actions.length)
      throw new PreparationError("Registration journal does not match its unchanged plan");
    for (const [index, entry] of journal.actions.entries()) {
      const action = actions[entry.id];
      if (!action || entry.id !== index || entry.status !== "confirmed" || Number(entry.receipt?.status) !== 1)
        throw new PreparationError("An unresolved, reverted or active signed registration requires reconciliation");
      const signed = validateSigned(action, entry.rawSignedTransaction, plan.owner);
      if (entry.hash !== signed.hash || entry.nonce !== signed.nonce || entry.unsignedHash !== action.unsignedHash ||
          seenHashes.has(signed.hash) || seenNonces.has(signed.nonce))
        throw new PreparationError("Registration signature, nonce or hash differs from the journal, or is duplicated");
      // A missing or insufficiently confirmed receipt fails immediately. This
      // read-only path never signs or rebroadcasts an old action.
      const receipt = await waitCanonicalReceipt(provider, signed, { confirmations, timeoutMs: 0, pollMs: 1 });
      const cost = receiptCost(receipt), saved = entry.receipt;
      if (Number(receipt.status) !== 1 || saved.transactionHash !== signed.hash ||
          saved.blockNumber !== receipt.blockNumber || !same(saved.blockHash, receipt.blockHash) ||
          BigInt(saved.gasUsed) !== cost.gasUsed || BigInt(saved.effectiveGasPrice) !== cost.effectiveGasPrice ||
          BigInt(saved.feeWei) !== cost.feeWei)
        throw new PreparationError("A confirmed registration receipt changed; preserve history and investigate");
      seenHashes.add(signed.hash); seenNonces.add(signed.nonce);
      confirmed.push({ journal: name, transactionHash: signed.hash, nonce: signed.nonce,
        blockNumber: receipt.blockNumber, blockHash: receipt.blockHash });
    }
  }
  const [latest, pending] = await Promise.all([
    provider.getTransactionCount(REGISTRATION.owner, "latest"),
    provider.getTransactionCount(REGISTRATION.owner, "pending"),
  ]);
  if (!Number.isSafeInteger(latest) || latest < 0 || latest !== pending ||
      [...seenNonces].some(nonce => nonce >= latest))
    throw new PreparationError("The owner has a pending or inconsistent nonce; no fresh registration plan was prepared");
  assertUnchanged(files);
  assertHistoryUnchanged(directory, names);
  return { confirmed, nextNonce: latest, files, names };
}

export async function prepareRegistrationContinuation({ directory, output, provider,
  prepare = prepareManualRh, reconcile = reconcileRegistrationJournals }) {
  const history = await reconcile({ directory, provider });
  const contract = new Contract(REGISTRATION.gateway, ["function authorizedSwapPool(bytes32) view returns (bool)"], provider);
  const remaining = [];
  for (const pool of REGISTRATION.pools) {
    const key = keccak256(AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [REGISTRATION.manager, pool]));
    if (!await contract.authorizedSwapPool(key)) remaining.push(pool);
  }
  const plan = await prepare(["register", "--owner", REGISTRATION.owner, "--icp-signer", REGISTRATION.signer,
    "--gateway", REGISTRATION.gateway, "--fee-cap-gwei", "0.05", "--out", output]);
  const actions = validateRegistrationPlan(plan);
  if (actions.length !== remaining.length || actions.some((action, index) =>
      action.nonce !== history.nextNonce + index || !same(plan.registrations[index].poolId, remaining[index])))
    throw new PreparationError("Registration state or nonce changed while preparing the remaining actions; discard the unsigned plan");
  const [latest, pending] = await Promise.all([
    provider.getTransactionCount(REGISTRATION.owner, "latest"), provider.getTransactionCount(REGISTRATION.owner, "pending"),
  ]);
  if (latest !== history.nextNonce || pending !== latest)
    throw new PreparationError("The owner nonce changed while preparing; discard the unsigned plan");
  assertUnchanged(history.files);
  assertHistoryUnchanged(directory, history.names);
  return { plan, confirmed: history.confirmed, remaining: remaining.length, nextNonce: history.nextNonce };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out" || !args[1]) throw new PreparationError("Use --out FILE");
  if (!process.env.RH_RPC_URL) throw new PreparationError("Private RH_RPC_URL is required");
  const directory = path.join(root, "build/mainnet-v2");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
  try {
    const result = await prepareRegistrationContinuation({ directory, output: path.resolve(args[1]), provider });
    console.log(JSON.stringify({ historicalConfirmedActions: result.confirmed.length, remainingPools: result.remaining,
      nextNonce: result.nextNonce, broadcast: false }));
    if (!result.remaining) {
      console.log("The approved pools are already registered. No signing is needed.");
      process.exitCode = 10;
    }
  } finally { provider.destroy(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => {
    // Never expose provider errors, endpoint parameters or signed bytes.
    console.error("Registration preparation stopped. " + (error instanceof PreparationError
      ? error.message : "A history, chain or receipt check failed; preserve the existing signed journals."));
    process.exitCode = 1;
  });
