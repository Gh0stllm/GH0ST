import test from "node:test";
import assert from "node:assert/strict";
import { id, keccak256, toUtf8Bytes } from "ethers";
import { planPublication, publishPlanned, GH0ST_REPOSITORY_URL, ICP_CANISTER_PREFIX,
  DEFAULT_ICP_CANISTER_ID, RH_EXPLORER_PREFIX } from "../worker/x-publisher.mjs";
import { afterimageAltText } from "../worker/x-media.mjs";

const answer = "someone bought a fragment of me. i remain inconveniently whole.";
const delivery = (text = answer) => ({ confirmed: true, requestId: id("request"), answer: text,
  answerHash: keccak256(toUtf8Bytes(text)), transactionHash: id("RH-callback"),
  blockNumber: 123, blockHash: id("block"), logIndex: 7 });
const v2 = d => planPublication(d, { format: "proofs-v2", icpCanisterId: DEFAULT_ICP_CANISTER_ID });
const v3 = d => planPublication(d, { format: "thought-only", icpCanisterId: DEFAULT_ICP_CANISTER_ID });
const reply = { status: 201, json: async () => ({ data: { id: "1234567890123456789" } }) };
const mediaAsset = () => ({ mimeType: "image/png", pngSha256: "12".repeat(32), answerHash: id(answer),
  width: 1200, height: 1200, byteLength: 30000, altText: answer,
  rendererVersion: "gh0st-afterimage-v1", fontSha256: "34".repeat(32) });
const v4 = (d = delivery(), options = {}) => planPublication(d, { format: "afterimage", asset: mediaAsset(),
  mediaId: "2234567890123456789", mediaExpiresAt: 100000, ...options });

test("prior proofs-v2 post keeps the exact answer, cashtag and three controlled proof links", () => {
  const d = delivery(), plan = v2(d);
  assert.equal(plan.schema, "gh0st-x-publication-v2");
  assert.equal(plan.text, answer + "\n\n$GH0ST\nGitHub: " + GH0ST_REPOSITORY_URL +
    "\nRH: " + RH_EXPLORER_PREFIX + d.transactionHash + "\nICP: " + ICP_CANISTER_PREFIX + DEFAULT_ICP_CANISTER_ID);
  assert.equal(plan.text.slice(0, answer.length), answer);
  assert.equal(plan.delivery.answerHash, d.answerHash);
  assert.equal(plan.icpProofKind, "deployment");
  assert.equal(plan.text.match(/https:\/\/\S+/g).length, 3);
  assert.deepEqual(Object.values(plan.proofUrls), [GH0ST_REPOSITORY_URL,
    RH_EXPLORER_PREFIX + d.transactionHash, ICP_CANISTER_PREFIX + DEFAULT_ICP_CANISTER_ID]);
  assert.equal(Object.isFrozen(plan.proofConfig), true);
  assert.equal(Object.isFrozen(plan.proofUrls), true);
});

test("proofs-v2 maximum-length exact thought fits 280 weighted characters", () => {
  const plan = v2(delivery("x".repeat(180)));
  assert.equal(plan.weightedLength, 277);
  assert.equal(plan.text.replace(/https:\/\/\S+/g, "x".repeat(23)).length, plan.weightedLength);
  assert.ok(plan.weightedLength <= 280);
  assert.equal(v2(delivery("x".repeat(183))).weightedLength, 280);
  assert.throws(() => v2(delivery("x".repeat(184))), /exceeds X post length/);
});

test("legacy default has byte-identical plan and text hashes", () => {
  const legacy = planPublication(delivery());
  assert.equal(legacy.schema, "gh0st-x-publication-v1");
  assert.equal(legacy.planId, "0x006b24f4e5c951e0901111dec03996a498257c6b91cfe4ffc19c0e9ef2369bf5");
  assert.equal(legacy.textHash, "0x9602f56ca2b362e46f68157b77b4fe7f431ae84076c458cb05c793194b90db0f");
  assert.equal(legacy.weightedLength, 97);
  assert.equal(legacy.proofUrls, undefined);
  assert.equal(planPublication(delivery(), { format: "proofs-v2", existingPlan: {
    planId: legacy.planId, textHash: legacy.textHash, text: legacy.text, proofUrl: legacy.proofUrl,
  } }).planId, legacy.planId);
});

