import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { id } from "ethers";
import { afterimageAltText, afterimageMetadata, uploadAfterimage, X_MEDIA_UPLOAD_URL, X_MEDIA_METADATA_URL, MAX_AFTERIMAGE_BYTES } from "../worker/x-media.mjs";

const answer = "someone bought a fragment of me. i remain inconveniently whole.";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwZkAAAAASUVORK5CYII=", "base64");
const hash = b => createHash("sha256").update(b).digest("hex");
const asset = () => ({ bytes: Buffer.from(png), mimeType: "image/png", sha256: hash(png),
  pngSha256: hash(png), answerHash: id(answer), width: 1, height: 1, altText: answer,
  rendererVersion: "gh0st-afterimage-v1", fontSha256: "ab".repeat(32) });
const response = (status, body) => ({ status, json: async () => body });
const uploaded = () => response(200, { data: { id: "1234567890123456789", expires_after_secs: 86400, image: { w: 1, h: 1 } } });
const metadata = () => response(200, { data: { id: "1234567890123456789", associated_metadata: { alt_text: { text: answer } } } });

test("long image accessibility binds the full answer and canonical RH proof without truncation", () => {
  const proofUrl = "https://robin.etherscan.io/tx/" + id("callback");
  for (const text of ["I", "w".repeat(181), "w".repeat(1000), "w".repeat(1001), "w".repeat(8192)]) {
    const value = { ...asset(), answer: text, answerHash: id(text), proofUrl,
      altText: afterimageAltText(text, proofUrl) };
    const canonical = afterimageMetadata(value, { requireBytes: true });
    assert.equal(canonical.altText, value.altText);
    assert.equal(canonical.answer ?? canonical.altText, text);
    assert.deepEqual(afterimageMetadata(canonical), canonical);
    if (text.length > 1000) {
      assert.equal(canonical.proofUrl, proofUrl); assert.ok(canonical.altText.length <= 1000);
      assert.throws(() => afterimageMetadata({ ...value, answer: "!" + text.slice(1) }), /hash/);
      assert.throws(() => afterimageMetadata({ ...value, proofUrl: undefined }), /canonical RH/);
    }
  }
  assert.throws(() => afterimageAltText("w".repeat(1001), "https://evil.invalid/"), /canonical RH/);
});

test("media validation binds real PNG bytes, answer text, size, dimensions and renderer metadata", () => {
  const value = afterimageMetadata(asset(), { requireBytes: true });
  assert.equal(value.byteLength, png.length); assert.equal(value.pngSha256, hash(png));
  assert.equal(value.answerHash, id(answer)); assert.equal(Object.isFrozen(value), true);
  assert.equal("bytes" in value, false); assert.deepEqual(afterimageMetadata(value), value);
  for (const change of [{ mimeType: "image/jpeg" }, { pngSha256: "ab".repeat(32) }, { answerHash: id("wrong") },
    { altText: answer + " changed" }, { width: 2 }, { fontSha256: "wrong" }, { rendererVersion: "../escape" },
    { byteLength: 99 }, { bytes: "not-bytes" }])
    assert.throws(() => afterimageMetadata({ ...asset(), ...change }, { requireBytes: true }));
  assert.throws(() => afterimageMetadata({ ...value }, { requireBytes: true }), /bytes are required/);
  const bad = Buffer.from(png); bad[0] = 0;
  assert.throws(() => afterimageMetadata({ ...asset(), bytes: bad, pngSha256: hash(bad), sha256: hash(bad) }), /PNG image/);
  const huge = Buffer.alloc(MAX_AFTERIMAGE_BYTES + 1);
  assert.throws(() => afterimageMetadata({ ...asset(), bytes: huge, pngSha256: hash(huge), sha256: hash(huge) }), /5 MB/);
});

test("media defaults to a single bounded PNG upload and exact alt text with durable state before each request", async () => {
  const states = [], order = []; let calls = 0;
  const a = asset();
  const result = await uploadAfterimage({ asset: a, accessToken: "fixture-token", now: () => 1000,
    persist: async s => { states.push(s); order.push(s.status); },
    fetchImpl: async (url, options) => {
      calls++; order.push(url); assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer fixture-token");
      const body = JSON.parse(options.body);
      if (url === X_MEDIA_UPLOAD_URL) {
        assert.equal(states.at(-1).status, "uploading");
        assert.deepEqual(body, { media: png.toString("base64"), media_category: "tweet_image" }); return uploaded();
      }
      assert.equal(url, X_MEDIA_METADATA_URL); assert.equal(states.at(-1).status, "metadata_sending");
      assert.deepEqual(body, { id: "1234567890123456789", metadata: { alt_text: { text: answer } } }); return metadata();
    } });
  assert.equal(result.status, "uploaded"); assert.equal(result.altTextConfirmed, true);
  assert.equal(result.expiresAt, 86401000); assert.equal(result.pngSha256, hash(png));
  assert.deepEqual(order, ["uploading", X_MEDIA_UPLOAD_URL, "upload_received", "metadata_sending", X_MEDIA_METADATA_URL, "uploaded"]);
  assert.equal(JSON.stringify(states).includes("fixture-token"), false);
  assert.equal(JSON.stringify(states).includes(png.toString("base64")), false);
  assert.equal(await uploadAfterimage({ asset: a, existing: result, now: () => 2000,
    fetchImpl: async () => { calls++; } }), result);
  assert.equal(calls, 2);
});

