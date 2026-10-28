import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  keccak256,
  parseUnits,
  AbiCoder,
  toUtf8Bytes,
} from "ethers";
import { idlFactory } from "./candid.mjs";
import { readRetentionStatus } from "./job-history.mjs";
import { coordinatorCallTransform } from "./icp-polling.mjs";
import { generationProgress, canContinueGeneration } from "./continuation-polling.mjs";
import { validateJob, json } from "./protocol.mjs";
import { readJournal, writeJournal, unwrap } from "./journal.mjs";
import { loadSources, scanSwaps } from "./swaps.mjs";
import { callbackFor } from "./routing.mjs";
import { findFulfillment } from "./delivery.mjs";
import { acknowledgeVoice } from "./voice.mjs";
import { getXAccessToken } from "./x-auth.mjs";
import { parseSwapTarget, matchesSwapTarget } from "./pilot.mjs";
import { BUY_POOL, createBuyQueue, enqueuePonsBuys, reserveNextBuy, buyBudget,
  observeBuyProgress, recordBuyDelivery, completeBuy, pendingBuyRecovery, reconcileObservedBuyProgress,
  migrateParkedWorkerResume, normalizeBuyCycleCap, setBuyFailurePolicy,
  settleObservedFailedBuy, rejectBuyResult } from "./buy-queue.mjs";
import { failurePolicyDecision, deliveryUncertain, publicationUncertain } from "./failure-policy.mjs";
import { deferFailedGeneration } from "./failure-deferral.mjs";
import { openThoughtHistory, DEFAULT_THOUGHT_HISTORY_JOURNALS } from "./thought-history.mjs";
import {
  planPublication,
  publishPlanned,
  verifyPublishingAccount,
  RH_EXPLORER_PREFIX,
  afterimageCaption,
} from "./x-publisher.mjs";

const required = (name) => {
  if (!process.env[name]) throw Error(`Missing ${name}`);
  return process.env[name];
};
const swapTarget = parseSwapTarget(process.env);
const buyOnly = process.env.BUY_ONLY === "1";
const watchOnly = process.env.WATCH_ONLY === "1";
if ((process.env.WATCH_ONLY && !["0", "1"].includes(process.env.WATCH_ONLY)) || (watchOnly && !buyOnly))
  throw Error("WATCH_ONLY must be 0/1 and requires BUY_ONLY=1");
const afterimageGenerationLock = process.env.GH0ST_SERVER_RUNTIME === "1"
  ? path.join(process.env.GH0ST_STATE_DIR, "afterimage-active-generation.lock")
  : new URL("../.state/afterimage-active-generation.lock", import.meta.url);
if (buyOnly && !watchOnly && fs.existsSync(afterimageGenerationLock))
  throw Error("The existing thought is being finalized; wait before starting the buy worker");
const gatewayAddress = required("RH_GATEWAY");
const canisterId = required("ICP_COORDINATOR");
const rpc = required("RH_RPC_URL");
const safeError = (error) => String(error?.message ?? error)
  .split(rpc).join("[private RH RPC]")
  .replace(/\/v2\/[^\s"'?]+/g, "/v2/[redacted]");
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
const coordinator = Actor.createActor(idlFactory, { agent, canisterId,
  callTransform: coordinatorCallTransform() });
const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(chainId))
  throw Error("RPC chain mismatch");
const artifact = JSON.parse(
  fs.readFileSync(new URL("../build/gateway.json", import.meta.url), "utf8"),
);
const gateway = new Contract(gatewayAddress, artifact.abi, provider);
const config = await coordinator.get_config();
if (buyOnly && (canisterId !== "6jacx-5yaaa-aaaaj-a65jq-cai" ||
    config.model_canister?.toText() !== "6obed-qaaaa-aaaaj-a65ja-cai"))
  throw Error("BUY_ONLY coordinator/model differs from the funded production pair");
const watchSwaps = process.env.WATCH_SWAPS === "1";
if (buyOnly && (!watchSwaps || swapTarget))
  throw Error("BUY_ONLY requires WATCH_SWAPS=1 and no one-swap pilot filter");
let swapPools = watchSwaps
  ? loadSources(
      { chain_id: chainId, pools: config.swap_sources?.[0] ?? [] },
      chainId,
    )
  : [];
if (buyOnly) swapPools = swapPools.filter(pool => pool.pool_id === BUY_POOL.pool_id && pool.manager === BUY_POOL.manager);
if (watchSwaps && !swapPools.length)
  throw Error("WATCH_SWAPS requires registered coordinator swap_sources");
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
for (const pool of swapPools) {
  const key = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [pool.manager, pool.pool_id],
    ),
  );
  if (!(await gateway.authorizedSwapPool(key)))
    throw Error("Swap pool is not enabled in the RH result gateway");
}
if (!watchOnly &&
  unwrap(await coordinator.signer_address()).toLowerCase() !==
  signer.toLowerCase()
)
  throw Error("Canister signer differs from gateway");
const file = path.resolve(process.env.JOURNAL ?? ".state/worker.json");
const journalBinding = {
    chainId,
    gateway: gatewayAddress.toLowerCase(),
    canisterId,
    ...(watchSwaps
      ? { swapSourcesHash: keccak256(toUtf8Bytes(json(swapPools))) }
      : {}),
    ...(swapTarget ? { swapTarget } : {}),
    ...(buyOnly ? { buyOnly: { poolId: BUY_POOL.pool_id, manager: BUY_POOL.manager, direction: "native-in-gh0st-out" } } : {}),
  };
let state = readJournal(file, journalBinding, startBlock);
if (buyOnly && process.env.RH_RELAYER_PRIVATE_KEY)
  throw Error("BUY_ONLY requires an in-memory injected relayer; raw environment keys are not accepted");
