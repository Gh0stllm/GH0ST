import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { PassThrough } from "node:stream";
import ganache from "ganache";
import { BrowserProvider, Wallet, Transaction, keccak256 } from "ethers";
import { prepareUnsigned } from "../scripts/manual-rh-core.mjs";
import { executeActions, executionMessage, readHiddenPassword, unlockKeystore,
  unsignedForAction, validateSigned, waitCanonicalReceipt } from "../scripts/execute-rh.mjs";

const hash = value => crypto.createHash("sha256").update(value).digest("hex");

test("execution errors explain safe local guards without exposing provider secrets", () => {
  const nonce = "Stale plan: wallet pending nonce is 6275, plan nonce is 6274. Regenerate the plan.";
  assert.equal(executionMessage(new Error(nonce)), nonce);
  const fees = "Current fees exceed this plan. Regenerate it before signing.";
  assert.equal(executionMessage(new Error(fees)), fees);
  for (const message of ["request failed https://private.invalid/v2/secret", nonce + " secret details"]) {
    const output = executionMessage(new Error(message));
    assert.match(output, /Preserve the signed journal/);
    assert.ok(!output.includes("secret"));
  }
});
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-rh-execute-"));
  const engine = ganache.provider({ logging: { quiet: true }, chain: { chainId: 4663 }, wallet: { totalAccounts: 2 } });
  const provider = new BrowserProvider(engine, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const key = Object.values(engine.getInitialAccounts())[0].secretKey;
  const wallet = new Wallet(key);
  const quoted = await prepareUnsigned(provider, { owner: wallet.address,
    data: "0x6001600c60003960016000f300", feeCapGwei: "10" });
  const action = { id: 0, label: "Fixture deployment", transaction: quoted.walletRequest.params[0],
    unsignedHash: quoted.unsignedHash, nonce: quoted.nonce, maxCostWei: quoted.cost.maxCostWei };
  const planPath = path.join(dir, "plan.json");
  fs.writeFileSync(planPath, JSON.stringify({ fixture: true, owner: wallet.address, unsignedHash: quoted.unsignedHash }));
  const planHash = hash(fs.readFileSync(planPath));
  t.after(async () => { provider.destroy(); await engine.disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, engine, provider, wallet, action, planPath, planHash, journalPath: planPath + ".signed-journal.json" };
}
function delegatedProvider(provider, overrides) {
  return new Proxy(provider, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return overrides[key];
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
}
const common = f => ({ planPath: f.planPath, planHash: f.planHash, owner: f.wallet.address,
  actions: [f.action], getSigner: async () => f.wallet, freshCheck: async () => {},
  confirmations: 12, timeoutMs: 1000, pollMs: 1, log: () => {} });

test("RH CLI rejects piped password entry before reading any input", async () => {
  await assert.rejects(readHiddenPassword({ isTTY: false }, { isTTY: false }), /interactive Terminal/);
});

test("hidden prompt restores initially dormant, paused and flowing stdin on success or cancellation", async () => {
  for (const initialFlow of [null, false, true]) {
    for (const cancelled of [false, true]) {
      const input = new PassThrough();
      input.isTTY = true;
      input.isRaw = false;
      input.setRawMode = value => { input.isRaw = value; return input; };
      if (initialFlow === false) input.pause();
      if (initialFlow === true) input.resume();
      assert.equal(input.readableFlowing, initialFlow);
      if (initialFlow === null) assert.equal(input.isPaused(), false);
      const output = [];
      const interruptListeners = process.listenerCount("SIGINT");
      const terminateListeners = process.listenerCount("SIGTERM");
      const prompt = readHiddenPassword(input, { isTTY: true, write: text => output.push(text) });
      input.write(cancelled ? "fixture-password\u0003" : "fixture-password\n");
      if (cancelled) await assert.rejects(prompt, /cancelled/);
      else assert.equal(await prompt, "fixture-password");
      assert.equal(input.readableFlowing, initialFlow === true);
      assert.equal(input.isPaused(), initialFlow !== true);
      assert.equal(input.isRaw, false);
      assert.equal(input.listenerCount("data"), 0);
      assert.equal(input.listenerCount("end"), 0);
      assert.equal(input.listenerCount("error"), 0);
      assert.equal(process.listenerCount("SIGINT"), interruptListeners);
      assert.equal(process.listenerCount("SIGTERM"), terminateListeners);
      assert.equal(output.join("").includes("fixture-password"), false);
      input.destroy();
    }
  }
});

test("keystore owner guard runs before requesting a password", async t => {
  const f = await fixture(t), other = Wallet.createRandom();
  const file = path.join(f.dir, "wrong-owner.json");
  fs.writeFileSync(file, JSON.stringify({ version: 3, address: other.address.slice(2), crypto: { ciphertext: "aa".repeat(32) } }), { mode: 0o600 });
  await assert.rejects(unlockKeystore(file, f.wallet.address, async () => { throw Error("must not prompt"); }), /differs/);
});

test("generated V3 keystore unlocks only to its matching owner", async t => {
  const f = await fixture(t), file = path.join(f.dir, "fixture-key.json");
  fs.writeFileSync(file, await f.wallet.encrypt("fixture-only-password"), { mode: 0o600 });
  const unlocked = await unlockKeystore(file, f.wallet.address, async () => "fixture-only-password");
  assert.equal(unlocked.address, f.wallet.address);
  await assert.rejects(unlockKeystore(file, f.wallet.address, async () => "wrong"), /Could not unlock/);
});

test("exact signed calldata, fees, nonce, chain and owner are required", async t => {
  const f = await fixture(t);
  const raw = await f.wallet.signTransaction(unsignedForAction(f.action));
  assert.equal(validateSigned(f.action, raw, f.wallet.address).unsignedHash, f.action.unsignedHash);
  const changed = Transaction.from(unsignedForAction(f.action)); changed.nonce += 1;
  await assert.rejects(async () => validateSigned(f.action, await f.wallet.signTransaction(changed), f.wallet.address), /differs/);
  assert.throws(() => validateSigned(f.action, raw, Wallet.createRandom().address), /differs/);
});

test("signed raw is durable before broadcast and confirmed execution is not sent twice", async t => {
  const f = await fixture(t);
  let sends = 0, checks = 0;
  const provider = delegatedProvider(f.provider, { broadcastTransaction: async raw => {
    sends++;
    const saved = JSON.parse(fs.readFileSync(f.journalPath));
    assert.equal(saved.actions[0].status, "signed");
    assert.equal(saved.actions[0].rawSignedTransaction, raw);
    assert.equal(saved.actions[0].hash, keccak256(raw));
    assert.equal(fs.statSync(f.journalPath).mode & 0o777, 0o600);
    const sent = await f.provider.broadcastTransaction(raw);
    for (let i = 0; i < 12; i++) await f.provider.send("evm_mine", []);
    return sent;
  } });
  const journal = await executeActions({ ...common(f), provider, freshCheck: async () => { checks++; } });
  assert.equal(sends, 1); assert.equal(checks, 3);
  assert.equal(journal.actions[0].status, "confirmed");
  assert.ok(BigInt(journal.actions[0].receipt.feeWei) > 0n);
  await executeActions({ ...common(f), provider, getSigner: async () => { throw Error("must not resign"); } });
  assert.equal(sends, 1);
});

test("uncertain broadcast resumes identical bytes without decrypting or assigning a new nonce", async t => {
  const f = await fixture(t);
  let signedRaw;
  const unavailable = delegatedProvider(f.provider, { broadcastTransaction: async raw => { signedRaw = raw; throw Error("fixture RPC interruption"); } });
  await assert.rejects(executeActions({ ...common(f), provider: unavailable, timeoutMs: 5 }), /unresolved/);
  const initial = JSON.parse(fs.readFileSync(f.journalPath));
  assert.equal(initial.actions[0].status, "broadcast_uncertain");
  const resumed = delegatedProvider(f.provider, { broadcastTransaction: async raw => {
    assert.equal(raw, signedRaw);
    const sent = await f.provider.broadcastTransaction(raw);
    for (let i = 0; i < 12; i++) await f.provider.send("evm_mine", []);
    return sent;
  } });
  const final = await executeActions({ ...common(f), provider: resumed, getSigner: async () => { throw Error("must not decrypt again"); } });
  assert.equal(final.actions[0].hash, initial.actions[0].hash);
  assert.equal(final.actions[0].nonce, initial.actions[0].nonce);
  assert.equal(final.actions[0].status, "confirmed");
});

test("a stale preflight stops before requesting the signer", async t => {
  const f = await fixture(t); let prompted = false;
  await assert.rejects(executeActions({ ...common(f), provider: f.provider,
    getSigner: async () => { prompted = true; return f.wallet; },
    freshCheck: async () => { throw Error("stale nonce"); } }), /stale nonce/);
  assert.equal(prompted, false); assert.equal(fs.existsSync(f.journalPath), false);
});

test("changed plan bytes stop before broadcast even after the password prompt", async t => {
  const f = await fixture(t); let sends = 0;
  const provider = delegatedProvider(f.provider, { broadcastTransaction: async () => { sends++; throw Error("must not broadcast"); } });
  await assert.rejects(executeActions({ ...common(f), provider, getSigner: async () => {
    fs.appendFileSync(f.planPath, " "); return f.wallet;
  } }), /Plan changed/);
  assert.equal(sends, 0);
});

test("canonical block mismatch is rejected before a receipt is accepted", async t => {
  const f = await fixture(t), raw = await f.wallet.signTransaction(unsignedForAction(f.action));
  await f.provider.broadcastTransaction(raw);
  const provider = delegatedProvider(f.provider, { getBlock: async () => ({ hash: "0x" + "00".repeat(32) }) });
  await assert.rejects(waitCanonicalReceipt(provider, Transaction.from(raw), { confirmations: 0 }), /reorganized/);
});
