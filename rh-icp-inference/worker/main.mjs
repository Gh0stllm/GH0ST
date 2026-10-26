import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  keccak256,
  parseUnits,
} from "ethers";
import { idlFactory } from "./candid.mjs";
import { validateJob, json } from "./protocol.mjs";
import { readJournal, writeJournal, unwrap } from "./journal.mjs";

const required = (name) => {
  if (!process.env[name]) throw Error(`Missing ${name}`);
  return process.env[name];
};
const gatewayAddress = required("RH_GATEWAY");
const canisterId = required("ICP_COORDINATOR");
const rpc = required("RH_RPC_URL");
const chainId = Number(process.env.RH_CHAIN_ID ?? 4663);
const startBlock = Number(required("START_BLOCK"));
if (!Number.isSafeInteger(startBlock) || startBlock < 0)
  throw Error("Invalid START_BLOCK");
const identity = Ed25519KeyIdentity.fromJSON(
  fs.readFileSync(required("ICP_IDENTITY_FILE"), "utf8"),
);
const host = process.env.ICP_HOST ?? "https://icp-api.io";
const agent = await HttpAgent.create({ host, identity });
// fetchRootKey is intentionally absent: mainnet root trust is pinned by the SDK.
const coordinator = Actor.createActor(idlFactory, { agent, canisterId });
const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(chainId))
  throw Error("RPC chain mismatch");
const artifact = JSON.parse(
  fs.readFileSync(new URL("../build/gateway.json", import.meta.url), "utf8"),
);
const gateway = new Contract(gatewayAddress, artifact.abi, provider);
const config = await coordinator.get_config();
if (
  config.gateway.toLowerCase() !== gatewayAddress.toLowerCase() ||
  config.chain_id !== BigInt(chainId)
)
  throw Error("Canister routing mismatch");
if (
  (await gateway.modelId()).toLowerCase() !== config.model_id.toLowerCase() ||
  (await gateway.artifactHash()).toLowerCase() !==
    config.artifact_hash.toLowerCase()
)
  throw Error("Model/artifact binding mismatch");
const signer = await gateway.icpSigner();
if (
  unwrap(await coordinator.signer_address()).toLowerCase() !==
  signer.toLowerCase()
)
  throw Error("Canister signer differs from gateway");
const file = path.resolve(process.env.JOURNAL ?? ".state/worker.json");
const state = readJournal(
  file,
  { chainId, gateway: gatewayAddress.toLowerCase(), canisterId },
  startBlock,
);
const wallet = process.env.RH_RELAYER_PRIVATE_KEY
  ? new Wallet(process.env.RH_RELAYER_PRIVATE_KEY, provider)
  : null;
if (wallet && !process.env.RELAY_MAX_FEE_GWEI)
  throw Error("Set RELAY_MAX_FEE_GWEI to bound transaction fees");
const lock = file + ".lock";
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
// The journal represents one nonce stream. Never run two writers concurrently.
const lockFd = fs.openSync(lock, "wx", 0o600);
fs.writeFileSync(lockFd, String(process.pid));
const release = () => {
  fs.closeSync(lockFd);
  fs.unlinkSync(lock);
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    release();
    process.exit(0);
  });
const save = () => writeJournal(file, state);

