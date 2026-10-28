import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AbiCoder, Interface, Transaction, Wallet, toQuantity } from "ethers";
import { REGISTRATION as R, validateRegistrationPlan, reconcileRegistrationJournals,
  prepareRegistrationContinuation } from "../scripts/prepare-registration.mjs";

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
const iface = new Interface(["function setSwapPool(address manager,bytes32 poolId,bool allowed)"]);
function planFor(pools = R.pools, nonce = 10) {
  return { schema: "gh0st-manual-rh-v1", operation: "register", broadcast: false, chainId: "4663",
    owner: R.owner, icpSigner: R.signer, gateway: R.gateway, modelId: R.modelId, artifactHash: R.artifactHash,
    registrations: pools.map((poolId, index) => {
      const tx = Transaction.from({ type: 2, chainId: 4663n, nonce: nonce + index, to: R.gateway,
        value: 0n, data: iface.encodeFunctionData("setSwapPool", [R.manager, poolId, true]),
        gasLimit: 100000n, maxFeePerGas: 40000000n, maxPriorityFeePerGas: 0n });
      return { manager: R.manager, poolId, unsignedSerialized: tx.unsignedSerialized, unsignedHash: tx.unsignedHash,
        walletRequest: { method: "eth_sendTransaction", params: [{ from: R.owner, to: R.gateway, data: tx.data,
          type: "0x2", chainId: "0x1237", value: "0x0", nonce: toQuantity(tx.nonce), gas: toQuantity(tx.gasLimit),
          maxFeePerGas: toQuantity(tx.maxFeePerGas), maxPriorityFeePerGas: "0x0" }] } };
    }) };
}

async function historyFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-registration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wallet = Wallet.createRandom(), plan = planFor(); plan.owner = wallet.address;
  const tx = Transaction.from(plan.registrations[0].unsignedSerialized);
  const raw = await wallet.signTransaction(tx), signed = Transaction.from(raw);
  const actions = plan.registrations.map((entry, id) => ({ id, transaction: entry.walletRequest.params[0],
    unsignedHash: entry.unsignedHash, nonce: 10 + id }));
  const planPath = path.join(directory, "rh-registration-plan.json");
  fs.writeFileSync(planPath, json(plan));
  const blockHash = "0x" + "ab".repeat(32);
  const receipt = { hash: signed.hash, blockNumber: 100, blockHash, status: 1,
    gasUsed: 42000n, gasPrice: 20000000n, contractAddress: null };
  const journalPath = planPath + ".signed-journal.json";
  const journal = { schema: "gh0st-rh-signed-v1", planHash: digest(fs.readFileSync(planPath)),
    owner: wallet.address, chainId: 4663, actions: [{ id: 0, status: "confirmed", nonce: 10,
      hash: signed.hash, unsignedHash: signed.unsignedHash, rawSignedTransaction: raw,
      receipt: { transactionHash: signed.hash, blockNumber: 100, blockHash, status: 1,
        gasUsed: "42000", effectiveGasPrice: "20000000", feeWei: "840000000000" } }] };
  const save = () => fs.writeFileSync(journalPath, json(journal), { mode: 0o600 }); save();
  const provider = {
    send: async () => "0x1237", getTransactionReceipt: async () => receipt,
    getTransaction: async () => signed, getBlock: async () => ({ hash: blockHash }),
    getBlockNumber: async () => 112, getTransactionCount: async () => 12,
  };
  const run = () => reconcileRegistrationJournals({ directory, provider, validate: () => actions });
  return { directory, planPath, journalPath, journal, save, provider, receipt, run };
}

test("registration guard pins the deployment, pools and exact zero-value authorization", () => {
  assert.equal(validateRegistrationPlan(planFor()).length, 2);
  assert.equal(validateRegistrationPlan(planFor([])).length, 0);
  for (const change of [p => { p.gateway = R.owner; }, p => { p.icpSigner = R.owner; },
    p => { p.registrations[0].manager = R.owner; }, p => { p.registrations[0].poolId = R.pools[1]; },
    p => { p.registrations[0].walletRequest.params[0].value = "0x1"; }]) {
    const plan = planFor(); change(plan); assert.throws(() => validateRegistrationPlan(plan));
  }
});

