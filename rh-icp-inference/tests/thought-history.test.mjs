import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openThoughtHistory, exactThoughtHash, DEFAULT_THOUGHT_HISTORY_JOURNALS } from "../worker/thought-history.mjs";
import { swapSourceId } from "../worker/swaps.mjs";

const CANISTER = "6jacx-5yaaa-aaaaj-a65jq-cai";
const hex = digit => "0x" + digit.repeat(64);
const answer = "the silence is a receipt for a thought nobody ordered.";
function item(index, text = answer, state = "fulfilled") {
  const source = { manager: "0x" + "1".repeat(40), pool_id: hex("2"), transaction_hash: hex(String(index)), log_index: "7" };
  const id = swapSourceId(4663, source);
  return { id, kind: "swap", source, state,
    result: { answer: text, result: { requestId: id, answerHash: exactThoughtHash(text) } },
    ...(state === "fulfilled" ? { delivery: { confirmed: true, answer: text, answerHash: exactThoughtHash(text), transactionHash: hex("a"), blockHash: hex("b") } } : {}) };
}
function journal(requests = [], gateway = "0x" + "3".repeat(40)) {
  return { version: 1, binding: { chainId: 4663, canisterId: CANISTER, gateway }, requests };
}
function setup(t, groups = [[], [], []]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-thought-history-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "history.json");
  const journalFiles = groups.map((requests, i) => {
    const file = path.join(directory, "journal-" + i + ".json");
    fs.writeFileSync(file, JSON.stringify(journal(requests)));
    return file;
  });
  const options = { file, journalFiles, chainId: 4663, canisterId: CANISTER };
  return { directory, file, journalFiles, options, open: () => openThoughtHistory(options) };
}
const candidate = (entry, stage = "relay") => ({ sourceId: entry.id, answer: entry.result.answer, answerHash: entry.result.result.answerHash, stage });
const expectCode = code => error => error.code === code;