async function relay(item, job) {
  const result = validateJob(config, job, signer);
  const onchain = await gateway.requests(item.id);
  if (Number(onchain.status) === 2) {
    item.state = "fulfilled";
    save();
    return;
  }
  if (
    Number(onchain.status) !== 1 ||
    Number(onchain.deadline) <= Math.floor(Date.now() / 1000)
  ) {
    item.state = "expired_or_cancelled";
    save();
    return;
  }
  item.result = result;
  item.state = "signed";
  save();
  if (!wallet) return;
  if (!item.rawTransaction) {
    const fees = await provider.getFeeData();
    const cap = parseUnits(process.env.RELAY_MAX_FEE_GWEI, "gwei");
    if (fees.maxFeePerGas == null || fees.maxFeePerGas > cap)
      throw Error("Current fee exceeds cap or EIP-1559 fees unavailable");
    const call = await gateway.fulfillInference.populateTransaction(
      result.result,
      result.answer,
      result.signature,
    );
    const gas = await provider.estimateGas({ ...call, from: wallet.address });
    const gasLimit = (gas * 120n) / 100n;
    if (gasLimit > BigInt(process.env.RELAY_GAS_LIMIT_CAP ?? 500000))
      throw Error("Callback gas exceeds configured cap");
    const tx = await wallet.populateTransaction({
      ...call,
      chainId,
      gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
      type: 2,
    });
    item.rawTransaction = await wallet.signTransaction(tx);
    item.transactionHash = keccak256(item.rawTransaction);
    save(); // journal BEFORE network send
  }
  const receipt = await provider.getTransactionReceipt(item.transactionHash);
  if (receipt) {
    item.state = receipt.status === 1 ? "fulfilled" : "callback_reverted";
    item.gasUsed = receipt.gasUsed.toString();
    item.feeWei = receipt.fee.toString();
    save();
    return;
  }
  // Retry the identical bytes/nonce after ambiguous submission, never create a
  // second transaction. A replacement by another wallet process needs review.
  try {
    await provider.broadcastTransaction(item.rawTransaction);
  } catch (e) {
    if (!(await provider.getTransaction(item.transactionHash))) throw e;
  }
}
async function tick() {
  const safe = (await provider.getBlockNumber()) - Number(config.confirmations);
  if (state.nextBlock <= safe) {
    const end = Math.min(safe, state.nextBlock + 249);
    const logs = await gateway.queryFilter(
      gateway.filters.InferenceRequested(),
      state.nextBlock,
      end,
    );
    for (const log of logs)
      if (!state.requests.some((r) => r.id === log.args.requestId))
        state.requests.push({
          id: log.args.requestId,
          txHash: log.transactionHash,
          logIndex: log.index,
          state: "queued",
        });
    state.nextBlock = end + 1;
    save();
  }
  // One model stream at a time. Completed signed jobs do not block later work.
  for (const item of state.requests) {
    if (
      [
        "fulfilled",
        "callback_reverted",
        "failed",
        "expired_or_cancelled",
      ].includes(item.state)
    )
      continue;
    if (item.state === "signed" && !wallet) continue;
    let job = (await coordinator.get_job(item.id))[0];
    const onchain = await gateway.requests(item.id);
    if (
      Number(onchain.status) !== 1 ||
      Number(onchain.deadline) <= Math.floor(Date.now() / 1000)
    ) {
      if (job?.busy) return;
      if (job && !("Complete" in job.phase) && !("Failed" in job.phase))
        unwrap(await coordinator.abort(item.id));
      item.state =
        Number(onchain.status) === 2 ? "fulfilled" : "expired_or_cancelled";
      save();
      continue;
    }
    if (!job)
      job = unwrap(
        await coordinator.submit_request(item.txHash, BigInt(item.logIndex)),
      );
    if (job.busy) return;
    if ("Failed" in job.phase) {
      item.state = "failed";
      item.error = job.error;
      save();
      return;
    }
    if (!("Complete" in job.phase))
      job = unwrap(await coordinator.advance(item.id));
    item.phase = Object.keys(job.phase)[0];
    item.modelCycles = job.model_cycles.toString();
    save();
    if ("Complete" in job.phase) {
      await relay(item, job);
      if (!item.cacheCleaned) {
        unwrap(await coordinator.cleanup(item.id));
        item.cacheCleaned = true;
        save();
      }
    }
    return;
  }
}
try {
  console.log(
    json({
      worker: identity.getPrincipal().toText(),
      chainId,
      canisterId,
      gateway: gatewayAddress,
      relayEnabled: !!wallet,
    }),
  );
  do {
    try {
      await tick();
    } catch (e) {
      console.error(String(e.message ?? e));
      if (process.env.ONCE === "1") throw e;
    }
    if (process.env.ONCE === "1") break;
    await delay(Number(process.env.POLL_MS ?? 15000));
  } while (true);
} finally {
  release();
}
