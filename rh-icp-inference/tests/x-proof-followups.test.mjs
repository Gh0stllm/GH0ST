import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Interface, id } from "ethers";
import { planPublication } from "../worker/x-publisher.mjs";
import { afterimageAltText } from "../worker/x-media.mjs";
import { swapSourceId } from "../worker/swaps.mjs";
import { PROOF_FOLLOWUP as P, planProofFollowup, eligibleProofFollowups, readFollowupToken,
  verifyFollowupParent, verifyFollowupReceipt, sendProofFollowup } from "../worker/x-proof-followups.mjs";
import { runProofFollowupPass, proofSidecarBinding, saveProofSidecar, loadProofSidecar } from "../scripts/run-proof-followups.mjs";

const answer = "the router brought me a spoon, and now the silence tastes expensive.";
const iface = new Interface(JSON.parse(fs.readFileSync(new URL("../build/gateway.json", import.meta.url), "utf8")).abi);
const reply = (status, body) => ({ status, json: async () => body });
function fixture(postId = P.anchorPostId, answer = "the router brought me a spoon, and now the silence tastes expensive.") {
  const source = { manager: P.manager, pool_id: P.poolId, transaction_hash: id("swap"), log_index: 4 };
  const sourceId = swapSourceId(4663, source);
  const delivery = { confirmed: true, answer, answerHash: id(answer), transactionHash: id("callback"), blockNumber: 100,
    blockHash: id("block"), logIndex: 2 };
  const asset = { mimeType: "image/png", pngSha256: "aa".repeat(32), answerHash: id(answer), width: 1200,
    height: 1200, byteLength: 24000, answer, altText: afterimageAltText(answer, "https://robin.etherscan.io/tx/" + id("callback")),
    proofUrl: "https://robin.etherscan.io/tx/" + id("callback"), rendererVersion: "gh0st-afterimage-v1", fontSha256: "bb".repeat(32) };
  const plan = planPublication({ ...delivery, requestId: sourceId }, { format: "afterimage", asset,
    mediaId: "2114736976947777536", mediaExpiresAt: 9999999999999 });
  const item = { id: sourceId, source, kind: "swap", state: "fulfilled", delivery, publicationPlan: plan,
    publication: { schema: plan.schema, planId: plan.planId, textHash: plan.textHash, status: "posted", postId } };
  return { item, plan: planProofFollowup(item), journal: { version: 1, binding: { chainId: 4663, gateway: P.gateway, canisterId: P.canisterId }, requests: [item] } };
}
function parentBody(plan, withUrl = true) {
  const mediaKey = "3_" + plan.parentPlan.media.id, url = "https://t.co/example";
  const caption = plan.parentPlan.text, offset = caption.length ? caption.length + 1 : 0;
  return { data: { id: plan.parentPostId, author_id: P.userId, text: caption + (withUrl ? (caption ? " " : "") + url : ""),
    entities: { urls: withUrl ? [{ start: offset, end: offset + url.length, url,
      expanded_url: `https://x.com/${P.username}/status/${plan.parentPostId}/photo/1`, media_key: mediaKey }] : [] },
    attachments: { media_keys: [mediaKey] } }, includes: { media: [{ media_key: mediaKey, type: "photo", alt_text: plan.parentPlan.media.altText }] } };
}

test("proof reply contains only fixed honest deployment, callback and code links after the selected anchor", () => {
  const { plan, journal } = fixture();
  assert.equal(plan.schema, "gh0st-x-proof-followup-v2");
  assert.equal(plan.text, `ICP (deployment): https://dashboard.internetcomputer.org/canister/${P.canisterId}\nRH (exact thought): https://robin.etherscan.io/tx/${id("callback")}\nGitHub (code): https://github.com/Gh0stllm/GH0ST\nCA: 0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559`);
  assert.equal(plan.weightedLength, 171);
  assert.ok(plan.weightedLength <= 280); assert.equal(eligibleProofFollowups(journal).length, 1);
  const old = fixture().item; old.publication = { ...old.publication, postId: (BigInt(P.anchorPostId) - 1n).toString() };
  assert.equal(eligibleProofFollowups({ ...journal, requests: [old] }).length, 0);
  assert.throws(() => planProofFollowup({ ...fixture().item, id: id("wrong") }), /source/);
});