if (buyOnly && !watchOnly && (process.env.X_USER_ACCESS_TOKEN || !process.env.X_OAUTH_TOKEN_FILE))
  throw Error("BUY_ONLY requires the private OAuth token file, not a raw environment token");
const injectedRelayerModule = buyOnly ? await import("./local-relayer.mjs") : null;
const injectedRelayer = injectedRelayerModule?.getInjectedRelayer() ?? null;
const wallet = injectedRelayer ?? (process.env.RH_RELAYER_PRIVATE_KEY
  ? new Wallet(process.env.RH_RELAYER_PRIVATE_KEY, provider)
  : null);
const buyRelayFeeCap = buyOnly ? parseUnits(process.env.RELAY_MAX_FEE_GWEI ?? "0.05", "gwei") : null;
const buyRelayGasText = process.env.RELAY_GAS_LIMIT_CAP ?? "500000";
if (buyOnly && (!/^[1-9]\d*$/.test(buyRelayGasText) || BigInt(buyRelayGasText) > 500000n ||
    buyRelayFeeCap <= 0n || buyRelayFeeCap > 50_000_000n))
  throw Error("BUY_ONLY callback limits must be positive and at most 500000 gas and 0.05 gwei");
const buyRelayGasCap = buyOnly ? BigInt(buyRelayGasText) : null;
if (wallet && !buyOnly && !process.env.RELAY_MAX_FEE_GWEI)
  throw Error("Set RELAY_MAX_FEE_GWEI to bound transaction fees");
const xEnabled = process.env.X_ENABLED === "1";
const buyPostFormat = process.env.X_POST_FORMAT ?? "afterimage";
if (buyOnly && buyPostFormat !== "afterimage")
  throw Error("New BUY_ONLY posts must use X_POST_FORMAT=afterimage");
const dailyBuyCap = normalizeBuyCycleCap(process.env.BUY_DAILY_CYCLE_CAP);
const fundingAdmission = buyOnly ? (await import("./cycle-budget.mjs")).assertFundingAdmission : null;
const xAccessToken = () => getXAccessToken({
  tokenFile: process.env.X_OAUTH_TOKEN_FILE,
  accessToken: process.env.X_USER_ACCESS_TOKEN,
  expectedUsername: process.env.X_EXPECTED_USERNAME ?? "llmgh0st",
  ...(buyOnly && buyPostFormat === "afterimage" ? { media: true } : {}),
});
let xAccount = null,
  xAuthorizationError = null,
  lastXCheck = 0;
async function checkXAccount() {
  if (!xEnabled || xAccount || Date.now() - lastXCheck < 60000) return;
  lastXCheck = Date.now();
  try {
    xAccount = await verifyPublishingAccount({
      enabled: true,
      accessToken: await xAccessToken(),
      expectedUsername: process.env.X_EXPECTED_USERNAME ?? "llmgh0st",
      timeoutMs: 5000,
    });
    xAuthorizationError = null;
  } catch (error) {
    xAuthorizationError = safeError(error).slice(0, 300);
  }
}
if (!watchOnly) await checkXAccount();
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
if (buyOnly) {
  try {
    // Startup account checks may await network I/O. Reload under the exclusive
    // writer lock so an intervening process cannot leave us with stale state.
    state = readJournal(file, journalBinding, startBlock);
    if (!state.buyQueue) {
      if (state.requests.length) throw Error("BUY_ONLY requires a fresh mode-bound journal or a preserved buy queue");
      state.buyQueue = createBuyQueue({ startBlock, dailyCycleBudget: dailyBuyCap, minimumRemainingCycles: "3000000000000" });
    }
    if (state.buyQueue.policy.dailyCycleBudget !== dailyBuyCap)
      throw Error("BUY_ONLY daily budget changed; review the persisted queue before changing its policy");
    if (state.buyQueue.policy.skipFailedBuys !== true) {
      state.buyQueue = setBuyFailurePolicy(state.buyQueue, { skipFailedBuys: true, nowMs: Date.now(),
        authorizationRef: "user: skip failures, one attempt per buy, never publish an exact thought twice",
        reason: "Known terminal failures must not block later buys; uncertain sends remain held" });
    }
    save();
  } catch (error) { release(); throw error; }
}

let thoughtHistory = null;
try {
  if (buyOnly && !watchOnly) thoughtHistory = openThoughtHistory({
    file: path.join(path.dirname(file), "thought-history.json"),
    journalFiles: [...new Set([...DEFAULT_THOUGHT_HISTORY_JOURNALS, file])],
    chainId, canisterId,
  });
} catch (error) { release(); throw error; }

function failureSideEffects(item) {
  return { pendingUpdate: item.pendingUpdate ?? item.pendingResume ?? item.buyHalt ?? null,
    deliveryUncertain: deliveryUncertain(item), publicationUncertain: publicationUncertain(item) };
}

function rejectThought(item, job, reason, duplicateOf = null) {
  const answerHash = keccak256(toUtf8Bytes(job.answer));
  if (item.delivery?.confirmed) {
    state.buyQueue = recordBuyDelivery(state.buyQueue, { sourceId: item.id,
      delivery: { ...item.delivery, sourceId: item.id, canonical: true } });
  }
  state.buyQueue = rejectBuyResult(state.buyQueue, { sourceId: item.id, answerHash, reason,
    actualCycles: String(job.model_cycles), nowMs: Date.now(),
    proofRef: file + "#" + item.id + "/rejectedThought", duplicateOf, ...failureSideEffects(item) });
  item.modelCycles = String(job.model_cycles);
  item.state = "skipped";
  item.rejectedThought = { reason, answerHash, duplicateOf, at: new Date().toISOString() };
  save();
}

