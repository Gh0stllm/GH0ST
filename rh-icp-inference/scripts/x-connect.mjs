import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createXAuthorization, exchangeXCode, loopbackRedirect,
  privateXTokenPath, readPrivateFile, writeXTokenFile } from "../worker/x-auth.mjs";
import { verifyPublishingAccount } from "../worker/x-publisher.mjs";

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (["--no-open", "--replace", "--help", "--media"].includes(name)) out[name.slice(2)] = true;
    else if (["--client-id", "--client-secret-file", "--token-file", "--redirect-uri"].includes(name)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw Error("Missing option value");
      out[name.slice(2)] = argv[++i];
    } else throw Error("Unrecognized option");
  }
  return out;
}

async function main() {
  const args = options(process.argv.slice(2));
  if (args.help) {
    console.log("Connect @llmgh0st without posting:\nnode scripts/x-connect.mjs --client-id PUBLIC_CLIENT_ID [--client-secret-file /private/path] [--no-open] [--media]\nRegister callback http://127.0.0.1:8787/x/callback in the X app. Tokens go outside the repository; X_ENABLED stays unchanged.");
    return;
  }
  const clientId = args["client-id"] ?? process.env.X_OAUTH_CLIENT_ID;
  if (!clientId) throw Error("Supply the app's public OAuth 2.0 Client ID with --client-id");
  const tokenFile = privateXTokenPath(args["token-file"] ?? path.join(os.homedir(), ".config/gh0st/x-oauth.json"));
  if (fs.existsSync(tokenFile) && !args.replace)
    throw Error("Token file already exists. Use --replace only to intentionally reconnect.");
  const clientSecretFile = args["client-secret-file"] ?? process.env.X_OAUTH_CLIENT_SECRET_FILE;
  const clientSecret = clientSecretFile ? readPrivateFile(clientSecretFile).trim() : undefined;
  const redirectUri = args["redirect-uri"] ?? "http://127.0.0.1:8787/x/callback";
  const redirect = loopbackRedirect(redirectUri);
  const auth = createXAuthorization({ clientId, redirectUri, media: Boolean(args.media) });
  let timer;
  let handling = false;
  let settle;
  const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method !== "GET" || req.headers.host !== redirect.host) {
      res.writeHead(400).end("Invalid callback request."); return;
    }
    let callback;
    try { callback = new URL(req.url, redirect.origin); }
    catch { res.writeHead(400).end("Invalid callback request."); return; }
    const state = callback.searchParams.get("state") ?? "";
    const stateBytes = Buffer.from(state), expectedState = Buffer.from(auth.state);
    if (callback.pathname !== redirect.pathname || stateBytes.length !== expectedState.length ||
        !timingSafeEqual(stateBytes, expectedState)) {
      res.writeHead(400).end("Invalid callback state."); return;
    }
    if (handling) { res.writeHead(409).end("Authorization is already being processed."); return; }
    handling = true;
    try {
      const code = callback.searchParams.get("code");
      if (callback.searchParams.has("error") || !code) throw Error("X authorization was declined");
      const record = await exchangeXCode({ clientId, clientSecret, redirectUri,
        code, verifier: auth.verifier, media: Boolean(args.media) });
      record.account = await verifyPublishingAccount({ enabled: true,
        accessToken: record.access_token, expectedUsername: "llmgh0st" });
      writeXTokenFile(tokenFile, record);
      res.end("Connected @llmgh0st. No post was sent. You can close this tab.");
      settle.resolve(record.account);
    } catch (error) {
      res.writeHead(400).end("Authorization could not be completed. See the local terminal.");
      settle.reject(error);
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", () => reject(Error("Could not open the loopback callback port")));
      server.listen(Number(redirect.port), "127.0.0.1", resolve);
    });
    timer = setTimeout(() => settle.reject(Error("X authorization timed out")), 10 * 60_000);
    console.log("Authorize @llmgh0st in your browser. No post is sent by this command.");
    console.log(auth.url);
    if (!args["no-open"] && process.platform === "darwin")
      spawn("/usr/bin/open", [auth.url], { stdio: "ignore" }).on("error", () => {});
    const account = await result;
    console.log(`Connected @${account.username}. Private token file: ${tokenFile}`);
    console.log("Keep X_ENABLED=0 until the RH end-to-end check is confirmed.");
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