test("confirmed historical action permits a fresh nonce after an unrelated consumed nonce", async t => {
  const f = await historyFixture(t), before = fs.readFileSync(f.journalPath);
  const result = await f.run();
  assert.equal(result.confirmed.length, 1); assert.equal(result.nextNonce, 12);
  assert.deepEqual(fs.readFileSync(f.journalPath), before);
});

test("pending, uncertain and reverted signed intents block continuation", async t => {
  const f = await historyFixture(t);
  for (const status of ["signed", "broadcast", "broadcast_uncertain", "reverted"]) {
    f.journal.actions[0].status = status; f.save();
    await assert.rejects(f.run(), /unresolved, reverted or active/);
  }
});

test("missing receipts and insufficient confirmations block continuation", async t => {
  const f = await historyFixture(t);
  f.provider.getTransactionReceipt = async () => null;
  await assert.rejects(f.run(), /unresolved/);
  f.provider.getTransactionReceipt = async () => f.receipt;
  f.provider.getBlockNumber = async () => 111;
  await assert.rejects(f.run(), /unresolved/);
});

test("canonical block, stored receipt and observed transaction mismatches block continuation", async t => {
  const f = await historyFixture(t);
  f.provider.getBlock = async () => ({ hash: "0x" + "cd".repeat(32) });
  await assert.rejects(f.run(), /reorganized/);
  f.provider.getBlock = async () => ({ hash: f.receipt.blockHash });
  f.receipt.gasUsed++;
  await assert.rejects(f.run(), /receipt changed/);
  f.receipt.gasUsed--;
  f.provider.getTransaction = async () => ({ data: "0x1234" });
  await assert.rejects(f.run(), /differs/);
});

test("changed plan and forged journal bindings block continuation", async t => {
  const f = await historyFixture(t), bytes = fs.readFileSync(f.planPath);
  fs.appendFileSync(f.planPath, " "); await assert.rejects(f.run(), /unchanged plan/);
  fs.writeFileSync(f.planPath, bytes);
  f.journal.actions[0].nonce++; f.save(); await assert.rejects(f.run(), /nonce or hash/);
  f.journal.actions[0].nonce--; f.journal.actions[0].rawSignedTransaction = "0x1234"; f.save();
  await assert.rejects(f.run(), /Signed transaction/);
});

test("active lock, wallet intent and pending owner nonce block fresh plans", async t => {
  const f = await historyFixture(t), lock = f.journalPath + ".lock";
  fs.writeFileSync(lock, "fixture"); await assert.rejects(f.run(), /active registration intent/); fs.unlinkSync(lock);
  const report = path.join(f.directory, "rh-register-cli.wallet-reports.json");
  fs.writeFileSync(report, "{}"); await assert.rejects(f.run(), /active registration intent/); fs.unlinkSync(report);
  f.provider.getTransactionCount = async (_, tag) => tag === "pending" ? 13 : 12;
  await assert.rejects(f.run(), /pending or inconsistent nonce/);
});

test("fresh plan contains only the unauthorized Pons pool at the current nonce", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-registration-prepare-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls = 0, prepared = 0;
  const provider = { call: async () => AbiCoder.defaultAbiCoder().encode(["bool"], [calls++ === 0]),
    getTransactionCount: async () => 12 };
  const result = await prepareRegistrationContinuation({ directory, output: path.join(directory, "fresh.json"), provider,
    reconcile: async () => ({ confirmed: [], nextNonce: 12, files: [], names: [] }),
    prepare: async args => { prepared++; assert.equal(args[args.indexOf("--gateway") + 1], R.gateway);
      return planFor([R.pools[1]], 12); } });
  assert.equal(prepared, 1); assert.equal(result.remaining, 1); assert.equal(result.plan.registrations[0].poolId, R.pools[1]);
});
