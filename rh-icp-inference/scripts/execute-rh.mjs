import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Wallet, Transaction, JsonRpcProvider, getAddress, getCreateAddress, keccak256, formatEther } from "ethers";
import { validatePlan, checkFresh } from "./manual-wallet.mjs";
import { assertRhChain, receiptCost } from "./manual-rh-core.mjs";

const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
class ExecutionError extends Error {}
const stop = message => { throw new ExecutionError(message); };

export function executionMessage(error) {
  if (error instanceof ExecutionError) return error.message;
  const message = typeof error?.message === "string" ? error.message : "";
  // These local guard messages contain no provider response or endpoint. Keep
  // them useful to the person signing while withholding unknown RPC errors.
  if (/^Stale plan: wallet pending nonce is \d+, plan nonce is \d+\. Regenerate the plan\.$/.test(message) ||
      ["Current fees exceed this plan. Regenerate it before signing.",
       "Current gas estimate exceeds the plan. Regenerate it.",
       "Wallet balance is below the input plus maximum transaction fee",
       "Private RPC returned another chain",
       "Swap router code changed since the reviewed plan",
       "Swap quote expired. Regenerate the exact Pons small-buy plan before signing."].includes(message))
    return message;
  return "RH execution stopped because a local, plan, or RPC check failed. Preserve the signed journal; no automatic replacement will be made.";
}

function regularFile(filename, privateMode = false) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) stop("Expected a regular file, not a link");
  if (privateMode && ((stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())))
    stop("Keystore and signed journal must be owned by this user and mode 0600");
}

export function readHiddenPassword(input = process.stdin, output = process.stderr) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function")
    return Promise.reject(new ExecutionError("Password entry requires your local interactive Terminal; pipes, arguments and environment passwords are not accepted"));
  return new Promise((resolve, reject) => {
    let password = "";
    let finished = false;
    let escape = false;
    const wasRaw = input.isRaw;
    const wasFlowing = input.readableFlowing;
    output.write("Keystore password (hidden): ");
    const done = (error) => {
      if (finished) return;
      finished = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      try { input.setRawMode(Boolean(wasRaw)); } catch {}
      // A fresh terminal stream has readableFlowing === null while isPaused()
      // is false. Only preserve active flow if it was explicitly active before
      // prompting; otherwise resumed stdin can keep a completed CLI alive.
      if (wasFlowing !== true) input.pause();
      try { output.write("\n"); } catch {}
      const result = password;
      password = "";
      if (error) reject(error); else resolve(result);
    };
    const onEnd = () => done(new ExecutionError("Password entry cancelled"));
    const onError = () => done(new ExecutionError("Private terminal input failed"));
    const onSignal = () => done(new ExecutionError("Password entry cancelled"));
    const onData = chunk => {
      for (const character of chunk.toString()) {
        if (character === "\u0003" || character === "\u0004") {
          done(new ExecutionError("Password entry cancelled")); return;
        }
        if (character === "\r" || character === "\n") { if (!password.length) continue; done(); return; }
        if (character === "\u001b") { escape = true; continue; }
        if (escape) { if (/[A-Za-z~]/.test(character)) escape = false; continue; }
        if (character === "\u0015") { password = ""; continue; }
        if (character === "\u007f" || character === "\b") password = Array.from(password).slice(0, -1).join("");
        else if (character >= " " && character !== "\u001b") password += character;
        if (password.length > 4096) { done(new ExecutionError("Password entry is too long")); return; }
      }
    };
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    input.resume();
  });
}

export async function unlockKeystore(keystorePath, owner, prompt = readHiddenPassword) {
  regularFile(keystorePath, true);
  if (fs.statSync(keystorePath).size > 1024 * 1024) stop("Keystore exceeds the expected size");
  const encrypted = fs.readFileSync(keystorePath, "utf8");
  let metadata;
  try { metadata = JSON.parse(encrypted); } catch { stop("Keystore is not valid JSON"); }
  const cipher = metadata.crypto ?? metadata.Crypto;
  if (metadata.version !== 3 || !/^[0-9a-fA-F]{64}$/.test(cipher?.ciphertext ?? "") ||
      !/^(?:0x)?[0-9a-fA-F]{40}$/.test(metadata.address ?? ""))
    stop("Expected an Ethereum V3 encrypted keystore");
  if (["privateKey", "private_key", "password", "mnemonic"].some(field => Object.hasOwn(metadata, field)))
    stop("Keystore contains an unexpected plaintext secret field");
  if (getAddress("0x" + metadata.address.replace(/^0x/, "")) !== getAddress(owner))
    stop("Keystore address differs from the reviewed plan owner");
  let password = await prompt();
  let wallet;
  try { wallet = await Wallet.fromEncryptedJson(encrypted, password); }
  catch { stop("Could not unlock the keystore; no transaction was signed"); }
  finally { password = undefined; }
  if (getAddress(wallet.address) !== getAddress(owner)) stop("Unlocked signer differs from the reviewed owner");
  return wallet;
}

