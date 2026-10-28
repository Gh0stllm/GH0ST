import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyPublishingAccount } from "./x-publisher.mjs";

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];
export const X_MEDIA_SCOPES = [...X_SCOPES, "media.write"];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = "gh0st-x-oauth-v1";

function token(value, label) {
  if (typeof value !== "string" || !value.length || /\s/.test(value))
    throw Error(`Invalid ${label}`);
  return value;
}

export function loopbackRedirect(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
      !url.port || url.username || url.password || url.search || url.hash ||
      !url.pathname || url.pathname === "/")
    throw Error("Use a registered http://127.0.0.1:PORT/PATH callback URL");
  return url;
}

export function createXAuthorization({ clientId, redirectUri, media = false }) {
  if (typeof media !== "boolean") throw Error("Invalid media authorization option");
  token(clientId, "X client ID");
  loopbackRedirect(redirectUri);
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(X_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    scope: (media ? X_MEDIA_SCOPES : X_SCOPES).join(" "), state, code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.href, verifier, state };
}

export function privateXTokenPath(filename) {
  if (!path.isAbsolute(filename)) throw Error("Use an absolute private token-file path");
  const absolute = path.resolve(filename);
  if (absolute === projectRoot || absolute.startsWith(projectRoot + path.sep))
    throw Error("X credentials must be stored outside the repository");
  const parent = path.dirname(absolute);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const realParent = fs.realpathSync(parent);
  if (realParent === projectRoot || realParent.startsWith(projectRoot + path.sep))
    throw Error("X credentials must be stored outside the repository");
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink())
    throw Error("Private token file must not be a symlink");
  return absolute;
}

export function readPrivateFile(filename) {
  const absolute = privateXTokenPath(filename);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid()))
    throw Error("Private X files must be owned by this user and mode 0600");
  return fs.readFileSync(absolute, "utf8");
}

export function writeXTokenFile(filename, record) {
  const absolute = privateXTokenPath(filename);
  const tmp = absolute + "." + randomBytes(8).toString("hex") + ".tmp";
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(record) + "\n");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, absolute); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  const dirFd = fs.openSync(path.dirname(absolute), "r");
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

function normalizeTokens(body, previous, now, requiredScopes = X_SCOPES) {
  const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/) : previous?.scopes;
  if (!Array.isArray(scopes) || !requiredScopes.every(scope => scopes.includes(scope)))
    throw Error("X authorization is missing required publishing/refresh scopes");
  if (String(body.token_type).toLowerCase() !== "bearer")
    throw Error("X token endpoint did not return a bearer token");
  if (!Number.isSafeInteger(body.expires_in) || body.expires_in < 120)
    throw Error("X token endpoint returned an invalid expiry");
  return {
    access_token: token(body.access_token, "X access token"),
    refresh_token: token(body.refresh_token ?? previous?.refresh_token, "X refresh token"),
    token_type: "bearer", scopes, expires_at: now + body.expires_in * 1000,
  };
}

async function tokenRequest(client, params, fetchImpl) {
  token(client.client_id, "X client ID");
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (client.client_secret) {
    token(client.client_secret, "X client secret");
    headers.Authorization = "Basic " + Buffer.from(
      encodeURIComponent(client.client_id) + ":" + encodeURIComponent(client.client_secret),
    ).toString("base64");
  } else params.client_id = client.client_id;
  let response;
  try {
    response = await fetchImpl(X_TOKEN_URL, {
      method: "POST", redirect: "error", headers,
      body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000),
    });
  } catch { throw Error("X token request failed; reconnect if refresh outcome is unknown"); }
  if (!response.ok) throw Error(`X token endpoint rejected the request (HTTP ${response.status})`);
  try { return await response.json(); }
  catch { throw Error("X token endpoint returned an invalid response"); }
}

export async function exchangeXCode({ clientId, clientSecret, redirectUri, code, verifier, media = false,
  now = Date.now(), fetchImpl = globalThis.fetch }) {
  loopbackRedirect(redirectUri);
  const client = { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) };
  const body = await tokenRequest(client, {
    code: token(code, "authorization code"), grant_type: "authorization_code",
    redirect_uri: redirectUri, code_verifier: token(verifier, "PKCE verifier"),
  }, fetchImpl);
  return { schema: SCHEMA, status: "ready", ...client, redirect_uri: redirectUri,
    ...normalizeTokens(body, null, now, media ? X_MEDIA_SCOPES : X_SCOPES) };
}

export async function getXAccessToken({
  tokenFile, accessToken, expectedUsername = "llmgh0st", now = Date.now(),
  fetchImpl = globalThis.fetch, media = false,
} = {}) {
  if (typeof media !== "boolean") throw Error("Invalid media authorization option");
  if (media && !tokenFile) throw Error("Media publishing requires a private scoped token file");
  if (!tokenFile) return token(accessToken, "X user-context access token");
  let record;
  try { record = JSON.parse(readPrivateFile(tokenFile)); }
  catch (error) { throw Error(error instanceof SyntaxError ? "Invalid private X token file" : error.message); }
  if (record.schema !== SCHEMA || !["ready", "verification_pending"].includes(record.status))
    throw Error("X authorization requires reconnecting; no refresh was retried");
  if (record.account?.username?.toLowerCase() !== expectedUsername.toLowerCase())
    throw Error("Private X token file belongs to another account");
  const requiredScopes = media ? X_MEDIA_SCOPES : X_SCOPES;
  if (!requiredScopes.every(scope => record.scopes?.includes(scope)))
    throw Error("Private X token file is missing required scopes");
  token(record.access_token, "X access token");
  token(record.refresh_token, "X refresh token");
  if (!Number.isSafeInteger(record.expires_at)) throw Error("Invalid X token expiry");
  if (record.status === "ready" && record.expires_at > now + 60_000) return record.access_token;

  const lock = privateXTokenPath(tokenFile) + ".lock";
  let fd;
  try { fd = fs.openSync(lock, "wx", 0o600); }
  catch { throw Error("X refresh is locked; check the existing process before retrying"); }
  try {
    let next = record;
    if (record.status !== "verification_pending") {
      // A lost response may have consumed a rotating refresh token. Persist
      // intent before contacting X and never silently repeat uncertain refreshes.
      writeXTokenFile(tokenFile, { ...record, status: "refresh_pending" });
      try {
        const body = await tokenRequest(record, {
          grant_type: "refresh_token", refresh_token: record.refresh_token,
        }, fetchImpl);
        next = { ...record, ...normalizeTokens(body, record, now, requiredScopes), status: "verification_pending" };
        // Save the rotated refresh token before any further network request.
        writeXTokenFile(tokenFile, next);
      } catch {
        writeXTokenFile(tokenFile, { ...record, status: "needs_reconnect" });
        throw Error("X token refresh did not complete safely; reconnect the account");
      }
    }
    const account = await verifyPublishingAccount({
      enabled: true, accessToken: next.access_token, expectedUsername, fetchImpl,
    });
    if (account.id !== record.account.id) {
      writeXTokenFile(tokenFile, { ...next, status: "needs_reconnect" });
      throw Error("Refreshed X token belongs to a different account");
    }
    next = { ...next, account, status: "ready" };
    writeXTokenFile(tokenFile, next);
    return next.access_token;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