async function enforceFailurePolicy(item, job) {
  if (!buyOnly) return false;
  const decision = failurePolicyDecision(item, job);
  if (decision.action === "continue") return false;
  if (decision.action === "wait") {
    item.failurePolicyHold = { reason: decision.reason, at: new Date().toISOString() };
    save(); return true;
  }
  delete item.failurePolicyHold;
  if (decision.action === "abort") {
    item.failurePolicyAbort = { reason: decision.reason, at: new Date().toISOString() };
    save();
    await runBuyMutation(item, "abort", async () => unwrap(await coordinator.abort(item.id)), job);
    const stopped = (await coordinator.get_job(item.id))[0];
    if (!stopped) throw Error("Aborted job is missing; reconcile before continuing");
    return await enforceFailurePolicy(item, stopped);
  }
  if (decision.action === "reject_result") {
    rejectThought(item, job, decision.reason);
    return true;
  }
  state.buyQueue = settleObservedFailedBuy(state.buyQueue, { sourceId: item.id, job,
    nowMs: Date.now(), evidenceRef: file + "#" + item.id + "/terminalFailure", ...failureSideEffects(item) });
  item.phase = "Failed"; item.state = "failed"; item.error = job.error;
  item.modelCycles = decision.actualCycles;
  item.terminalFailure = { reason: decision.reason, skipped: true, at: new Date().toISOString() };
  save();
  return true;
}

async function admitUniqueThought(item, job, stage) {
  if (!thoughtHistory) return true;
  const answer = stage === "publish" ? item.delivery.answer : job.answer;
  const answerHash = keccak256(toUtf8Bytes(answer));
  try {
    thoughtHistory.reserve({ sourceId: item.id, answer, answerHash, stage });
    return true;
  } catch (error) {
    if (error.code !== "DUPLICATE_THOUGHT") throw error;
    const effects = failureSideEffects(item);
    if (effects.pendingUpdate || effects.deliveryUncertain || effects.publicationUncertain || job.busy !== false) {
      item.duplicateHold = { reason: "Duplicate thought has an unresolved send; reconcile it before skipping",
        answerHash, duplicateOf: error.duplicateSourceId, at: new Date().toISOString() };
      save(); return false;
    }
    rejectThought(item, job, "exact_duplicate_thought", error.duplicateSourceId);
    return false;
  }
}

function buyPublicationOptions(item) {
  return { format: buyPostFormat, existingPublication: item.publication,
    existingPlan: item.publicationPlan, icpCanisterId: canisterId,
    asset: item.afterimageAsset, mediaId: item.media?.mediaId, mediaExpiresAt: item.media?.expiresAt };
}

async function prepareAfterimage(item) {
  await checkXAccount();
  if (!xEnabled || !xAccount) {
    item.publicationError = xAuthorizationError ?? "Afterimage publishing is unavailable";
    save(); return false;
  }
  const { renderAfterimage } = await import("./afterimage.mjs");
  const { uploadAfterimage, afterimageMetadata, afterimageAltText } = await import("./x-media.mjs");
  if (!/^0x[0-9a-f]{64}$/.test(item.id)) throw Error("Invalid Afterimage source ID");
  const outputPath = path.join(path.dirname(file), "afterimages", item.id + ".png");
  const proofUrl = RH_EXPLORER_PREFIX + item.delivery.transactionHash;
  const asset = await renderAfterimage({ answer: item.delivery.answer, answerHash: item.delivery.answerHash, outputPath, proofUrl });
  const metadata = { ...afterimageMetadata(asset, { requireBytes: true }), path: asset.path, metadataPath: asset.metadataPath };
  if (metadata.answerHash !== item.delivery.answerHash || metadata.altText !== afterimageAltText(item.delivery.answer, proofUrl) ||
      metadata.mimeType !== "image/png" || !/^[0-9a-f]{64}$/.test(metadata.pngSha256 ?? "") || metadata.path !== outputPath)
    throw Error("Afterimage asset differs from the confirmed thought");
  if (item.afterimageAsset && json(item.afterimageAsset) !== json(metadata))
    throw Error("The previously journaled Afterimage asset changed");
  item.afterimageAsset = metadata;
  save(); // PNG/sidecar and their exact metadata are durable before upload.
  const media = await uploadAfterimage({ asset, accessToken: await xAccessToken(), existing: item.media,
    enabled: xEnabled, persist: async intent => { item.media = intent; save(); } });
  item.media = media; save();
  if (media?.status !== "uploaded") {
    item.publicationError = "Afterimage upload is held: " + (media?.status ?? "unknown");
    save(); return false;
  }
  return true;
}