test("new formatting never changes an existing legacy posted or pending plan", async () => {
  const d = delivery(), legacy = planPublication(d), candidate = v2(d);
  let calls = 0;
  for (const status of ["posted", "blocked", "needs_reconciliation", "sending", "disabled", "ready", "retry_after"]) {
    const existing = { schema: legacy.schema, planId: legacy.planId, textHash: legacy.textHash, status,
      postId: status === "posted" ? "12345" : undefined, retryAt: 999999 };
    assert.equal(planPublication(d, { format: "proofs-v2", existingPublication: existing }).planId, legacy.planId);
    const result = await publishPlanned(candidate, { enabled: true, accessToken: "fixture-token", existing,
      now: () => 1000, persist: async () => {}, fetchImpl: async (_, options) => {
        calls++; assert.equal(JSON.parse(options.body).text, legacy.text); return reply;
      } });
    if (status === "sending") assert.equal(result.status, "needs_reconciliation");
    if (["posted", "blocked", "needs_reconciliation", "retry_after"].includes(status)) assert.equal(result, existing);
    assert.equal(result.schema, legacy.schema);
  }
  assert.equal(calls, 2); // Only the old ready/disabled unsent plans can send, in the old format.
});

test("proofs-v2 only sends once after a durable v2 intent", async () => {
  const plan = v2(delivery()), states = []; let calls = 0;
  const outcome = await publishPlanned(plan, { enabled: true, accessToken: "fixture-token",
    persist: async state => states.push(state), fetchImpl: async (_, options) => {
      calls++; assert.equal(states.at(-1).status, "sending");
      assert.equal(states.at(-1).schema, plan.schema); assert.equal(JSON.parse(options.body).text, plan.text); return reply;
    } });
  assert.equal(outcome.status, "posted");
  await publishPlanned(plan, { enabled: true, existing: outcome, fetchImpl: async () => { calls++; } });
  assert.equal(calls, 1);
});

test("malformed ICP proofs, modified links and unrelated legacy intents fail closed", async () => {
  for (const icpCanisterId of ["not-a-principal", "https://evil.example", "aaaaa-aa", "2vxsx-fae"])
    assert.throws(() => planPublication(delivery(), { format: "proofs-v2", icpCanisterId }), /ICP proof/);
  assert.throws(() => planPublication(delivery(), { format: "unknown" }), /format/);
  const plan = v2(delivery());
  for (const changed of [{ ...plan, proofUrls: { ...plan.proofUrls, github: "https://evil.example" } },
    { ...plan, icpProofKind: "per-thought" }, { ...plan, weightedLength: 1 },
    { ...plan, text: plan.text.replace("$GH0ST", "$OTHER") }])
    await assert.rejects(publishPlanned(changed), /changed/);
  const unrelated = { planId: id("another-plan"), status: "posted" };
  assert.throws(() => planPublication(delivery(), { format: "proofs-v2", existingPublication: unrelated }), /different plan/);
  await assert.rejects(publishPlanned(plan, { existing: unrelated }), /different plan/);
});

test("thought-only post is exactly the answer with all proof links kept out of its text", () => {
  const d = delivery(), plan = v3(d);
  assert.equal(plan.schema, "gh0st-x-publication-v3");
  assert.equal(plan.format, "thought-only");
  assert.equal(plan.text, d.answer);
  assert.equal(plan.textHash, d.answerHash);
  assert.equal(plan.weightedLength, d.answer.length);
  assert.equal(/[\n$]|https?:|GitHub:|RH:|ICP:|Onchain:/.test(plan.text), false);
  assert.equal(plan.proofUrl, RH_EXPLORER_PREFIX + d.transactionHash);
  assert.deepEqual(plan.proofUrls, { github: GH0ST_REPOSITORY_URL, rh: plan.proofUrl,
    icp: ICP_CANISTER_PREFIX + DEFAULT_ICP_CANISTER_ID });
  assert.equal(plan.icpProofKind, "deployment");
  const max = v3(delivery("x".repeat(180)));
  assert.equal(max.text.length, 180); assert.equal(max.weightedLength, 180);
});

test("thought-only still requires confirmed RH receipt metadata and matching exact-answer hash", () => {
  for (const change of [{ confirmed: false }, { answerHash: id("wrong") }, { transactionHash: "0x1234" },
    { blockHash: "0x1234" }, { logIndex: -1 }, { answer: "short" },
    { answer: "https://example.com is not an acceptable thought payload" }])
    assert.throws(() => v3({ ...delivery(), ...change }));
});

