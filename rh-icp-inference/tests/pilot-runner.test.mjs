import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ContractFactory, Transaction, toQuantity } from "ethers";
import { REGISTRATION as R } from "../scripts/prepare-registration.mjs";
import { runPilotFlow, workerEnvironment, redactWorkerLine, saveCheckpoint, loadCheckpoint, validateCycleStatus,
  cycleDecrease, copyExactFile, validateSuccessorDeployment, successorConfigMatches } from "../scripts/run-pilot.mjs";

function fixture() {
  const state = { registrationPlans: [] }, calls = [], signed = new Set(), saved = [];
  const source = { id: "source", txHash: "0x" + "ab".repeat(32), logIndex: 0, blockNumber: 100 };
  const item = { state: "signed", result: { answer: "exact thought" } };
  const delivered = { ...item, state: "fulfilled", delivery: { confirmed: true }, memoryAcknowledged: true };
  const ops = {
    hasSigned: ref => Boolean(ref && signed.has(ref.path)),
    register: async () => { calls.push("register"); },
    prepareSwap: async previous => { calls.push(["prepareSwap", previous]); return { path: "swap", sha256: "swap-hash" }; },
    execute: async (ref, kind) => { calls.push(["execute", kind, ref.path]);
      assert.ok(saved.some(value => value[kind]?.path === ref.path), "checkpoint must precede signing");
      signed.add(ref.path); return { hashes: [kind + "-tx"] }; },
    source: async () => { calls.push("source"); return source; },
    startWorker: async received => { assert.equal(received, source); calls.push("startWorker"); return "worker"; },
    waitWorker: async kind => { calls.push(["wait", kind]); return kind === "signed" ? item : delivered; },
    prepareCallback: async () => { calls.push("prepareCallback"); return { path: "callback", sha256: "callback-hash" }; },
    stopWorker: async () => { calls.push("stopWorker"); },
    summary: async () => ({ success: true }),
    verifyCompleted: async () => { calls.push("verifyCompleted"); },
  };
  const save = value => saved.push(structuredClone(value));
  return { state, calls, signed, saved, ops, save };
}

test("one pilot checkpoints registration, swap and callback before their signed actions", async () => {
  const f = fixture(); await runPilotFlow(f);
  assert.equal(f.state.stage, "complete"); assert.ok(f.state.completedAt);
  assert.equal(f.calls.filter(x => Array.isArray(x) && x[0] === "prepareSwap").length, 1);
  assert.equal(f.calls.filter(x => x === "prepareCallback").length, 1);
  assert.equal(f.calls.at(-1), "stopWorker");
});

test("an interrupted signed swap resumes the same plan and never quotes another trade", async () => {
  const f = fixture(), execute = f.ops.execute;
  f.ops.execute = async (ref, kind) => { await execute(ref, kind); throw Error("uncertain broadcast"); };
  await assert.rejects(runPilotFlow(f));
  assert.equal(f.state.swap.path, "swap"); assert.equal(f.state.lastError.stage, "swap");
  f.ops.execute = execute; await runPilotFlow(f);
  assert.equal(f.calls.filter(x => Array.isArray(x) && x[0] === "prepareSwap").length, 1);
  assert.equal(f.calls.filter(x => Array.isArray(x) && x[0] === "execute" && x[1] === "swap").length, 2);
});

test("a failed inference preserves the source, stops the worker and never signs a callback", async () => {
  const f = fixture(); f.ops.waitWorker = async () => { throw Error("failed job"); };
  await assert.rejects(runPilotFlow(f));
  assert.equal(f.state.source.id, "source"); assert.equal(f.state.lastError.stage, "inference");
  assert.equal(f.calls.at(-1), "stopWorker");
  assert.equal(f.calls.includes("prepareCallback"), false);
});

test("an interrupted signed callback resumes exact bytes without another swap or callback plan", async () => {
  const f = fixture(), execute = f.ops.execute;
  f.ops.execute = async (ref, kind) => { const result = await execute(ref, kind);
    if (kind === "callback") throw Error("uncertain callback"); return result; };
  await assert.rejects(runPilotFlow(f)); f.ops.execute = execute;
  await runPilotFlow(f);
  assert.equal(f.calls.filter(x => Array.isArray(x) && x[0] === "prepareSwap").length, 1);
  assert.equal(f.calls.filter(x => x === "prepareCallback").length, 1);
});

