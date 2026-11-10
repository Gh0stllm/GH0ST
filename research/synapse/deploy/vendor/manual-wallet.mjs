import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { JsonRpcProvider, Transaction, getAddress, formatEther, keccak256 } from "ethers";
import { validateSwapPlan, assertSwapQuoteFresh } from "./swap-plan.mjs";

const OWNER = "0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6";
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);

export function validatePlan(plan) {
  if (plan.operation === "swap") return validateSwapPlan(plan);
  if (plan.schema !== "gh0st-manual-rh-v1" || plan.broadcast !== false || String(plan.chainId) !== "4663" || getAddress(plan.owner) !== OWNER)
    throw Error("Plan schema, chain or owner does not match this GH0ST pilot");
  let entries;
  if (plan.operation === "deploy") entries = [plan.deployment];
  else if (plan.operation === "register") entries = plan.registrations;
  else if (plan.operation === "callback") entries = [plan.callback];
  else throw Error("Plan must contain a deployment, registrations or a callback");
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 8)
    throw Error("Plan has no actions or too many actions");
  return entries.map((entry, index) => {
    const request = entry?.walletRequest;
    if (request?.method !== "eth_sendTransaction" || request.params?.length !== 1)
      throw Error("Plan action is not a single wallet transaction");
    const tx = request.params[0];
    const allowed = new Set(["from", "to", "data", "value", "type", "chainId", "nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas"]);
    if (Object.keys(tx).some((key) => !allowed.has(key))) throw Error("Unexpected transaction field");
    if (getAddress(tx.from) !== OWNER || BigInt(tx.chainId) !== 4663n || BigInt(tx.value) !== 0n || BigInt(tx.type) !== 2n)
      throw Error("Transaction owner, chain, value or type is invalid");
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(tx.data)) throw Error("Invalid calldata");
    const decoded = Transaction.from(entry.unsignedSerialized);
    if (decoded.signature || decoded.unsignedHash !== entry.unsignedHash || decoded.chainId !== 4663n || decoded.data.toLowerCase() !== tx.data.toLowerCase() || decoded.value !== 0n || decoded.nonce !== Number(BigInt(tx.nonce)) || decoded.gasLimit !== BigInt(tx.gas) || decoded.maxFeePerGas !== BigInt(tx.maxFeePerGas) || decoded.maxPriorityFeePerGas !== BigInt(tx.maxPriorityFeePerGas) || (decoded.to?.toLowerCase() ?? null) !== (tx.to?.toLowerCase() ?? null))
      throw Error("Wallet request differs from the exact unsigned transaction");
    if (decoded.gasLimit <= 0n || decoded.maxFeePerGas <= 0n || decoded.maxPriorityFeePerGas > decoded.maxFeePerGas)
      throw Error("Invalid gas or fee limits");
    if ((plan.operation === "deploy") !== !tx.to) throw Error("Unexpected transaction destination");
    if (tx.to && getAddress(tx.to) !== getAddress(plan.gateway)) throw Error("Transaction targets another gateway");
    return {
      id: index, label: plan.operation === "deploy" ? "Deploy RH callback contract" : plan.operation === "register" ? `Register pool ${index + 1}` : "Record exact thought on RH",
      transaction: tx, unsignedHash: entry.unsignedHash,
      destination: tx.to ?? `New contract: ${entry.predictedGateway}`,
      nonce: decoded.nonce, maxCostWei: decoded.gasLimit * decoded.maxFeePerGas,
      maxCostEth: formatEther(decoded.gasLimit * decoded.maxFeePerGas),
      poolId: entry.poolId ?? null, answer: entry.answer ?? null,
    };
  });
}

export async function checkFresh(provider, action) {
  const tx = action.transaction;
  assertSwapQuoteFresh(action);
  if (BigInt(await provider.send("eth_chainId", [])) !== 4663n) throw Error("Private RPC returned another chain");
  if (action.kind === "swap" && keccak256(await provider.getCode(tx.to)) !== action.routerCodeHash)
    throw Error("Swap router code changed since the reviewed plan");
  const nonce = await provider.getTransactionCount(OWNER, "pending");
  if (nonce !== action.nonce) throw Error(`Stale plan: wallet pending nonce is ${nonce}, plan nonce is ${action.nonce}. Regenerate the plan.`);
  const [fees, block] = await Promise.all([provider.getFeeData(), provider.getBlock("latest")]);
  // A suggested max fee includes extra headroom (commonly twice the base fee).
  // Its fluctuation must not invalidate an already bounded transaction whose
  // actual base fee and priority still fit the exact reviewed fee cap.
  const priority = BigInt(tx.maxPriorityFeePerGas), maximum = BigInt(tx.maxFeePerGas);
  if (block?.baseFeePerGas == null || fees.maxPriorityFeePerGas == null ||
      BigInt(block.baseFeePerGas) + priority > maximum || fees.maxPriorityFeePerGas > priority)
    throw Error("Current fees exceed this plan. Regenerate it before signing.");
  const estimate = await provider.estimateGas({ from: OWNER, ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: BigInt(tx.value) });
  if (estimate > BigInt(tx.gas)) throw Error("Current gas estimate exceeds the plan. Regenerate it.");
  if (await provider.getBalance(OWNER) < action.maxCostWei + BigInt(tx.value)) throw Error("Wallet balance is below the input plus maximum transaction fee");
  return { checkedAt: new Date().toISOString(), pendingNonce: nonce, estimatedGas: estimate.toString() };
}