test("historical defaults include pilot and both worker generations", () => {
  assert.equal(DEFAULT_THOUGHT_HISTORY_JOURNALS.length, 3);
  assert.ok(DEFAULT_THOUGHT_HISTORY_JOURNALS.some(file => file.endsWith("rh-pilot-v2-worker.json")));
  assert.ok(DEFAULT_THOUGHT_HISTORY_JOURNALS.some(file => file.endsWith("buy-worker.json")));
  assert.ok(DEFAULT_THOUGHT_HISTORY_JOURNALS.some(file => file.endsWith("buy-worker-unlimited.json")));
});
test("seed all journals and block the same exact text under a new source", t => {
  const old = item(1), next = item(2), f = setup(t, [[old], [], []]);
  const history = f.open();
  assert.throws(() => history.reserve(candidate(next)), error => error.code === "DUPLICATE_THOUGHT" && error.duplicateSourceId === old.id && error.answerHash === exactThoughtHash(answer));
  assert.equal(history.snapshot().hashes[exactThoughtHash(answer)].ownerSourceId, old.id);
});
test("same source/text remains idempotent across relay and publication", t => {
  const current = item(1), f = setup(t), history = f.open();
  history.reserve(candidate(current));
  history.reserve(candidate(current, "publish"));
  const state = f.open().snapshot();
  assert.deepEqual(state.sources[current.id].stages, ["relay", "publish"]);
  assert.equal(state.hashes[exactThoughtHash(answer)].sourceIds.length, 1);
});
test("durable reservations survive restart and gateway migration", t => {
  const a = item(1), f = setup(t), history = f.open();
  history.reserve(candidate(a));
  fs.writeFileSync(f.journalFiles[2], JSON.stringify(journal([], "0x" + "9".repeat(40))));
  assert.throws(() => f.open().reserve(candidate(item(2))), expectCode("DUPLICATE_THOUGHT"));
});
test("deleting historical records from seed journals does not erase the index", t => {
  const f = setup(t, [[item(1)], [], []]);
  f.open();
  fs.writeFileSync(f.journalFiles[0], JSON.stringify(journal()));
  assert.throws(() => f.open().reserve(candidate(item(2))), expectCode("DUPLICATE_THOUGHT"));
});
test("all historic duplicate sources remain visible but only the first can publish", t => {
  const a = item(1), b = item(2), f = setup(t, [[a], [b], [a, b]]), history = f.open();
  assert.deepEqual(history.snapshot().hashes[exactThoughtHash(answer)].sourceIds, [a.id, b.id]);
  history.reserve(candidate(a, "publish"));
  assert.throws(() => history.reserve(candidate(b, "publish")), expectCode("DUPLICATE_THOUGHT"));
});
test("record can reconcile an already-confirmed duplicate without changing ownership", t => {
  const a = item(1), b = item(2), f = setup(t, [[a], [], []]), history = f.open();
  history.record(candidate(b, "delivered"));
  assert.equal(history.snapshot().hashes[exactThoughtHash(answer)].ownerSourceId, a.id);
  assert.throws(() => history.assertUnique(candidate(b, "publish")), expectCode("DUPLICATE_THOUGHT"));
});
test("the exact UTF-8 policy preserves case, whitespace, and normalization differences", t => {
  const f = setup(t), history = f.open();
  const variants = ["café", "cafe\u0301", " café", "CAFÉ"];
  for (let i = 0; i < variants.length; i++) history.reserve(candidate(item(i + 1, variants[i])));
  assert.equal(Object.keys(history.snapshot().hashes).length, variants.length);
  assert.equal(exactThoughtHash("café"), exactThoughtHash("caf\u00e9"));
});
test("invalid, empty, oversized, or malformed UTF-16 text never obtains a reservation", t => {
  const history = setup(t).open();
  for (const text of ["", "\ud800", "x".repeat(8193)]) {
    assert.throws(() => history.reserve({ sourceId: hex("1"), answer: text, answerHash: hex("2") }), expectCode("THOUGHT_HISTORY_INVALID"));
  }
  assert.equal(Object.keys(history.snapshot().sources).length, 0);
});
test("hash mismatch cannot poison the durable index", t => {
  const f = setup(t), history = f.open();
  assert.throws(() => history.reserve({ ...candidate(item(1)), answerHash: hex("f") }), expectCode("THOUGHT_HISTORY_INVALID"));
  assert.equal(Object.keys(history.snapshot().sources).length, 0);
});
test("one source cannot replace its previously reserved thought", t => {
  const f = setup(t), history = f.open(), a = item(1);
  history.reserve(candidate(a));
  assert.throws(() => history.reserve({ ...candidate(a), answer: "different", answerHash: exactThoughtHash("different") }), /cannot replace/);
});
test("missing and corrupt required journals fail closed, even with a saved index", t => {
  const f = setup(t), history = f.open();
  fs.rmSync(f.journalFiles[1]);
  assert.throws(() => history.reserve(candidate(item(1))), expectCode("THOUGHT_HISTORY_UNAVAILABLE"));
  fs.writeFileSync(f.journalFiles[1], "bad json");
  assert.throws(f.open, expectCode("THOUGHT_HISTORY_UNAVAILABLE"));
});
test("missing registry after opening is not silently recreated", t => {
  const f = setup(t), history = f.open();
  fs.rmSync(f.file);
  assert.throws(() => history.reserve(candidate(item(1))), expectCode("THOUGHT_HISTORY_UNAVAILABLE"));
});
test("corrupt and cross-network history fails closed", t => {
  const f = setup(t);
  f.open();
  const state = JSON.parse(fs.readFileSync(f.file)); state.chainId = 1;
  fs.writeFileSync(f.file, JSON.stringify(state));
  assert.throws(f.open, expectCode("THOUGHT_HISTORY_INVALID"));
  fs.writeFileSync(f.file, "{");
  assert.throws(f.open, expectCode("THOUGHT_HISTORY_UNAVAILABLE"));
});
test("a truncated source index cannot quietly drop a hash owner", t => {
  const f = setup(t, [[item(1)], [], []]); f.open();
  const state = JSON.parse(fs.readFileSync(f.file)); state.sources = {};
  fs.writeFileSync(f.file, JSON.stringify(state));
  assert.throws(f.open, expectCode("THOUGHT_HISTORY_INVALID"));
});
test("a changed historical source ID or signed hash is rejected", t => {
  const a = item(1), f = setup(t, [[a], [], []]);
  a.id = hex("f"); fs.writeFileSync(f.journalFiles[0], JSON.stringify(journal([a])));
  assert.throws(f.open, /source ID/);
  const b = item(2); b.result.result.answerHash = hex("f");
  fs.writeFileSync(f.journalFiles[0], JSON.stringify(journal([b])));
  assert.throws(f.open, /differs from its answer hash/);
});
test("signed and delivered answer disagreements fail closed", t => {
  const a = item(1); a.delivery.answer = "different"; a.delivery.answerHash = exactThoughtHash("different");
  const f = setup(t, [[a], [], []]);
  assert.throws(f.open, /Signed and delivered thoughts differ/);
});
test("attempted X publication without confirmed delivery cannot be silently ignored", t => {
  const a = item(1, answer, "signed"); a.publication = { status: "sending", attempt: 1 };
  const f = setup(t, [[a], [], []]);
  assert.throws(f.open, /lacks confirmed thought history/);
});
test("queued rows without generated thoughts are safe and signed rows are indexed", t => {
  const signed = item(1, answer, "signed");
  const queued = { ...item(2), result: undefined, delivery: undefined, state: "queued" };
  const f = setup(t, [[signed, queued], [], []]), history = f.open();
  assert.equal(Object.keys(history.snapshot().sources).length, 1);
  assert.throws(() => history.reserve(candidate(item(3))), expectCode("DUPLICATE_THOUGHT"));
});
test("new history appended by a different worker is read before the next reservation", t => {
  const f = setup(t), history = f.open();
  fs.writeFileSync(f.journalFiles[2], JSON.stringify(journal([item(1)])));
  assert.throws(() => history.reserve(candidate(item(2))), expectCode("DUPLICATE_THOUGHT"));
});
test("exclusive lock never overwrites or removes another writer's lock", t => {
  const f = setup(t), history = f.open();
  const prior = fs.readFileSync(f.file, "utf8");
  fs.writeFileSync(f.file + ".lock", "other writer");
  assert.throws(() => history.reserve(candidate(item(1))), expectCode("THOUGHT_HISTORY_LOCKED"));
  assert.equal(fs.readFileSync(f.file, "utf8"), prior);
  assert.equal(fs.readFileSync(f.file + ".lock", "utf8"), "other writer");
});
test("registry writes use private permissions and leave no temporary files", t => {
  const f = setup(t), history = f.open(); history.reserve(candidate(item(1)));
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.ok(!fs.readdirSync(f.directory).some(name => /\.tmp-|\.lock$/.test(name)));
});
test("returned snapshots cannot mutate persisted history", t => {
  const f = setup(t, [[item(1)], [], []]), history = f.open();
  const snapshot = history.snapshot(); snapshot.hashes = {}; snapshot.sources = {};
  assert.throws(() => history.reserve(candidate(item(2))), expectCode("DUPLICATE_THOUGHT"));
});
test("an empty required journal set is never a fresh safe history", t => {
  const f = setup(t);
  assert.throws(() => openThoughtHistory({ ...f.options, journalFiles: [] }), /nonempty required journal set/);
});