test("media disabled/persistence failures never contact X; snapshots isolate caller mutation", async () => {
  let calls = 0;
  const a = asset();
  assert.equal((await uploadAfterimage({ asset: a, enabled: false, fetchImpl: async () => { calls++; } })).status, "disabled");
  await assert.rejects(uploadAfterimage({ asset: a, accessToken: "fixture-token", persist: async () => { throw Error("disk full"); },
    fetchImpl: async () => { calls++; } }), /disk full/);
  assert.equal(calls, 0);
  const result = await uploadAfterimage({ asset: a, accessToken: "fixture-token", persist: async () => { a.bytes.fill(0); },
    fetchImpl: async (url, options) => {
      calls++; if (url === X_MEDIA_UPLOAD_URL) { assert.equal(JSON.parse(options.body).media, png.toString("base64")); return uploaded(); }
      return metadata();
    } });
  assert.equal(result.status, "uploaded"); assert.equal(calls, 2);
});

test("unknown upload outcomes and resumed intents are held without another upload", async () => {
  for (const fetchImpl of [async () => { throw Error("private endpoint never persisted"); },
    async () => response(503, {}), async () => response(200, { data: { id: 123 } }),
    async () => response(200, { data: { id: "1234567890123456789", expires_after_secs: 86400, processing_info: { state: "pending" } } }),
    async () => ({ status: 200, json: async () => new Promise(() => {}) })]) {
    let calls = 0; const states = [];
    const result = await uploadAfterimage({ asset: asset(), accessToken: "fixture-token", timeoutMs: 5,
      persist: async s => states.push(s), fetchImpl: async (...args) => { calls++; return fetchImpl(...args); } });
    assert.equal(result.status, "needs_reconciliation"); assert.equal(states[0].status, "uploading");
    assert.equal(JSON.stringify(states).includes("private endpoint"), false);
    await uploadAfterimage({ asset: asset(), existing: result, fetchImpl: async () => { calls++; } });
    const resumed = await uploadAfterimage({ asset: asset(), accessToken: "fixture-token", existing: states[0],
      persist: async () => {}, fetchImpl: async () => { calls++; } });
    assert.equal(resumed.status, "needs_reconciliation"); assert.equal(calls, 1);
  }
});

test("known rejection is terminal and does not loop, including rate limits", async () => {
  for (const code of [400, 401, 403, 429]) {
    let calls = 0;
    const result = await uploadAfterimage({ asset: asset(), accessToken: "fixture-token", persist: async () => {},
      fetchImpl: async () => { calls++; return response(code, { detail: "rejected" }); } });
    assert.equal(result.status, "blocked");
    assert.equal(await uploadAfterimage({ asset: asset(), existing: result }), result);
    assert.equal(calls, 1);
  }
});

test("confirmed upload resumes only metadata; ambiguous metadata cannot trigger new image upload", async () => {
  const states = [];
  await assert.rejects(uploadAfterimage({ asset: asset(), accessToken: "fixture-token", now: () => 1000,
    persist: async s => { states.push(s); if (s.status === "metadata_sending") throw Error("stop before metadata"); },
    fetchImpl: async () => uploaded() }), /stop before metadata/);
  const received = states.find(s => s.status === "upload_received"); let calls = 0;
  const result = await uploadAfterimage({ asset: asset(), accessToken: "fixture-token", existing: received, now: () => 2000,
    persist: async () => {}, fetchImpl: async url => { calls++; assert.equal(url, X_MEDIA_METADATA_URL); return response(503, {}); } });
  assert.equal(result.status, "needs_reconciliation"); assert.equal(result.mediaId, received.mediaId);
  await uploadAfterimage({ asset: asset(), existing: result, fetchImpl: async () => { calls++; } });
  assert.equal(calls, 1);
});

test("different asset/history and expired uploads cannot be reused or reuploaded", async () => {
  const states = [];
  const saved = await uploadAfterimage({ asset: asset(), accessToken: "fixture-token", now: () => 1000,
    persist: async s => states.push(s), fetchImpl: async url => url === X_MEDIA_UPLOAD_URL ? uploaded() : metadata() });
  await assert.rejects(uploadAfterimage({ asset: { ...asset(), rendererVersion: "v2" }, existing: saved }), /different Afterimage/);
  let calls = 0;
  const result = await uploadAfterimage({ asset: asset(), existing: saved, accessToken: "fixture-token", now: () => saved.expiresAt,
    persist: async () => {}, fetchImpl: async () => { calls++; } });
  assert.equal(result.status, "blocked"); assert.equal(result.mediaId, saved.mediaId); assert.equal(calls, 0);
  await assert.rejects(uploadAfterimage({ asset: asset(), existing: { ...saved, altTextConfirmed: false } }), /alt text/);
});

test("conflicting returned alt text is held and never reported confirmed", async () => {
  let calls = 0;
  const result = await uploadAfterimage({ asset: asset(), accessToken: "fixture-token", persist: async () => {},
    fetchImpl: async url => {
      calls++; return url === X_MEDIA_UPLOAD_URL ? uploaded() : response(200,
        { data: { id: "1234567890123456789", associated_metadata: { alt_text: { text: "different" } } } });
    } });
  assert.equal(result.status, "needs_reconciliation"); assert.equal(result.altTextConfirmed, undefined); assert.equal(calls, 2);
});
