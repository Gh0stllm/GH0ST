import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { AbiCoder, Interface, Transaction, Wallet, id } from "ethers";
import { SWAP_ABI } from "../worker/swaps.mjs";
import { resultTypes } from "../worker/protocol.mjs";
import { LOCAL_RELAYER_POLICY as P } from "../worker/local-relayer.mjs";

// Ephemeral offline signer: the old public pilot signature belongs to the old
// gateway domain and cannot be reused after a manifest-bound deployment. Only
// a test-loaded module's public trust anchor changes; production bytes do not.
// Neither this signer nor the random gas wallets are saved or used on-chain.
const fixtureSigner = Wallet.createRandom();
const source = { manager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  poolId: "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01",
  transactionHash: "0xc28f82412c4beea4ced077fe3bb9247a308cca51d9a210baec0d556f4914209a", logIndex: 47n };
const result = { requestId: "0x45cafa1ecafdaa1a64d69820d57902ed2d3624b0d10d73ae0c7020c8220393d6",
  promptHash: "0xa2d62116acb6335ec0239b9df824d0e2683609b7a0266d318461452af97e5125",
  modelId: "0x169670d418d7032d6b7429b6b8d27e6cb6d755be6fce5d36e9f7c9bd74471005",
  artifactHash: P.artifactHash,
  answerHash: "0xb7f341207456afab3c5e3f2d237836d55cafc40e5fdc271780e071212fbb60b5",
  inputTokens: 242n, outputTokens: 16n, modelCycles: 1386676573947n };
const answer = "the spoon's hunger is a silent war; i've swallowed the void.";
const signature = await fixtureSigner.signTypedData({ name: "GH0ST ICP Inference", version: "1",
  chainId: P.chainId, verifyingContract: P.gateway }, resultTypes, result);
const iface = new Interface(["function fulfillSwapInference((address manager,bytes32 poolId,bytes32 transactionHash,uint256 logIndex) source,(bytes32 requestId,bytes32 promptHash,bytes32 modelId,bytes32 artifactHash,bytes32 answerHash,uint64 inputTokens,uint64 outputTokens,uint128 modelCycles) result,string answer,bytes signature)"]);
const calldata = (s = source, r = result, a = answer, sig = signature) => iface.encodeFunctionData("fulfillSwapInference", [s, r, a, sig]);

async function fixture(t, options = {}) {
  const moduleUrl = new URL(`../worker/local-relayer.mjs?fixture=${Math.random()}`, import.meta.url).href;
  const hook = options.productionSigner ? null : registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== moduleUrl) return loaded;
    const source = String(loaded.source), anchor = `icpSigner: "${P.icpSigner}"`;
    assert.equal(source.split(anchor).length, 2, "Only the exact public test trust anchor may change");
    return { ...loaded, source: source.replace(anchor, `icpSigner: "${fixtureSigner.address}"`) };
  } });
  let module;
  try { module = await import(moduleUrl); } finally { hook?.deregister(); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-relayer-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wallet = Wallet.createRandom(), ledger = path.join(dir, "fees.json");
  const swap = new Interface(SWAP_ABI).encodeEventLog("Swap", [source.poolId, wallet.address, -10000000000000n,
    323515226282140870077n, 450636665515841416958411607091206n, 29277002188455996411301n, 172930, 0]);
  const receipt = { hash: source.transactionHash, status: 1, blockNumber: 100, blockHash: id("source-block"),
    logs: [{ ...swap, address: source.manager, index: 47 }] };
  const settings = { nonce: 7, balance: 10n ** 18n, head: 112, blockHash: receipt.blockHash, now: Date.UTC(2026, 0, 2) };
  let signs = 0;
  const provider = { send: async () => "0x1237", getTransactionCount: async () => settings.nonce,
    getBalance: async () => settings.balance, getBlockNumber: async () => settings.head,
    call: async () => AbiCoder.defaultAbiCoder().encode(["address", "uint32", "uint64", "uint8", "bytes32", "bytes32"],
      ["0x0000000000000000000000000000000000000000", 0, 0, 0, id("zero"), id("zero")]),
    getTransactionReceipt: async hash => hash === source.transactionHash ? receipt : null,
    getBlock: async () => ({ hash: settings.blockHash, timestamp: Math.floor(settings.now / 1000) }) };
  const signer = { address: wallet.address, signTransaction: async tx => { signs++; return options.sign ? options.sign(tx, wallet, ledger) : wallet.signTransaction(tx); } };
  assert.equal(module.getInjectedRelayer(), null);
  assert.deepEqual(await module.checkInjectedRelayerAdmission(), { allowed: false, reason: "relayer_unavailable" });
  const adapter = await module.installInjectedRelayer({ signer, provider, expectedAddress: wallet.address, feeLedgerPath: ledger,
    dailyBudgetWei: options.budget ?? null, now: () => settings.now });
  const tx = { to: module.LOCAL_RELAYER_POLICY.gateway, chainId: 4663n, type: 2, value: 0n,
    data: calldata(), gasLimit: 200000n, maxFeePerGas: 40000000n, maxPriorityFeePerGas: 0n };
  return { module, wallet, adapter, provider, receipt, settings, ledger, tx, signs: () => signs };
}

