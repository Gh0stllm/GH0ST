import test from "node:test";
import assert from "node:assert/strict";
import { ICP_CLI, FUNDING_CANISTERS as IDS, FUNDING_DEPLOYER,
  MODEL_JOB_RESERVE, MODEL_MINIMUM_REMAINING, COORDINATOR_JOB_RESERVE,
  COORDINATOR_MINIMUM_REMAINING, readCycleSnapshot, validateFundingStatus,
  assertFundingAdmission, UNLIMITED_ADMISSION_POLICY } from "../worker/cycle-budget.mjs";

const NOW = Date.parse("2026-10-26T12:00:00Z"), T = 1_000_000_000_000n;
const manifest = { model_wasm_sha256: "ab".repeat(32), coordinator_wasm_sha256: "cd".repeat(32),
  limits: { model_cycle_budget: MODEL_JOB_RESERVE.toString() } };
const copy = value => JSON.parse(JSON.stringify(value));
function status(name, amount) {
  return { id: IDS[name], status: "Running", module_hash: "0x" + manifest[name + "_wasm_sha256"],
    settings: { controllers: name === "model" ? [IDS.coordinator, FUNDING_DEPLOYER] : [FUNDING_DEPLOYER] },
    cycles: amount.toString(), reserved_cycles: "0", observedAtMs: NOW };
}
function snapshot(model = 5n * T, coordinator = 400_000_000_000n) {
  return { schema: "gh0st-funding-snapshot-v1", startedAtMs: NOW, atMs: NOW,
    canisters: { model: status("model", model), coordinator: status("coordinator", coordinator) } };
}
const admission = (value = snapshot(), extra = {}) => assertFundingAdmission({ snapshot: value, manifest, nowMs: NOW, ...extra });

test("funding limits reserve a full model job plus three trillion floor and coordinator working reserve", async () => {
  assert.equal(MODEL_JOB_RESERVE + MODEL_MINIMUM_REMAINING, 5n * T);
  assert.equal(COORDINATOR_JOB_RESERVE + COORDINATOR_MINIMUM_REMAINING, 400_000_000_000n);
  const result = await admission();
  assert.equal(result.allowed, true); assert.equal(result.halt, false); assert.equal(result.reason, null);
  assert.equal(result.snapshotStamp, "2026-10-26T12:00:00.000Z");
  assert.equal(result.balances.model.cycles, (5n * T).toString());
  assert.equal(result.dailyBudget.enabled, false);
});

test("one cycle below either threshold halts without spending or mutating input", async () => {
  for (const [value, reason] of [
    [snapshot(5n * T - 1n), "model_funding_floor"],
    [snapshot(5n * T, 399_999_999_999n), "coordinator_funding_floor"],
  ]) {
    const before = copy(value), result = await admission(value);
    assert.equal(result.allowed, false); assert.equal(result.halt, true); assert.equal(result.reason, reason);
    assert.deepEqual(value, before); assert.ok(result.balances);
  }
});

test("reserved cycles never count as spendable funding", async () => {
  const value = snapshot(1n);
  value.canisters.model.reserved_cycles = (10n * T).toString();
  assert.equal((await admission(value)).reason, "model_funding_floor");
});

test("status parser accepts CLI grouping exactly and preserves integers above Number precision", () => {
  const value = status("model", 1n);
  value.cycles = "17_122_150_652_073";
  value.reserved_cycles = "9_007_199_254_740_993";
  const result = validateFundingStatus("model", value, manifest);
  assert.equal(result.cycles, "17122150652073");
  assert.equal(result.reservedCycles, "9007199254740993");
  for (const bad of ["_5", "5_", "1__000", "01", "1e13", "-1", "1.5", 5000000000000]) {
    value.cycles = bad;
    assert.throws(() => validateFundingStatus("model", value, manifest));
  }
});

test("fixed principals, exact controller sets, running state and manifest hashes are required", async () => {
  for (const alter of [
    s => { s.id = IDS.coordinator; },
    s => { s.module_hash = "0x" + "ef".repeat(32); },
    s => { s.status = "Stopped"; },
    s => { s.settings.controllers = [FUNDING_DEPLOYER]; },
    s => { s.settings.controllers.push("extra-principal"); },
    s => { s.settings.controllers.push(FUNDING_DEPLOYER); },
    s => { delete s.cycles; },
    s => { delete s.reserved_cycles; },
  ]) {
    const value = snapshot(); alter(value.canisters.model);
    assert.equal((await admission(value)).allowed, false);
  }
  const reversed = snapshot(); reversed.canisters.model.settings.controllers.reverse();
  assert.equal((await admission(reversed)).allowed, true);
});

test("public-only status fallback cannot admit a job", async () => {
  const value = snapshot();
  value.canisters.model = { id: IDS.model, module_hash: value.canisters.model.module_hash, observedAtMs: NOW };
  assert.equal((await admission(value)).allowed, false);
});

test("snapshots must be recent and internally time-consistent", async () => {
  for (const alter of [
    s => { s.startedAtMs -= 60001; },
    s => { s.atMs += 5001; },
    s => { s.canisters.model.observedAtMs -= 1; },
    s => { s.startedAtMs += 1; },
  ]) {
    const value = snapshot(); alter(value);
    assert.equal((await admission(value)).allowed, false);
  }
  assert.equal((await admission(snapshot(), { nowMs: NOW + 60000 })).allowed, true);
  assert.equal((await admission(snapshot(), { nowMs: NOW + 60001 })).reason, "stale_snapshot");
});

