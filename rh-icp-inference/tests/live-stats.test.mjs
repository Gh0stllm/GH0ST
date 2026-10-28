import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCollector, buildStats, parsePrefillSample, createStatsServer, readPrivateJson, statsIdlFactory } from "../scripts/live-stats.mjs";
import { IDL } from "@icp-sdk/core/candid";

const NOW = 1793034000000, id = "0x" + "aa".repeat(32), tx = "0x" + "bb".repeat(32);
function fixture() {
  const job = { request: { id }, phase: { Running: null }, busy: true, prompt_ingested: false,
    input_tokens: 0n, output_tokens: 0n, model_cycles: 5377000000000n, chunks: 41, voice: [{ attempt: 4, generation: [4n] }] };
  const journal = { buyQueue: { activeSourceId: id, entries: [{ event: { id }, status: "generating" },
    { event: { id: tx }, status: "queued" }] }, requests: [{ id, phase: "Running", modelCycles: "5000000000000",
    pendingUpdate: { operation: "advance", sourceId: id, startedAt: NOW - 10000 },
    rawTransaction: "PRIVATE_RAW_BYTES", secret: "TOKEN_SECRET", prompt: "PRIVATE_PROMPT" }] };
  return { journal, job };
}

test("dashboard actor exposes only anonymous query methods", () => {
  const service = statsIdlFactory({ IDL });
  assert.deepEqual(service._fields.map(([name, method]) => [name, method.annotations]), [
    ["get_config", ["query"]], ["get_job", ["query"]], ["list_jobs", ["query"]], ["list_jobs_page", ["query"]], ["retention_status", ["query"]],
  ]);
});

test("prefill sample filters old logs, decodes bytes, never invents a percentage or leaks text", () => {
  const line = "llama_cpp: run_update_full - chunk 28: decoded=5 generated=0 prompt_remaining_tokens=86 eog=0 instructions=12";
  const sample = parsePrefillSample({ log_records: [
    { timestamp: String(BigInt(NOW - 11000) * 1000000n), content: line.replace("86", "999") },
    { timestamp: String(BigInt(NOW - 1000) * 1000000n), content: [...Buffer.from(line)] },
    { timestamp: String(BigInt(NOW) * 1000000n), content: "PRIVATE_TOKEN" },
  ] }, { startedAt: NOW - 10000, nowMs: NOW });
  assert.deepEqual(sample, { observedAt: new Date(NOW - 1000).toISOString(), chunk: 28, decoded: 5, generated: 0,
    promptRemaining: 86, eog: false, certified: false });
  assert.equal(parsePrefillSample({ log_records: [] }, { startedAt: NOW, nowMs: NOW }), null);
});

test("stats expose only bounded public fields with last-confirmed counters and unknown remaining by default", () => {
  const { journal, job } = fixture();
  const stats = buildStats({ journal, job, jobSourceId: id, journalAt: NOW, icpAt: NOW, nowMs: NOW,
    jobs: [job, { request: { id: tx }, phase: { Complete: null } }, { request: { id: "pilot" }, phase: { Complete: null } }],
    config: { gateway: "0x" + "11".repeat(20), rpc_urls: ["PRIVATE_RPC"], model_cycle_budget: 0n }, warnings: ["PRIVATE_RPC", "icp_query_unavailable"] });
  assert.equal(stats.active.modelCycles, "5377000000000"); assert.equal(stats.active.attempt, "4");
  assert.equal(stats.active.countersBasis, "last_confirmed"); assert.equal(stats.active.promptRemaining, null);
  assert.equal(stats.active.batchElapsedMs, 10000); assert.equal(stats.queue.pilotCompleted, 1);
  for (const secret of ["PRIVATE_RAW_BYTES", "TOKEN_SECRET", "PRIVATE_PROMPT", "PRIVATE_RPC"])
    assert.ok(!JSON.stringify(stats).includes(secret));
  assert.equal(buildStats({ nowMs: NOW }).active, null);
  assert.equal(buildStats({ nowMs: NOW }).freshness.icp.stale, true);
});

test("logs are hidden after the pending batch changes or multiple jobs overlap", () => {
  const { journal, job } = fixture();
  const common = { journal, job, jobSourceId: id, jobs: [job], nowMs: NOW, logAt: NOW,
    logSourceId: id, logStartedAt: NOW - 10000, logSample: { promptRemaining: 86, observedAt: new Date(NOW - 1000).toISOString() } };
  assert.equal(buildStats(common).active.promptRemaining, 86);
  assert.equal(buildStats({ ...common, logStartedAt: NOW - 20000 }).active.promptRemaining, null);
  assert.equal(buildStats({ ...common, jobs: [job, { busy: true }] }).active.promptRemaining, null);
  assert.equal(buildStats({ ...common, logSample: { ...common.logSample, observedAt: new Date(NOW - 31000).toISOString() } }).active.promptRemaining, null);
});