async function serviceDelivery(item, knownJob) {
  const job = knownJob ?? (await coordinator.get_job(item.id))[0];
  if (!job) return;
  if (buyOnly && item.publication?.status !== "posted") {
    if (await enforceFailurePolicy(item, job)) return;
    if (!(await admitUniqueThought(item, job, "publish"))) return;
  }
  if (!item.memoryAcknowledged) {
    try {
      await acknowledgeVoice(item, job, coordinator);
      delete item.memoryError;
    } catch (error) {
      item.memoryError = safeError(error).slice(0, 300);
    }
    save();
  }
  if (item.kind !== "swap" || !job.voice?.[0]) return;
  if (
    ["posted", "blocked", "needs_reconciliation"].includes(
      item.publication?.status,
    )
  )
    return;
  try {
    if (buyOnly && item.publicationPlan?.format !== "afterimage") {
      const previous = item.publication;
      const neverSent = !previous || (["ready", "disabled"].includes(previous.status) &&
        (previous.attempt ?? 0) === 0 && previous.startedAt == null && previous.httpStatus == null &&
        previous.postId == null && previous.postUrl == null);
      if (neverSent) {
        // Changing an unsent presentation is safe. A persisted send intent or
        // any attempted/uncertain outcome must retain its original identity.
        delete item.publication;
        delete item.publicationPlan;
        save();
      } else throw Error("An attempted old-format publication must be reconciled before adding an Afterimage");
    }
    if (buyOnly && !(await prepareAfterimage(item))) return;
    const plan = planPublication({ ...item.delivery, requestId: item.id }, buyOnly ? buyPublicationOptions(item) : undefined);
    const exactCaption = afterimageCaption(item.delivery.answer);
    if (buyOnly && (plan.format !== "afterimage" || plan.text !== exactCaption))
      throw Error("Afterimage must preserve the exact thought in its caption or full-text image");
    item.publicationPlan = buyOnly ? { ...plan } : {
      planId: plan.planId,
      textHash: plan.textHash,
      text: plan.text,
      proofUrl: plan.proofUrl,
    };
    save();
    await checkXAccount();
    if (xEnabled && !xAccount) {
      item.publicationError =
        xAuthorizationError ?? "X account authorization is unavailable";
      save();
      return;
    }
    if (buyOnly && !(await admitUniqueThought(item, job, "publish"))) return;
    const outcome = await publishPlanned(plan, {
      enabled: xEnabled,
      accessToken: xEnabled ? await xAccessToken() : undefined,
      existing: item.publication,
      persist: async (publication) => {
        item.publication = publication;
        save();
      },
    });
    item.publication = outcome;
    delete item.publicationError;
    save();
  } catch (error) {
    item.publicationError = safeError(error).slice(0, 300);
    save();
  }
}

async function confirmDelivery(item, job, onchain, safeBlock) {
  const delivery = await findFulfillment(
    provider,
    gateway,
    item,
    onchain.answerHash,
    job && "Complete" in job.phase ? job.answer : undefined,
    safeBlock,
    startBlock,
  );
  item.state = delivery ? "fulfilled" : "awaiting_confirmation";
  if (delivery) {
    item.delivery = delivery;
    if (delivery.gasUsed !== undefined) item.gasUsed = delivery.gasUsed;
    if (delivery.feeWei !== undefined) item.feeWei = delivery.feeWei;
  }
  save();
  if (delivery && thoughtHistory) thoughtHistory.record({ sourceId: item.id, answer: delivery.answer,
    answerHash: delivery.answerHash, stage: "delivered" });
  if (delivery) await serviceDelivery(item, job);
  return !!delivery;
}

