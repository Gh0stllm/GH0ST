import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { X_SCOPES } from "./x-auth.mjs";
import { fileURLToPath } from "node:url";
import { planPublication, afterimageCaption, X_CREATE_POST_URL, GH0ST_REPOSITORY_URL, ICP_CANISTER_PREFIX,
  DEFAULT_ICP_CANISTER_ID, RH_EXPLORER_PREFIX } from "./x-publisher.mjs";
import { inspectFulfillment } from "./delivery.mjs";
import { swapSourceId } from "./swaps.mjs";

export const PROOF_FOLLOWUP = Object.freeze({ anchorPostId: "2114736980802343045",
  username: "llmgh0st", userId: "2112514428507926528", chainId: 4663,
  // Conditional successor; historical receipt and archive identity stay pinned separately.
  gateway: "0x0a99a5f180ab7990877df73f63686958298330ce",
  historyGateway: "0xc50c27735c14d4f4c8b08789685ff8715caa3785", canisterId: DEFAULT_ICP_CANISTER_ID,
  manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  contractAddress: "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559",
  poolId: "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01" });
const proofGateways = Object.freeze([PROOF_FOLLOWUP.historyGateway, PROOF_FOLLOWUP.gateway]);
const LEGACY_SCHEMA = "gh0st-x-proof-followup-v1";
const SCHEMA = "gh0st-x-proof-followup-v2";
const POST_ID = /^[1-9][0-9]{0,19}$/;
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const hash = value => keccak256(toUtf8Bytes(JSON.stringify(value)));
const timestamp = value => { if (!Number.isSafeInteger(value) || value < 0) throw Error("Invalid follow-up timestamp"); return value; };

/** Read-only token access. Never calls getXAccessToken or writes/locks OAuth state. */
export function readFollowupToken(tokenFile, { now = Date.now() } = {}) {
  try {
    if (!path.isAbsolute(tokenFile) || !fs.existsSync(path.dirname(tokenFile)) || fs.existsSync(tokenFile + ".lock")) return null;
    const stat = fs.lstatSync(tokenFile), real = fs.realpathSync(tokenFile);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
        typeof process.getuid === "function" && stat.uid !== process.getuid() ||
        real === projectRoot || real.startsWith(projectRoot + path.sep)) return null;
    const record = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    if (record.schema !== "gh0st-x-oauth-v1" || record.status !== "ready" ||
        record.account?.id !== PROOF_FOLLOWUP.userId || record.account?.username?.toLowerCase() !== PROOF_FOLLOWUP.username ||
        !X_SCOPES.every(scope => record.scopes?.includes(scope)) || !Number.isSafeInteger(record.expires_at) ||
        record.expires_at <= now + 60_000 || typeof record.access_token !== "string" || !record.access_token || /\s/.test(record.access_token)) return null;
    return { accessToken: record.access_token, fingerprint: createHash("sha256").update(record.access_token).digest("hex") };
  } catch { return null; }
}