test("conditional successor pins stay exact and the production trust anchor rejects the offline fixture", async t => {
  assert.equal(P.gateway, "0x0a99a5f180AB7990877DF73f63686958298330ce");
  assert.equal(P.artifactHash, "0x65d045ec2ab262372834065fb7d59453e7047ecac2a346d55d5eb14f4b123b53");
  const f = await fixture(t, { productionSigner: true });
  await assert.rejects(f.adapter.populateTransaction(f.tx), /pinned ICP signer/);
  assert.equal(f.signs(), 0);
});

test("in-memory adapter exposes no key/provider and persists a reservation before signing", async t => {
  const f = await fixture(t, { sign: async (tx, wallet, ledger) => {
    const saved = JSON.parse(fs.readFileSync(ledger));
    assert.equal(saved.reservations[0].status, "reserved");
    assert.equal(fs.statSync(ledger).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(saved).includes(wallet.privateKey), false);
    return wallet.signTransaction(tx);
  } });
  assert.deepEqual(Object.keys(f.adapter).sort(), ["address", "populateTransaction", "signTransaction"]);
  assert.equal(Object.isFrozen(f.adapter), true);
  assert.equal(JSON.stringify(f.adapter).includes(f.wallet.privateKey), false);
  assert.equal(f.module.getInjectedRelayer(), f.adapter);
  const tx = await f.adapter.populateTransaction(f.tx);
  const raw = await f.adapter.signTransaction(tx), signed = Transaction.from(raw);
  assert.equal(signed.from, f.wallet.address); assert.equal(signed.nonce, 7);
  assert.equal(signed.data, f.tx.data); assert.equal(signed.value, 0n);
  assert.equal(JSON.parse(fs.readFileSync(f.ledger)).reservations[0].transactionHash, signed.hash);
  await assert.rejects(f.module.installInjectedRelayer({}), /already installed/);
});

test("adapter rejects transfers, setters, approvals, alternate chains and excessive fee/gas", async t => {
  const f = await fixture(t);
  for (const tx of [{ ...f.tx, to: f.wallet.address }, { ...f.tx, value: 1n }, { ...f.tx, chainId: 1n },
    { ...f.tx, data: new Interface(["function setPaused(bool)"]).encodeFunctionData("setPaused", [true]) },
    { ...f.tx, data: new Interface(["function approve(address,uint256)"]).encodeFunctionData("approve", [f.wallet.address, 1n]) },
    { ...f.tx, gasLimit: 500001n }, { ...f.tx, maxFeePerGas: 50000001n },
    { ...f.tx, accessList: [] }, { ...f.tx, type: 0 }, { ...f.tx, gasPrice: 1n }])
    await assert.rejects(f.adapter.populateTransaction(tx));
  assert.equal(f.signs(), 0);
});

test("exact ICP signature, model, artifact, source and answer hash are mandatory", async t => {
  const f = await fixture(t);
  for (const data of [calldata({ ...source, poolId: id("other-pool") }), calldata({ ...source, transactionHash: id("other-source") }),
    calldata(source, { ...result, modelId: id("other-model") }), calldata(source, { ...result, artifactHash: id("other-artifact") }),
    calldata(source, result, answer + "!"), calldata(source, { ...result, promptHash: id("changed") }),
    calldata(source, result, answer, "0x" + "00".repeat(65)), f.tx.data + "00"])
    await assert.rejects(f.adapter.populateTransaction({ ...f.tx, data }));
  assert.equal(f.signs(), 0);
});

