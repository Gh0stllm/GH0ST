import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Interface, Transaction, getAddress, keccak256, toUtf8Bytes, verifyTypedData } from "ethers";
import { resultTypes } from "./protocol.mjs";
import { BUY_POOL } from "./buy-queue.mjs";
import { decodeSwapReceipt, swapSourceId } from "./swaps.mjs";

export const LOCAL_RELAYER_POLICY = Object.freeze({
  chainId: 4663n,
  // Conditional successor from owner nonce 6324; verify nonce and receipt before activation.
  gateway: "0x0a99a5f180AB7990877DF73f63686958298330ce",
  mainWallet: "0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6",
  icpSigner: "0x8156899f88e9e45163e3770145a473923ace2ff1",
  modelId: "0x169670d418d7032d6b7429b6b8d27e6cb6d755be6fce5d36e9f7c9bd74471005",
  artifactHash: "0x65d045ec2ab262372834065fb7d59453e7047ecac2a346d55d5eb14f4b123b53",
  maxGas: 500_000n,
  maxFeePerGas: 50_000_000n,
});
const P = LOCAL_RELAYER_POLICY;
const iface = new Interface(["function fulfillSwapInference((address manager,bytes32 poolId,bytes32 transactionHash,uint256 logIndex) source,(bytes32 requestId,bytes32 promptHash,bytes32 modelId,bytes32 artifactHash,bytes32 answerHash,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles) result,string answer,bytes signature)"]);
const readInterface = new Interface(["function requests(bytes32) view returns (address requester,uint32 maxTokens,uint64 deadline,uint8 status,bytes32 promptHash,bytes32 answerHash)"]);
const HASH = /^0x[0-9a-f]{64}$/i;
const fields = new Set(["from", "to", "data", "value", "chainId", "type", "nonce", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]);
class RelayerError extends Error {}
const stop = message => { throw new RelayerError(message); };
const same = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
let installed = null, installing = false, admissionCheck = null;

function uint(value, label) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) stop(`Invalid relayer ${label}`);
  if (!["bigint", "number", "string"].includes(typeof value) ||
      (typeof value === "string" && !/^(?:0|[1-9]\d*|0x[0-9a-f]+)$/i.test(value))) stop(`Invalid relayer ${label}`);
  const n = BigInt(value); if (n < 0n) stop(`Invalid relayer ${label}`); return n;
}
function hash(value, label) {
  if (!HASH.test(value ?? "") || /^0x0{64}$/.test(value)) stop(`Invalid relayer ${label}`);
  return value.toLowerCase();
}
function dateAt(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 253_402_300_799_999) stop("Invalid relayer clock");
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function validateTransaction(input, address, requireNonce) {
  if (!input || typeof input !== "object" || Object.keys(input).some(key => !fields.has(key))) stop("Unexpected relayer transaction field");
  if (!same(input.to, P.gateway) || (input.from !== undefined && !same(input.from, address)) ||
      uint(input.chainId, "chain") !== P.chainId || uint(input.type, "type") !== 2n ||
      uint(input.value ?? 0n, "value") !== 0n) stop("Relayer permits only zero-value chain4663 callbacks to the approved gateway");
  const gasLimit = uint(input.gasLimit, "gas limit"), maxFeePerGas = uint(input.maxFeePerGas, "fee"),
    maxPriorityFeePerGas = uint(input.maxPriorityFeePerGas, "priority fee");
  if (gasLimit === 0n || gasLimit > P.maxGas || maxFeePerGas === 0n || maxFeePerGas > P.maxFeePerGas ||
      maxPriorityFeePerGas > maxFeePerGas) stop("Relayer gas or fee cap exceeded");
  if (typeof input.data !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(input.data) || input.data.length > 2 + 2 * (8192 + 1024))
    stop("Invalid relayer callback calldata");
  let decoded;
  try { decoded = iface.parseTransaction({ data: input.data }); } catch { stop("Relayer only signs fulfillSwapInference"); }
  if (!decoded || decoded.name !== "fulfillSwapInference") stop("Relayer only signs fulfillSwapInference");
  const { source, result, answer, signature } = decoded.args;
  if (process.env.GH0ST_SERVER_LEGACY_ONLY === "1" && (answer.length < 30 || answer.length > 180))
    stop("Server migration preserves the deployed 30-180 character thought policy");
  if (!same(source.manager, BUY_POOL.manager) || !same(source.poolId, BUY_POOL.pool_id) || source.logIndex > BigInt(Number.MAX_SAFE_INTEGER))
    stop("Relayer callback is not for the selected Pons pool");
  const normalizedSource = { manager: source.manager.toLowerCase(), pool_id: source.poolId.toLowerCase(),
    transaction_hash: hash(source.transactionHash, "source transaction"), log_index: source.logIndex };
  const sourceId = swapSourceId(Number(P.chainId), normalizedSource);
  if (!same(result.requestId, sourceId) || !same(result.modelId, P.modelId) || !same(result.artifactHash, P.artifactHash) ||
      !same(result.answerHash, keccak256(toUtf8Bytes(answer))) || /^0x0{64}$/.test(result.promptHash) ||
      result.outputTokens === 0n || result.outputTokens > 128n ||
      answer.length < 1 || answer.length > 8192 || answer.trim() !== answer || !/^[\x20-\x7e]+$/.test(answer))
    stop("Relayer result differs from the source, model, artifact or exact thought");
  if (!same(input.data, iface.encodeFunctionData("fulfillSwapInference", [source, result, answer, signature])))
    stop("Relayer callback calldata is not canonical");
  let recovered;
  try { recovered = verifyTypedData({ name: "GH0ST ICP Inference", version: "1", chainId: P.chainId,
    verifyingContract: P.gateway }, resultTypes, result, signature); } catch { stop("Invalid ICP result signature"); }
  if (!same(recovered, P.icpSigner)) stop("Result was not signed by the pinned ICP signer");
  let nonce;
  if (input.nonce !== undefined) {
    const n = uint(input.nonce, "nonce"); if (n > BigInt(Number.MAX_SAFE_INTEGER)) stop("Invalid relayer nonce"); nonce = Number(n);
  } else if (requireNonce) stop("Relayer signing requires the already populated nonce");
  return { transaction: { to: getAddress(P.gateway), data: input.data.toLowerCase(), value: 0n, chainId: P.chainId,
    type: 2, gasLimit, maxFeePerGas, maxPriorityFeePerGas, ...(nonce === undefined ? {} : { nonce }) },
    source: normalizedSource, sourceId, maximumFeeWei: gasLimit * maxFeePerGas };
}