export function planProofFollowup(item, { schema = SCHEMA, existingPlan = null } = {}) {
  schema = existingPlan?.schema ?? schema;
  if (![LEGACY_SCHEMA, SCHEMA].includes(schema)) throw Error("Invalid proof follow-up schema");
  const published = item?.publication;
  if (item?.kind !== "swap" || item.state !== "fulfilled" || !item.delivery?.confirmed || published?.status !== "posted" ||
      !["gh0st-x-publication-v4", "gh0st-x-publication-v5"].includes(published.schema) || item.publicationPlan?.format !== "afterimage" ||
      typeof published.postId !== "string" || !POST_ID.test(published.postId) || BigInt(published.postId) < BigInt(PROOF_FOLLOWUP.anchorPostId))
    throw Error("Follow-up requires an eligible confirmed Afterimage post");
  const source = item.source;
  if (!source || source.manager?.toLowerCase() !== PROOF_FOLLOWUP.manager || source.pool_id !== PROOF_FOLLOWUP.poolId ||
      swapSourceId(PROOF_FOLLOWUP.chainId, source) !== item.id) throw Error("Follow-up source is not the confirmed Pons buy");
  const parentPlan = planPublication({ ...item.delivery, requestId: item.id }, { format: "afterimage",
    existingPublication: published, existingPlan: item.publicationPlan });
  if (parentPlan.format !== "afterimage" || parentPlan.text !== afterimageCaption(item.delivery.answer) ||
      parentPlan.delivery.answer !== item.delivery.answer || parentPlan.delivery.answerHash !== item.delivery.answerHash ||
      parentPlan.planId !== published.planId || parentPlan.textHash !== published.textHash)
    throw Error("Follow-up parent differs from its exact committed thought");
  let text = "ICP (deployment): " + ICP_CANISTER_PREFIX + PROOF_FOLLOWUP.canisterId +
    "\nRH (exact thought): " + RH_EXPLORER_PREFIX + parentPlan.delivery.transactionHash +
    "\nGitHub (code): " + GH0ST_REPOSITORY_URL;
  let weightedLength = "ICP (deployment): \nRH (exact thought): \nGitHub (code): ".length + 3 * 23;
  if (schema === SCHEMA) {
    text += "\nCA: " + PROOF_FOLLOWUP.contractAddress;
    weightedLength += "\nCA: ".length + PROOF_FOLLOWUP.contractAddress.length;
  }
  if (weightedLength > 280) throw Error("Follow-up exceeds X length limit");
  const base = { schema, sourceId: item.id, parentPostId: published.postId, parentPlan,
    source: { manager: source.manager.toLowerCase(), pool_id: source.pool_id,
      transaction_hash: source.transaction_hash, log_index: source.log_index },
    text, textHash: keccak256(toUtf8Bytes(text)), weightedLength };
  const plan = Object.freeze({ ...base, planId: hash(base) });
  if (existingPlan && JSON.stringify(existingPlan) !== JSON.stringify(plan))
    throw Error("Saved proof follow-up differs from its parent or original format");
  return plan;
}

function validatePlan(plan) {
  if (![LEGACY_SCHEMA, SCHEMA].includes(plan?.schema)) throw Error("Invalid proof follow-up plan");
  const rebuilt = planProofFollowup({ id: plan.sourceId, kind: "swap", state: "fulfilled", source: plan.source,
    delivery: plan.parentPlan?.delivery, publicationPlan: plan.parentPlan,
    publication: { schema: plan.parentPlan?.schema, status: "posted", planId: plan.parentPlan?.planId,
      textHash: plan.parentPlan?.textHash, postId: plan.parentPostId } }, { schema: plan.schema });
  if (JSON.stringify(rebuilt) !== JSON.stringify(plan)) throw Error("Proof follow-up plan was changed");
  return rebuilt;
}

export function eligibleProofFollowups(journal, { existingReplies = {} } = {}) {
  if (journal?.version !== 1 || journal.binding?.chainId !== PROOF_FOLLOWUP.chainId ||
      !proofGateways.includes(journal.binding.gateway?.toLowerCase()) || journal.binding.canisterId !== PROOF_FOLLOWUP.canisterId ||
      !Array.isArray(journal.requests)) throw Error("Main journal differs from the approved deployment");
  const plans = journal.requests.filter(item => item.publication?.status === "posted" &&
    POST_ID.test(item.publication.postId ?? "") && BigInt(item.publication.postId) >= BigInt(PROOF_FOLLOWUP.anchorPostId))
    .map(item => planProofFollowup(item, { existingPlan: existingReplies[item.publication.postId]?.plan }))
    .sort((a, b) => BigInt(a.parentPostId) < BigInt(b.parentPostId) ? -1 : 1);
  if (new Set(plans.map(plan => plan.parentPostId)).size !== plans.length) throw Error("Duplicate parent post in main journal");
  return plans;
}

