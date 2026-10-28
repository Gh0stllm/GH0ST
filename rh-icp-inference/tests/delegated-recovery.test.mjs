import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DelegationChain, Ed25519KeyIdentity, ECDSAKeyIdentity} from "@icp-sdk/core/identity";
import {Secp256k1KeyIdentity} from "@icp-sdk/core/identity/secp256k1";
import {Principal} from "@icp-sdk/core/principal";
import {swapSourceId} from "../worker/swaps.mjs";
import {validateRecoveryDelegation, createRecoveryOperations, loadDelegatedRecovery,
  RECOVERY_COORDINATOR, RECOVERY_REASON, RECOVERY_OWNER, RECOVERY_MAX_REMAINING_MS} from "../server/delegated-recovery.mjs";

// Synthetic offline credentials only. None is the deployed GH0ST owner.
const nowMs = 1793088000000;
async function fixture({owner = Ed25519KeyIdentity.generate(), ttl = 86400000,
  targets = [Principal.fromText(RECOVERY_COORDINATOR)], permissions} = {}) {
  const session = Ed25519KeyIdentity.generate();
  const chain = await DelegationChain.create(owner, session.getPublicKey(), new Date(nowMs + ttl), {targets, permissions});
  const input = {sessionJson: JSON.stringify(session.toJSON()), delegationJson: JSON.stringify(chain.toJSON()),
    expectedOwner: owner.getPrincipal().toText(), nowMs};
  assert.notEqual(input.expectedOwner, RECOVERY_OWNER);
  return {owner, session, chain, input};
}
const changed = (input, mutate) => {
  const raw = JSON.parse(input.delegationJson);mutate(raw);
  return {...input, delegationJson: JSON.stringify(raw)};
};

test("offline delegation verification binds root principal, exact coordinator and terminal session key", async () => {
  const {input} = await fixture();
  const checked = validateRecoveryDelegation(input);
  assert.equal(checked.principal, input.expectedOwner);
  assert.equal(checked.identity.getPrincipal().toText(), input.expectedOwner);
  assert.equal(checked.target, RECOVERY_COORDINATOR);
  assert.equal(checked.remainingMs, 86400000);
  assert.throws(() => validateRecoveryDelegation({...input, expectedOwner: RECOVERY_OWNER}), /root is not the approved/);
});

test("offline delegation verifies Ed25519, P256 and secp256k1 root signatures", async () => {
  for (const owner of [Ed25519KeyIdentity.generate(), await ECDSAKeyIdentity.generate(), Secp256k1KeyIdentity.generate()]) {
    const {input} = await fixture({owner});
    assert.equal(validateRecoveryDelegation(input).principal, owner.getPrincipal().toText());
  }
});

test("delegation rejects a tampered signature and a different target session", async () => {
  const {input} = await fixture();
  const tampered = changed(input, raw => {raw.delegations[0].signature = "00".repeat(64);});
  assert.throws(() => validateRecoveryDelegation(tampered), /signature is invalid/);
  const session = Ed25519KeyIdentity.generate();
  assert.throws(() => validateRecoveryDelegation({...input, sessionJson: JSON.stringify(session.toJSON())}), /different session key/);
  const mixed = JSON.parse(input.sessionJson);mixed[1] = session.toJSON()[1];
  assert.throws(() => validateRecoveryDelegation({...input, sessionJson: JSON.stringify(mixed)}), /public and private keys differ/);
});

