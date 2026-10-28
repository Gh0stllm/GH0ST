import fs from "node:fs";
import {listCoordinatorJobs, retentionStatusType, jobPageType} from "../worker/job-history.mjs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const STATS_IDS = Object.freeze({ coordinator: "6jacx-5yaaa-aaaaj-a65jq-cai", model: "6obed-qaaaa-aaaaj-a65ja-cai" });
const ICP_CLI = "/Users/abhijith/.cargo/bin/icp";
const execFile = promisify(nodeExecFile);
const HASH = /^0x[0-9a-f]{64}$/i, ADDRESS = /^0x[0-9a-f]{40}$/i, POST = /^[1-9][0-9]{0,19}$/;
const num = value => { if (value == null || value === "") return null; const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null; };
const nat = value => /^(0|[1-9][0-9]*)$/.test(String(value)) ? String(value) : null;
const text = (value, max = 300) => typeof value === "string" ? value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, max) : null;
const iso = value => num(value) !== null && Number(value) < 253402300800000 ? new Date(Number(value)).toISOString() : null;
const phase = job => typeof job?.phase === "string" ? job.phase : Object.keys(job?.phase ?? {})[0] ?? null;
const hash = value => HASH.test(value ?? "") ? value.toLowerCase() : null;

// Deliberately query-only Candid interface: no wallet, identity or update method.
export function statsIdlFactory({ IDL }) {
  const Job = IDL.Record({ request: IDL.Record({ id: IDL.Text }),
    phase: IDL.Variant({ Verified: IDL.Null, Running: IDL.Null, ReadyToSign: IDL.Null, Complete: IDL.Null, Failed: IDL.Null }),
    busy: IDL.Bool, prompt_ingested: IDL.Bool, input_tokens: IDL.Nat64, output_tokens: IDL.Nat64,
    model_cycles: IDL.Nat, chunks: IDL.Nat32,
    voice: IDL.Opt(IDL.Record({ attempt: IDL.Nat8, generation: IDL.Opt(IDL.Nat), quality_error: IDL.Text })) });
  return IDL.Service({ get_job: IDL.Func([IDL.Text], [IDL.Opt(Job)], ["query"]),
    list_jobs: IDL.Func([], [IDL.Vec(Job)], ["query"]),
    retention_status: IDL.Func([], [retentionStatusType(IDL)], ["query"]),
    list_jobs_page: IDL.Func([IDL.Opt(IDL.Text), IDL.Nat32], [jobPageType(IDL, Job)], ["query"]),
    get_config: IDL.Func([], [IDL.Record({ model_canister: IDL.Principal, gateway: IDL.Text,
      artifact_hash: IDL.Text, model_cycle_budget: IDL.Nat })], ["query"]) });
}

export function readPrivateJson(file, limit = 16 * 1024 * 1024) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > limit || (s.mode & 0o077) !== 0 ||
      typeof process.getuid === "function" && s.uid !== process.getuid()) throw Error("private_input_unavailable");
  return { value: JSON.parse(fs.readFileSync(file, "utf8")), mtimeMs: s.mtimeMs };
}

export function processHealth(lockPath, { read = fs.readFileSync, alive = pid => process.kill(pid, 0) } = {}) {
  try {
    const value = String(read(lockPath, "utf8")).trim();
    if (!/^[1-9][0-9]{0,8}$/.test(value)) return { status: "unknown" };
    alive(Number(value)); return { status: "running" };
  } catch (error) { return { status: error.code === "ESRCH" ? "stopped" : error.code === "ENOENT" ? "not_observed" : "unknown" }; }
}