async function checkChainAndSource(provider, checked, address) {
  const [chain, nonce, balance, receipt, head, requestState] = await Promise.all([
    provider.send("eth_chainId", []), provider.getTransactionCount(address, "pending"), provider.getBalance(address),
    provider.getTransactionReceipt(checked.source.transaction_hash), provider.getBlockNumber(),
    provider.call({ to: P.gateway, data: readInterface.encodeFunctionData("requests", [checked.sourceId]) }),
  ]);
  if (BigInt(chain) !== P.chainId) stop("Relayer RPC returned a different chain");
  if (!Number.isSafeInteger(nonce) || nonce < 0 || (checked.transaction.nonce !== undefined && checked.transaction.nonce !== nonce))
    stop("Relayer nonce changed; the existing signed intent requires reconciliation");
  if (BigInt(balance) < checked.maximumFeeWei) stop("Dedicated relayer balance is below the maximum callback fee");
  if (Number(readInterface.decodeFunctionResult("requests", requestState).status) !== 0)
    stop("The Pons source already has an on-chain result or conflicting state");
  if (!Number.isSafeInteger(head) || head < 12 || !receipt || receipt.blockNumber > head - 12) stop("Pons buy lacks twelve confirmation descendants");
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || !same(block.hash, receipt.blockHash)) stop("Pons buy receipt is not canonical");
  const event = decodeSwapReceipt(receipt, BUY_POOL, Number(checked.source.log_index), Number(P.chainId));
  if (event.id !== checked.sourceId || BigInt(event.context.amount0) >= 0n || BigInt(event.context.amount1) <= 0n)
    stop("Relayer only signs thoughts for canonical Pons buys");
  return { ...checked.transaction, nonce };
}

