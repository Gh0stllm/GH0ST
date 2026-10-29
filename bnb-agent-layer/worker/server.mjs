import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { accessAbi, passportAbi } from "../../website/agents/protocol.mjs";
import { validateConfig, signQuote, same, stringify } from "./core.mjs";
import { Relay } from "./relay.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)),
  root = path.resolve(here, "..");
const config = validateConfig(
  JSON.parse(
    fs.readFileSync(
      process.env.GH0ST_BNB_CONFIG ?? path.join(root, "config.example.json"),
      "utf8",
    ),
  ),
);
const bnb = new JsonRpcProvider(config.rpcUrl),
  rh = new JsonRpcProvider(config.originRpcUrl);
const access = config.deployed
  ? new Contract(config.access, accessAbi, bnb)
  : null;
const passport = config.deployed
  ? new Contract(config.passport, passportAbi, bnb)
  : null;
let ready = false,
  relay = null,
  quoter = null,
  stopped = false;
const publicConfig = () => ({
  deployed: config.deployed,
  ready,
  chainId: 56,
  passport: config.passport,
  access: config.access,
  agentRegistry: config.agentRegistry,
  deploymentBlock: config.deploymentBlock,
  rpcUrl: config.rpcUrl,
  originChainId: 4663,
  originGateway: config.originGateway,
  coordinator: config.coordinator,
  modelCanister: config.modelCanister,
  apiBase: "/api/bnb",
  quoteSigner: quoter?.address ?? null,
});
async function initialize() {
  if (!config.deployed) return;
  if (
    BigInt(await bnb.send("eth_chainId", [])) !== 56n ||
    BigInt(await rh.send("eth_chainId", [])) !== 4663n
  )
    throw Error("Configured chain does not match");
  const expected = [
    ["passport", config.passport],
    ["icpSigner", config.icpSigner],
    ["rhGateway", config.originGateway],
    ["modelId", config.modelId],
    ["artifactHash", config.artifactHash],
  ];
  for (const [method, value] of expected)
    if (!same(await access[method](), value))
      throw Error(`Access contract ${method} differs from configuration`);
  if (!same(await passport.agentRegistry(), config.agentRegistry))
    throw Error("Passport registry differs from configuration");
  if (
    !process.env.GH0ST_BNB_QUOTE_KEY ||
    !process.env.GH0ST_RELAY_KEY ||
    !process.env.ICP_IDENTITY_FILE ||
    !process.env.GH0ST_BNB_STATE
  )
    return;
  quoter = new Wallet(process.env.GH0ST_BNB_QUOTE_KEY);
  if (!same(await access.quoteSigner(), quoter.address))
    throw Error("Quote signer differs from contract");
  relay = await Relay.open(config, bnb, rh, {
    key: process.env.GH0ST_RELAY_KEY,
    identityFile: process.env.ICP_IDENTITY_FILE,
    stateFile: process.env.GH0ST_BNB_STATE,
  });
  ready = true;
}
await initialize();
const rates = new Map();
function rate(req) {
  const ip = req.socket.remoteAddress ?? "local",
    now = Date.now(),
    old = rates.get(ip);
  if (rates.size > 10000)
    for (const [k, v] of rates) if (now - v.start > 60000) rates.delete(k);
  const r = old && now - old.start < 60000 ? old : { start: now, count: 0 };
  rates.set(ip, r);
  return ++r.count <= 60;
}
async function body(req) {
  let size = 0,
    chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 12000) throw Error("Request body exceeds 12 KB");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(stringify(value));
};
const publicItem = (item) =>
  item
    ? {
        id: item.id,
        status: item.status,
        bnbRequestTx: item.bnbRequestTx,
        originId: item.originId ?? null,
        originRequestTx: item.originRequest?.hash ?? null,
        originCallbackTx: item.originCallback?.hash ?? null,
        bnbCallbackTx: item.bnbCallback?.hash ?? null,
        answer: item.answer ?? null,
      }
    : null;
const webroot = path.resolve(root, "../website");
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local");
    url.pathname = url.pathname.replace(/^\/api\/bnb(?=\/)/, "/api");
    if (!rate(req)) return json(res, 429, { error: "Rate limit reached" });
    if (url.pathname === "/api/config") return json(res, 200, publicConfig());
    if (url.pathname === "/api/health")
      return json(res, 200, {
        ready,
        deployed: config.deployed,
        pending:
          relay?.state.items.filter(
            (x) =>
              !["fulfilled", "refunded", "awaiting_refund", "held"].includes(
                x.status,
              ),
          ).length ?? 0,
      });
    if (url.pathname === "/api/quote" && req.method === "POST") {
      if (!ready || !quoter || !relay || (await access.paused()))
        return json(res, 503, { error: "New requests are not active yet" });
      if (
        req.headers.origin &&
        req.headers.origin !== process.env.GH0ST_PUBLIC_ORIGIN
      )
        return json(res, 403, { error: "Origin not allowed" });
      const input = await body(req);
      input.requester = getAddress(input.requester);
      input.maxTokens = Number(input.maxTokens);
      const passportId = await passport.passportOf(input.requester);
      if (!passportId || !(await passport.isActive(input.requester)))
        return json(res, 403, {
          error: "An active GH0ST Passport is required",
        });
      if (
        relay.state.items.filter(
          (x) =>
            !["fulfilled", "refunded", "awaiting_refund", "held"].includes(
              x.status,
            ),
        ).length >= config.maxPendingRequests
      )
        return json(res, 503, {
          error: "Inference queue is full; no payment requested",
        });
      const out = await signQuote(
        config,
        quoter,
        { ...input, passportId },
        (await bnb.getBlock("latest")).timestamp,
      );
      return json(res, 200, out);
    }
    if (url.pathname === "/api/receipt") {
      const id = url.searchParams.get("id");
      if (!/^0x[0-9a-f]{64}$/i.test(id ?? ""))
        return json(res, 400, { error: "Invalid request ID" });
      return json(res, 200, {
        receipt: publicItem(relay?.state.items.find((x) => same(x.id, id))),
      });
    }
    if (url.pathname.startsWith("/api/"))
      return json(res, 404, { error: "Unknown API route" });
    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { error: "Method not allowed" });
    // This service exposes only the additive page and its existing local ethers dependency.
    const local =
      url.pathname === "/agents" || url.pathname === "/agents/"
        ? "/agents/index.html"
        : url.pathname;
    if (!local.startsWith("/agents/") && local !== "/mint/vendor/ethers.js")
      return json(res, 404, { error: "Not found" });
    const target = path.resolve(webroot, "." + decodeURIComponent(local));
    if (!target.startsWith(webroot + path.sep))
      return json(res, 400, { error: "Invalid path" });
    const ext = path.extname(target),
      mime = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".txt": "text/plain; charset=utf-8",
        ".svg": "image/svg+xml",
      }[ext];
    if (!mime || !fs.existsSync(target))
      return json(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(target).pipe(res);
  } catch (error) {
    json(res, 400, { error: error.shortMessage ?? error.message });
  }
});
server.listen(
  Number(process.env.PORT ?? 8787),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `GH0ST access listening at http://${process.env.HOST ?? "127.0.0.1"}:${server.address().port}/agents/ (${ready ? "active" : "read-only; deployment or worker setup pending"})`,
    ),
);
async function work() {
  while (!stopped && relay) {
    try {
      await relay.tick();
    } catch {
      ready = false;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
void work();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopped = true;
    ready = false;
    relay?.close();
    bnb.destroy();
    rh.destroy();
    server.close(() => process.exit(0));
  });