/** Diagnostic sample only; never infer total progress or expose raw log text. */
export function parsePrefillSample(value, { startedAt, nowMs = Date.now() }) {
  if (num(startedAt) === null) return null;
  const records = value?.log_records;
  if (!Array.isArray(records) || records.length > 10000) return null;
  let latest = null;
  for (const row of records) {
    let stamp;
    try { stamp = BigInt(row.timestamp); } catch { continue; }
    if (stamp < BigInt(startedAt) * 1000000n || stamp > BigInt(nowMs + 5000) * 1000000n) continue;
    let content = row.content ?? row.message;
    if (Array.isArray(content) && content.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) content = Buffer.from(content).toString("utf8");
    if (typeof content !== "string" || content.length > 16384) continue;
    const match = /run_update_full - chunk (\d+): decoded=(\d+) generated=(\d+) prompt_remaining_tokens=(\d+) eog=([01])(?:\s|$)/.exec(content);
    if (!match || match.slice(1).some(x => num(x) === null)) continue;
    if (latest && stamp <= latest.stamp) continue;
    latest = { stamp, observedAt: iso(Number(stamp / 1000000n)), chunk: Number(match[1]), decoded: Number(match[2]),
      generated: Number(match[3]), promptRemaining: Number(match[4]), eog: match[5] === "1", certified: false };
  }
  if (!latest) return null;
  const { stamp, ...sample } = latest; return sample;
}

function freshness(at, nowMs, maxAge) {
  if (num(at) === null) at = null;
  const ageMs = at == null ? null : Math.max(0, nowMs - at);
  return { observedAt: at == null ? null : iso(at), ageMs, stale: ageMs === null || ageMs > maxAge };
}

export function buildStats({ journal, journalAt, journalMtime, replies, job, jobSourceId, config, jobs,
  icpAt, logSample, logSourceId, logStartedAt, logAt, worker, sidecar, nowMs = Date.now(), warnings = [] }) {
  const entries = Array.isArray(journal?.buyQueue?.entries) ? journal.buyQueue.entries : [];
  const requests = Array.isArray(journal?.requests) ? journal.requests : [];
  const activeId = hash(journal?.buyQueue?.activeSourceId);
  const item = requests.find(r => r.id === activeId);
  const useJob = activeId && jobSourceId === activeId && job?.request?.id === activeId ? job : null;
  const pending = item?.pendingUpdate?.sourceId === activeId && item.pendingUpdate.operation === "advance" ? item.pendingUpdate : null;
  const batchStarted = num(pending?.startedAt);
  const confirmedPhase = useJob ? phase(useJob) : item?.phase ?? null;
  const busy = useJob ? useJob.busy === true : null;
  const overlapping = Array.isArray(jobs) && jobs.filter(j => j.busy).length > 1;
  const sample = useJob && busy && !overlapping && !useJob.prompt_ingested && logSourceId === activeId && logStartedAt === batchStarted &&
    logSample && !freshness(logAt, nowMs, 30000).stale &&
    !freshness(Date.parse(logSample.observedAt), nowMs, 30000).stale ? logSample : null;
  const voice = useJob?.voice?.[0];
  const active = activeId ? { id: activeId, phase: text(confirmedPhase, 30), busy,
    attempt: nat(voice?.generation?.[0] ?? voice?.attempt), promptIngested: useJob ? !!useJob.prompt_ingested : null,
    previousRejection: text(voice?.quality_error, 300) || null,
    inputTokens: nat(useJob?.input_tokens), outputTokens: nat(useJob?.output_tokens),
    modelCycles: nat(useJob?.model_cycles ?? item?.modelCycles), chunks: num(useJob?.chunks),
    countersBasis: "last_confirmed", batchStartedAt: iso(batchStarted),
    batchElapsedMs: batchStarted == null ? null : Math.max(0, nowMs - batchStarted),
    pendingUpdate: pending ? "advance" : null, promptRemaining: sample?.promptRemaining ?? null, logSample: sample } : null;
  const counts = key => entries.filter(e => e.status === key).length;
  const completeJobs = Array.isArray(jobs) ? jobs.filter(j => phase(j) === "Complete") : [];
  const knownIds = new Set(entries.map(e => e.event?.id));
  const posts = requests.filter(r => r.publication?.status === "posted" && POST.test(r.publication.postId ?? "") &&
    r.delivery?.confirmed === true && hash(r.delivery.transactionHash)).map(r => {
    const postId = r.publication.postId, reply = replies?.replies?.[postId]?.publication;
    return { sourceId: hash(r.id), postId, url: `https://x.com/i/web/status/${postId}`,
      answer: text(r.delivery.answer, 600), text: text(r.delivery.answer, 600), postedAt: iso(r.publication.updatedAt ?? r.publication.startedAt),
      callbackUrl: `https://robin.etherscan.io/tx/${hash(r.delivery.transactionHash)}`,
      icpUrl: `https://dashboard.internetcomputer.org/canister/${STATS_IDS.coordinator}`, icpProofKind: "deployment",
      proofReplyUrl: reply?.status === "posted" && POST.test(reply.postId ?? "") ? `https://x.com/i/web/status/${reply.postId}` : null };
  }).sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "")).slice(0, 12);
  return { schema: "gh0st-live-stats-v1", observedAt: iso(nowMs),
    chain: { coordinatorId: STATS_IDS.coordinator, modelId: STATS_IDS.model,
      gateway: ADDRESS.test(config?.gateway ?? "") ? config.gateway : null,
      artifactHash: hash(config?.artifact_hash), executionCycleLimit: nat(config?.model_cycle_budget) },
    freshness: { journal: { ...freshness(journalAt, nowMs, 7000), modifiedAt: iso(journalMtime) },
      icp: freshness(icpAt, nowMs, 20000),
      log: { ...freshness(logSample?.observedAt ? Date.parse(logSample.observedAt) : null, nowMs, 30000), checkedAt: iso(logAt) } },
    process: { worker: worker ?? { status: "unknown" }, sidecar: sidecar ?? { status: "unknown" } },
    queue: { total: entries.length, queued: counts("queued") + counts("parked"), active: activeId ? 1 : 0,
      completed: counts("completed"), failed: entries.filter(e => ["failed", "ambiguous", "failed_final", "not_executed"].includes(e.status) && !e.ownerDeferral).length,
      deferred: entries.filter(e => !!e.ownerDeferral).length,
      coordinatorCompleted: Array.isArray(jobs) ? completeJobs.length : null,
      pilotCompleted: Array.isArray(jobs) ? completeJobs.filter(j => !knownIds.has(j.request?.id)).length : null },
    active, posts, warnings: [...new Set(warnings.filter(w => /^[a-z_]{1,60}$/.test(w)))].slice(0, 8) };
}