export function unsignedForAction(action) {
  const tx = action.transaction;
  const unsigned = Transaction.from({
    type: 2, chainId: BigInt(tx.chainId), nonce: Number(BigInt(tx.nonce)),
    to: tx.to ?? null, value: BigInt(tx.value), data: tx.data,
    gasLimit: BigInt(tx.gas), maxFeePerGas: BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
  });
  if (unsigned.unsignedHash !== action.unsignedHash) stop("Action no longer matches the reviewed unsigned hash");
  return unsigned;
}

export function validateSigned(action, raw, owner) {
  let signed;
  try { signed = Transaction.from(raw); } catch { stop("Signed transaction is invalid"); }
  if (!signed.signature || signed.type !== 2 || signed.chainId !== 4663n ||
      getAddress(signed.from) !== getAddress(owner) || signed.unsignedHash !== action.unsignedHash ||
      signed.hash !== keccak256(raw)) stop("Signed transaction differs from the exact reviewed action");
  unsignedForAction(action);
  return signed;
}

function savePrivate(filename, value) {
  if (fs.existsSync(filename)) regularFile(filename, true);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, json(value) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filename);
  const dir = fs.openSync(path.dirname(filename), "r");
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

function verifyObservedTransaction(actual, signed) {
  if (!actual || actual.hash !== signed.hash || actual.chainId !== signed.chainId ||
      getAddress(actual.from) !== getAddress(signed.from) || actual.nonce !== signed.nonce ||
      (actual.to?.toLowerCase() ?? null) !== (signed.to?.toLowerCase() ?? null) ||
      actual.data.toLowerCase() !== signed.data.toLowerCase() || actual.value !== signed.value ||
      actual.gasLimit !== signed.gasLimit || actual.maxFeePerGas !== signed.maxFeePerGas ||
      actual.maxPriorityFeePerGas !== signed.maxPriorityFeePerGas)
    stop("RPC transaction differs from the journaled signed transaction");
}