function html(payload) {
  const embedded = json(payload).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GH0ST · Manual RH signing</title><style>
  body{font:16px/1.5 system-ui,sans-serif;background:#101010;color:#eee;max-width:800px;margin:48px auto;padding:0 22px}h1{font-size:26px}p{color:#bbb}article{border:1px solid #444;border-radius:10px;padding:20px;margin:20px 0}button{background:#eee;color:#111;border:0;border-radius:6px;padding:12px 18px;font-weight:650;cursor:pointer}button:disabled{opacity:.4;cursor:default}code{overflow-wrap:anywhere;font-size:13px}dl{display:grid;grid-template-columns:120px 1fr;gap:8px}dd{margin:0;overflow-wrap:anywhere}.status{white-space:pre-wrap;color:#e0bd69}.muted{font-size:13px;color:#999}</style></head><body>
  <h1>GH0ST · Manual RH signing</h1><p>Connect your deployment wallet, review the exact transaction, then approve it in your wallet. This local page never receives your private key.</p>
  <p>Robinhood Chain · 4663<br>Required wallet: <code id="owner"></code></p><button id="connect">Connect wallet</button><p id="connection" class="status"></p><p class="muted">Plan SHA-256: <code id="planhash"></code></p><main id="actions"></main>
  <p class="muted">Nonce, current fees, balance and gas are checked immediately before opening your wallet. If the wallet prompt remains open or you send another transaction, cancel and regenerate the plan. A reported transaction still needs receipt verification.</p>
  <script>const plan=${embedded};let connected=false;const status=document.getElementById('connection');document.getElementById('owner').textContent=plan.owner;document.getElementById('planhash').textContent=plan.planHash;
  async function api(route,body){const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-wallet-token':plan.token},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error||'Local check failed');return v;}
  async function walletCheck(){const accounts=await window.ethereum.request({method:'eth_accounts'});if(!accounts[0]||accounts[0].toLowerCase()!==plan.owner.toLowerCase())throw Error('Select the required deployment wallet.');const chain=await window.ethereum.request({method:'eth_chainId'});if(BigInt(chain)!==4663n)throw Error('Switch your wallet to Robinhood Chain (4663).');}
  document.getElementById('connect').onclick=async()=>{try{if(!window.ethereum)throw Error('Open this page in a browser with your wallet extension.');await window.ethereum.request({method:'eth_requestAccounts'});if(BigInt(await window.ethereum.request({method:'eth_chainId'}))!==4663n)await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});await walletCheck();connected=true;status.textContent='Connected. Review an action below.';render();}catch(e){status.textContent=e.message;}};
  function render(){const root=document.getElementById('actions');root.replaceChildren();for(const a of plan.actions){const card=document.createElement('article'),title=document.createElement('h2'),details=document.createElement('dl'),button=document.createElement('button'),message=document.createElement('p');title.textContent=a.label;for(const [key,value] of [['Destination',a.destination],['ETH value',a.valueEth||'0'],['Maximum fee',a.maxCostEth+' ETH'],['Nonce',a.nonce],['Unsigned transaction hash',a.unsignedHash],...(a.poolId?[['Pool',a.poolId]]:[]),...(a.answer?[['Thought',a.answer]]:[])]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;details.append(dt,dd);}message.className='status';const report=plan.reports[a.id];button.textContent='Review and sign in wallet';button.disabled=!connected||!!report;message.textContent=report?(report.transactionHash?'Wallet reported: '+report.transactionHash:'A previous wallet request needs reconciliation before retrying.') : '';button.onclick=async()=>{button.disabled=true;let ticket;try{await walletCheck();message.textContent='Checking nonce, fees, gas and balance…';const check=await api('/api/preflight',{actionId:a.id});ticket=check.ticket;message.textContent='Fresh checks passed. Review and approve in your wallet.';const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[a.transaction]});await api('/api/report',{actionId:a.id,ticket,transactionHash:hash});plan.reports[a.id]={transactionHash:hash};message.textContent='Wallet reported: '+hash+' — Receipt verification is next.';}catch(e){message.textContent=e.message;if(e.code===4001&&ticket){try{await api('/api/cancel',{actionId:a.id,ticket});button.disabled=false;}catch{message.textContent+=' Check wallet history before retrying.';}}else if(!ticket){button.disabled=false;}else{message.textContent+=' Outcome uncertain: check wallet history before retrying.';}}};card.append(title,details,button,message);root.append(card);}}
  if(window.ethereum){window.ethereum.on?.('accountsChanged',()=>{connected=false;status.textContent='Wallet changed. Connect again.';render();});window.ethereum.on?.('chainChanged',()=>{connected=false;status.textContent='Network changed. Connect again.';render();});}render();</script></body></html>`;
}

export async function startServer({ planPath, port = 8788, rpc = process.env.RH_RPC_URL }) {
  if (!rpc) throw Error("RH_RPC_URL must be supplied privately to the local server");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid local port");
  planPath = path.resolve(planPath);
  if (!fs.lstatSync(planPath).isFile() || fs.lstatSync(planPath).isSymbolicLink()) throw Error("Plan must be a regular file");
  const bytes = fs.readFileSync(planPath), planHash = digest(bytes), plan = JSON.parse(bytes);
  const actions = validatePlan(plan), token = crypto.randomBytes(32).toString("hex");
  const reportsPath = planPath.replace(/\.json$/, "") + ".wallet-reports.json";
  let reports = {};
  if (fs.existsSync(reportsPath)) {
    const saved = JSON.parse(fs.readFileSync(reportsPath, "utf8"));
    if (saved.planHash !== planHash) throw Error("Existing wallet reports belong to another plan");
    reports = saved.actions;
  }
  const save = () => {
    const tmp = reportsPath + ".tmp";
    fs.writeFileSync(tmp, json({ schema: "gh0st-wallet-reports-v1", planHash, owner: OWNER, chainId: 4663, actions: reports }) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, reportsPath);
  };
  const provider = new JsonRpcProvider(rpc, 4663, { staticNetwork: true });
  const checking = new Set();
  const origin = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (req, res) => {
    const send = (status, value, type = "application/json") => { res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY" }); res.end(type === "application/json" ? json(value) : value); };
    try {
      if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: "Use the exact 127.0.0.1 address" });
      if (req.method === "GET" && req.url === "/") return send(200, html({ owner: OWNER, planHash, token, actions, reports }), "text/html; charset=utf-8");
      if (req.method !== "POST" || !["/api/preflight", "/api/report", "/api/cancel"].includes(req.url)) return send(404, { error: "Not found" });
      if (req.headers.origin !== origin || req.headers["x-wallet-token"] !== token) return send(403, { error: "Invalid local signing session" });
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 8192) throw Error("Request too large"); }
      const input = JSON.parse(body), action = actions[input.actionId];
      if (!Number.isInteger(input.actionId) || !action) throw Error("Unknown action");
      if (digest(fs.readFileSync(planPath)) !== planHash) throw Error("Plan changed on disk. Restart with the regenerated plan.");
      if (req.url === "/api/preflight") {
        if (reports[action.id] || checking.has(action.id)) throw Error("Action already requested. Reconcile wallet history before retrying.");
        checking.add(action.id);
        try {
          const fresh = await checkFresh(provider, action);
          const ticket = crypto.randomBytes(24).toString("hex");
          reports[action.id] = { status: "awaiting_wallet", ticket, requestedAt: new Date().toISOString(), unsignedHash: action.unsignedHash };
          save();
          return send(200, { ...fresh, ticket });
        } finally { checking.delete(action.id); }
      }
      const record = reports[action.id];
      if (!record || record.ticket !== input.ticket) throw Error("Signing intent does not match");
      if (req.url === "/api/cancel") {
        if (record.transactionHash) throw Error("A submitted transaction cannot be cancelled here");
        delete reports[action.id]; save(); return send(200, { cancelled: true });
      }
      if (!/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash ?? "")) throw Error("Invalid reported transaction hash");
      if (record.transactionHash && record.transactionHash !== input.transactionHash) throw Error("Action has another reported transaction");
      reports[action.id] = { ...record, status: "wallet_reported_unverified", transactionHash: input.transactionHash, reportedAt: new Date().toISOString() };
      save(); return send(200, { saved: true, receiptVerified: false });
    } catch (error) {
      let message = String(error.message ?? error).split(rpc).join("[private RH RPC]");
      send(400, { error: message.replace(/\/v2\/[^\s"'?]+/g, "/v2/[redacted]") });
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { server, provider, url: origin, reportsPath, planHash, actions };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--plan", "--port"].includes(args[i]) || !args[i + 1]) throw Error("Usage: manual-wallet.mjs --plan FILE --port 8788");
    values[args[i].slice(2)] = args[i + 1];
  }
  if (!values.plan) throw Error("--plan is required");
  startServer({ planPath: values.plan, port: Number(values.port ?? 8788) }).then(({ server, provider, url, reportsPath, planHash, actions }) => {
    console.log(json({ url, reportsPath, planHash, actions: actions.length, broadcasts: 0 }));
    const stop = () => { server.close(); provider.destroy(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  }).catch((error) => { console.error(String(error.message ?? error).split(process.env.RH_RPC_URL ?? "[unused]").join("[private RH RPC]")); process.exitCode = 1; });
}
