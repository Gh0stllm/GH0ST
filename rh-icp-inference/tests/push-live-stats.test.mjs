import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildStats } from "../scripts/live-stats.mjs";
import { publicStats, pushSnapshot, readPushToken, acquireUplinkLock, LIVE_STATS_INGEST_URL } from "../scripts/push-live-stats.mjs";

const fixture = () => buildStats({ nowMs: 1793034000000, journalAt: 1793034000000, icpAt: 1793034000000,
  journal: { requests: [], buyQueue: { entries: [] } }, jobs: [], worker: { status: "running" }, sidecar: { status: "running" } });
const token = "a".repeat(64);

test("public stats projection strips all unexpected fields and permits no private endpoints or raw logs", () => {
  const s = fixture();
  s.privateKey = "secret-key"; s.rawJournal = { secret: "secret-key" }; s.process.worker.pid = 123;
  s.chain.rpc = "https://secret.invalid/token"; s.warnings.push("https://secret.invalid/token");
  s.posts = [{ sourceId: "0x" + "ab".repeat(32), postId: "1234", url: "https://x.com/i/web/status/1234",
    answer: "the spoon has arrived with a formal complaint.", text: "the spoon has arrived with a formal complaint.",
    callbackUrl: "https://robin.etherscan.io/tx/0x" + "cd".repeat(32),
    icpUrl: "https://secret.invalid/token", proofReplyUrl: "javascript:alert(1)", raw: "secret-key" }];
  const p = publicStats(s), encoded = JSON.stringify(p);
  assert.equal(encoded.includes("secret"), false); assert.equal(encoded.includes("pid"), false);
  assert.equal(p.posts[0].icpUrl, null); assert.equal(p.posts[0].proofReplyUrl, null);
  assert.equal(p.process.worker.status, "running"); assert.equal(p.queue.completed, 0);
  assert.equal(p.schema, "gh0st-live-stats-v1");
});

test("push sends only the public snapshot to fixed HTTPS endpoint with no redirect or credentials in body", async () => {
  const s = fixture(); let calls = 0;
  const result = await pushSnapshot(s, { token, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, LIVE_STATS_INGEST_URL); assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer " + token);
    assert.equal(options.body.includes(token), false); assert.deepEqual(JSON.parse(options.body), publicStats(s));
    return { status: 202, json: async () => ({ accepted: true, observedAt: s.observedAt }) };
  } });
  assert.equal(calls, 1); assert.equal(result.status, "accepted");
});

test("failed or stalled push attempts are bounded and never expose server error content", async () => {
  for (const [status, expected] of [[401,"unauthorized"],[409,"stale"],[503,"unavailable"]]) {
    const result = await pushSnapshot(fixture(), { token, fetchImpl: async () => ({ status,
      json: async () => ({ secret: "server-private-data" }) }) });
    assert.equal(result.status, expected); assert.equal(JSON.stringify(result).includes("private"), false);
  }
  assert.equal((await pushSnapshot(fixture(), { token, timeoutMs: 5, fetchImpl: async () => new Promise(() => {}) })).status, "timeout");
  assert.equal((await pushSnapshot(fixture(), { token, timeoutMs: 5,
    fetchImpl: async () => ({ status: 202, json: async () => new Promise(() => {}) }) })).status, "timeout");
});

test("token reader accepts only private fixed-site configuration and never modifies it", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-push-token-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config.json");
  const record = { schema: "gh0st-netlify-live-push-v1", endpoint: LIVE_STATS_INGEST_URL, token,
    siteId: "1460fb0c-b81d-4624-aac5-b78658310ce0", intervalMs: 10000 };
  fs.writeFileSync(file, JSON.stringify(record), { mode: 0o600 }); const bytes = fs.readFileSync(file);
  assert.equal(readPushToken(file), token); assert.deepEqual(fs.readFileSync(file), bytes);
  fs.chmodSync(file, 0o644); assert.throws(() => readPushToken(file), /private/); fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, JSON.stringify({ ...record, endpoint: "https://wrong.invalid" })); assert.throws(() => readPushToken(file), /approved/);
  fs.writeFileSync(file, bytes); const link = path.join(dir, "link.json"); fs.symlinkSync(file, link); assert.throws(() => readPushToken(link), /private/);
});

test("cloud dashboard is self-contained, uses public endpoint and 20-second stale threshold", () => {
  const file = new URL("./fixtures/live-dashboard.html", import.meta.url);
  const html = fs.readFileSync(file, "utf8"), code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(code);
  assert.ok(code.includes("fetch('/api/live-stats'")); assert.ok(code.includes("setTimeout(poll,5000)"));
  assert.ok(code.includes("Date.now()-observed>20000")); assert.ok(code.includes("timeZone:'Asia/Kolkata'"));
  assert.equal(code.includes("innerHTML"), false);
  assert.ok(code.includes("q.completed+(Number.isSafeInteger(q.pilotCompleted)?q.pilotCompleted:0)"));
});

test("one uplink owns the private PID lock until cleanup; a competing publisher cannot start", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-uplink-lock-")); t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,"uplink.lock"), release = acquireUplinkLock(file);
  assert.equal(fs.readFileSync(file,"utf8"),String(process.pid)); assert.equal(fs.statSync(file).mode & 0o777,0o600);
  assert.throws(() => acquireUplinkLock(file),/owns the lock/);
  release(); release(); assert.equal(fs.existsSync(file),false);
  const again = acquireUplinkLock(file); again();
});