export function createCollector({ actor, journalPath, sidecarPath, read = readPrivateJson, logsExec = execFile,
  now = Date.now, health = processHealth } = {}) {
  const state = {}; let stopped = false, icpBusy = false, logBusy = false;
  const warn = new Set();
  function readLocal() {
    try { const r = read(journalPath); state.journal = r.value; state.journalAt = now(); state.journalMtime = r.mtimeMs; warn.delete("journal_unavailable"); }
    catch { warn.add("journal_unavailable"); }
    try { state.replies = read(sidecarPath).value; warn.delete("proof_journal_unavailable"); } catch { warn.add("proof_journal_unavailable"); }
    state.worker = health(journalPath + ".lock"); state.sidecar = health(sidecarPath + ".lock");
  }
  async function pollIcp() {
    if (stopped || icpBusy) return; icpBusy = true;
    try {
      const id = hash(state.journal?.buyQueue?.activeSourceId);
      const [config, jobs, found] = await Promise.all([actor.get_config(), listCoordinatorJobs(actor), id ? actor.get_job(id) : []]);
      if (stopped) return;
      Object.assign(state, { config, jobs, job: found?.[0] ?? null, jobSourceId: id, icpAt: now() });
      warn.delete("icp_query_unavailable");
    } catch { warn.add("icp_query_unavailable"); } finally { icpBusy = false; }
  }
  async function pollLogs() {
    if (stopped || logBusy) return;
    const id = hash(state.journal?.buyQueue?.activeSourceId), item = state.journal?.requests?.find(r => r.id === id);
    const pending = item?.pendingUpdate;
    if (!id || state.jobSourceId !== id || state.job?.request?.id !== id || !state.job.busy || state.job.prompt_ingested ||
        pending?.operation !== "advance" || pending.sourceId !== id || num(pending.startedAt) === null ||
        !Array.isArray(state.jobs) || state.jobs.filter(j => j.busy).length !== 1) return;
    logBusy = true;
    try {
      const response = await logsExec(ICP_CLI, ["canister", "logs", STATS_IDS.model, "-e", "production", "--identity", "gh0st-deployer",
        "--since", iso(pending.startedAt), "--json"], { cwd: ROOT, timeout: 10000, maxBuffer: 512 * 1024, windowsHide: true });
      const parsed = JSON.parse(response.stdout.replace(/("timestamp"\s*:\s*)(\d{16,})/g, '$1"$2"'));
      if (stopped) return;
      Object.assign(state, { logSample: parsePrefillSample(parsed, { startedAt: pending.startedAt, nowMs: now() }),
        logSourceId: id, logStartedAt: pending.startedAt, logAt: now() }); warn.delete("model_logs_unavailable");
    } catch { warn.add("model_logs_unavailable"); } finally { logBusy = false; }
  }
  return { readLocal, pollIcp, pollLogs, stop: () => { stopped = true; },
    snapshot: () => buildStats({ ...state, nowMs: now(), warnings: [...warn] }) };
}

