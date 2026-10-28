import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createXAuthorization, exchangeXCode, getXAccessToken,
  loopbackRedirect, readPrivateFile, writeXTokenFile, X_SCOPES, X_MEDIA_SCOPES, X_TOKEN_URL,
} from "../worker/x-auth.mjs";

const now = 1_800_000_000_000;
const base = () => ({
  schema: "gh0st-x-oauth-v1", status: "ready", client_id: "test-client",
  access_token: "fake-access", refresh_token: "fake-refresh", token_type: "bearer",
  scopes: X_SCOPES, expires_at: now + 7_200_000,
  account: { id: "12345", username: "llmgh0st" },
});
function fixture(t, record = base()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh0st-x-auth-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "x.json");
  writeXTokenFile(file, record);
  return file;
}

test("X authorization uses S256 PKCE, unpredictable state and only required scopes", () => {
  const one = createXAuthorization({ clientId: "test-client", redirectUri: "http://127.0.0.1:8787/x/callback" });
  const two = createXAuthorization({ clientId: "test-client", redirectUri: "http://127.0.0.1:8787/x/callback" });
  const url = new URL(one.url);
  assert.equal(url.origin, "https://x.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(one.verifier).digest("base64url"));
  assert.equal(url.searchParams.get("scope"), X_SCOPES.join(" "));
  assert.notEqual(one.state, two.state);
  assert.notEqual(one.verifier, two.verifier);
  assert.ok(!one.url.includes(one.verifier));
});

test("local connector accepts only explicit loopback callback URLs", () => {
  for (const value of ["https://example.com/x/callback", "http://0.0.0.0:8787/x/callback",
    "http://127.0.0.1:8787/", "http://127.0.0.1:8787/x/callback?token=x"])
    assert.throws(() => loopbackRedirect(value));
});

test("authorization code is exchanged at pinned endpoint with verifier", async () => {
  let calls = 0;
  const record = await exchangeXCode({ clientId: "test-client", redirectUri: "http://127.0.0.1:8787/x/callback",
    code: "fake-code", verifier: "fake-verifier", now,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, X_TOKEN_URL);
      assert.equal(options.redirect, "error");
      assert.equal(options.body.get("grant_type"), "authorization_code");
      assert.equal(options.body.get("code_verifier"), "fake-verifier");
      assert.equal(options.body.get("client_id"), "test-client");
      return { ok: true, json: async () => ({ access_token: "fake-access", refresh_token: "fake-refresh",
        token_type: "bearer", scope: X_SCOPES.join(" "), expires_in: 7200 }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(record.expires_at, now + 7_200_000);
});

test("private token records are mode 0600 and wrong accounts are refused", async t => {
  const file = fixture(t);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(await getXAccessToken({ tokenFile: file, now }), "fake-access");
  await assert.rejects(getXAccessToken({ tokenFile: file, now, expectedUsername: "other" }), /another account/);
  fs.chmodSync(file, 0o644);
  assert.throws(() => readPrivateFile(file), /0600/);
});

test("expired access refreshes once and durably saves rotated refresh token", async t => {
  const file = fixture(t, { ...base(), expires_at: now + 30_000 });
  let calls = 0;
  const access = await getXAccessToken({ tokenFile: file, now, fetchImpl: async (url, options) => {
    calls++;
    if (url === "https://api.x.com/2/users/me") {
      assert.equal(JSON.parse(fs.readFileSync(file)).refresh_token, "new-fake-refresh");
      assert.equal(options.headers.Authorization, "Bearer new-fake-access");
      return { status: 200, json: async () => ({ data: { id: "12345", username: "llmgh0st" } }) };
    }
    assert.equal(JSON.parse(fs.readFileSync(file)).status, "refresh_pending");
    assert.equal(options.body.get("refresh_token"), "fake-refresh");
    return { ok: true, json: async () => ({ access_token: "new-fake-access", refresh_token: "new-fake-refresh",
      token_type: "bearer", expires_in: 7200 }) };
  } });
  assert.equal(access, "new-fake-access");
  assert.equal(calls, 2);
  const saved = JSON.parse(readPrivateFile(file));
  assert.equal(saved.refresh_token, "new-fake-refresh");
  assert.equal(saved.status, "ready");
  assert.ok(!fs.existsSync(file + ".lock"));
});

test("a failed account check preserves rotated tokens and retries only verification", async t => {
  const file = fixture(t, { ...base(), expires_at: now - 1 });
  let tokenCalls = 0;
  await assert.rejects(getXAccessToken({ tokenFile: file, now, fetchImpl: async url => {
    if (url === X_TOKEN_URL) {
      tokenCalls++;
      return { ok: true, json: async () => ({ access_token: "new-fake-access", refresh_token: "rotated-refresh",
        token_type: "bearer", expires_in: 7200 }) };
    }
    throw Error("fake users/me outage");
  } }), /Could not verify/);
  assert.equal(JSON.parse(readPrivateFile(file)).status, "verification_pending");
  assert.equal(await getXAccessToken({ tokenFile: file, now, fetchImpl: async url => {
    assert.equal(url, "https://api.x.com/2/users/me");
    return { status: 200, json: async () => ({ data: { id: "12345", username: "llmgh0st" } }) };
  } }), "new-fake-access");
  assert.equal(tokenCalls, 1);
});

test("uncertain rotating-refresh outcome requires reconnect and never silently retries", async t => {
  const file = fixture(t, { ...base(), expires_at: now - 1 });
  let calls = 0;
  const fetchImpl = async () => { calls++; throw Error("fake network error"); };
  await assert.rejects(getXAccessToken({ tokenFile: file, now, fetchImpl }), /reconnect/);
  await assert.rejects(getXAccessToken({ tokenFile: file, now, fetchImpl }), /no refresh was retried/);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(readPrivateFile(file)).status, "needs_reconnect");
});

test("missing offline scope fails before token use", async t => {
  const file = fixture(t, { ...base(), scopes: ["tweet.read", "tweet.write", "users.read"] });
  await assert.rejects(getXAccessToken({ tokenFile: file, now }), /missing required scopes/);
});

test("credential storage rejects repository paths and symlinks", t => {
  assert.throws(() => writeXTokenFile(new URL("../x-secret.json", import.meta.url).pathname, base()), /outside the repository/);
  const file = fixture(t);
  const alias = path.join(path.dirname(file), "alias.json");
  fs.symlinkSync(file, alias);
  assert.throws(() => readPrivateFile(alias), /symlink/);
});

test("media authorization requests only one extra scope and old text-only grants fail before use", async t => {
  const auth = createXAuthorization({ clientId: "test-client", redirectUri: "http://127.0.0.1:8787/x/callback", media: true });
  assert.deepEqual(new URL(auth.url).searchParams.get("scope").split(" "), X_MEDIA_SCOPES);
  assert.deepEqual(X_MEDIA_SCOPES.filter(s => !X_SCOPES.includes(s)), ["media.write"]);
  const file = fixture(t);
  await assert.rejects(getXAccessToken({ tokenFile: file, now, media: true, fetchImpl: () => assert.fail("must not contact X") }), /missing required scopes/);
  await assert.rejects(getXAccessToken({ accessToken: "test-token", media: true }), /private scoped token file/);
});

test("media-scoped access and refresh preserve media permission", async t => {
  const file = fixture(t, { ...base(), scopes: X_MEDIA_SCOPES, expires_at: now - 1 });
  const access = await getXAccessToken({ tokenFile: file, now, media: true, fetchImpl: async url => {
    if (url === X_TOKEN_URL) return { ok: true, json: async () => ({ access_token: "new-media-access", refresh_token: "new-media-refresh", token_type: "bearer", expires_in: 7200 }) };
    return { status: 200, json: async () => ({ data: { id: "12345", username: "llmgh0st" } }) };
  } });
  assert.equal(access, "new-media-access");
  assert.ok(JSON.parse(readPrivateFile(file)).scopes.includes("media.write"));
});

test("media code exchange and refresh reject a downgraded grant", async t => {
  const response = { ok: true, json: async () => ({ access_token: "fake-access", refresh_token: "fake-refresh", token_type: "bearer", scope: X_SCOPES.join(" "), expires_in: 7200 }) };
  await assert.rejects(exchangeXCode({ clientId: "test-client", redirectUri: "http://127.0.0.1:8787/x/callback", code: "fake-code", verifier: "fake-verifier", media: true, now, fetchImpl: async () => response }), /missing required/);
  const file = fixture(t, { ...base(), scopes: X_MEDIA_SCOPES, expires_at: now - 1 });
  await assert.rejects(getXAccessToken({ tokenFile: file, now, media: true, fetchImpl: async () => response }), /reconnect/);
  assert.equal(JSON.parse(readPrivateFile(file)).status, "needs_reconnect");
});