test("no arbitrary daily cap is invented when configuration omits it", async () => {
  const result = await admission(snapshot(), { dailyLedger: { day: "wrong", spent: "bad", reserved: "bad" } });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.dailyBudget, { enabled: false, scope: "model_cycles" });
});

test("explicit daily model cap accounts for both actual spend and unresolved reserves", async () => {
  const ledger = { day: "2026-10-26", spent: T.toString(), reserved: (2n * T).toString() }, before = copy(ledger);
  const allowed = await admission(snapshot(), { dailyCycleCap: (5n * T).toString(), dailyLedger: ledger });
  assert.equal(allowed.allowed, true); assert.equal(allowed.dailyBudget.available, (2n * T).toString());
  const denied = await admission(snapshot(), { dailyCycleCap: (5n * T - 1n).toString(), dailyLedger: ledger });
  assert.equal(denied.reason, "daily_cycle_cap"); assert.deepEqual(ledger, before);
  assert.equal((await admission(snapshot(), { dailyCycleCap: "0", dailyLedger: ledger })).dailyBudget.enabled, false);
});

test("explicit daily caps fail closed without a valid ledger for the current UTC day", async () => {
  for (const ledger of [null, { day: "2026-10-25", spent: "0", reserved: "0" },
    { day: "2026-10-26", spent: "-1", reserved: "0" }]) {
    assert.equal((await admission(snapshot(), { dailyCycleCap: (8n * T).toString(), dailyLedger: ledger })).allowed, false);
  }
});

test("CLI reader uses only the fixed executable and sequential read-only status arguments", async () => {
  const calls = []; let active = 0, maximum = 0;
  const execFile = async (file, args, options) => {
    active++; maximum = Math.max(maximum, active);
    assert.equal(file, ICP_CLI); assert.equal(options.timeout, 30000); assert.equal(options.maxBuffer, 1024 * 1024);
    assert.deepEqual(args.slice(0, 2), ["canister", "status"]);
    assert.deepEqual(args.slice(3), ["-e", "production", "--identity", "gh0st-deployer", "--json"]);
    const name = args[2] === IDS.model ? "model" : "coordinator";
    calls.push(name); await Promise.resolve(); active--;
    return { stdout: JSON.stringify(status(name, name === "model" ? 5n * T : 400_000_000_000n)) };
  };
  const read = await readCycleSnapshot({ manifest, execFile, now: () => NOW });
  assert.deepEqual(calls, ["coordinator", "model"]); assert.equal(maximum, 1);
  assert.equal((await admission(read)).allowed, true);
});

test("admission can read statuses through injected CLI without any mainnet access", async () => {
  const calls = [];
  const execFile = async (_file, args) => {
    calls.push(args[1]); const name = args[2] === IDS.model ? "model" : "coordinator";
    return { stdout: JSON.stringify(status(name, name === "model" ? 5n * T : 400_000_000_000n)) };
  };
  const result = await assertFundingAdmission({ manifest, execFile, now: () => NOW });
  assert.equal(result.allowed, true); assert.deepEqual(calls, ["status", "status"]);
});

test("CLI failure and invalid JSON return a redacted halt instead of retrying or topping up", async () => {
  let calls = 0;
  const denied = await assertFundingAdmission({ manifest, now: () => NOW, execFile: async () => { calls++; throw Error("sensitive implementation detail"); } });
  assert.equal(calls, 1); assert.equal(denied.reason, "status_read_failed");
  assert.ok(!JSON.stringify(denied).includes("sensitive"));
  const malformed = await assertFundingAdmission({ manifest, now: () => NOW, execFile: async () => ({ stdout: "not-json" }) });
  assert.equal(malformed.reason, "invalid_status_json");
});

test("changed manifest model budget or absent module pins cannot admit", async () => {
  for (const change of [m => { m.limits.model_cycle_budget = "1"; }, m => { delete m.model_wasm_sha256; }]) {
    const bad = copy(manifest); change(bad);
    assert.equal((await admission(snapshot(), { manifest: bad })).reason, "invalid_manifest");
  }
});

test("zero execution limit is uncapped while admission estimate and real balance floors remain enforced", async () => {
  const unlimited = copy(manifest);
  unlimited.limits.model_cycle_budget = "0";
  unlimited.limits.max_chunks = null;
  unlimited.limits.model_admission_reserve = MODEL_JOB_RESERVE.toString();
  unlimited.generation_policy = { ...UNLIMITED_ADMISSION_POLICY };
  assert.equal((await admission(snapshot(), { manifest: unlimited })).allowed, true);
  assert.equal((await admission(snapshot(5n * T - 1n), { manifest: unlimited })).reason, "model_funding_floor");
  assert.equal((await admission(snapshot(5n * T, 399_999_999_999n), { manifest: unlimited })).reason, "coordinator_funding_floor");
  unlimited.limits.model_admission_reserve = "1";
  assert.equal((await admission(snapshot(), { manifest: unlimited })).reason, "invalid_manifest");
});

test("uncapped execution requires the exact explicit policy and preserves generation bindings", async () => {
  const unlimited = { ...copy(manifest), limits: { model_cycle_budget: "0", max_chunks: null },
    generation_policy: { ...UNLIMITED_ADMISSION_POLICY } };
  for (const change of [m => { delete m.generation_policy; }, m => { m.limits.max_chunks = 48; },
    m => { m.generation_policy.admission_estimate = "0"; }, m => { m.generation_policy.prefill_method = "run_update"; },
    m => { m.generation_policy.extra = true; }]) {
    const bad = copy(unlimited); change(bad);
    assert.equal((await admission(snapshot(), { manifest: bad })).reason, "invalid_unlimited_policy");
  }
});