test("relayer accepts protocol-sized exact thoughts without the old presentation cap", async t => {
  const f = await fixture(t);
  for (const length of [1, 181, 280, 8192]) {
    const text = "w".repeat(length), signedResult = { ...result, answerHash: id(text) };
    const sig = await fixtureSigner.signTypedData({ name: "GH0ST ICP Inference", version: "1",
      chainId: P.chainId, verifyingContract: P.gateway }, resultTypes, signedResult);
    const tx = { ...f.tx, data: calldata(source, signedResult, text, sig) };
    assert.equal((await f.adapter.populateTransaction(tx)).data, tx.data);
  }
  const text = "w".repeat(8193), signedResult = { ...result, answerHash: id(text) };
  const sig = await fixtureSigner.signTypedData({ name: "GH0ST ICP Inference", version: "1",
    chainId: P.chainId, verifyingContract: P.gateway }, resultTypes, signedResult);
  await assert.rejects(f.adapter.populateTransaction({ ...f.tx, data: calldata(source, signedResult, text, sig) }));
  assert.equal(f.signs(), 0);
});

test("canonical buy direction, twelve descendants and funded maximum fee are required", async t => {
  const f = await fixture(t);
  f.settings.head = 111; await assert.rejects(f.adapter.populateTransaction(f.tx), /twelve/);
  f.settings.head = 112; f.settings.blockHash = id("reorg"); await assert.rejects(f.adapter.populateTransaction(f.tx), /canonical/);
  f.settings.blockHash = f.receipt.blockHash; f.settings.balance = 1n;
  await assert.rejects(f.adapter.populateTransaction(f.tx), /balance/);
  f.settings.balance = 10n ** 18n;
  const sell = new Interface(SWAP_ABI).encodeEventLog("Swap", [source.poolId, f.wallet.address, 1n, -1n, 1n, 1n, 0, 0]);
  Object.assign(f.receipt.logs[0], sell);
  await assert.rejects(f.adapter.populateTransaction(f.tx), /buys/);
});

test("nonce changes and attempts to re-sign the same source at a new nonce stop", async t => {
  const f = await fixture(t), tx = await f.adapter.populateTransaction(f.tx);
  f.settings.nonce++; await assert.rejects(f.adapter.signTransaction(tx), /nonce changed/);
  f.settings.nonce--; await f.adapter.signTransaction(tx);
  f.settings.nonce++;
  const next = await f.adapter.populateTransaction(f.tx);
  await assert.rejects(f.adapter.signTransaction(next), /already has a different/);
  assert.equal(f.signs(), 1);
});

test("daily maximum is reserved before signing and failed signing never releases it", async t => {
  const f = await fixture(t, { budget: 8000000000000n, sign: async (_, wallet) => { throw Error(wallet.privateKey); } });
  const tx = await f.adapter.populateTransaction(f.tx);
  await assert.rejects(f.adapter.signTransaction(tx), /private details withheld/);
  assert.equal(JSON.parse(fs.readFileSync(f.ledger)).reservations[0].maximumFeeWei, "8000000000000");
  assert.equal(JSON.parse(fs.readFileSync(f.ledger)).reservations[0].status, "reserved");
  assert.equal(f.signs(), 1);
});

test("budget exhaustion and old unresolved reservations block before signing", async t => {
  const f = await fixture(t, { budget: 8000000000000n });
  fs.writeFileSync(f.ledger, JSON.stringify({ schema: "gh0st-relayer-fees-v1", address: f.wallet.address,
    gateway: f.module.LOCAL_RELAYER_POLICY.gateway, chainId: 4663, dailyBudgetWei: "8000000000000",
    reservations: [{ unsignedHash: id("older-unsigned"), sourceId: id("older-source"), nonce: 6,
      maximumFeeWei: "8000000000000", reservedDay: "2026-01-01", status: "reserved" }] }), { mode: 0o600 });
  await assert.rejects(f.adapter.signTransaction(await f.adapter.populateTransaction(f.tx)), /daily fee budget/);
  assert.equal(f.signs(), 0);
});