test("v2 CA format never rewrites any stored v1 plan or sends a duplicate historical reply", async () => {
  const { item, journal, plan: current } = fixture();
  const legacy = planProofFollowup(item, { schema: "gh0st-x-proof-followup-v1" });
  assert.equal(legacy.weightedLength, 124); assert.equal(legacy.text.includes("\nCA:"), false);
  assert.notEqual(legacy.planId, current.planId);
  for (const status of ["posted", "blocked", "needs_reconciliation", "sending", "retry_after", undefined]) {
    const publication = status ? { schema: legacy.schema, planId: legacy.planId, parentPostId: legacy.parentPostId,
      status, attempt: 1, retryAt: 999999, postId: status === "posted" ? "12345" : undefined } : undefined;
    const state = { replies: { [legacy.parentPostId]: { plan: JSON.parse(JSON.stringify(legacy)), publication } } };
    const savedText = JSON.stringify(state.replies[legacy.parentPostId].plan);
    const selected = eligibleProofFollowups(journal, { existingReplies: state.replies })[0];
    assert.equal(selected.planId, legacy.planId); assert.equal(selected.schema, legacy.schema);
    let calls = 0;
    await runProofFollowupPass({ mainJournal: journal, state, persist: async () => {}, now: () => 1000,
      getToken: async () => ({ accessToken: "fixture" }), verifyAccount: async () => {},
      verifyParent: async () => {}, verifyReceipt: async () => {},
      send: (plan, options) => sendProofFollowup(plan, { ...options, fetchImpl: async (_, request) => {
        calls++; assert.equal(JSON.parse(request.body).text, legacy.text);
        return reply(201, { data: { id: "2114739999999999999" } }); } }), });
    assert.equal(calls, status === undefined ? 1 : 0);
    assert.equal(JSON.stringify(state.replies[legacy.parentPostId].plan), savedText);
    if (status === "sending") assert.equal(state.replies[legacy.parentPostId].publication.status, "needs_reconciliation");
  }
});

test("stored v1 proof must still match its original parent and unknown versions fail closed", () => {
  const { item, journal } = fixture();
  const legacy = planProofFollowup(item, { schema: "gh0st-x-proof-followup-v1" });
  for (const changed of [{ ...legacy, text: legacy.text + "\nCA: changed" },
    { ...legacy, schema: "unrecognized" }, { ...legacy, parentPostId: "2114739999999999999" }])
    assert.throws(() => eligibleProofFollowups(journal, { existingReplies: { [P.anchorPostId]: { plan: changed } } }));
});

test("read-only token loader waits through refresh/expiry and never changes token bytes or directories", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-token-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "oauth.json"), record = { schema: "gh0st-x-oauth-v1", status: "ready", account: { id: P.userId, username: P.username },
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"], expires_at: 61001, access_token: "fixture-token" };
  const write = value => fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  write(record); const before = fs.readFileSync(file); assert.equal(readFollowupToken(file, { now: 1000 }).accessToken, "fixture-token");
  assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(fs.readdirSync(dir), ["oauth.json"]);
  for (const changed of [{ status: "refresh_pending" }, { status: "verification_pending" }, { expires_at: 61000 },
    { account: { id: "1", username: P.username } }, { scopes: [] }]) { write({ ...record, ...changed }); assert.equal(readFollowupToken(file, { now: 1000 }), null); }
  write(record); fs.writeFileSync(file + ".lock", "main-worker"); assert.equal(readFollowupToken(file, { now: 1000 }), null);
  const missing = path.join(dir, "not-created", "token.json"); assert.equal(readFollowupToken(missing), null); assert.equal(fs.existsSync(path.dirname(missing)), false);
});

test("parent verifier permits only the exact caption or its bound platform-added photo URL", async () => {
  const { plan } = fixture();
  for (const withUrl of [false, true]) assert.equal(await verifyFollowupParent(plan, { accessToken: "fixture", fetchImpl: async (url, options) => {
    assert.match(url, /media.fields=media_key,type,alt_text/); assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    return reply(200, parentBody(plan, withUrl));
  } }), true);
  for (const mutate of [b => { b.data.author_id = "1"; }, b => { b.data.text += " extra"; },
    b => { b.data.entities.urls[0].expanded_url = "https://other.invalid/"; }, b => { b.data.entities.urls[0].media_key = "3_1"; },
    b => { b.data.entities.urls[0].start = 0; }, b => { b.includes.media[0].alt_text = "wrong"; }]) {
    const body = parentBody(plan); mutate(body);
    await assert.rejects(verifyFollowupParent(plan, { accessToken: "fixture", fetchImpl: async () => reply(200, body) }));
  }
});