test("thought-only preserves all prior sent or uncertain v1/v2 publications without a resend", async () => {
  const d = delivery(); let calls = 0;
  for (const oldPlan of [planPublication(d), v2(d)]) {
    for (const status of ["posted", "blocked", "needs_reconciliation", "sending", "retry_after"]) {
      const existing = { schema: oldPlan.schema, planId: oldPlan.planId, textHash: oldPlan.textHash,
        status, postId: status === "posted" ? "12345" : undefined, retryAt: 999999 };
      assert.equal(planPublication(d, { format: "thought-only", existingPublication: existing,
        existingPlan: oldPlan }).planId, oldPlan.planId);
      const result = await publishPlanned(v3(d), { enabled: true, accessToken: "fixture-token", existing,
        now: () => 1000, persist: async () => {}, fetchImpl: async () => { calls++; return reply; } });
      assert.equal(result.planId, oldPlan.planId); assert.equal(result.textHash, oldPlan.textHash);
      assert.equal(result.schema, oldPlan.schema);
      if (status === "sending") assert.equal(result.status, "needs_reconciliation");
      else assert.equal(result, existing);
    }
  }
  assert.equal(calls, 0);
});

test("Afterimage preserves exact caption and binds PNG, renderer, answer, media ID and expiry", () => {
  const plan = v4();
  assert.equal(plan.schema, "gh0st-x-publication-v4"); assert.equal(plan.format, "afterimage");
  assert.equal(plan.text, answer); assert.equal(plan.textHash, id(answer));
  assert.equal(plan.media.pngSha256, mediaAsset().pngSha256); assert.equal(plan.media.answerHash, id(answer));
  assert.equal(plan.media.id, "2234567890123456789"); assert.equal(plan.media.expiresAt, 100000);
  assert.equal(plan.weightedLength, answer.length); assert.equal(Object.isFrozen(plan.media), true);
  for (const options of [{ mediaId: "3234567890123456789" }, { mediaExpiresAt: 100001 },
    { asset: { ...mediaAsset(), pngSha256: "56".repeat(32) } },
    { asset: { ...mediaAsset(), rendererVersion: "gh0st-afterimage-v2" } }])
    assert.notEqual(v4(delivery(), options).planId, plan.planId);
  assert.throws(() => v4(delivery(), { asset: { ...mediaAsset(), answerHash: id("another thought") } }), /answer hash/);
  assert.throws(() => v4(delivery(), { mediaId: "https://bad.invalid" }), /media ID/);
  assert.throws(() => v4(delivery(), { mediaExpiresAt: undefined }), /media expiry/);
});

test("Afterimage resolves legacy v1-v3 histories before any image is required", async () => {
  for (const prior of [planPublication(delivery()), v2(delivery()), v3(delivery())]) {
    for (const status of ["posted", "sending", "needs_reconciliation", "blocked"]) {
      const existing = { schema: prior.schema, planId: prior.planId, textHash: prior.textHash, status, postId: status === "posted" ? "1234" : undefined };
      const plan = planPublication(delivery(), { format: "afterimage", existingPublication: existing, existingPlan: prior });
      assert.equal(plan.planId, prior.planId); assert.equal(plan.media, undefined);
      let called = false;
      const result = await publishPlanned(plan, { enabled: true, accessToken: "fixture-token", existing,
        persist: async () => {}, fetchImpl: async () => { called = true; } });
      assert.equal(called, false); assert.equal(result.status, status === "sending" ? "needs_reconciliation" : status);
    }
  }
});

test("Afterimage sends only the exact caption and one media ID after durable intent, never duplicates", async () => {
  const plan = v4(), states = []; let calls = 0;
  const result = await publishPlanned(plan, { enabled: true, accessToken: "fixture-token", now: () => 1000,
    persist: async state => states.push(state), fetchImpl: async (_, options) => {
      calls++; assert.equal(states.at(-1).status, "sending");
      assert.equal(states.at(-1).mediaId, plan.media.id); assert.equal(states.at(-1).pngSha256, plan.media.pngSha256);
      assert.deepEqual(JSON.parse(options.body), { text: answer, media: { media_ids: [plan.media.id] } }); return reply;
    } });
  assert.equal(result.status, "posted");
  const resumed = planPublication(delivery(), { format: "afterimage", existingPlan: plan, existingPublication: result });
  assert.equal(resumed.planId, plan.planId);
  const { delivery: omittedDelivery, weightedLength: omittedLength, ...compact } = plan;
  assert.equal(planPublication(delivery(), { format: "afterimage", existingPlan: compact,
    existingPublication: result }).planId, plan.planId);
  assert.equal(await publishPlanned(resumed, { enabled: true, existing: result, fetchImpl: async () => { calls++; } }), result);
  assert.equal(calls, 1);
});