test("delegation rejects omitted, empty, extra, management, model and ledger targets", async () => {
  const {input} = await fixture();
  const targets = [undefined, [], [Principal.fromText(RECOVERY_COORDINATOR).toHex(), Principal.fromText("aaaaa-aa").toHex()],
    [Principal.fromText("aaaaa-aa").toHex()], [Principal.fromText("6obed-qaaaa-aaaaj-a65ja-cai").toHex()],
    [Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai").toHex()]];
  for (const value of targets) {
    const invalid = changed(input, raw => {
      if (value === undefined) delete raw.delegations[0].delegation.targets;
      else raw.delegations[0].delegation.targets = value;
    });
    assert.throws(() => validateRecoveryDelegation(invalid), /credential fields|encoding|target only/);
  }
});

test("delegation requires one hop, update capability, valid expiration and at most 30 days remaining", async () => {
  for (const ttl of [-1, 0, RECOVERY_MAX_REMAINING_MS + 1]) {
    const {input} = await fixture({ttl});
    assert.throws(() => validateRecoveryDelegation(input), /expired|30 days/);
  }
  const {input} = await fixture({ttl: RECOVERY_MAX_REMAINING_MS});
  assert.equal(validateRecoveryDelegation(input).remainingMs, RECOVERY_MAX_REMAINING_MS);
  assert.throws(() => validateRecoveryDelegation({...input, minimumRemainingMs: RECOVERY_MAX_REMAINING_MS}), /expires too soon/);
  assert.throws(() => validateRecoveryDelegation(changed(input, raw => {raw.delegations.push(raw.delegations[0]);})), /one direct/);
  const queries = await fixture({permissions: "queries"});
  assert.throws(() => validateRecoveryDelegation(queries.input), /update permission/);
  const all = await fixture({permissions: "all"});
  assert.equal(validateRecoveryDelegation(all.input).target, RECOVERY_COORDINATOR);
});

const source = {manager: "0x" + "11".repeat(20), pool_id: "0x" + "22".repeat(32),
  transaction_hash: "0x" + "33".repeat(32), log_index: 0n};
const sourceId = swapSourceId(4663, source);
function fakeOperations({phase = "Failed", busy = false, recovery = [], remembering = [], cycles = 123n} = {}) {
  const calls = [];
  const job = {request: {id: sourceId}, phase: {[phase]: null}, busy, recovery, model_cycles: cycles, source: [source]};
  const actor = {
    list_jobs: async () => {calls.push("list_jobs");return [job];},
    get_voice_state: async () => {calls.push("get_voice_state");return {remembering};},
    set_paused: async value => {calls.push(["set_paused", value]);return {Ok: null};},
    defer_failed_swap: async (...args) => {calls.push(["defer_failed_swap", ...args]);return {Ok: null};},
  };
  const operations = createRecoveryOperations({actor, validateCredential: async remaining => {calls.push(["validate", remaining]);}});
  return {operations, calls, actor};
}

test("recovery wrapper exposes only two fixed update methods and rechecks terminal state", async () => {
  const {operations, calls} = fakeOperations();
  assert.deepEqual(Object.keys(operations), ["set_paused", "defer_failed_swap"]);
  assert.equal(Object.isFrozen(operations), true);
  assert.deepEqual(await operations.set_paused(true), {Ok: null});
  assert.deepEqual(await operations.defer_failed_swap(sourceId, "123", RECOVERY_REASON), {Ok: null});
  assert.deepEqual(await operations.set_paused(false), {Ok: null});
  assert.equal(calls.filter(row => row === "list_jobs").length, 3);
  assert.equal(calls.filter(row => row === "get_voice_state").length, 3);
  assert.deepEqual(calls.filter(Array.isArray).filter(row => row[0] === "defer_failed_swap"),
    [["defer_failed_swap", sourceId, 123n, RECOVERY_REASON]]);
});

test("recovery wrapper rejects busy, nonterminal, uncertain and remembering states before any update", async () => {
  for (const options of [{busy: true}, {phase: "Running"}, {phase: "ReadyToSign"},
    {recovery: [{accounting_uncertain: true}]}, {remembering: [sourceId]}]) {
    const {operations, calls} = fakeOperations(options);
    await assert.rejects(operations.set_paused(true), /terminal|memory acknowledgement/);
    assert.equal(calls.some(row => Array.isArray(row) && row[0] === "set_paused"), false);
  }
});

test("recovery wrapper binds deferral source, reason, phase and Nat128 measured cost", async () => {
  for (const [id, cost, reason] of [[sourceId, 124n, RECOVERY_REASON], [sourceId.toUpperCase(), 123n, RECOVERY_REASON],
    [sourceId, 123n, "arbitrary operator action"], [sourceId, 1n << 128n, RECOVERY_REASON],
    [sourceId, Number.MAX_SAFE_INTEGER + 1, RECOVERY_REASON]]) {
    const {operations, calls} = fakeOperations();
    await assert.rejects(operations.defer_failed_swap(id, cost, reason));
    assert.equal(calls.some(row => Array.isArray(row) && row[0] === "defer_failed_swap"), false);
  }
  const {operations} = fakeOperations({phase: "Complete"});
  await assert.rejects(operations.defer_failed_swap(sourceId, 123n, RECOVERY_REASON), /Failed job source/);
  await assert.rejects(operations.set_paused(1), /boolean/);
});

test("recovery wrapper sends an update once and lets its caller reconcile uncertain outcomes", async () => {
  const {actor} = fakeOperations();let attempts = 0;
  actor.set_paused = async () => {attempts++;throw Error("transport result unknown");};
  const operations = createRecoveryOperations({actor, validateCredential: () => {}});
  await assert.rejects(operations.set_paused(true), /transport result unknown/);
  assert.equal(attempts, 1);
});

test("production loader rejects unsafe credential files before any network access", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-fake-recovery-"));
  try {
    fs.chmodSync(directory, 0o700);
    fs.writeFileSync(path.join(directory, "coordinator-recovery-session"), "{}", {mode: 0o644});
    fs.writeFileSync(path.join(directory, "coordinator-recovery-delegation"), "{}", {mode: 0o600});
    await assert.rejects(loadDelegatedRecovery({credentialsDirectory: directory}), /private owned regular files/);
    fs.unlinkSync(path.join(directory, "coordinator-recovery-session"));
    fs.symlinkSync(path.join(directory, "coordinator-recovery-delegation"), path.join(directory, "coordinator-recovery-session"));
    await assert.rejects(loadDelegatedRecovery({credentialsDirectory: directory}));
    await assert.rejects(loadDelegatedRecovery({credentialsDirectory: "relative/path"}), /absolute systemd/);
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
});
