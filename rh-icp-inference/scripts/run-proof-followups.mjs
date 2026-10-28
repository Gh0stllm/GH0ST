import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Interface, JsonRpcProvider } from "ethers";
import { verifyPublishingAccount } from "../worker/x-publisher.mjs";
import { PROOF_FOLLOWUP as P, eligibleProofFollowups, readFollowupToken, sendProofFollowup,
  verifyFollowupParent, verifyFollowupReceipt } from "../worker/x-proof-followups.mjs";
import { loadRetainedProofState, saveRetainedProofState, unarchivedProofInputs,
  assertArchivedProofPlan } from "../worker/proof-retention.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = value => JSON.stringify(value, null, 2);
function readJson(file, limit = 16 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || (stat.mode & 0o077) !== 0 ||
      typeof process.getuid === "function" && stat.uid !== process.getuid()) throw Error("Sidecar inputs must be bounded private regular files");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function proofSidecarBinding(mainJournal) {
  return { mainJournal: path.resolve(mainJournal), anchorPostId: P.anchorPostId,
    // This is the immutable archive lineage, not the current callback destination.
    // Preserve it so existing plans, archive hashes and dedup records never move.
    gateway: P.historyGateway, canisterId: P.canisterId, username: P.username, userId: P.userId };
}

export function loadProofSidecar(file, binding) {
  return loadRetainedProofState(file, binding);
}

export function saveProofSidecar(file, state) {
  saveRetainedProofState(file, state);
}