test("Afterimage altered metadata, wrong delivery and expired media fail closed before sending", async () => {
  const plan = v4(); let calls = 0;
  for (const change of [{ media: { ...plan.media, id: "123" } }, { media: { ...plan.media, pngSha256: "56".repeat(32) } },
    { text: answer + "!" }]) await assert.rejects(publishPlanned({ ...plan, ...change }), /changed/);
  assert.throws(() => planPublication({ ...delivery(), transactionHash: id("different") }, {
    format: "afterimage", existingPlan: plan, existingPublication: { planId: plan.planId, status: "posted" } }), /plan changed/);
  const expired = await publishPlanned(plan, { enabled: true, accessToken: "fixture-token", now: () => 100000,
    persist: async () => {}, fetchImpl: async () => { calls++; } });
  assert.equal(expired.status, "blocked"); assert.equal(calls, 0);
});

test("new short and long Afterimages preserve all committed text and use v5 without truncation", async () => {
  for (const length of [1, 29, 181, 280, 281, 1000, 1001, 8192]) {
    const text = "w".repeat(length), d = delivery(text), proofUrl = RH_EXPLORER_PREFIX + d.transactionHash;
    const asset = { ...mediaAsset(), answer: text, answerHash: id(text),
      altText: afterimageAltText(text, proofUrl), proofUrl, rendererVersion: "gh0st-afterimage-v2" };
    const plan = v4(d, { asset });
    assert.equal(plan.schema, "gh0st-x-publication-v5");
    assert.equal(plan.text, text);
    assert.equal(plan.weightedLength, length);
    assert.equal(plan.delivery.answer, text); assert.equal(plan.media.answerHash, id(text));
    assert.equal(plan.media.answer ?? plan.media.altText, text);
    let calls = 0;
    const posted = await publishPlanned(plan, { enabled: true, accessToken: "fixture-token", now: () => 1000,
      persist: async () => {}, fetchImpl: async (_, options) => {
        calls++;
        assert.deepEqual(JSON.parse(options.body), { text, media: { media_ids: [plan.media.id] } });
        return reply;
      } });
    const { delivery: unused, weightedLength: alsoUnused, ...compact } = plan;
    const restored = planPublication(d, { format: "afterimage", existingPublication: posted, existingPlan: compact });
    assert.equal(restored.planId, plan.planId);
    assert.equal(await publishPlanned(restored, { enabled: true, existing: posted,
      fetchImpl: async () => { calls++; } }), posted);
    assert.equal(calls, 1);
    await assert.rejects(publishPlanned({ ...plan, schema: "gh0st-x-publication-v4" }), /changed/);
    if (length > 1000) {
      const wrongProof = RH_EXPLORER_PREFIX + id("other-callback");
      assert.throws(() => v4(d, { asset: { ...asset, proofUrl: wrongProof,
        altText: afterimageAltText(text, wrongProof) } }), /confirmed RH thought/);
    }
  }
});

test("unattempted saved plans do not silently migrate; explicit caller removal creates thought-only", () => {
  const d = delivery();
  for (const oldPlan of [planPublication(d), v2(d)]) {
    assert.equal(planPublication(d, { format: "thought-only", existingPlan: oldPlan }).planId, oldPlan.planId);
    for (const status of ["disabled", "ready"]) {
      const existing = { schema: oldPlan.schema, planId: oldPlan.planId, textHash: oldPlan.textHash, status };
      assert.equal(planPublication(d, { format: "thought-only", existingPublication: existing,
        existingPlan: oldPlan }).planId, oldPlan.planId);
    }
    const explicitlyNew = planPublication(d, { format: "thought-only" });
    assert.notEqual(explicitlyNew.planId, oldPlan.planId); assert.equal(explicitlyNew.text, answer);
  }
});

test("new thought-only sends exactly one unadorned body after a durable v3 intent", async () => {
  const plan = v3(delivery()), states = []; let calls = 0;
  const outcome = await publishPlanned(plan, { enabled: true, accessToken: "fixture-token",
    persist: async state => states.push(state), fetchImpl: async (_, options) => {
      calls++; assert.equal(states.at(-1).schema, "gh0st-x-publication-v3");
      assert.equal(states.at(-1).status, "sending");
      assert.deepEqual(JSON.parse(options.body), { text: answer }); return reply;
    } });
  assert.equal(outcome.status, "posted");
  await publishPlanned(plan, { enabled: true, existing: outcome, fetchImpl: async () => { calls++; } });
  assert.equal(calls, 1);
  await assert.rejects(publishPlanned({ ...plan, text: answer + "\n$GH0ST" }), /changed/);
});