test("v5 Premium long captions receive proof replies only after exact full-text and media verification", async () => {
  for (const length of [181, 280, 281, 1000, 1001, 8192]) {
    const { plan, journal } = fixture(P.anchorPostId, "w".repeat(length));
    assert.equal(plan.parentPlan.schema, "gh0st-x-publication-v5");
    assert.equal(eligibleProofFollowups(journal).length, 1);
    assert.equal(plan.parentPlan.delivery.answer.length, length);
    assert.equal(plan.parentPlan.text, plan.parentPlan.delivery.answer);
    for (const withUrl of [false, true]) {
      assert.equal(await verifyFollowupParent(plan, { accessToken: "fixture",
        fetchImpl: async () => reply(200, parentBody(plan, withUrl)) }), true);
      const body = parentBody(plan, withUrl);
      body.data.note_tweet = { text: body.data.text, entities: body.data.entities };
      body.data.text = body.data.text.slice(0, 200) + "...";
      assert.equal(await verifyFollowupParent(plan, { accessToken: "fixture",
        fetchImpl: async url => { assert.match(url, /note_tweet/); return reply(200, body); } }), true);
    }
    for (const mutate of [b => { b.includes.media[0].alt_text = "different"; },
      b => { b.data.text += " extra"; }, b => { b.data.entities.urls[0].expanded_url = "https://other.invalid/"; }]) {
      const body = parentBody(plan); mutate(body);
      await assert.rejects(verifyFollowupParent(plan, { accessToken: "fixture", fetchImpl: async () => reply(200, body) }));
    }
    for (const note of [{ text: "wrong full thought" }, {}, { text: null }]) {
      const body = parentBody(plan, false); body.data.note_tweet = note;
      await assert.rejects(verifyFollowupParent(plan, { accessToken: "fixture", fetchImpl: async () => reply(200, body) }));
    }
  }
});

test("RH proof requires canonical depth plus exact fulfillment and source event in the same gateway receipt", async () => {
  const { plan } = fixture();
  const makeLog = (name, args, index) => ({ address: P.gateway, index, ...iface.encodeEventLog(iface.getEvent(name), args) });
  const receipt = { hash: id("callback"), to: P.gateway, status: 1, blockNumber: 100, blockHash: id("block"), logs: [
    makeLog("SwapThoughtRecorded", [plan.sourceId, P.poolId, P.manager, plan.source.transaction_hash, 4], 1),
    makeLog("InferenceFulfilled", [plan.sourceId, id(answer), answer, 220, 50, 1000], 2) ] };
  const provider = { send: async () => "0x1237", getTransactionReceipt: async () => receipt,
    getBlock: async () => ({ hash: id("block") }), getBlockNumber: async () => 112 };
  assert.equal(await verifyFollowupReceipt(plan, { provider, iface }), true);
  for (const changed of [{ ...receipt, to: P.manager }, { ...receipt, logs: receipt.logs.slice(1) },
    { ...receipt, logs: [makeLog("SwapThoughtRecorded", [plan.sourceId, P.poolId, P.manager, id("wrong"), 4], 1), receipt.logs[1]] }])
    await assert.rejects(verifyFollowupReceipt(plan, { provider: { ...provider, getTransactionReceipt: async () => changed }, iface }));
  await assert.rejects(verifyFollowupReceipt(plan, { provider: { ...provider, getBlockNumber: async () => 111 }, iface }));
});

test("successor gateway preserves old proof bindings and exact historical receipt plans", async () => {
  const {plan,journal}=fixture(),before=JSON.stringify(plan);
  assert.equal(proofSidecarBinding('/private/preserved-worker.json').gateway,P.historyGateway);
  assert.deepEqual(eligibleProofFollowups({...journal,binding:{...journal.binding,gateway:P.historyGateway}}),[plan]);
  for(const gateway of [P.historyGateway,P.gateway]){
    const makeLog=(name,args,index)=>({address:gateway,index,...iface.encodeEventLog(iface.getEvent(name),args)});
    const receipt={hash:id('callback'),to:gateway,status:1,blockNumber:100,blockHash:id('block'),logs:[
      makeLog('SwapThoughtRecorded',[plan.sourceId,P.poolId,P.manager,plan.source.transaction_hash,4],1),
      makeLog('InferenceFulfilled',[plan.sourceId,id(answer),answer,220,50,1000],2)]};
    const provider={send:async()=> '0x1237',getTransactionReceipt:async()=>receipt,getBlock:async()=>({hash:id('block')}),getBlockNumber:async()=>112};
    assert.equal(await verifyFollowupReceipt(plan,{provider,iface}),true);
    await assert.rejects(verifyFollowupReceipt(plan,{provider:{...provider,getTransactionReceipt:async()=>({...receipt,to:P.manager})},iface}),/pinned gateway/);
    const other=gateway===P.gateway?P.historyGateway:P.gateway;
    await assert.rejects(verifyFollowupReceipt(plan,{provider:{...provider,getTransactionReceipt:async()=>({...receipt,logs:receipt.logs.map(log=>({...log,address:other}))})},iface}));
  }
  assert.equal(JSON.stringify(plan),before);
});