function regularPrivate(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) stop("Relayer ledger must be a private owned regular file");
}
function savePrivate(file, value) {
  if (fs.existsSync(file)) regularPrivate(file);
  const tmp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  const fd = fs.openSync(tmp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  const directory = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
function validateLedger(ledger, address, dailyBudgetWei) {
  if (ledger.schema !== "gh0st-relayer-fees-v1" || ledger.address !== address || ledger.gateway !== P.gateway ||
      ledger.chainId !== Number(P.chainId) || ledger.dailyBudgetWei !== (dailyBudgetWei?.toString() ?? null) ||
      !Array.isArray(ledger.reservations) || ledger.reservations.length > 10000) stop("Relayer fee ledger binding differs");
  const nonces = new Set(), sources = new Set(), hashes = new Set();
  for (const entry of ledger.reservations) {
    hash(entry.unsignedHash, "reserved hash"); hash(entry.sourceId, "reserved source");
    if (!Number.isSafeInteger(entry.nonce) || entry.nonce < 0 || nonces.has(entry.nonce) || sources.has(entry.sourceId) || hashes.has(entry.unsignedHash) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.reservedDay) || !["reserved", "signed", "confirmed"].includes(entry.status) ||
        uint(entry.maximumFeeWei, "reserved maximum") > P.maxGas * P.maxFeePerGas || uint(entry.maximumFeeWei, "reserved maximum") === 0n)
      stop("Relayer fee ledger contains a changed or duplicate reservation");
    if (entry.transactionHash !== undefined) hash(entry.transactionHash, "signed hash");
    if (entry.status === "confirmed" && (!/^\d{4}-\d{2}-\d{2}$/.test(entry.confirmedDay ?? "") ||
        uint(entry.actualFeeWei, "confirmed fee") > BigInt(entry.maximumFeeWei))) stop("Relayer confirmed fee record is invalid");
    nonces.add(entry.nonce); sources.add(entry.sourceId); hashes.add(entry.unsignedHash);
  }
}

async function reconcileFees(provider, ledger, today) {
  for (const entry of ledger.reservations) {
    if (entry.reservedDay > today || entry.confirmedDay > today) stop("Relayer clock moved behind the fee ledger");
    if (entry.status !== "confirmed" && entry.transactionHash) {
      const receipt = await provider.getTransactionReceipt(entry.transactionHash);
      if (receipt && (await provider.getBlockNumber()) - receipt.blockNumber >= 12) {
        const block = await provider.getBlock(receipt.blockNumber);
        if (!same(receipt.hash ?? receipt.transactionHash, entry.transactionHash) || !block ||
            !same(block.hash, receipt.blockHash) || ![0, 1].includes(Number(receipt.status))) stop("Relayer fee receipt is not canonical");
        const fee = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice ?? receipt.gasPrice);
        if (fee < 0n || fee > BigInt(entry.maximumFeeWei)) stop("Relayer receipt exceeded its reserved fee");
        entry.status = "confirmed"; entry.actualFeeWei = fee.toString(); entry.confirmedDay = dateAt(Number(block.timestamp) * 1000);
      }
    }
  }
}
const usedFees = (ledger, today) => ledger.reservations.reduce((sum, entry) => sum + (entry.status !== "confirmed" ?
  BigInt(entry.maximumFeeWei) : entry.confirmedDay === today ? BigInt(entry.actualFeeWei) : 0n), 0n);