async function relay(item, job) {
  const result = validateJob(config, job, signer);
  const callback = callbackFor(item, job, chainId, result);
  const onchain = await gateway.requests(item.id);
  if (Number(onchain.status) === 2) {
    await confirmDelivery(
      item,
      job,
      onchain,
      (await provider.getBlockNumber()) - Number(config.confirmations),
    );
    return;
  }
  if (
    item.kind === "swap"
      ? Number(onchain.status) !== 0
      : Number(onchain.status) !== 1 ||
        Number(onchain.deadline) <= Math.floor(Date.now() / 1000)
  ) {
    item.state = "expired_or_cancelled";
    save();
    return;
  }
  // Existing signed bytes may already be in flight. Reconcile that exact
  // transaction first; the separate publication guard still prevents repeats.
  if (!item.rawTransaction && !item.transactionHash && !(await admitUniqueThought(item, job, "relay"))) return;
  item.result = result;
  item.state = "signed";
  save();
  if (!wallet) return;
  if (!item.rawTransaction) {
    const fees = await provider.getFeeData();
    const cap = buyOnly ? buyRelayFeeCap : parseUnits(process.env.RELAY_MAX_FEE_GWEI, "gwei");
    if (fees.maxFeePerGas == null || fees.maxFeePerGas > cap)
      throw Error("Current fee exceeds cap or EIP-1559 fees unavailable");
    const call = await gateway[callback.method].populateTransaction(
      ...callback.args,
    );
    const gas = await provider.estimateGas({ ...call, from: wallet.address });
    const gasLimit = (gas * 120n) / 100n;
    if (gasLimit > (buyOnly ? buyRelayGasCap : BigInt(process.env.RELAY_GAS_LIMIT_CAP ?? 500000)))
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
    const safeBlock =
      (await provider.getBlockNumber()) - Number(config.confirmations);
    if (receipt.blockNumber > safeBlock) {
      item.state = "awaiting_confirmation";
      save();
      return;
    }
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block || block.hash !== receipt.blockHash) {
      item.state = "awaiting_confirmation";
      save();
      return;
    }
    if (receipt.status === 1)
      await confirmDelivery(
        item,
        job,
        await gateway.requests(item.id),
        safeBlock,
      );
    else item.state = "callback_reverted";
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

async function buyCanonicalEvidence(events) {
  const headBlockNumber = await provider.getBlockNumber(), canonicalBlockHashes = {};
  for (const number of new Set(events.map(event => event.blockNumber))) {
    const block = await provider.getBlock(number);
    if (!block?.hash) throw Error("BUY_ONLY canonical block is unavailable");
    canonicalBlockHashes[number] = block.hash;
  }
  return { headBlockNumber, canonicalBlockHashes };
}

// Keep the reservation until RH delivery, memory acknowledgement AND a known
// successful X post. Failures and uncertain sends never let the next buy pass.
function syncBuyQueue(item) {
  if (!buyOnly || state.buyQueue.activeSourceId !== item.id) return;
  const entry = state.buyQueue.entries.find(value => value.event.id === item.id);
  if (["failed", "callback_reverted", "expired_or_cancelled"].includes(item.state)) {
    state.buyQueue = observeBuyProgress(state.buyQueue, { sourceId: item.id, status: "failed", reason: item.error || item.state });
  } else if (item.delivery?.confirmed) {
    state.buyQueue = recordBuyDelivery(state.buyQueue, { sourceId: item.id,
      delivery: { ...item.delivery, sourceId: item.id, canonical: true } });
    if (["blocked", "needs_reconciliation", "sending"].includes(item.publication?.status)) {
      state.buyQueue = observeBuyProgress(state.buyQueue, { sourceId: item.id,
        status: item.publication.status === "blocked" ? "failed" : "ambiguous", reason: "X publication requires reconciliation" });
    } else if (["blocked", "needs_reconciliation", "uploading", "upload_received", "metadata_sending"].includes(item.media?.status)) {
      state.buyQueue = observeBuyProgress(state.buyQueue, { sourceId: item.id,
        status: item.media.status === "blocked" ? "failed" : "ambiguous", reason: "Afterimage media upload requires reconciliation" });
    } else if (item.memoryAcknowledged && item.publication?.status === "posted") {
      try {
        const expected = planPublication({ ...item.delivery, requestId: item.id }, buyPublicationOptions(item));
        if (![undefined, "legacy", "proofs-v2", "thought-only", "afterimage"].includes(expected.format))
          throw Error("Unrecognized stored publication format");
      } catch (error) {
        item.publicationError = safeError(error).slice(0, 300);
        state.buyQueue = observeBuyProgress(state.buyQueue, { sourceId: item.id, status: "ambiguous", reason: "Posted record does not match this thought's proof plan" });
        save(); return;
      }
      state.buyQueue = completeBuy(state.buyQueue, { sourceId: item.id, actualCycles: item.modelCycles, nowMs: Date.now(),
        publication: { sourceId: item.id, status: "posted", verified: true, postId: item.publication.postId,
          callbackTransactionHash: item.delivery.transactionHash, answerHash: item.delivery.answerHash }, proofRef: file + "#" + item.id });
    }
  } else if (!["failed", "ambiguous"].includes(entry.status)) {
    const status = item.state === "signed" ? "signed" : item.phase === "Running" ? "generating" : item.phase ? "submitted" : null;
    if (status && ["reserved", "submitted", "generating", "signed"].indexOf(status) >=
        ["reserved", "submitted", "generating", "signed"].indexOf(entry.status))
      state.buyQueue = observeBuyProgress(state.buyQueue, { sourceId: item.id, status });
  }
  save();
}

async function synchronizeFailedDeferrals() {
  for (const entry of state.buyQueue.entries) {
    if (!["failed_final", "not_executed"].includes(entry.status)) continue;
    const item = state.requests.find(value => value.id === entry.event.id);
    if (!item) throw Error("Settled failure is missing its source journal");
    if (["deferred", "not_required"].includes(item.coordinatorDeferral?.status)) continue;
    const job = (await coordinator.get_job(item.id))[0];
    if ((!job && entry.status === "not_executed") || (job && "Complete" in job.phase && !job.busy)) {
      item.coordinatorDeferral = { status: "not_required", reason: job ? "signed_completed_result" : "no_canister_job",
        at: new Date().toISOString() };
      save(); continue;
    }
    const cumulative = BigInt(entry.cumulativeActualCycles ??
      (BigInt(entry.actualCycles) + BigInt(entry.costBaseline ?? "0")).toString());
    if (!job || !("Failed" in job.phase) || job.busy || BigInt(job.model_cycles) !== cumulative) {
      state.buyAdmission = { allowed: false, reason: "failed_canister_job_requires_reconciliation", sourceId: item.id };
      save(); return false;
    }
    const result = await deferFailedGeneration({ coordinator, canisterId, sourceId: item.id,
      expectedCycles: cumulative, expectedSource: item.source, existing: item.coordinatorDeferral,
      persist: async record => { item.coordinatorDeferral = record; save(); } });
    item.coordinatorDeferral = result;
    save();
    if (result?.status !== "deferred") {
      state.buyAdmission = { allowed: false, reason: "failed_canister_job_deferral_pending", sourceId: item.id };
      save(); return false;
    }
  }
  return true;
}

async function reserveBuy() {
  buyBudget(state.buyQueue, new Date().toISOString().slice(0, 10)); // Validate the entire saved queue, including active/terminal proofs.
  const items = new Map(state.requests.map(item => [item.id, item]));
  if (items.size !== state.requests.length || items.size !== state.buyQueue.entries.length)
    throw Error("BUY_ONLY request journal and buy queue differ");
  for (const { event } of state.buyQueue.entries) {
    const item = items.get(event.id);
    if (!item || item.kind !== "swap" || item.txHash !== event.txHash || item.logIndex !== event.logIndex ||
        item.blockHash !== event.blockHash || item.blockNumber !== event.blockNumber ||
        item.context?.amount0 !== event.context.amount0 || item.context?.amount1 !== event.context.amount1)
      throw Error("BUY_ONLY saved request differs from its admitted source");
  }
  const recovery = pendingBuyRecovery(state.buyQueue);
  if (recovery) {
    state.buyAdmission = { allowed: false, reason: "unfulfilled_prior_buy", ...recovery };
    save(); return null;
  }
  if (state.buyQueue.activeSourceId) {
    const active = state.buyQueue.entries.find(entry => entry.event.id === state.buyQueue.activeSourceId);
    if (active.recoveryAdmissionNeeded && !(await admitRecoverySegment(active))) return null;
    return state.buyQueue.activeSourceId;
  }
  // The coordinator also retains failed sources. Reconcile its owner-only
  // deferral before a new reservation can spend cycles or submit another job.
  if (!(await synchronizeFailedDeferrals())) return null;
  const next = state.buyQueue.entries.find(entry => entry.status === "queued" || entry.status === "parked");
  if (!next) return null;
  if (next.status === "parked") return resumeParkedSource(next);
  await checkXAccount();
  if (!wallet || !xEnabled || !xAccount) {
    state.buyAdmission = { allowed: false, reason: !wallet ? "relayer_unavailable" : !xEnabled ? "publishing_disabled" : "publishing_account_unavailable" };
    save(); return null;
  }
  const retention = await readRetentionStatus(coordinator);
  if (!retention.admission_allowed) {
    state.buyAdmission = { allowed: false, reason: retention.blocked_failed ? "coordinator_failed_work" : retention.open > 0n ? "coordinator_unfinished_work" : "coordinator_admission_blocked",
      retainedJobs: Number(retention.retained), openJobs: Number(retention.open) };
    save(); return null;
  }
  const callbackReserveWei = buyRelayGasCap * buyRelayFeeCap;
  const relayerBalanceWei = await provider.getBalance(wallet.address);
  if (relayerBalanceWei < callbackReserveWei) {
    state.buyAdmission = { allowed: false, reason: "relayer_funding_floor",
      balanceWei: relayerBalanceWei.toString(), requiredWei: callbackReserveWei.toString() };
    save(); return null;
  }
  let relayerAdmission;
  try { relayerAdmission = await injectedRelayerModule.checkInjectedRelayerAdmission(); }
  catch { relayerAdmission = { allowed: false, reason: "relayer_budget_unavailable" }; }
  state.buyRelayerBudget = relayerAdmission;
  if (relayerAdmission?.allowed !== true) {
    state.buyAdmission = { allowed: false, reason: relayerAdmission?.reason ?? "relayer_budget_unavailable" };
    save(); return null;
  }
  const utcDay = new Date().toISOString().slice(0, 10);
  const admission = await fundingAdmission({ dailyCycleCap: dailyBuyCap,
    dailyLedger: dailyBuyCap ? buyBudget(state.buyQueue, utcDay) : null });
  const nowMs = Date.now();
  state.buyFunding = { ...admission, checkedAt: new Date(nowMs).toISOString() }; save();
  if (admission.allowed !== true) {
    state.buyAdmission = { allowed: false, reason: admission.reason ?? "cycle_budget_unavailable" };
    save(); return null;
  }
  if (config.model_wasm_hash !== admission.balances.model.moduleHash)
    throw Error("BUY_ONLY configured model differs from the verified funding snapshot");
  const reservation = reserveNextBuy(state.buyQueue, { nowMs, verification: await buyCanonicalEvidence([next.event]),
    balance: { cycles: admission.balances.model.cycles, observedAtMs: admission.snapshot.canisters.model.observedAtMs } });
  state.buyQueue = reservation.state;
  state.buyAdmission = { allowed: reservation.decision.kind === "start", reason: reservation.decision.reason ?? null };
  save(); // Durable before submit_swap.
  return reservation.decision.kind === "start" ? reservation.decision.intent.sourceId : null;
}

async function admitRecoverySegment(entry) {
  await checkXAccount();
  if (!wallet || !xEnabled || !xAccount) {
    state.buyAdmission = { allowed: false, reason: "recovery_delivery_capability_unavailable" }; save(); return false;
  }
  if (await provider.getBalance(wallet.address) < buyRelayGasCap * buyRelayFeeCap) {
    state.buyAdmission = { allowed: false, reason: "relayer_funding_floor" }; save(); return false;
  }
  let relayer;
  try { relayer = await injectedRelayerModule.checkInjectedRelayerAdmission(); }
  catch { relayer = { allowed: false, reason: "relayer_budget_unavailable" }; }
  if (relayer?.allowed !== true) {
    state.buyAdmission = { allowed: false, reason: relayer?.reason ?? "relayer_budget_unavailable" }; save(); return false;
  }
  const ledger = buyBudget(state.buyQueue, new Date().toISOString().slice(0, 10));
  // This segment already holds 2T. The helper adds the next 2T reservation, so
  // exclude only this hold from its input; parked work and old costs stay held.
  const dailyLedger = dailyBuyCap ? { ...ledger, reserved: (BigInt(ledger.reserved) - 2_000_000_000_000n).toString() } : null;
  const funding = await fundingAdmission({ dailyCycleCap: dailyBuyCap, dailyLedger });
  state.buyFunding = funding;
  if (funding.allowed !== true || config.model_wasm_hash !== funding.balances?.model?.moduleHash) {
    state.buyAdmission = { allowed: false, reason: funding.reason ?? "recovery_funding_unavailable" }; save(); return false;
  }
  entry.recoveryAdmissionNeeded = false;
  entry.recoveryAdmissionAt = Date.now();
  state.buyAdmission = { allowed: true, reason: null, recoverySegment: true };
  save(); return true;
}

async function resumeParkedSource(entry) {
  const item = state.requests.find(value => value.id === entry.event.id);
  if (!item) throw Error("Parked source is missing from the worker journal");
  let job = (await coordinator.get_job(item.id))[0];
  if (!job || job.busy || !("Verified" in job.phase) || job.recovery?.[0]?.requires_owner) {
    state.buyAdmission = { allowed: false, reason: "parked_job_requires_reconciliation", sourceId: item.id }; save(); return null;
  }
  if (job.recovery?.[0]?.parked) {
    if (item.pendingResume) return null; // An accepted resume may still be pending. Read again, never resend blindly.
    if (!(await admitRecoverySegment(entry))) return null;
    item.pendingResume = { sourceId: item.id, startedAt: Date.now() }; save();
    try { job = unwrap(await coordinator.resume_job(item.id)); }
    catch (error) {
      item.resumeError = safeError(error).slice(0, 300); save(); return null;
    }
  }
  if (job.busy || !("Verified" in job.phase) || job.recovery?.[0]?.parked) return null;
  const evidenceRef = file + "#" + item.id + "/owner-pregranted-resume";
  state = migrateParkedWorkerResume(state, { sourceId: item.id, resumedJob: job, nowMs: Date.now(), evidenceRef });
  const resumedItem = state.requests.find(value => value.id === item.id);
  if (resumedItem.pendingResume) {
    resumedItem.resumeHistory ??= []; resumedItem.resumeHistory.push(resumedItem.pendingResume);
    delete resumedItem.pendingResume; delete resumedItem.resumeError;
  }
  // Recheck the remaining 2T segment before any model update, including a resume
  // that was only observed after an earlier uncertain response.
  save();
  return await reserveBuy();
}

const jobFingerprint = job => createHash("sha256").update(json(job)).digest("hex");
async function runBuyMutation(item, operation, perform, beforeJob) {
  if (buyOnly) {
    if (item.pendingUpdate) throw Error("An earlier update still requires reconciliation");
    item.pendingUpdate = { operation, sourceId: item.id, startedAt: Date.now(),
      beforeFingerprint: beforeJob ? jobFingerprint(beforeJob) : null };
    save(); // Persist before the ingress update can be accepted.
  }
  try {
    const result = await perform();
    if (buyOnly) { delete item.pendingUpdate; delete item.buyHalt; save(); }
    return result;
  }
  catch (error) {
    if (buyOnly) {
      item.buyHalt = { operation, reason: safeError(error).slice(0, 300), at: new Date().toISOString() };
      state.buyQueue = observeBuyProgress(state.buyQueue, { sourceId: item.id, status: "ambiguous", reason: "Unresolved " + operation + "; reconcile before retrying" });
      save();
    }
    const uncertain = new Error(safeError(error));
    uncertain.buyUpdateUncertain = true;
    throw uncertain;
  }
}

async function reconcilePendingUpdate(item) {
  if (!item.pendingUpdate) return !item.buyHalt;
  const pending = item.pendingUpdate;
  if (pending.sourceId !== item.id || !["submit", "advance", "abort"].includes(pending.operation))
    throw Error("Invalid pending canister update marker");
  const job = (await coordinator.get_job(item.id))[0];
  if (!job || job.busy || (pending.operation === "advance" && jobFingerprint(job) === pending.beforeFingerprint) ||
      (pending.operation === "abort" && !("Failed" in job.phase))) {
    item.updateReconciliation = { status: "waiting", checkedAt: Date.now(), reason: !job ? "job_absent" : job.busy ? "job_busy" : "job_unchanged" };
    save(); return false;
  }
  const source = job.source?.[0];
  if (job.request?.id !== item.id || job.request.tx_hash !== item.txHash || Number(job.request.log_index) !== item.logIndex ||
      source?.transaction_hash !== item.txHash || Number(source.log_index) !== item.logIndex ||
      source.pool_id !== BUY_POOL.pool_id || source.manager !== BUY_POOL.manager)
    throw Error("Observed canister update belongs to a different source");
  const phase = Object.keys(job.phase)[0];
  if (!["Verified", "Running", "ReadyToSign", "Complete", "Failed"].includes(phase)) throw Error("Unknown reconciled job phase");
  const status = phase === "Failed" ? "failed" : ["ReadyToSign", "Complete"].includes(phase) ? "signed" : phase === "Running" ? "generating" : "submitted";
  item.updateReconciliation = { status: "observed", phase, checkedAt: Date.now(), fingerprint: jobFingerprint(job) };
  state.buyQueue = reconcileObservedBuyProgress(state.buyQueue, { sourceId: item.id, status, evidenceRef: file + "#" + item.id + "/updateReconciliation" });
  item.phase = phase; item.modelCycles = job.model_cycles.toString();
  if (phase === "Failed") { item.state = "failed"; item.error = job.error; }
  delete item.pendingUpdate; delete item.buyHalt; save();
  return true;
}

async function mediaAccessReady() {
  try {
    if (!xEnabled) throw Error("Publishing is disabled");
    await xAccessToken(); // Includes media:true: recheck scope before any inference work.
    return true;
  } catch (error) {
    state.buyAdmission = { allowed: false, reason: "media_authorization_unavailable", error: safeError(error).slice(0, 300) };
    save(); return false;
  }
}
async function tick() {
  const safe = (await provider.getBlockNumber()) - Number(config.confirmations);
  if (state.nextBlock <= safe) {
    const end = Math.min(safe, state.nextBlock + 249);
    const logs = buyOnly ? [] : await gateway.queryFilter(
      gateway.filters.InferenceRequested(),
      state.nextBlock,
      end,
    );
    const discovered = [];
    for (const log of logs)
      if (!state.requests.some((r) => r.id === log.args.requestId))
        discovered.push({
          kind: "request",
          id: log.args.requestId,
          txHash: log.transactionHash,
          logIndex: log.index,
          state: "queued",
          blockNumber: log.blockNumber,
        });
    if (watchSwaps)
      discovered.push(
        ...(await scanSwaps(
          provider,
          swapPools,
          state.nextBlock,
          end,
          chainId,
        )),
      );
    discovered.sort(
      (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
    );
    if (buyOnly) {
      const observed = enqueuePonsBuys(state.buyQueue, discovered, await buyCanonicalEvidence(discovered));
      state.buyQueue = observed.state;
      const accepted = new Set(observed.accepted);
      for (const item of discovered) if (accepted.delete(item.id)) state.requests.push(item);
      state.requests.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    } else for (const item of discovered)
        if (matchesSwapTarget(item, swapTarget) && !state.requests.some((r) => r.id === item.id))
          state.requests.push(item);
    state.nextBlock = end + 1;
    save();
  }
  if (watchOnly) return; // Read-only intake: never reserve, call a job, render, upload or publish.
  if (buyOnly && !(await mediaAccessReady())) return;
  const activeBuy = buyOnly ? await reserveBuy() : null;
  if (buyOnly && !activeBuy) return;
  // One model stream at a time. Completed signed jobs do not block later work.
  for (const item of state.requests) {
    if (buyOnly && item.id !== activeBuy) continue;
    if (!matchesSwapTarget(item, swapTarget)) continue;
    if (buyOnly && !(await reconcilePendingUpdate(item))) return;
    if (item.state === "fulfilled") {
      if (
        !item.memoryAcknowledged ||
        (xEnabled &&
          !["posted", "blocked", "needs_reconciliation"].includes(
            item.publication?.status,
          ))
      )
        await serviceDelivery(item);
      if (buyOnly) { syncBuyQueue(item); return; }
      continue;
    }
    if (
      [
        "fulfilled",
        "callback_reverted",
        ...(!buyOnly ? ["failed"] : []),
        "skipped",
        "expired_or_cancelled",
      ].includes(item.state)
    ) {
      if (buyOnly) { syncBuyQueue(item); return; }
      continue;
    }
    let job = (await coordinator.get_job(item.id))[0];
    const onchain = await gateway.requests(item.id);
    if (Number(onchain.status) === 2) {
      if (buyOnly && job) item.modelCycles = job.model_cycles.toString();
      await confirmDelivery(item, job, onchain, safe);
      if (buyOnly) { syncBuyQueue(item); return; }
      continue;
    }
    if (
      item.kind === "swap"
        ? Number(onchain.status) !== 0
        : Number(onchain.status) !== 1 ||
          Number(onchain.deadline) <= Math.floor(Date.now() / 1000)
    ) {
      if (job?.busy) return;
      if (job && !("Complete" in job.phase) && !("Failed" in job.phase))
        unwrap(await coordinator.abort(item.id));
      item.state =
        Number(onchain.status) === 2 ? "fulfilled" : "expired_or_cancelled";
      save();
      if (buyOnly) { syncBuyQueue(item); return; }
      continue;
    }
    // A manual/external relayer may have delivered a previously signed result.
    // Always reconcile RH first, even when this worker has no transaction key.
    if (item.state === "signed" && !wallet) {
      if (buyOnly) { syncBuyQueue(item); return; }
      continue;
    }
    if (!job)
      job = await runBuyMutation(item, "submit", async () => unwrap(
        await (item.kind === "swap"
          ? coordinator.submit_swap(item.txHash, BigInt(item.logIndex))
          : coordinator.submit_request(item.txHash, BigInt(item.logIndex))),
      ));
    if (job.busy) return;
    if (buyOnly && await enforceFailurePolicy(item, job)) return;
    const recovery = job.recovery?.[0];
    if (buyOnly && recovery && (recovery.requires_owner || recovery.accounting_uncertain || recovery.parked ||
        Number(recovery.retry_after) > Math.floor(Date.now() / 1000))) {
      item.recoveryHold = { requiresOwner: recovery.requires_owner, accountingUncertain: recovery.accounting_uncertain,
        parked: recovery.parked, retryAfter: String(recovery.retry_after), reason: recovery.last_error };
      save(); return;
    }
    if ("Failed" in job.phase) {
      item.state = "failed";
      item.error = job.error;
      save();
      if (buyOnly) syncBuyQueue(item);
      return;
    }
    let continueGeneration = false;
    if (!("Complete" in job.phase)) {
      const before = generationProgress(job);
      job = await runBuyMutation(item, "advance", async () => unwrap(await coordinator.advance(item.id)), job);
      continueGeneration = buyOnly && canContinueGeneration(before, job);
    }
    item.phase = Object.keys(job.phase)[0];
    item.modelCycles = job.model_cycles.toString();
    if (buyOnly && "Failed" in job.phase) { item.state = "failed"; item.error = job.error; }
    save();
    if (buyOnly && await enforceFailurePolicy(item, job)) return;
    if ("Complete" in job.phase) {
      await relay(item, job);
      if (!item.cacheCleaned) {
        unwrap(await coordinator.cleanup(item.id));
        item.cacheCleaned = true;
        save();
      }
    }
    if (buyOnly) syncBuyQueue(item);
    return continueGeneration;
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
      swapPools: swapPools.length,
      swapTarget,
      xPublishingEnabled: xEnabled,
      xAccount: xAccount?.username ?? null,
      ...(buyOnly ? { buyOnly: true, buyPool: BUY_POOL.pool_id } : {}),
      watchOnly,
    }),
  );
  do {
    let continueImmediately = false;
    try {
      if (!buyOnly || !state.readBackoff || state.readBackoff.nextRetryAt <= Date.now()) {
        continueImmediately = await tick() === true;
        if (buyOnly && state.readBackoff) { delete state.readBackoff; save(); }
      }
    } catch (e) {
      console.error(safeError(e));
      if (buyOnly && !e.buyUpdateUncertain) {
        const attempts = Math.min((state.readBackoff?.attempts ?? 0) + 1, 10);
        state.readBackoff = { attempts, nextRetryAt: Date.now() + Math.min(1000 * 2 ** (attempts - 1), 60000), error: safeError(e).slice(0, 300) };
        save();
      }
      if (process.env.ONCE === "1") throw e;
    }
    if (process.env.ONCE === "1") break;
    if (!continueImmediately) await delay(Number(process.env.POLL_MS ?? 15000));
  } while (true);
} finally {
  release();
}