test("numeric-string timestamps are safe and previous rejection never replaces the current phase", () => {
  const { journal, job } = fixture();
  job.voice[0].quality_error = "Earlier candidate was too similar\u0000" + "x".repeat(400);
  const stats = buildStats({ journal, job, jobSourceId: id, journalAt: String(NOW),
    journalMtime: String(NOW - 1000), icpAt: String(NOW), nowMs: NOW });
  assert.equal(stats.freshness.journal.observedAt, new Date(NOW).toISOString());
  assert.equal(stats.freshness.journal.modifiedAt, new Date(NOW - 1000).toISOString());
  assert.equal(stats.active.phase, "Running"); assert.equal(stats.active.busy, true);
  assert.equal(stats.active.previousRejection.length, 300);
  assert.ok(!stats.active.previousRejection.includes("\u0000"));
  assert.ok(stats.active.previousRejection.startsWith("Earlier candidate was too similar"));
  assert.equal(buildStats({ journalAt: "invalid", nowMs: NOW }).freshness.journal.observedAt, null);
});

test("collector reads only its journals and query APIs; owner CLI is logs-only and restricted to busy prefill", async () => {
  const { journal, job } = fixture(); const calls = [], inputs = JSON.stringify(journal);
  const actor = { get_config: async () => ({}), get_job: async () => [job], list_jobs: async () => [job] };
  const collector = createCollector({ actor, journalPath: "/journal", sidecarPath: "/proof", now: () => NOW,
    health: () => ({ status: "running" }), read: file => { calls.push(file); return { value: file === "/journal" ? journal : {}, mtimeMs: NOW }; },
    logsExec: async (file, args) => {
      assert.equal(file, "/Users/abhijith/.cargo/bin/icp"); assert.deepEqual(args.slice(0, 3), ["canister", "logs", "6obed-qaaaa-aaaaj-a65ja-cai"]);
      assert.ok(!args.includes("call")); return { stdout: '{"log_records":[]}' };
    } });
  collector.readLocal(); await collector.pollLogs(); // No queried busy job yet.
  await collector.pollIcp(); await collector.pollLogs();
  assert.deepEqual(calls, ["/journal", "/proof"]); assert.equal(JSON.stringify(journal), inputs);
  assert.equal(collector.snapshot().freshness.log.stale, true); // No sample in this successful read.
  assert.equal(collector.snapshot().freshness.log.checkedAt, new Date(NOW).toISOString());
  collector.stop();
});

test("private reads reject symlinks and permissive files", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-stats-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "j.json"); fs.writeFileSync(file, "{}", { mode: 0o600 });
  assert.deepEqual(readPrivateJson(file).value, {});
  fs.symlinkSync(file, path.join(dir, "link")); assert.throws(() => readPrivateJson(path.join(dir, "link")));
  fs.chmodSync(file, 0o644); assert.throws(() => readPrivateJson(file));
});

test("HTTP is read-only, rejects foreign origins and paths, and sends CSP", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-stats-http-"));
  fs.writeFileSync(path.join(dir, "index.html"), '<script>document.title="GH0ST";</script>');
  const server = createStatsServer({ snapshot: () => ({ public: true }), dashboardDir: dir });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  function request(url, extra = {}) {
    const response = { status: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(s) { this.status = s; }, end(body) { this.body = body; } };
    server.emit("request", { url, method: "GET", headers: { host: "127.0.0.1:8790" },
      socket: { remoteAddress: "127.0.0.1" }, ...extra }, response);
    return response;
  }
  const ok = request("/api/stats"); assert.equal(ok.status, 200); assert.deepEqual(JSON.parse(ok.body), { public: true });
  assert.equal(request("/api/stats", { headers: { host: "127.0.0.1:8790", origin: "https://evil.test" } }).status, 403);
  assert.equal(request("/api/stats", { method: "POST" }).status, 405);
  assert.equal(request("/.env.buy.local").status, 404);
  const html = request("/"); assert.match(html.headers["content-security-policy"], /sha256-/);
  assert.match(html.headers["content-security-policy"], /frame-ancestors 'none'/);
});