/** The underlying wallet stays in this module's closure, never in env or globals. */
export async function installInjectedRelayer({ signer, provider, expectedAddress, feeLedgerPath = null,
  dailyBudgetWei = null, now = Date.now } = {}) {
  if (installed || installing) stop("A local relayer is already installed in this process");
  installing = true;
  try {
    const address = getAddress(expectedAddress);
    if ([P.mainWallet, P.icpSigner, P.gateway].some(value => same(address, value)) || BigInt(address) === 0n)
      stop("A separate dedicated relayer wallet is required");
    if (!signer || !same(signer.address ?? await signer.getAddress(), address) || typeof signer.signTransaction !== "function")
      stop("Unlocked wallet does not match the dedicated relayer address");
    if (!provider || BigInt(await provider.send("eth_chainId", [])) !== P.chainId) stop("Relayer RPC returned a different chain");
    dailyBudgetWei = dailyBudgetWei === null ? null : uint(dailyBudgetWei, "daily budget");
    if (dailyBudgetWei === 0n || (dailyBudgetWei !== null && !feeLedgerPath)) stop("A positive daily budget requires a durable fee ledger");
    if (feeLedgerPath) {
      feeLedgerPath = path.resolve(feeLedgerPath);
      fs.mkdirSync(path.dirname(feeLedgerPath), { recursive: true, mode: 0o700 });
    }
    let memoryLedger = { schema: "gh0st-relayer-fees-v1", address, gateway: P.gateway, chainId: Number(P.chainId),
      dailyBudgetWei: dailyBudgetWei?.toString() ?? null, reservations: [] };
    let pending = Promise.resolve();
    const exclusive = operation => { const next = pending.then(operation); pending = next.catch(() => {}); return next; };
    const sign = input => exclusive(async () => {
      const checked = validateTransaction(input, address, true);
      const transaction = await checkChainAndSource(provider, checked, address);
      const unsignedHash = Transaction.from(transaction).unsignedHash, today = dateAt(now());
      let lockFd;
      const lock = feeLedgerPath && feeLedgerPath + ".lock";
      if (lock) {
        try { lockFd = fs.openSync(lock, "wx", 0o600); fs.writeFileSync(lockFd, String(process.pid)); }
        catch {
          if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(lock); }
          stop("Another relayer fee-ledger operation is active; reconcile its lock");
        }
      }
      try {
        let ledger = structuredClone(memoryLedger);
        if (feeLedgerPath && fs.existsSync(feeLedgerPath)) { regularPrivate(feeLedgerPath); ledger = JSON.parse(fs.readFileSync(feeLedgerPath, "utf8")); }
        validateLedger(ledger, address, dailyBudgetWei);
        await reconcileFees(provider, ledger, today);
        let entry = ledger.reservations.find(value => value.unsignedHash === unsignedHash);
        if (ledger.reservations.some(value => (value.nonce === transaction.nonce || value.sourceId === checked.sourceId) && value !== entry))
          stop("Relayer source or nonce already has a different reserved transaction");
        const used = usedFees(ledger, today);
        if (dailyBudgetWei !== null && used + (entry ? 0n : checked.maximumFeeWei) > dailyBudgetWei)
          stop("Relayer daily fee budget is exhausted; pending reservations remain held");
        if (!entry) {
          entry = { unsignedHash, sourceId: checked.sourceId, nonce: transaction.nonce, maximumFeeWei: checked.maximumFeeWei.toString(),
            reservedDay: today, status: "reserved" };
          ledger.reservations.push(entry);
        }
        const save = () => { if (feeLedgerPath) savePrivate(feeLedgerPath, ledger); memoryLedger = structuredClone(ledger); };
        save(); // Maximum fee reservation is durable BEFORE access to the signing operation.
        await checkChainAndSource(provider, { ...checked, transaction }, address);
        const raw = await signer.signTransaction(transaction);
        let signed;
        try { signed = Transaction.from(raw); } catch { stop("Dedicated relayer returned an invalid signed transaction"); }
        if (!same(signed.from, address) || signed.unsignedHash !== unsignedHash || !signed.signature ||
            (entry.transactionHash && entry.transactionHash !== signed.hash)) stop("Dedicated relayer changed the approved transaction");
        entry.transactionHash = signed.hash; entry.status = "signed"; save();
        return raw;
      } finally { if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(lock); } }
    });
    const safely = async operation => {
      try { return await operation(); }
      catch (error) { if (error instanceof RelayerError) throw error; throw new RelayerError("Local relayer check failed; private details withheld"); }
    };
    installed = Object.freeze({ address,
      populateTransaction: input => safely(async () => {
        const checked = validateTransaction(input, address, false);
        return checkChainAndSource(provider, checked, address);
      }),
      signTransaction: input => safely(() => sign(input)),
    });
    admissionCheck = async () => {
      const reserve = P.maxGas * P.maxFeePerGas;
      const base = { requiredWei: reserve.toString(), dailyBudgetWei: dailyBudgetWei?.toString() ?? null };
      if (dailyBudgetWei === null) return { ...base, allowed: true, reason: null, usedWei: null, availableWei: null };
      try {
        if (fs.existsSync(feeLedgerPath + ".lock")) return { ...base, allowed: false, reason: "fee_ledger_locked" };
        const today = dateAt(now());
        let ledger = structuredClone(memoryLedger);
        let before = null;
        if (fs.existsSync(feeLedgerPath)) { regularPrivate(feeLedgerPath); before = fs.readFileSync(feeLedgerPath, "utf8"); ledger = JSON.parse(before); }
        validateLedger(ledger, address, dailyBudgetWei);
        await reconcileFees(provider, ledger, today); // Work on a copy; this admission query never writes or signs.
        const after = fs.existsSync(feeLedgerPath) ? fs.readFileSync(feeLedgerPath, "utf8") : null;
        if (before !== after || fs.existsSync(feeLedgerPath + ".lock")) return { ...base, allowed: false, reason: "fee_ledger_changed" };
        const used = usedFees(ledger, today), available = dailyBudgetWei > used ? dailyBudgetWei - used : 0n;
        return { ...base, allowed: available >= reserve, reason: available >= reserve ? null : "daily_relayer_fee_budget",
          usedWei: used.toString(), availableWei: available.toString() };
      } catch { return { ...base, allowed: false, reason: "fee_ledger_unavailable_or_invalid" }; }
    };
    return installed;
  } finally { installing = false; }
}

export function getInjectedRelayer() { return installed; }
export async function checkInjectedRelayerAdmission() {
  return admissionCheck ? admissionCheck() : { allowed: false, reason: "relayer_unavailable" };
}