export async function waitCanonicalReceipt(provider, signed, {
  confirmations = 12, timeoutMs = 300_000, pollMs = 2_000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const receipt = await provider.getTransactionReceipt(signed.hash);
    if (receipt) {
      const block = await provider.getBlock(receipt.blockNumber);
      if (!block || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
        stop("Receipt was reorganized; reconcile the saved hash before continuing");
      const head = await provider.getBlockNumber();
      if (head - receipt.blockNumber >= confirmations) {
        const final = await provider.getTransactionReceipt(signed.hash);
        if (!final || final.blockHash !== receipt.blockHash || final.blockNumber !== receipt.blockNumber)
          stop("Receipt changed during confirmation; reconcile before continuing");
        verifyObservedTransaction(await provider.getTransaction(signed.hash), signed);
        if (!signed.to && final.contractAddress?.toLowerCase() !== getCreateAddress({ from: signed.from, nonce: signed.nonce }).toLowerCase())
          stop("Deployment receipt returned an unexpected contract address");
        return final;
      }
    }
    if (Date.now() >= deadline) stop(`Confirmation is unresolved for ${signed.hash}; keep the journal and rerun this exact plan`);
    await delay(pollMs);
  }
}

/** Only signs the supplied reviewed actions; never populates a new nonce/fee. */
export async function executeActions({ planPath, planHash, owner, actions, provider,
  getSigner, journalPath = planPath + ".signed-journal.json", freshCheck = checkFresh,
  confirmations = 12, timeoutMs = 300_000, pollMs = 2_000, log = console.log }) {
  await assertRhChain(provider);
  const unchanged = () => { if (digest(fs.readFileSync(planPath)) !== planHash) stop("Plan changed on disk; no further action will be sent"); };
  unchanged();
  const lockPath = journalPath + ".lock";
  let lock;
  try { lock = fs.openSync(lockPath, "wx", 0o600); }
  catch { stop("This plan is locked by another execution; check that process before removing a stale lock"); }
  fs.writeFileSync(lock, String(process.pid));
  const binding = { schema: "gh0st-rh-signed-v1", planHash, owner: getAddress(owner), chainId: 4663 };
  let journal = { ...binding, actions: [] };
  const save = () => savePrivate(journalPath, journal);
  try {
    if (fs.existsSync(journalPath)) {
      regularFile(journalPath, true);
      try { journal = JSON.parse(fs.readFileSync(journalPath, "utf8")); }
      catch { stop("Signed journal is invalid; preserve it for reconciliation"); }
      for (const key of Object.keys(binding))
        if (journal[key] !== binding[key]) stop("Signed journal belongs to another plan or owner");
      if (!Array.isArray(journal.actions)) stop("Signed journal action list is invalid");
      if (new Set(journal.actions.map(entry => entry.id)).size !== journal.actions.length)
        stop("Signed journal contains duplicate actions");
      if (journal.actions.some(entry => !actions.some(action => action.id === entry.id)))
        stop("Signed journal contains an unexpected action");
    }
    for (const action of actions) {
      unchanged();
      let entry = journal.actions.find(candidate => candidate.id === action.id);
      let signed;
      if (entry) {
        signed = validateSigned(action, entry.rawSignedTransaction, owner);
        if (entry.hash !== signed.hash || entry.nonce !== signed.nonce || entry.unsignedHash !== action.unsignedHash)
          stop("Journal hash/nonce differs from the exact signed action");
        const [receipt, transaction] = await Promise.all([
          provider.getTransactionReceipt(signed.hash), provider.getTransaction(signed.hash),
        ]);
        if (!receipt && !transaction) {
          const [latest, pending] = await Promise.all([
            provider.getTransactionCount(owner, "latest"), provider.getTransactionCount(owner, "pending"),
          ]);
          if (latest !== signed.nonce || pending !== signed.nonce)
            stop(`Saved transaction ${signed.hash} is not found and its nonce is consumed or pending; reconcile before continuing`);
          await freshCheck(provider, action);
          unchanged();
          // Rebroadcast only identical saved bytes, never a replacement/new nonce.
          try { await provider.broadcastTransaction(entry.rawSignedTransaction); }
          catch { entry.status = "broadcast_uncertain"; save(); }
        }
      } else {
        await freshCheck(provider, action);
        const signer = await getSigner();
        if (getAddress(await signer.getAddress()) !== getAddress(owner)) stop("Signer does not own the reviewed plan");
        // Password entry can take arbitrarily long. Recheck after unlocking.
        await freshCheck(provider, action);
        unchanged();
        const raw = await signer.signTransaction(unsignedForAction(action));
        signed = validateSigned(action, raw, owner);
        entry = { id: action.id, label: action.label, unsignedHash: action.unsignedHash,
          nonce: signed.nonce, hash: signed.hash, rawSignedTransaction: raw,
          status: "signed", signedAt: new Date().toISOString() };
        journal.actions.push(entry);
        save(); // The signed bytes and hash are durable before any broadcast.
        unchanged();
        await freshCheck(provider, action);
        try {
          const sent = await provider.broadcastTransaction(raw);
          if (sent.hash !== signed.hash) stop("RPC returned a different transaction hash");
          entry.status = "broadcast";
        } catch { entry.status = "broadcast_uncertain"; }
        save();
      }
      log(`${action.label}: ${signed.hash} — waiting for ${confirmations} descendant blocks`);
      const receipt = await waitCanonicalReceipt(provider, signed, { confirmations, timeoutMs, pollMs });
      const cost = receiptCost(receipt);
      entry.status = Number(receipt.status) === 1 ? "confirmed" : "reverted";
      entry.receipt = { transactionHash: signed.hash, blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash, contractAddress: receipt.contractAddress,
        status: Number(receipt.status), ...cost, feeEth: formatEther(cost.feeWei) };
      entry.confirmedAt = new Date().toISOString();
      save();
      log(json({ action: action.label, ...entry.receipt }));
      if (entry.status !== "confirmed") stop("The exact reviewed transaction reverted; no later action was signed");
    }
    return journal;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["--execute", "--help"].includes(arg)) result[arg.slice(2)] = true;
    else if (["--plan", "--keystore"].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      if (result[arg.slice(2)]) stop("Duplicate command-line option");
      result[arg.slice(2)] = argv[++i];
    } else stop("Use only --plan FILE --keystore FILE [--execute]; passwords are never accepted as options");
  }
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Review: node --env-file=.env.local scripts/execute-rh.mjs --plan FILE\nSign in your local Terminal: add --keystore V3_JSON_FILE --execute\nPassword is hidden and accepted only from that Terminal. Existing signed hashes are reconciled; nonces and fees are never regenerated.");
    return;
  }
  if (!args.plan) stop("--plan is required");
  const planPath = path.resolve(args.plan);
  regularFile(planPath);
  const bytes = fs.readFileSync(planPath), planHash = digest(bytes);
  let plan;
  try { plan = JSON.parse(bytes); } catch { stop("Plan is not valid JSON"); }
  const actions = validatePlan(plan);
  console.log(json({ planHash, owner: plan.owner, chainId: 4663, actions: actions.map(action => ({
    label: action.label, nonce: action.nonce, destination: action.destination,
    inputEth: action.valueEth ?? "0", maximumFeeEth: action.maxCostEth, unsignedHash: action.unsignedHash,
  })), execute: Boolean(args.execute) }));
  if (!args.execute) return;
  if (!args.keystore) stop("--keystore is required for execution");
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    stop("Execution requires your local interactive Terminal");
  if (!process.env.RH_RPC_URL) stop("Set RH_RPC_URL privately before execution");
  const provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
  let signer;
  try {
    await executeActions({ planPath, planHash, owner: plan.owner, actions, provider,
      getSigner: async () => signer ??= await unlockKeystore(path.resolve(args.keystore), plan.owner) });
  } finally { signer = undefined; provider.destroy(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(executionMessage(error));
    process.exitCode = 1;
  });
}
