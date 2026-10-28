import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { id } from "ethers";
import { planPublication } from "../worker/x-publisher.mjs";
import { afterimageAltText } from "../worker/x-media.mjs";
import { swapSourceId } from "../worker/swaps.mjs";
import { PROOF_FOLLOWUP as P, planProofFollowup, sendProofFollowup } from "../worker/x-proof-followups.mjs";
import { proofSidecarBinding, loadProofSidecar, saveProofSidecar, runProofFollowupPass } from "../scripts/run-proof-followups.mjs";
import { PROOF_RETENTION as R, archivedProofReplies, proofArchiveDirectory,
  loadRetainedProofState, saveRetainedProofState, unarchivedProofInputs } from "../worker/proof-retention.mjs";

const clone = value => JSON.parse(JSON.stringify(value));
function place(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "proof-retention-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "proofs.json"), binding = proofSidecarBinding(path.join(directory, "main.json"));
  return { directory, file, binding, state: { schema: R.legacySchema, binding, replies: {} } };
}
function fixture(n, schema = "gh0st-x-proof-followup-v2") {
  const postId = (BigInt(P.anchorPostId) + BigInt(n)).toString(), answer = "Exact retained thought " + n;
  const source = { manager: P.manager, pool_id: P.poolId, transaction_hash: id("swap" + n), log_index: n };
  const sourceId = swapSourceId(4663, source), transactionHash = id("callback" + n);
  const delivery = { confirmed: true, answer, answerHash: id(answer), transactionHash, blockNumber: 100 + n, blockHash: id("block" + n), logIndex: 2 };
  const proofUrl = "https://robin.etherscan.io/tx/" + transactionHash;
  const asset = { mimeType: "image/png", pngSha256: "aa".repeat(32), answerHash: id(answer), width: 1200,
    height: 1200, byteLength: 24000, answer, altText: afterimageAltText(answer, proofUrl), proofUrl,
    rendererVersion: "gh0st-afterimage-v1", fontSha256: "bb".repeat(32) };
  const parentPlan = planPublication({ ...delivery, requestId: sourceId }, { format: "afterimage", asset,
    mediaId: "2114736976947777536", mediaExpiresAt: 9999999999999 });
  const item = { id: sourceId, source, kind: "swap", state: "fulfilled", delivery, publicationPlan: parentPlan,
    publication: { schema: parentPlan.schema, planId: parentPlan.planId, textHash: parentPlan.textHash, status: "posted", postId } };
  const plan = planProofFollowup(item, { schema });
  const publication = { schema: plan.schema, parentPostId: postId, planId: plan.planId, textHash: plan.textHash,
    status: "posted", attempt: 1, postId: (BigInt(postId) + 100000n).toString(), updatedAt: n + 1000 };
  return { item, entry: { plan, publication, retainedExtra: { exact: "history " + n } } };
}
function populated(count, binding) {
  const state = { schema: R.legacySchema, binding, replies: {} }, items = [];
  for (let n = 0; n < count; n++) { const f = fixture(n, n % 2 ? "gh0st-x-proof-followup-v2" : "gh0st-x-proof-followup-v1");
    state.replies[f.item.publication.postId] = f.entry; items.push(f.item); }
  return { state, journal: { version: 1, binding: { chainId: 4663, gateway: P.gateway, canisterId: P.canisterId }, requests: items } };
}
function writeLegacy(file, state) { fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 }); }

test("513 completed replies compact to 256 recent entries with exact immutable archives and restart dedup", async t => {
  const { file, binding } = place(t), { state, journal } = populated(513, binding), original = clone(state), mainBefore = JSON.stringify(journal);
  writeLegacy(file, state); assert.deepEqual(loadProofSidecar(file, binding), original, "old schema loads losslessly without a 512 count cap");
  saveProofSidecar(file, state); assert.equal(state.schema, R.schema);
  assert.equal(Object.keys(state.replies).length, 256); assert.equal(Object.keys(archivedProofReplies(state)).length, 257);
  assert.equal(fs.readdirSync(proofArchiveDirectory(file)).length, 257);
  for (const [parent, descriptor] of Object.entries(archivedProofReplies(state))) {
    const target = path.join(proofArchiveDirectory(file), descriptor.file), record = JSON.parse(fs.readFileSync(target));
    assert.deepEqual(record.entry, original.replies[parent]);assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  }
  const restart = loadProofSidecar(file, binding);let sends = 0, tokenReads = 0;
  await runProofFollowupPass({ mainJournal: journal, state: restart, persist: s => saveProofSidecar(file, s),
    getToken: async () => { tokenReads++; return { accessToken: "never-used" }; }, verifyAccount: async () => {},
    verifyParent: async () => {}, verifyReceipt: async () => {}, send: async () => { sends++; } });
  assert.equal(sends, 0);assert.equal(tokenReads, 0);assert.equal(JSON.stringify(journal), mainBefore);
  assert.equal(unarchivedProofInputs(journal, restart).requests.length, 256);
  const retained = Object.keys(restart.replies).map(BigInt);assert.equal(retained.reduce((a,b)=>a<b?a:b),BigInt(P.anchorPostId)+257n);
});