test("canonical old-day receipt settles a reservation before today's budget check", async t => {
  const f = await fixture(t, { budget: 8000000000000n }), olderHash = id("older-tx"), olderBlock = id("older-block");
  fs.writeFileSync(f.ledger, JSON.stringify({ schema: "gh0st-relayer-fees-v1", address: f.wallet.address,
    gateway: f.module.LOCAL_RELAYER_POLICY.gateway, chainId: 4663, dailyBudgetWei: "8000000000000",
    reservations: [{ unsignedHash: id("older-unsigned"), sourceId: id("older-source"), nonce: 6,
      maximumFeeWei: "8000000000000", reservedDay: "2026-01-01", status: "signed", transactionHash: olderHash }] }), { mode: 0o600 });
  f.provider.getTransactionReceipt = async hash => hash === source.transactionHash ? f.receipt : hash === olderHash ?
    { hash: olderHash, status: 1, blockNumber: 90, blockHash: olderBlock, gasUsed: 100000n, gasPrice: 40000000n } : null;
  f.provider.getBlock = async number => number === 90 ? { hash: olderBlock, timestamp: Date.UTC(2026, 0, 1) / 1000 } :
    { hash: f.receipt.blockHash, timestamp: f.settings.now / 1000 };
  await f.adapter.signTransaction(await f.adapter.populateTransaction(f.tx));
  const ledger = JSON.parse(fs.readFileSync(f.ledger));
  assert.equal(ledger.reservations[0].status, "confirmed");
  assert.equal(ledger.reservations[0].actualFeeWei, "4000000000000");
  assert.equal(ledger.reservations[0].confirmedDay, "2026-01-01");
  assert.equal(f.signs(), 1);
});

test("the production main wallet can never be installed as background relayer", async () => {
  const module = await import(`../worker/local-relayer.mjs?main-wallet=${Math.random()}`);
  await assert.rejects(module.installInjectedRelayer({ expectedAddress: module.LOCAL_RELAYER_POLICY.mainWallet }), /separate dedicated/);
});

test("read-only admission with no daily cap needs no ledger or extra RPC", async t => {
  const f = await fixture(t);
  f.provider.getTransactionReceipt = async () => { throw Error("must not read"); };
  const admission = await f.module.checkInjectedRelayerAdmission();
  assert.equal(admission.allowed, true); assert.equal(admission.dailyBudgetWei, null);
  assert.equal(admission.requiredWei, "25000000000000");
  assert.equal(fs.existsSync(f.ledger), false); assert.equal(f.signs(), 0);
});

test("read-only admission reserves full callback maximum and preserves unresolved old-day holds", async t => {
  const f = await fixture(t, { budget: 30000000000000n });
  const ledger = { schema: "gh0st-relayer-fees-v1", address: f.wallet.address,
    gateway: f.module.LOCAL_RELAYER_POLICY.gateway, chainId: 4663, dailyBudgetWei: "30000000000000",
    reservations: [{ unsignedHash: id("older-unsigned"), sourceId: id("older-source"), nonce: 6,
      maximumFeeWei: "8000000000000", reservedDay: "2026-01-01", status: "reserved" }] };
  fs.writeFileSync(f.ledger, JSON.stringify(ledger), { mode: 0o600 });
  const before = fs.readFileSync(f.ledger);
  const admission = await f.module.checkInjectedRelayerAdmission();
  assert.equal(admission.allowed, false); assert.equal(admission.reason, "daily_relayer_fee_budget");
  assert.equal(admission.usedWei, "8000000000000"); assert.equal(admission.availableWei, "22000000000000");
  assert.deepEqual(fs.readFileSync(f.ledger), before); assert.equal(f.signs(), 0);
});

test("read-only admission virtually settles confirmed fees without changing the ledger", async t => {
  const f = await fixture(t, { budget: 30000000000000n }), olderHash = id("older-tx"), blockHash = id("older-block");
  fs.writeFileSync(f.ledger, JSON.stringify({ schema: "gh0st-relayer-fees-v1", address: f.wallet.address,
    gateway: f.module.LOCAL_RELAYER_POLICY.gateway, chainId: 4663, dailyBudgetWei: "30000000000000",
    reservations: [{ unsignedHash: id("older-unsigned"), sourceId: id("older-source"), nonce: 6,
      maximumFeeWei: "8000000000000", reservedDay: "2026-01-01", status: "signed", transactionHash: olderHash }] }), { mode: 0o600 });
  f.provider.getTransactionReceipt = async () => ({ hash: olderHash, status: 1, blockNumber: 90, blockHash, gasUsed: 100000n, gasPrice: 40000000n });
  f.provider.getBlock = async () => ({ hash: blockHash, timestamp: f.settings.now / 1000 });
  const before = fs.readFileSync(f.ledger), admission = await f.module.checkInjectedRelayerAdmission();
  assert.equal(admission.allowed, true); assert.equal(admission.usedWei, "4000000000000");
  assert.equal(admission.availableWei, "26000000000000");
  assert.deepEqual(fs.readFileSync(f.ledger), before); assert.equal(f.signs(), 0);
});
