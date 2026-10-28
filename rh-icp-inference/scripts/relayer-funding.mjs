import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Wallet, Transaction, JsonRpcProvider, getAddress, formatEther } from "ethers";
import { executeActions, unlockKeystore } from "./execute-rh.mjs";
import { nativeMacPasswordPrompt } from "./native-unlock.mjs";

export const FUNDING = Object.freeze({
  owner: "0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6",
  value: 50_000_000_000_000n, gas: 21_000n, maxFeePerGas: 50_000_000n, chainId: 4663n,
});
export const RELAYER_KEYSTORE = path.join(os.homedir(), ".config/gh0st/buy-relayer.json");
const root = fileURLToPath(new URL("../", import.meta.url));
const planPath = path.join(root, "build/mainnet-v2/buy-relayer-funding.json");
const ownerKeystore = path.resolve(root, "../../recovered-model/research/v4-hook-1m/experiments/multichain-gpt2/deployments/canary-signer.json");
const json = value => JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v, 2);
const same = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const fail = message => { throw new Error(message); };
function privateFile(filename) {
  const s = fs.lstatSync(filename);
  if (!s.isFile() || s.isSymbolicLink() || s.mode & 0o077 || s.uid !== process.getuid())
    fail("Expected a private regular file owned by this user");
}
export function relayerAddress(filename = RELAYER_KEYSTORE) {
  privateFile(filename);
  const metadata = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (metadata.version !== 3 || !/^[0-9a-f]{40}$/i.test(metadata.address ?? "") ||
      !/^[0-9a-f]{64}$/i.test((metadata.crypto ?? metadata.Crypto)?.ciphertext ?? "")) fail("Expected an encrypted V3 callback wallet");
  const address = getAddress("0x" + metadata.address);
  if (same(address, FUNDING.owner) || BigInt(address) === 0n) fail("The callback wallet must be separate from the main wallet");
  return address;
}
export async function createRelayerKeystore(filename = RELAYER_KEYSTORE, prompt = () => nativeMacPasswordPrompt({ purpose: "createWorker" })) {
  if (fs.existsSync(filename)) return relayerAddress(filename);
  fs.mkdirSync(path.dirname(filename), { mode: 0o700, recursive: true });
  let password = await prompt(), wallet = Wallet.createRandom();
  try {
    if (typeof password !== "string" || password.length < 12) fail("Choose a callback wallet password with at least 12 characters");
    const encrypted = await wallet.encrypt(password);
    const fd = fs.openSync(filename, "wx", 0o600);
    try { fs.writeFileSync(fd, encrypted + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return wallet.address;
  } finally { password = undefined; wallet = undefined; }
}
export function validateFundingPlan(plan, expectedRecipient) {
  const f = FUNDING;
  if (plan?.schema !== "gh0st-relayer-funding-v1" || plan.broadcast !== false ||
      !same(plan.owner, f.owner) || !same(plan.recipient, expectedRecipient) ||
      same(plan.recipient, f.owner) || BigInt(plan.recipient) === 0n || plan.chainId !== Number(f.chainId)) fail("Funding plan binding differs");
  const tx = plan.transaction;
  if (!tx || Object.keys(tx).some(k => !["from", "to", "type", "chainId", "nonce", "value", "data", "gas", "maxFeePerGas", "maxPriorityFeePerGas"].includes(k)) ||
      !same(tx.from, f.owner) || !same(tx.to, expectedRecipient) || BigInt(tx.type) !== 2n || BigInt(tx.chainId) !== f.chainId ||
      BigInt(tx.value) !== f.value || tx.data !== "0x" || BigInt(tx.gas) !== f.gas ||
      BigInt(tx.maxFeePerGas) <= 0n || BigInt(tx.maxFeePerGas) > f.maxFeePerGas ||
      BigInt(tx.maxPriorityFeePerGas) < 0n || BigInt(tx.maxPriorityFeePerGas) > BigInt(tx.maxFeePerGas) ||
      !Number.isSafeInteger(tx.nonce) || tx.nonce < 0) fail("Funding transaction exceeds the reviewed transfer policy");
  const unsigned = Transaction.from({ type: 2, chainId: f.chainId, nonce: tx.nonce, to: tx.to,
    value: f.value, data: "0x", gasLimit: f.gas, maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas) });
  if (unsigned.unsignedHash !== plan.unsignedHash || unsigned.unsignedSerialized !== plan.unsignedSerialized) fail("Funding transaction hash differs");
  return { id: 0, label: "Fund the dedicated GH0ST callback wallet", transaction: tx, unsignedHash: unsigned.unsignedHash,
    nonce: tx.nonce, destination: getAddress(tx.to), valueEth: formatEther(f.value), maxCostWei: f.gas * BigInt(tx.maxFeePerGas),
    maxCostEth: formatEther(f.gas * BigInt(tx.maxFeePerGas)) };
}
export async function checkFundingFresh(provider, action) {
  const tx = action.transaction;
  const [chain, nonce, balance, recipientBalance, code, recipientNonce, block] = await Promise.all([
    provider.send("eth_chainId", []), provider.getTransactionCount(FUNDING.owner, "pending"), provider.getBalance(FUNDING.owner),
    provider.getBalance(tx.to),
    provider.getCode(tx.to), provider.getTransactionCount(tx.to, "pending"), provider.getBlock("latest"),
  ]);
  if (BigInt(chain) !== FUNDING.chainId || nonce !== action.nonce || BigInt(recipientBalance) !== 0n || code !== "0x" || recipientNonce !== 0 ||
      block?.baseFeePerGas == null || BigInt(block.baseFeePerGas) + BigInt(tx.maxPriorityFeePerGas) > BigInt(tx.maxFeePerGas) ||
      BigInt(balance) < FUNDING.value + action.maxCostWei) fail("Funding balance, chain, recipient, nonce or fee freshness check failed");
  if (await provider.estimateGas({ from: FUNDING.owner, to: tx.to, value: FUNDING.value, data: "0x" }) > FUNDING.gas)
    fail("Funding transfer gas exceeds the fixed policy");
}
export async function prepareFundingPlan(provider, recipient) {
  recipient = getAddress(recipient);
  if (same(recipient, FUNDING.owner) || BigInt(recipient) === 0n) fail("Funding requires a separate callback wallet");
  const [nonce, recipientBalance, fees] = await Promise.all([provider.getTransactionCount(FUNDING.owner, "pending"), provider.getBalance(recipient), provider.getFeeData()]);
  if (recipientBalance !== 0n) fail("The callback wallet is already funded; do not repeat the initial transfer");
  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null || fees.maxFeePerGas > FUNDING.maxFeePerGas)
    fail("Current suggested funding fees exceed the fixed policy");
  const transaction = { from: FUNDING.owner, to: recipient, type: 2, chainId: 4663, nonce, value: FUNDING.value.toString(),
    data: "0x", gas: FUNDING.gas.toString(), maxFeePerGas: FUNDING.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() };
  const unsigned = Transaction.from({ ...transaction, from: undefined, gas: undefined, gasLimit: FUNDING.gas });
  const plan = { schema: "gh0st-relayer-funding-v1", broadcast: false, chainId: 4663, owner: FUNDING.owner, recipient,
    preparedAt: new Date().toISOString(), transaction, unsignedHash: unsigned.unsignedHash, unsignedSerialized: unsigned.unsignedSerialized };
  await checkFundingFresh(provider, validateFundingPlan(plan, recipient));
  return plan;
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !["--prepare", "--fund"].includes(argv[0])) fail("Use --prepare or --fund");
  if (!process.env.RH_RPC_URL) fail("Private RH RPC configuration is required");
  const provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
  let signer;
  try {
    if (argv[0] === "--prepare") {
      const recipient = await createRelayerKeystore();
      if (fs.existsSync(planPath + ".signed-journal.json")) fail("A funding journal already exists; reconcile it instead of preparing another transfer");
      const plan = await prepareFundingPlan(provider, recipient);
      fs.writeFileSync(planPath, json(plan) + "\n", { mode: 0o600 });
      console.log(json({ status: "prepared_not_broadcast", recipient, valueEth: formatEther(FUNDING.value), maximumFeeEth: formatEther(FUNDING.gas * FUNDING.maxFeePerGas), planPath }));
    } else {
      privateFile(planPath);
      const bytes = fs.readFileSync(planPath), plan = JSON.parse(bytes), action = validateFundingPlan(plan, relayerAddress());
      await executeActions({ planPath, planHash: crypto.createHash("sha256").update(bytes).digest("hex"), owner: FUNDING.owner, actions: [action],
        provider, freshCheck: checkFundingFresh, getSigner: async () => signer ??= await unlockKeystore(ownerKeystore, FUNDING.owner,
          () => nativeMacPasswordPrompt({ purpose: "fundWorker" })) });
    }
  } finally { signer = undefined; provider.destroy(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error("Dedicated callback wallet setup stopped. Preserve any funding journal; no replacement or extra transfer was sent."); process.exitCode = 1; });
}