test("a completed pilot only verifies its saved evidence", async () => {
  const f = fixture(); f.state.completedAt = "complete";
  await runPilotFlow(f); assert.deepEqual(f.calls, ["verifyCompleted"]);
});

test("a missing signed journal after saved swap confirmation cannot create a replacement trade", async () => {
  const f = fixture(); f.state.swap = { path: "swap" }; f.state.swapResult = { hashes: ["existing"] };
  await assert.rejects(runPilotFlow(f), /signed swap journal is missing/);
  assert.equal(f.calls.some(x => Array.isArray(x) && x[0] === "prepareSwap"), false);
});

test("worker stays target-only and overrides env-file values that could relay, exit early or publish", () => {
  const source = { txHash: "0x" + "ab".repeat(32), logIndex: 0, blockNumber: 100 };
  const env = workerEnvironment(source, { RH_RELAYER_PRIVATE_KEY: "secret", ONCE: "1", X_ENABLED: "1", X_USER_ACCESS_TOKEN: "token" });
  assert.equal(env.RH_RELAYER_PRIVATE_KEY, ""); assert.equal(env.ONCE, "0"); assert.equal(env.X_ENABLED, "0");
  assert.equal(env.X_USER_ACCESS_TOKEN, ""); assert.equal(env.POLL_MS, "1000");
  assert.equal(env.TARGET_SWAP_TX_HASH, source.txHash); assert.equal(env.TARGET_SWAP_LOG_INDEX, "0");
  assert.equal(env.START_BLOCK, "100"); assert.equal(env.WATCH_SWAPS, "1");
});

test("worker diagnostics redact endpoints and configured secret values before persistence", () => {
  const value = redactWorkerLine("RPC https://host/v2/privatekey token super-secret-token", { X_USER_ACCESS_TOKEN: "super-secret-token" });
  assert.equal(value.includes("privatekey"), false); assert.equal(value.includes("super-secret-token"), false);
});

test("private checkpoint is atomic, bound to this pilot, and rejects symlinks", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-pilot-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "pilot.json"), state = loadCheckpoint(file);
  saveCheckpoint(file, state); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadCheckpoint(file), state);
  state.binding = { ...state.binding, inputWei: "1" }; saveCheckpoint(file, state);
  assert.throws(() => loadCheckpoint(file), /another pilot/);
  const link = path.join(dir, "link.json"); fs.symlinkSync(file, link);
  assert.throws(() => loadCheckpoint(link), /private regular file/);
});

test("cycle snapshots pin exact module, canister and controller set", () => {
  const manifest = { model_wasm_sha256: "aa".repeat(32), coordinator_wasm_sha256: "bb".repeat(32) };
  const status = { id: "6obed-qaaaa-aaaaj-a65ja-cai", status: "Running", module_hash: "0x" + manifest.model_wasm_sha256,
    cycles: "17_000_000", reserved_cycles: "0", settings: { controllers: ["6jacx-5yaaa-aaaaj-a65jq-cai", "uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe"] } };
  assert.equal(validateCycleStatus("model", status, manifest).cycles, "17000000");
  for (const mutate of [s => { s.id = "other"; }, s => { s.module_hash = "0x00"; },
    s => { s.settings.controllers.push("unexpected"); }, s => { s.status = "Stopped"; }]) {
    const changed = structuredClone(status); mutate(changed);
    assert.throws(() => validateCycleStatus("model", changed, manifest));
  }
});

test("aggregate cycle decrease cancels transfers between coordinator and model", () => {
  const before = { canisters: { coordinator: { cycles: "100", reservedCycles: "1" }, model: { cycles: "200", reservedCycles: "2" } } };
  const after = { canisters: { coordinator: { cycles: "60", reservedCycles: "1" }, model: { cycles: "235", reservedCycles: "2" } } };
  assert.equal(cycleDecrease(before, after), "5");
});

