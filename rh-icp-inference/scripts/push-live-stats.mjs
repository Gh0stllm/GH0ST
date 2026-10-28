import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { createCollector, statsIdlFactory, STATS_IDS } from "./live-stats.mjs";

export const LIVE_STATS_INGEST_URL = "https://gh0st.wiki/api/live-stats-ingest";
export const LIVE_STATS_MAX_BYTES = 65536;
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TOKEN_FILE = path.join(os.homedir(), ".config/gh0st/netlify-live-push.json");
const nat = value => /^(0|[1-9]\d*)$/.test(String(value)) ? String(value) : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const str = (value, max = 300) => typeof value === "string" ? value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0,max) : null;
const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const hash = value => /^0x[0-9a-f]{64}$/i.test(value ?? "") ? value.toLowerCase() : null;
const address = value => /^0x[0-9a-f]{40}$/i.test(value ?? "") ? value.toLowerCase() : null;
const postId = value => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value : null;
const xUrl = value => /^https:\/\/x\.com\/i\/web\/status\/[1-9][0-9]{0,19}$/.test(value ?? "") ? value : null;
const callbackUrl = value => /^https:\/\/robin\.etherscan\.io\/tx\/0x[0-9a-f]{64}$/i.test(value ?? "") ? value : null;
const ICP_URL = "https://dashboard.internetcomputer.org/canister/" + STATS_IDS.coordinator;

/** Explicit public projection: never serialize the worker journal, logs or credentials. */
export function publicStats(snapshot) {
  if (snapshot?.schema !== "gh0st-live-stats-v1" || !iso(snapshot.observedAt) || !snapshot.queue || !snapshot.freshness)
    throw Error("Invalid public stats snapshot");
  const fresh = item => ({ observedAt: iso(item?.observedAt), ageMs: count(item?.ageMs), stale: item?.stale !== false,
    ...(item?.modifiedAt !== undefined ? { modifiedAt: iso(item.modifiedAt) } : {}),
    ...(item?.checkedAt !== undefined ? { checkedAt: iso(item.checkedAt) } : {}) });
  const processStatus = item => ({ status: ["running","stopped","not_observed","unknown"].includes(item?.status) ? item.status : "unknown" });
  const queue = Object.fromEntries(["total","queued","active","completed","failed","deferred","coordinatorCompleted","pilotCompleted"]
    .map(key => [key,count(snapshot.queue[key])]));
  const a = snapshot.active;
  const active = a && hash(a.id) ? { id: hash(a.id), phase: ["Verified","Running","ReadyToSign","Complete","Failed"].includes(a.phase) ? a.phase : null,
    busy: typeof a.busy === "boolean" ? a.busy : null, attempt: nat(a.attempt),
    promptIngested: typeof a.promptIngested === "boolean" ? a.promptIngested : null,
    previousRejection: str(a.previousRejection), inputTokens: nat(a.inputTokens), outputTokens: nat(a.outputTokens),
    modelCycles: nat(a.modelCycles), chunks: count(a.chunks), countersBasis: "last_confirmed",
    batchStartedAt: iso(a.batchStartedAt), batchElapsedMs: count(a.batchElapsedMs),
    pendingUpdate: a.pendingUpdate === "advance" ? "advance" : null, promptRemaining: count(a.promptRemaining),
    logSample: a.logSample && iso(a.logSample.observedAt) ? { observedAt: iso(a.logSample.observedAt),
      chunk: count(a.logSample.chunk), decoded: count(a.logSample.decoded), generated: count(a.logSample.generated),
      promptRemaining: count(a.logSample.promptRemaining), eog: a.logSample.eog === true, certified: false } : null } : null;
  const posts = (Array.isArray(snapshot.posts) ? snapshot.posts : []).slice(0,12).map(post => ({
    sourceId: hash(post?.sourceId), postId: postId(post?.postId), url: xUrl(post?.url),
    answer: str(post?.answer,600), text: str(post?.text,600), postedAt: iso(post?.postedAt),
    callbackUrl: callbackUrl(post?.callbackUrl), icpUrl: post?.icpUrl === ICP_URL ? ICP_URL : null,
    icpProofKind: "deployment", proofReplyUrl: xUrl(post?.proofReplyUrl),
  })).filter(post => post.sourceId && post.postId && post.url && post.callbackUrl);
  const result = { schema: "gh0st-live-stats-v1", observedAt: iso(snapshot.observedAt),
    chain: { coordinatorId: STATS_IDS.coordinator, modelId: STATS_IDS.model, gateway: address(snapshot.chain?.gateway),
      artifactHash: hash(snapshot.chain?.artifactHash), executionCycleLimit: nat(snapshot.chain?.executionCycleLimit) },
    freshness: { journal: fresh(snapshot.freshness.journal), icp: fresh(snapshot.freshness.icp), log: fresh(snapshot.freshness.log) },
    process: { worker: processStatus(snapshot.process?.worker), sidecar: processStatus(snapshot.process?.sidecar) }, queue, active, posts,
    warnings: (Array.isArray(snapshot.warnings) ? snapshot.warnings : []).filter(w => typeof w === "string" && /^[a-z_]{1,60}$/.test(w)).slice(0,8) };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > LIVE_STATS_MAX_BYTES) throw Error("Public stats snapshot is too large");
  return result;
}