export function createStatsServer({ snapshot, dashboardDir = path.join(ROOT, "live-dashboard"), port = 8790 }) {
  const server = http.createServer((req, res) => {
    const actualPort = port || server.address()?.port;
    const allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
    const host = req.headers.host, origin = req.headers.origin;
    if (!allowedHosts.has(host) || origin && !allowedHosts.has(origin.replace(/^http:\/\//, "")) ||
        !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(req.socket.remoteAddress)) {
      res.writeHead(403); res.end("Local access only"); return;
    }
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    if (req.url === "/api/stats") {
      res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(req.method === "HEAD" ? "" : JSON.stringify(snapshot())); return;
    }
    const name = req.url === "/" ? "index.html" : req.url?.slice(1);
    if (!["index.html", "dashboard.js", "style.css"].includes(name)) { res.writeHead(404); res.end(); return; }
    try {
      const target = path.join(dashboardDir, name), stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error();
      const bytes = fs.readFileSync(target), source = bytes.toString("utf8");
      const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`).join(" ");
      res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`);
      res.setHeader("Content-Type", name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
      res.end(req.method === "HEAD" ? "" : bytes);
    } catch { res.writeHead(404); res.end("Dashboard unavailable"); }
  });
  return server;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length) throw Error("No command arguments are supported");
  const agent = await HttpAgent.create({ host: "https://icp-api.io",
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(7000) }) }); // Anonymous, pinned mainnet trust; no key/token reads.
  const actor = Actor.createActor(statsIdlFactory, { agent, canisterId: STATS_IDS.coordinator });
  const collector = createCollector({ actor, journalPath: path.resolve(process.env.JOURNAL ?? path.join(ROOT, ".state/buy-worker-unlimited.json")),
    sidecarPath: path.resolve(process.env.PROOF_FOLLOWUP_JOURNAL ?? path.join(ROOT, ".state/x-proof-followups.json")) });
  collector.readLocal(); void collector.pollIcp();
  const timers = [setInterval(collector.readLocal, 2000), setInterval(() => void collector.pollIcp(), 8000),
    setInterval(() => void collector.pollLogs(), 12000)];
  const server = createStatsServer({ snapshot: collector.snapshot });
  server.listen(8790, "127.0.0.1", () => console.log("Read-only GH0ST dashboard: http://127.0.0.1:8790"));
  const stop = () => { collector.stop(); timers.forEach(clearInterval); server.close(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  return { server, collector, stop };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(() => { console.error("Read-only stats service could not start."); process.exitCode = 1; });