test("unfinished and ambiguous replies never leave hot state, even when hot count exceeds 512", t => {
  const { file, binding } = place(t), { state } = populated(513, binding);
  const statuses = ["sending", "needs_reconciliation", "blocked", "retry_after", "retry_pending"];
  const pending = {};
  for (let n = 513; n < 813; n++) { const f = fixture(n); f.entry.publication.status = statuses[n % statuses.length];
    state.replies[f.item.publication.postId] = f.entry;pending[f.item.publication.postId] = clone(f.entry); }
  saveProofSidecar(file, state);
  assert.equal(Object.keys(state.replies).length, 556);
  for (const [parent, entry] of Object.entries(pending)) { assert.deepEqual(state.replies[parent], entry);assert.equal(archivedProofReplies(state)[parent], undefined); }
  assert.deepEqual(loadProofSidecar(file, binding), state);
});

test("hot entry references remain attached so a sending intent reaches disk before a post", t => {
  const { file, state } = place(t), f = fixture(0);delete f.entry.publication;state.replies[f.item.publication.postId] = f.entry;
  const reference = f.entry;saveProofSidecar(file, state);assert.equal(state.replies[f.item.publication.postId], reference);
  reference.publication = { schema: f.entry.plan.schema, planId: f.entry.plan.planId, parentPostId: f.item.publication.postId, status: "sending", attempt: 1 };
  saveProofSidecar(file, state);assert.equal(JSON.parse(fs.readFileSync(file)).replies[f.item.publication.postId].publication.status, "sending");
});

test("a post beyond the old lifetime cap persists sending intent and sends only once across restart", async t => {
  const { file, binding } = place(t), { state, journal } = populated(513, binding);saveProofSidecar(file, state);
  const f = fixture(513);journal.requests.push(f.item);let sends = 0;
  const options = { mainJournal: journal, state, persist: s => saveProofSidecar(file,s),
    getToken: async () => ({ accessToken: "synthetic-token" }), verifyAccount: async () => {}, verifyParent: async () => {}, verifyReceipt: async () => {},
    send: (plan, config) => sendProofFollowup(plan, { ...config, fetchImpl: async () => {
      const saved = loadProofSidecar(file,binding);assert.equal(saved.replies[plan.parentPostId].publication.status,"sending");
      sends++;return { status:201,json:async()=>({data:{id:"2115999999999999999"}}) };
    } }) };
  await runProofFollowupPass(options);assert.equal(sends,1);
  options.state=loadProofSidecar(file,binding);await runProofFollowupPass(options);assert.equal(sends,1);
  assert.equal(options.state.replies[f.item.publication.postId].publication.status,"posted");
});

test("compaction during a pass cannot recreate later planned replies that just moved into the archive", async t => {
  const { file,binding }=place(t), { state,journal }=populated(514,binding);
  delete state.replies[P.anchorPostId].publication;writeLegacy(file,state);let sends=0;
  const options={mainJournal:journal,state,persist:s=>saveProofSidecar(file,s),getToken:async()=>({accessToken:"synthetic-token"}),
    verifyAccount:async()=>{},verifyParent:async()=>{},verifyReceipt:async()=>{},
    send:(plan,config)=>sendProofFollowup(plan,{...config,fetchImpl:async()=>{sends++;return{status:201,json:async()=>({data:{id:"2115999999999999998"}})};}})};
  await runProofFollowupPass(options);assert.equal(sends,1);assert.ok(archivedProofReplies(state)[P.anchorPostId]);
  options.state=loadProofSidecar(file,binding);await runProofFollowupPass(options);assert.equal(sends,1);
});

test("crash after archive fsync leaves old journal and hot state intact and retry reuses exact bytes", t => {
  const { file, binding }=place(t), { state }=populated(257,binding);writeLegacy(file,state);
  const disk=fs.readFileSync(file),memory=JSON.stringify(state);let interrupted=false;
  assert.throws(()=>saveRetainedProofState(file,state,{onArchiveDurable(){interrupted=true;throw Error("synthetic interruption");}}),/synthetic interruption/);
  assert.equal(interrupted,true);assert.deepEqual(fs.readFileSync(file),disk);assert.equal(JSON.stringify(state),memory);
  assert.equal(Object.keys(loadProofSidecar(file,binding).replies).length,257);
  const files=fs.readdirSync(proofArchiveDirectory(file));assert.equal(files.length,1);
  const bytes=fs.readFileSync(path.join(proofArchiveDirectory(file),files[0]));saveProofSidecar(file,state);
  assert.equal(fs.readdirSync(proofArchiveDirectory(file)).length,1);assert.deepEqual(fs.readFileSync(path.join(proofArchiveDirectory(file),files[0])),bytes);
  assert.equal(Object.keys(loadProofSidecar(file,binding).replies).length,256);
});