async function requestJson(url, options, fetchImpl, timeoutMs) {
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([(async () => {
      const response = await fetchImpl(url, { ...options, redirect: "error", signal: controller.signal });
      if (Number(response.headers?.get?.("content-length") ?? 0) > 65536) throw Error("Oversized X response");
      let body;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let length = 0;
        try { for (;;) { const { done, value } = await reader.read(); if (done) break;
          length += value.length; if (length > 65536) { await reader.cancel(); throw Error("Oversized X response"); }
          chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } else { body = await response.json(); if (JSON.stringify(body).length > 65536) throw Error("Oversized X response"); }
      return { response, body };
    })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("X follow-up timeout")); }, timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

/** X may append a t.co media URL. Remove only a verified link to this parent's own photo. */
export function parentTextMatches(data, plan) {
  const answer = plan.parentPlan.text;
  // X may return a shortened preview in text for Premium long posts. When the
  // full note is present it is authoritative, including its own URL entities.
  if (data.note_tweet !== undefined) {
    if (typeof data.note_tweet?.text !== "string") return false;
    data = { ...data, text: data.note_tweet.text, entities: data.note_tweet.entities };
  }
  if (data.text === answer) return true;
  const offset = answer.length ? answer.length + 1 : 0;
  if (typeof data.text !== "string" || (answer.length && !data.text.startsWith(answer + " "))) return false;
  const tail = data.text.slice(offset);
  return (data.entities?.urls ?? []).some(entity => {
    if (entity.url !== tail || entity.start !== offset || entity.end !== data.text.length ||
        entity.media_key !== data.attachments?.media_keys?.[0]) return false;
    try { const url = new URL(entity.expanded_url); return url.protocol === "https:" &&
      ["x.com", "twitter.com"].includes(url.hostname) &&
      url.pathname.toLowerCase() === `/${PROOF_FOLLOWUP.username}/status/${plan.parentPostId}/photo/1`;
    } catch { return false; }
  });
}

export async function verifyFollowupParent(plan, { accessToken, fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  validatePlan(plan);
  const url = `https://api.x.com/2/tweets/${plan.parentPostId}?tweet.fields=author_id,entities,attachments,note_tweet&expansions=attachments.media_keys&media.fields=media_key,type,alt_text`;
  const { response, body } = await requestJson(url, { method: "GET", headers: { Authorization: "Bearer " + accessToken } }, fetchImpl, timeoutMs);
  const data = body?.data;
  if (response.status !== 200 || body.errors?.length || data?.id !== plan.parentPostId ||
      data.author_id !== PROOF_FOLLOWUP.userId || !parentTextMatches(data, plan))
    throw Error("X parent author or exact thought could not be verified");
  const keys = data.attachments?.media_keys;
  if (!Array.isArray(keys) || keys.length !== 1 || !/^\d+_[1-9]\d*$/.test(keys[0]) ||
      keys[0].split("_")[1] !== plan.parentPlan.media.id ||
      !body.includes?.media?.some(media => media.media_key === keys[0] && media.type === "photo" && media.alt_text === plan.parentPlan.media.altText))
    throw Error("X parent image differs from the confirmed Afterimage");
  return true;
}

export async function verifyFollowupReceipt(plan, { provider, iface } = {}) {
  validatePlan(plan);
  if (BigInt(await provider.send("eth_chainId", [])) !== 4663n) throw Error("Follow-up RPC chain mismatch");
  const d = plan.parentPlan.delivery, receipt = await provider.getTransactionReceipt(d.transactionHash);
  const gateway = receipt?.to?.toLowerCase();
  if (!proofGateways.includes(gateway)) throw Error("Callback did not target a pinned gateway");
  const canonicalBlock = receipt && await provider.getBlock(receipt.blockNumber);
  const verified = inspectFulfillment(receipt, canonicalBlock, gateway, iface,
    plan.sourceId, d.answerHash, d.answer, (await provider.getBlockNumber()) - 12);
  if (!verified || verified.transactionHash !== d.transactionHash || verified.blockHash !== d.blockHash ||
      verified.blockNumber !== d.blockNumber || verified.logIndex !== d.logIndex)
    throw Error("Canonical RH callback differs from the published thought");
  const sourceEvents = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== gateway) continue;
    let event; try { event = iface.parseLog(log); } catch { continue; }
    if (event?.name === "SwapThoughtRecorded" && event.args.requestId === plan.sourceId) sourceEvents.push(event);
  }
  const source = sourceEvents[0]?.args;
  if (sourceEvents.length !== 1 || source.poolId !== plan.source.pool_id || source.manager.toLowerCase() !== plan.source.manager ||
      source.swapTransactionHash !== plan.source.transaction_hash || BigInt(source.swapLogIndex) !== BigInt(plan.source.log_index))
    throw Error("Canonical RH callback does not bind the exact Pons swap");
  return true;
}

/** Persists an intent before a single reply attempt; unknown outcomes never resend. */
export async function sendProofFollowup(plan, { enabled = false, accessToken, existing = null, persist,
  verify, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 20_000 } = {}) {
  validatePlan(plan);
  if (existing && (existing.planId !== plan.planId || existing.parentPostId !== plan.parentPostId ||
      existing.schema !== plan.schema)) throw Error("Follow-up journal belongs to another parent");
  if (existing && !["posted", "blocked", "needs_reconciliation", "sending", "retry_after"].includes(existing.status))
    throw Error("Invalid follow-up journal status");
  if (existing && (!Number.isSafeInteger(existing.attempt) || existing.attempt < 0 || existing.attempt > 3 ||
      existing.status === "retry_after" && (!Number.isSafeInteger(existing.retryAt) || existing.retryAt < 0)))
    throw Error("Invalid follow-up attempt or retry time");
  if (!enabled || existing && ["posted", "blocked", "needs_reconciliation"].includes(existing.status)) return existing;
  if (typeof persist !== "function" || typeof verify !== "function" || typeof fetchImpl !== "function") throw Error("Durable follow-up callbacks are required");
  if (typeof accessToken !== "string" || !accessToken || /\s/.test(accessToken)) throw Error("Read-only valid X token required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error("Invalid follow-up timeout");
  const current = timestamp(now());
  const save = async state => { await persist(state); return state; };
  if (existing?.status === "sending") return save({ ...existing, status: "needs_reconciliation", updatedAt: current, reason: "A prior reply may have completed; do not resend blindly" });
  if (existing?.status === "retry_after" && existing.retryAt > current) return existing;
  const attempt = (existing?.attempt ?? 0) + 1;
  if (!Number.isSafeInteger(attempt) || attempt > 3) return save({ ...existing, status: "blocked", updatedAt: current, reason: "Follow-up retry limit reached" });
  await verify(plan); // Only read-only account, parent and canonical receipt checks.
  const intent = { schema: plan.schema, planId: plan.planId, parentPostId: plan.parentPostId,
    textHash: plan.textHash, status: "sending", attempt, startedAt: current, updatedAt: current };
  await save(intent);
  let result;
  try { result = await requestJson(X_CREATE_POST_URL, { method: "POST", headers: {
    Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ text: plan.text, reply: { in_reply_to_tweet_id: plan.parentPostId } }) }, fetchImpl, timeoutMs); }
  catch { return save({ ...intent, status: "needs_reconciliation", updatedAt: timestamp(now()), reason: "Reply outcome is unknown; reconcile before retrying" }); }
  const { response, body } = result;
  if (response.status === 201 && typeof body?.data?.id === "string" && POST_ID.test(body.data.id) && !body.errors?.length) return save({ ...intent, status: "posted",
    updatedAt: timestamp(now()), postId: body.data.id, postUrl: "https://x.com/i/web/status/" + body.data.id });
  if (response.status === 429 && !body?.data?.id) {
    const after = response.headers?.get?.("retry-after"), reset = response.headers?.get?.("x-rate-limit-reset");
    const retryAt = Math.max(current + 300_000,
      /^\d+$/.test(after ?? "") ? current + Number(after) * 1000 : Date.parse(after) || 0,
      /^\d+$/.test(reset ?? "") ? Number(reset) * 1000 : 0);
    return save({ ...intent, status: attempt >= 3 || !Number.isSafeInteger(retryAt) || retryAt > current + 86400000 ? "blocked" : "retry_after",
      updatedAt: timestamp(now()), retryAt, httpStatus: 429, reason: "X rate limited this proof reply" });
  }
  const blocked = [400,401,403,404,405,413,415,422].includes(response.status) && !body?.data?.id;
  return save({ ...intent, status: blocked ? "blocked" : "needs_reconciliation", updatedAt: timestamp(now()),
    ...(typeof body?.data?.id === "string" && POST_ID.test(body.data.id) ? { observedPostId: body.data.id } : {}),
    httpStatus: response.status, reason: blocked ? "X rejected this proof reply" : "X reply response is ambiguous; reconcile before retrying" });
}