/** Private bearer exists only in process memory; no environment or CLI fallback. */
export function readPushToken(file = TOKEN_FILE) {
  if (!path.isAbsolute(file)) throw Error("Push token file must be absolute");
  const stat = fs.lstatSync(file), real = fs.realpathSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || (stat.mode & 0o077) !== 0 ||
      typeof process.getuid === "function" && stat.uid !== process.getuid() || real === ROOT.slice(0,-1) || real.startsWith(ROOT))
    throw Error("Push token must be a private regular file outside the repository");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  if (record.schema !== "gh0st-netlify-live-push-v1" || record.endpoint !== LIVE_STATS_INGEST_URL ||
      record.siteId !== "1460fb0c-b81d-4624-aac5-b78658310ce0" || record.intervalMs !== 10000)
    throw Error("Push configuration differs from the approved site and interval");
  const value = record.token;
  if (typeof value !== "string" || value.length < 32 || value.length > 512 || /\s/.test(value)) throw Error("Invalid private push token");
  return value;
}

export async function pushSnapshot(snapshot, { token, fetchImpl = globalThis.fetch, timeoutMs = 7000 } = {}) {
  const publicSnapshot = publicStats(snapshot);
  if (typeof token !== "string" || token.length < 32 || token.length > 512 || /\s/.test(token)) throw Error("Invalid push authorization");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error("Invalid stats push timeout");
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([(async () => {
      const response = await fetchImpl(LIVE_STATS_INGEST_URL, { method: "POST", redirect: "error", cache: "no-store",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(publicSnapshot), signal: controller.signal });
      if (response.status === 401 || response.status === 403) return { status: "unauthorized", httpStatus: response.status };
      if (response.status === 409) return { status: "stale", httpStatus: 409 };
      if (response.status !== 202) return { status: "unavailable", httpStatus: response.status };
      let body; try { body = await response.json(); } catch { return { status: "unavailable", httpStatus: 202 }; }
      return body?.accepted === true && body.observedAt === publicSnapshot.observedAt
        ? { status: "accepted", observedAt: body.observedAt } : { status: "unavailable", httpStatus: 202 };
    })(), new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ status: "timeout" }); }, timeoutMs); })]);
  } catch { return { status: "unavailable" }; }
  finally { clearTimeout(timer); }
}

export function acquireUplinkLock(file = path.join(ROOT, ".state/live-stats-uplink.lock")) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = fs.openSync(file, "wx", 0o600); }
  catch { throw Error("Another stats uplink owns the lock; review it before retrying"); }
  const value = String(process.pid);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); }
  catch (error) { fs.closeSync(fd); fs.unlinkSync(file); throw error; }
  let released = false;
  return () => {
    if (released) return; released = true; fs.closeSync(fd);
    // Never unlink a replacement lock after an operator intervenes.
    try { if (fs.readFileSync(file,"utf8") === value) fs.unlinkSync(file); } catch {}
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some(arg => !["--execute","--once","--dry-run"].includes(arg)) || new Set(argv).size !== argv.length ||
      argv.includes("--execute") && argv.includes("--dry-run")) throw Error("Use --dry-run, --once --execute, or --execute. No token arguments.");
  const execute = argv.includes("--execute"), once = argv.includes("--once");
  const release = execute ? acquireUplinkLock() : () => {};
  let collector, stopped = false, timers = [];
  const stop = () => { stopped = true; collector?.stop(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const agent = await HttpAgent.create({ host: "https://icp-api.io",
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(7000) }) });
    const actor = Actor.createActor(statsIdlFactory, { agent, canisterId: STATS_IDS.coordinator });
    collector = createCollector({ actor, journalPath: path.resolve(process.env.JOURNAL ?? path.join(ROOT, ".state/buy-worker-unlimited.json")),
      sidecarPath: path.join(ROOT, ".state/x-proof-followups.json") });
    collector.readLocal(); await collector.pollIcp(); await collector.pollLogs();
    if (stopped) return;
    if (!execute) {
      const value = publicStats(collector.snapshot());
      console.log(JSON.stringify({ execute: false, schema: value.schema, observedAt: value.observedAt,
        completed: value.queue.coordinatorCompleted, queued: value.queue.queued, posts: value.posts.length,
        bytes: Buffer.byteLength(JSON.stringify(value), "utf8") })); return;
    }
    timers = [setInterval(collector.readLocal,2000), setInterval(() => void collector.pollIcp(),8000),
      setInterval(() => void collector.pollLogs(),12000)];
    while (!stopped) {
      const started = Date.now();
      const result = await pushSnapshot(collector.snapshot(), { token: readPushToken() });
      console.log(JSON.stringify(result));
      if (result.status === "unauthorized") throw Error("Live stats push authorization rejected");
      if (once) break;
      await delay(Math.max(0,10000-(Date.now()-started)));
    }
  } finally { stop(); timers.forEach(clearInterval); process.off("SIGINT",stop); process.off("SIGTERM",stop); release(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(() => { console.error("Live stats uplink stopped. Check its private token and connection; the generation worker is unchanged."); process.exitCode = 1; });