test("reply intent is durable before POST, targets original post, and never blindly sends twice", async () => {
  const { plan } = fixture(); const states = []; let calls = 0;
  const result = await sendProofFollowup(plan, { enabled: true, accessToken: "fixture", verify: async () => {},
    persist: async value => states.push(value), fetchImpl: async (url, options) => {
      calls++; assert.equal(url, "https://api.x.com/2/tweets"); assert.equal(states.at(-1).status, "sending");
      assert.deepEqual(JSON.parse(options.body), { text: plan.text, reply: { in_reply_to_tweet_id: P.anchorPostId } });
      return reply(201, { data: { id: "2114739999999999999" } }); } });
  assert.equal(result.status, "posted");
  await sendProofFollowup(plan, { enabled: true, existing: result, fetchImpl: async () => { calls++; } });
  assert.equal(calls, 1); assert.equal(JSON.stringify(states).includes("fixture"), false);
  const resumed = await sendProofFollowup(plan, { enabled: true, accessToken: "fixture", existing: states[0],
    verify: async () => {}, persist: async () => {}, fetchImpl: async () => { calls++; } });
  assert.equal(resumed.status, "needs_reconciliation"); assert.equal(calls, 1);
});

test("network uncertainty, 201 with errors and rejection are held with no retry loop", async () => {
  const { plan } = fixture();
  for (const fetchImpl of [async () => { throw Error("secret endpoint"); }, async () => reply(201, { data: { id: "12345" }, errors: [{}] }),
    async () => reply(503, {}), async () => reply(201, { data: { id: 12345 } })]) {
    const states = []; const result = await sendProofFollowup(plan, { enabled: true, accessToken: "fixture",
      verify: async () => {}, persist: async value => states.push(value), fetchImpl });
    assert.equal(result.status, "needs_reconciliation"); assert.equal(JSON.stringify(states).includes("secret endpoint"), false);
  }
});

test("rate limits honor retry timing and stop after three proven rejections", async () => {
  const { plan } = fixture(); let existing = null, now = 1000, calls = 0;
  const run = () => sendProofFollowup(plan, { enabled: true, accessToken: "fixture", existing, now: () => now,
    verify: async () => {}, persist: async () => {}, fetchImpl: async () => {
      calls++; return { ...reply(429, {}), headers: { get: key => key === "retry-after" ? "900" : null } };
    } });
  existing = await run(); assert.equal(existing.status, "retry_after"); assert.equal(existing.retryAt, 901000);
  assert.equal(await run(), existing); assert.equal(calls, 1);
  now = existing.retryAt; existing = await run(); now = existing.retryAt; existing = await run();
  assert.equal(existing.status, "blocked"); assert.equal(calls, 3);
  assert.equal(await run(), existing); assert.equal(calls, 3);
});

test("sidecar waits for main token, bounds verification failures and preserves main journal byte-equivalent", async () => {
  const { journal } = fixture(), original = JSON.stringify(journal);
  const state = { replies: {} }; let time = 1000, sends = 0;
  const options = { mainJournal: journal, state, persist: async () => {}, now: () => time,
    getToken: async () => null, verifyAccount: async () => {}, verifyParent: async () => {}, verifyReceipt: async () => {}, send: async () => { sends++; } };
  assert.equal((await runProofFollowupPass(options)).status, "waiting_for_main_token"); assert.equal(sends, 0);
  options.getToken = async () => ({ accessToken: "fixture" }); options.verifyParent = async () => { throw Error("privateRPC"); };
  options.send = sendProofFollowup;
  for (let i = 0; i < 6; i++) { time += 1000000; await runProofFollowupPass(options); }
  assert.equal(state.replies[P.anchorPostId].publication.status, "blocked");
  assert.equal(JSON.stringify(journal), original); assert.equal(JSON.stringify(state).includes("privateRPC"), false);
});

test("sidecar owns separate private durable state and rejects changed binding", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-journal-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "proofs.json"), binding = proofSidecarBinding(path.join(dir, "main.json"));
  const state = loadProofSidecar(file, binding); saveProofSidecar(file, state);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600); assert.deepEqual(loadProofSidecar(file, binding), state);
  assert.throws(() => loadProofSidecar(file, { ...binding, anchorPostId: "1" }), /another/);
});