/** Main journal is input only. A failed proof reply cannot mutate its buy queue. */
export async function runProofFollowupPass({ mainJournal, state, persist, getToken,
  verifyAccount, verifyParent, verifyReceipt, send = sendProofFollowup, now = Date.now }) {
  const plans = eligibleProofFollowups(unarchivedProofInputs(mainJournal, state), { existingReplies: state.replies });
  let token;
  for (const plan of plans) {
    if (assertArchivedProofPlan(state, plan)) continue;
    let entry = state.replies[plan.parentPostId];
    if (entry && entry.plan.planId !== plan.planId) throw Error("Saved proof reply changed its parent or callback");
    if (entry && ["posted", "blocked", "needs_reconciliation"].includes(entry.publication?.status)) continue;
    if (!entry) {
      entry = state.replies[plan.parentPostId] = { plan };
      await persist(state);
    }
    if (entry.publication?.status === "retry_after" && entry.publication.retryAt > now()) continue;
    if (entry.nextCheckAt > now()) continue;
    token ??= await getToken();
    if (!token) return { status: "waiting_for_main_token", eligible: plans.length };
    try {
      await verifyAccount(token);
      const publication = await send(plan, { enabled: true, accessToken: token.accessToken,
        existing: entry.publication, now,
        verify: async () => { await verifyParent(plan, token); await verifyReceipt(plan); },
        persist: async value => { entry.publication = value; delete entry.lastError; await persist(state); } });
      entry.publication = publication; delete entry.lastError; delete entry.nextCheckAt; entry.verificationFailures = 0;
    } catch {
      // No provider message or token is copied into the journal. A read failure
      // happened before sending; the same fixed plan is checked next pass.
      entry.lastError = "Read-only verification unavailable; proof reply remains pending";
      entry.lastCheckedAt = now();
      entry.verificationFailures = (entry.verificationFailures ?? 0) + 1;
      entry.nextCheckAt = now() + Math.min(900_000, 30_000 * 2 ** (entry.verificationFailures - 1));
      if (entry.verificationFailures >= 6) entry.publication = { schema: plan.schema, planId: plan.planId,
        parentPostId: plan.parentPostId, status: "blocked", attempt: 0,
        reason: "Read-only proof verification repeatedly failed; review before retrying" };
    }
    await persist(state);
  }
  return { status: "checked", eligible: plans.length };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["--execute", "--once", "--dry-run"].includes(arg) && !options[arg]) options[arg] = true;
    else if (arg === "--state" && !options[arg] && path.isAbsolute(argv[i + 1] ?? "")) options[arg] = argv[++i];
    else throw Error("Use --once --dry-run, --once --execute or --execute; optional --state ABSOLUTE_FILE");
  }
  if (options["--execute"] && options["--dry-run"]) throw Error("Choose dry-run or execute");
  const execute = !!options["--execute"], once = !!options["--once"];
  const mainJournal = path.resolve(process.env.JOURNAL ?? path.join(root, ".state/buy-worker.json"));
  const ownJournal = path.resolve(options["--state"] ?? process.env.PROOF_FOLLOWUP_JOURNAL ?? path.join(root, ".state/x-proof-followups.json"));
  if ([mainJournal, mainJournal + ".lock", mainJournal + ".tmp"].includes(ownJournal) ||
      ownJournal === process.env.X_OAUTH_TOKEN_FILE) throw Error("Sidecar must use its own separate journal");
  const binding = proofSidecarBinding(mainJournal);
  if (!execute) {
    const state = loadProofSidecar(ownJournal, binding);
    const plans = eligibleProofFollowups(unarchivedProofInputs(readJson(mainJournal), state), { existingReplies: state.replies });
    const pending = plans.filter(plan => !["posted", "blocked", "needs_reconciliation", "sending"].includes(state.replies[plan.parentPostId]?.publication?.status));
    if (options["--dry-run"] && pending.length) {
      if (!process.env.RH_RPC_URL || !process.env.X_OAUTH_TOKEN_FILE) throw Error("Dry verification needs private RPC and existing token file");
      const token = readFollowupToken(process.env.X_OAUTH_TOKEN_FILE);
      if (!token) throw Error("Waiting for main worker to provide a fresh verified token");
      const provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
      try {
        const account = await verifyPublishingAccount({ enabled: true, accessToken: token.accessToken, expectedUsername: P.username });
        if (account.id !== P.userId) throw Error("Unexpected proof account");
        const iface = new Interface(JSON.parse(fs.readFileSync(path.join(root, "build/gateway.json"), "utf8")).abi);
        for (const plan of pending) {
          await verifyFollowupParent(plan, { accessToken: token.accessToken });
          await verifyFollowupReceipt(plan, { provider, iface });
        }
      } finally { provider.destroy(); }
    }
    console.log(json({ execute: false, followups: plans.map(plan => ({ parentPostId: plan.parentPostId,
      sourceId: plan.sourceId, schema: plan.schema, text: plan.text, weightedLength: plan.weightedLength,
      existingStatus: state.replies[plan.parentPostId]?.publication?.status ?? null,
      wouldSend: pending.includes(plan), verified: !!options["--dry-run"] && pending.includes(plan) })) }));
    return;
  }
  if (!process.env.RH_RPC_URL || !process.env.X_OAUTH_TOKEN_FILE) throw Error("Private RPC and existing OAuth token file are required");
  fs.mkdirSync(path.dirname(ownJournal), { recursive: true, mode: 0o700 });
  const lockPath = ownJournal + ".lock";
  const lock = fs.openSync(lockPath, "wx", 0o600); fs.writeFileSync(lock, String(process.pid)); fs.fsyncSync(lock);
  let provider, stopped = false, verifiedFingerprint;
  const stop = () => { stopped = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const state = loadProofSidecar(ownJournal, binding);
    const iface = new Interface(JSON.parse(fs.readFileSync(path.join(root, "build/gateway.json"), "utf8")).abi);
    provider = new JsonRpcProvider(process.env.RH_RPC_URL, 4663, { staticNetwork: true, cacheTimeout: -1 });
    do {
      const journal = readJson(mainJournal);
      await runProofFollowupPass({ mainJournal: journal, state,
        persist: value => saveProofSidecar(ownJournal, value),
        getToken: () => stopped ? null : readFollowupToken(process.env.X_OAUTH_TOKEN_FILE),
        verifyAccount: async token => {
          if (verifiedFingerprint === token.fingerprint) return;
          const account = await verifyPublishingAccount({ enabled: true, accessToken: token.accessToken, expectedUsername: P.username });
          if (account.id !== P.userId) throw Error("Unexpected proof account");
          verifiedFingerprint = token.fingerprint;
        },
        verifyParent: (plan, token) => verifyFollowupParent(plan, { accessToken: token.accessToken }),
        verifyReceipt: async plan => { await verifyFollowupReceipt(plan, { provider, iface }); if (stopped) throw Error("Sidecar stopped"); },
      });
      if (once || stopped) break;
      await delay(5000);
    } while (!stopped);
  } finally {
    provider?.destroy(); process.off("SIGINT", stop); process.off("SIGTERM", stop);
    fs.closeSync(lock); fs.unlinkSync(lockPath);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(() => { console.error("Proof follow-up sidecar stopped; main thought worker is unchanged. Preserve its separate journal for review."); process.exitCode = 1; });