test("successor registers both pools even with a reused confirmed swap and never prepares another trade", async () => {
  const f = fixture(); f.state.swap = { path: "swap", sha256: "existing" }; f.signed.add("swap");
  f.ops.deploySuccessor = async () => { f.calls.push("deploySuccessor"); };
  f.ops.prepareSwap = async () => { throw Error("must not prepare another swap"); };
  await runPilotFlow(f);
  assert.equal(f.state.successorReady, true); assert.equal(f.state.registrationDone, true);
  assert.ok(f.calls.indexOf("deploySuccessor") < f.calls.indexOf("register"));
  assert.ok(f.calls.indexOf("register") < f.calls.findIndex(x => Array.isArray(x) && x[0] === "execute"));
});

test("successor copies preserve every byte and refuse replacing different evidence", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-copy-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const original = path.join(dir, "original.json"), copy = path.join(dir, "copy.json");
  fs.writeFileSync(original, '{"bytes":"  exact \\n"}\n', { mode: 0o600 });
  copyExactFile(original, copy); assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(original));
  copyExactFile(original, copy);
  fs.appendFileSync(copy, " "); assert.throws(() => copyExactFile(original, copy), /differs/);
});

test("successor deployment accepts only exact nonce6277 constructor and approved caps", async () => {
  const artifact = JSON.parse(fs.readFileSync(new URL("../build/gateway.json", import.meta.url)));
  const created = await new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object)
    .getDeployTransaction(R.owner, R.signer, R.modelId, R.artifactHash);
  const tx = Transaction.from({ type: 2, chainId: 4663n, nonce: 6277, value: 0n, data: created.data,
    gasLimit: 2000000n, maxFeePerGas: 40000000n, maxPriorityFeePerGas: 0n });
  const plan = { schema: "gh0st-manual-rh-v1", operation: "deploy", owner: R.owner, icpSigner: R.signer,
    modelId: R.modelId, artifactHash: R.artifactHash, chainId: "4663", broadcast: false,
    deployment: { predictedGateway: R.gateway, unsignedSerialized: tx.unsignedSerialized, unsignedHash: tx.unsignedHash,
      walletRequest: { method: "eth_sendTransaction", params: [{ from: R.owner, data: tx.data, value: "0x0", type: "0x2",
        chainId: "0x1237", nonce: toQuantity(tx.nonce), gas: toQuantity(tx.gasLimit),
        maxFeePerGas: toQuantity(tx.maxFeePerGas), maxPriorityFeePerGas: "0x0" }] } } };
  assert.equal((await validateSuccessorDeployment(plan)).length, 1);
  for (const mutate of [p => { p.artifactHash = "0x" + "00".repeat(32); },
    p => { p.deployment.predictedGateway = R.owner; },
    p => { p.deployment.walletRequest.params[0].nonce = "0x1886"; },
    p => { p.deployment.walletRequest.params[0].maxFeePerGas = "0xffffffffff"; },
    p => { p.deployment.walletRequest.params[0].gas = "0xffffff"; },
    p => { p.deployment.walletRequest.params[0].data += "00"; }]) {
    const changed = structuredClone(plan); mutate(changed); await assert.rejects(validateSuccessorDeployment(changed));
  }
});

test("migration wait rejects temporary code even when successor config already matches", () => {
  const config = { gateway: R.gateway, artifact_hash: R.artifactHash, model_id: R.modelId,
    model_canister: { toText: () => "6obed-qaaaa-aaaaj-a65ja-cai" },
    model_wasm_hash: "0x964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5" };
  const status = { canisters: { coordinator: { moduleHash: "0x70d972d42e6a8698ada4a164a9ae81045ed472dc9d77ce023829b5520807ce37" } } };
  assert.equal(successorConfigMatches(config, status), false);
  status.canisters.coordinator.moduleHash = "0x7e57af5c383986244e3ff38bd0f874822ca1a3e1f0d4ec6faa349dd30b15e05c";
  assert.equal(successorConfigMatches(config, status), true);
});