test("crash immediately before journal rename is recoverable without forgetting the archived parent", t => {
  const { file,binding }=place(t), { state }=populated(258,binding);writeLegacy(file,state);const disk=fs.readFileSync(file);
  assert.throws(()=>saveRetainedProofState(file,state,{beforeJournalCommit(){throw Error("synthetic before rename");}}),/synthetic before rename/);
  assert.deepEqual(fs.readFileSync(file),disk);const restored=loadProofSidecar(file,binding);assert.equal(Object.keys(restored.replies).length,258);
  saveProofSidecar(file,restored);assert.equal(Object.keys(archivedProofReplies(loadProofSidecar(file,binding))).length,2);
});

test("an archive publish failure never exposes partial final bytes or loses the hot record", t => {
  const { file,binding }=place(t), { state }=populated(257,binding);writeLegacy(file,state);const disk=fs.readFileSync(file);
  const originalLink=fs.linkSync;fs.linkSync=()=>{const error=Error("synthetic archive publish interruption");error.code="EIO";throw error;};
  try { assert.throws(()=>saveProofSidecar(file,state),/synthetic archive publish interruption/); }
  finally { fs.linkSync=originalLink; }
  assert.deepEqual(fs.readFileSync(file),disk);assert.equal(fs.readdirSync(proofArchiveDirectory(file)).length,0);
  assert.equal(Object.keys(loadProofSidecar(file,binding).replies).length,257);
  saveProofSidecar(file,state);assert.equal(Object.keys(archivedProofReplies(loadProofSidecar(file,binding))).length,1);
});

test("tampered/missing archive bytes, traversal and absent journal all fail closed", t => {
  const { file,binding }=place(t), { state }=populated(257,binding);saveProofSidecar(file,state);
  const descriptor=Object.values(archivedProofReplies(state))[0],target=path.join(proofArchiveDirectory(file),descriptor.file),bytes=fs.readFileSync(target);
  const changed=JSON.parse(bytes);changed.entry.retainedExtra.exact="tampered";fs.writeFileSync(target,JSON.stringify(changed),{mode:0o600});
  assert.throws(()=>loadProofSidecar(file,binding),/integrity/);fs.writeFileSync(target,bytes,{mode:0o600});
  const journal=fs.readFileSync(file);const invalid=JSON.parse(journal);Object.values(invalid.retention.archivedReplies)[0].file="../escape.json";writeLegacy(file,invalid);
  assert.throws(()=>loadProofSidecar(file,binding),/index/);fs.writeFileSync(file,journal,{mode:0o600});
  fs.unlinkSync(target);assert.throws(()=>loadProofSidecar(file,binding),/missing/);fs.writeFileSync(target,bytes,{mode:0o600});
  fs.unlinkSync(file);assert.throws(()=>loadProofSidecar(file,binding),/journal is missing/);
});

test("low disk and oversized records fail before compaction and retain the old journal", t => {
  const { file,binding }=place(t), { state }=populated(257,binding);writeLegacy(file,state);const disk=fs.readFileSync(file);
  assert.throws(()=>saveRetainedProofState(file,state,{statfs:()=>({bavail:0n,bsize:4096n})}),/free disk/);
  assert.deepEqual(fs.readFileSync(file),disk);assert.equal(fs.existsSync(proofArchiveDirectory(file)),false);
  state.replies[P.anchorPostId].retainedExtra.padding="x".repeat(R.maxArchiveBytes);
  assert.throws(()=>saveProofSidecar(file,state),/record exceeds/);assert.deepEqual(fs.readFileSync(file),disk);
});

test("archived dedup cannot be dropped, downgraded, or rebound to another source", t => {
  const { file,binding }=place(t), { state,journal }=populated(257,binding);saveProofSidecar(file,state);
  const dropped=clone(state);dropped.retention.archivedReplies={};assert.throws(()=>saveProofSidecar(file,dropped),/cannot be dropped/);
  const down=clone(state);down.schema=R.legacySchema;assert.throws(()=>saveProofSidecar(file,down),/Legacy proof/);
  const changed=clone(journal);changed.requests[0].delivery.answer="not the archived thought";
  assert.throws(()=>unarchivedProofInputs(changed,state),/exact thought/);
  assert.throws(()=>loadRetainedProofState(file,{...binding,mainJournal:"/changed"}),/another source/);
});
