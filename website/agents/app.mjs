import {
  BrowserProvider,
  JsonRpcProvider,
  Contract,
  formatEther,
  getAddress,
  keccak256,
  toUtf8Bytes,
  verifyTypedData,
} from "../mint/vendor/ethers.js";
import {
  accessAbi,
  passportAbi,
  quoteTypes,
  tokenQuoteTypes,
  quoteDomain,
} from "./protocol.mjs";
const $ = (id) => document.getElementById(id);
let config,
  readProvider,
  walletProvider,
  signer,
  account,
  access,
  passport,
  paymentTokenContract,
  activeQuote,
  generation = 0;
const tell = (text) => {
  $("message").textContent = text;
};
const friendly = (e) =>
  e.code === 4001 || e.code === "ACTION_REJECTED"
    ? "Transaction cancelled."
    : (e.shortMessage ?? e.message ?? "Request failed.");
async function api(path, options = {}) {
  const r = await fetch(config.apiBase + path, options);
  const j = await r.json();
  if (!r.ok) throw Error(j.error ?? "Service unavailable");
  return j;
}
function resetQuote() {
  activeQuote = null;
  $("quote").hidden = true;
}
function controls() {
  const ready = !!signer && config?.deployed;
  $("mint").disabled = !ready;
  $("refresh").disabled = !ready;
  $("get-quote").disabled = !ready || !config.ready;
  $("copy-prompt").disabled = !config?.deployed;
  if (!ready) {
    $("withdraw").disabled = true;
    $("withdraw-token").disabled = true;
  }
}
async function load() {
  config = await (await fetch("./config.json", { cache: "no-store" })).json();
  try {
    const r = await fetch(config.apiBase + "/config", { cache: "no-store" });
    if (r.ok) {
      const live = await r.json();
      if (live.chainId === 56 && live.originChainId === 4663)
        config = { ...config, ...live };
    }
  } catch {}
  readProvider = new JsonRpcProvider(config.rpcUrl);
  if (config.deployed) {
    access = new Contract(config.access, accessAbi, readProvider);
    passport = new Contract(config.passport, passportAbi, readProvider);
  }
  $("deployment").textContent = config.deployed
    ? config.ready
      ? "● BNB ACCESS ACTIVE / POWERED BY EXISTING GH0ST"
      : "● PASSPORT DEPLOYED / INFERENCE INTAKE PAUSED"
    : "○ IMPLEMENTATION PREVIEW / CONTRACT DEPLOYMENT PENDING";
  if (config.paymentToken) {
    paymentTokenContract = new Contract(
      config.paymentToken,
      [
        "function balanceOf(address) view returns(uint256)",
        "function allowance(address,address) view returns(uint256)",
        "function approve(address,uint256) returns(bool)",
      ],
      readProvider,
    );
    $("asset-gh0st").disabled = false;
    $("payment-asset").value = "gh0st";
  }
  controls();
  await refresh();
}
async function connect() {
  if (!window.ethereum)
    throw Error(
      "Open this page in a wallet browser, or use the agent instructions.",
    );
  await window.ethereum.request({ method: "eth_requestAccounts" });
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x38" }],
    });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x38",
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: [config.rpcUrl],
          blockExplorerUrls: ["https://bscscan.com"],
        },
      ],
    });
  }
  walletProvider = new BrowserProvider(window.ethereum);
  signer = await walletProvider.getSigner();
  account = await signer.getAddress();
  if ((await walletProvider.getNetwork()).chainId !== 56n)
    throw Error("Select BNB Smart Chain.");
  $("connect").textContent = account.slice(0, 6) + "…" + account.slice(-4);
  controls();
  await refresh();
}
async function transact(button, fn) {
  button.disabled = true;
  try {
    const tx = await fn();
    tell("Transaction submitted. Waiting for confirmation…");
    await tx.wait();
    resetQuote();
    await refresh();
    tell("Confirmed on BNB Chain.");
  } finally {
    controls();
  }
}
async function refresh() {
  if (!access || !passport) return;
  $("reward-pool").textContent =
    formatEther(await access.rewardPool()) + " BNB";
  const [reward, cap, budget] = await Promise.all([
    access.rewardPerRequest(),
    access.maxRewardsPerPassport(),
    access.maxRewardBudget(),
  ]);
  $("reward-terms").textContent =
    reward > 0n
      ? `${formatEther(reward)} BNB per eligible completion; up to ${cap} rewards per passport. Lifetime campaign funding cap: ${formatEther(budget)} BNB.`
      : "No reward campaign is active.";
  if (!account) return;
  const [id, credit, isActive] = await Promise.all([
    passport.passportOf(account),
    access.credits(account),
    passport.isActive(account),
  ]);
  $("credits").textContent = formatEther(credit) + " BNB";
  $("withdraw").disabled = credit === 0n;
  if (paymentTokenContract) {
    const tokenCredit = await access.tokenCredits(account),
      balance = await paymentTokenContract.balanceOf(account);
    $("token-credits").textContent = formatEther(tokenCredit) + " GH0ST";
    $("token-balance").textContent =
      "Wallet: " + formatEther(balance) + " GH0ST";
    $("withdraw-token").disabled = tokenCredit === 0n;
  }
  $("passport-number").textContent = id ? "PASSPORT #" + id : "NOT MINTED";
  $("passport-state").textContent = id
    ? isActive
      ? "Active. Your requests belong to this passport."
      : "Inactive: the linked Agent ID is no longer held by this wallet."
    : "Connect the wallet that holds your Agent ID.";
  $("mint").disabled = !signer || id !== 0n;
  $("get-quote").disabled = !signer || !isActive || !config.ready;
  if (id) {
    const agentId = await passport.agentIdOf(id);
    $("agent-id").value = String(agentId);
    await history(id);
  }
}
function link(label, href) {
  const a = document.createElement("a");
  a.textContent = label + " ↗";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}
async function history(id) {
  const count = Number(await access.requestCount(id)),
    ids = await access.requestPage(id, Math.max(0, count - 20), 20),
    container = $("history-list");
  container.replaceChildren();
  container.className = ids.length ? "" : "empty";
  if (!ids.length) {
    container.textContent = "No requests yet. Your first thought starts here.";
    return;
  }
  for (const requestId of [...ids].reverse()) {
    const r = await access.requests(requestId);
    let receipt = null;
    try {
      receipt = (await api("/receipt?id=" + requestId)).receipt;
    } catch {}
    const article = document.createElement("article");
    article.className = "receipt";
    const top = document.createElement("div");
    top.className = "receipt-head";
    const short = document.createElement("span");
    short.textContent = requestId.slice(0, 12) + "…";
    const status = document.createElement("span");
    status.textContent = ["UNKNOWN", "PENDING", "FULFILLED", "REFUNDED"][
      Number(r.status)
    ];
    top.append(short, status);
    article.append(top);
    const answer = document.createElement("p");
    answer.className = "answer";
    answer.textContent =
      receipt?.answer ??
      (Number(r.status) === 2
        ? "Answer recorded. Hash: " + r.answerHash
        : "Waiting for the next step.");
    article.append(answer);
    const links = document.createElement("div");
    links.className = "receipt-links";
    for (const [label, url, hash] of [
      ["BNB request", "https://bscscan.com/tx/", receipt?.bnbRequestTx],
      [
        "RH request",
        "https://robin.etherscan.io/tx/",
        receipt?.originRequestTx,
      ],
      [
        "RH result",
        "https://robin.etherscan.io/tx/",
        receipt?.originCallbackTx,
      ],
      ["BNB result", "https://bscscan.com/tx/", receipt?.bnbCallbackTx],
    ])
      if (hash) links.append(link(label, url + hash));
    if (!links.children.length)
      links.append(
        link(
          "Read contract",
          "https://bscscan.com/address/" + config.access + "#readContract",
        ),
      );
    article.append(links);
    if (
      Number(r.status) === 1 &&
      Number(r.deadline) < Math.floor(Date.now() / 1000)
    ) {
      const button = document.createElement("button");
      button.textContent = "Return expired payment";
      button.className = "secondary";
      button.onclick = () =>
        transact(button, () => access.connect(signer).refund(requestId)).catch(
          (e) => tell(friendly(e)),
        );
      article.append(button);
    }
    container.append(article);
  }
}
$("connect").onclick = () => connect().catch((e) => tell(friendly(e)));
$("mint").onclick = () => {
  const id = $("agent-id").value.trim();
  if (!/^\d+$/.test(id)) return tell("Enter the numeric Agent ID token ID.");
  transact($("mint"), () => passport.connect(signer).mint(BigInt(id))).catch(
    (e) => tell(friendly(e)),
  );
};
$("prompt").oninput = () => {
  resetQuote();
  $("byte-count").textContent =
    toUtf8Bytes($("prompt").value).length + " / 3400 bytes";
};
$("tokens").onchange = resetQuote;
$("payment-asset").onchange = resetQuote;
$("get-quote").onclick = async () => {
  const button = $("get-quote");
  button.disabled = true;
  const version = generation;
  try {
    const prompt = $("prompt").value,
      maxTokens = Number($("tokens").value),
      tokenMode = $("payment-asset").value === "gh0st";
    if (tokenMode && !paymentTokenContract)
      throw Error("GH0ST payments are not active yet.");
    const response = await api("/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: account,
        prompt,
        maxTokens,
        paymentToken: tokenMode ? config.paymentToken : null,
      }),
    });
    const q = response.tokenQuote?.request ?? response.quote,
      types = tokenMode ? tokenQuoteTypes : quoteTypes,
      value = tokenMode ? response.tokenQuote : q;
    if (
      tokenMode &&
      (!value ||
        getAddress(value.paymentToken) !== getAddress(config.paymentToken))
    )
      throw Error("Quote uses the wrong payment token.");
    if (!tokenMode && response.tokenQuote)
      throw Error("Quote has the wrong denomination.");
    const expectedSigner = await access.quoteSigner();
    if (
      version !== generation ||
      getAddress(q.requester) !== getAddress(account) ||
      q.promptHash !== keccak256(toUtf8Bytes(prompt)) ||
      Number(q.maxTokens) !== maxTokens ||
      getAddress(
        verifyTypedData(
          quoteDomain(config.access),
          types,
          value,
          response.signature,
        ),
      ) !== getAddress(expectedSigner)
    )
      throw Error("Quote does not match this wallet and request.");
    if (BigInt(q.passportId) !== (await passport.passportOf(account)))
      throw Error("Quote uses a different passport.");
    const digest = tokenMode
      ? await access.tokenQuoteDigest(value)
      : await access.quoteDigest(q);
    if (digest !== response.requestId)
      throw Error("Quote digest differs from the contract.");
    let needsApproval = false,
      gas;
    if (tokenMode) {
      if ((await paymentTokenContract.balanceOf(account)) < BigInt(q.fee))
        throw Error("Not enough GH0ST on BNB. Use the GH0ST bridge first.");
      needsApproval =
        (await paymentTokenContract.allowance(account, config.access)) <
        BigInt(q.fee);
      gas = needsApproval
        ? await paymentTokenContract
            .connect(signer)
            .approve.estimateGas(config.access, q.fee)
        : await access
            .connect(signer)
            .requestThoughtWithToken.estimateGas(
              prompt,
              value,
              response.signature,
            );
    } else
      gas = await access
        .connect(signer)
        .requestThought.estimateGas(prompt, q, response.signature, {
          value: BigInt(q.fee),
        });
    const fees = await walletProvider.getFeeData();
    if (version !== generation) return;
    activeQuote = {
      ...response,
      quote: q,
      prompt,
      account,
      tokenMode,
      needsApproval,
    };
    $("quote-price").textContent =
      formatEther(q.fee) + (tokenMode ? " GH0ST" : " BNB");
    $("quote-detail").textContent =
      (needsApproval ? "Approval" : "Request") +
      " gas estimate: " +
      formatEther(gas * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n)) +
      " BNB. " +
      (needsApproval ? "Payment is a separate wallet confirmation. " : "") +
      "Price expires " +
      new Date(Number(q.validUntil) * 1000).toLocaleTimeString() +
      ".";
    $("submit").textContent = needsApproval
      ? "Approve " + formatEther(q.fee) + " GH0ST"
      : tokenMode
        ? "Pay in GH0ST"
        : "Approve in wallet";
    $("quote").hidden = false;
  } catch (e) {
    tell(friendly(e));
  } finally {
    controls();
  }
};
$("submit").onclick = async () => {
  const q = activeQuote;
  if (!q || q.account !== account) return tell("Get a fresh quote first.");
  const button = $("submit");
  button.disabled = true;
  try {
    if (
      q.tokenMode &&
      (await paymentTokenContract.allowance(account, config.access)) <
        BigInt(q.quote.fee)
    ) {
      const tx = await paymentTokenContract
        .connect(signer)
        .approve(config.access, q.quote.fee);
      tell("Waiting for the exact GH0ST allowance to confirm…");
      await tx.wait();
      if (activeQuote !== q || q.account !== account) return;
      if (
        Number(q.quote.validUntil) <
        (await walletProvider.getBlock("latest")).timestamp
      ) {
        resetQuote();
        tell("Approval confirmed. Get a fresh price before paying.");
        return;
      }
      q.needsApproval = false;
      button.textContent = "Pay " + formatEther(q.quote.fee) + " GH0ST";
      tell("Allowance confirmed. Review and click Pay to submit the request.");
      return;
    }
    await transact(button, () =>
      q.tokenMode
        ? access
            .connect(signer)
            .requestThoughtWithToken(q.prompt, q.tokenQuote, q.signature)
        : access
            .connect(signer)
            .requestThought(q.prompt, q.quote, q.signature, {
              value: BigInt(q.quote.fee),
            }),
    );
  } catch (e) {
    tell(friendly(e));
  } finally {
    button.disabled = false;
  }
};
$("withdraw-token").onclick = () =>
  transact($("withdraw-token"), () =>
    access.connect(signer).withdrawToken(),
  ).catch((e) => tell(friendly(e)));
$("withdraw").onclick = () =>
  transact($("withdraw"), () => access.connect(signer).withdraw()).catch((e) =>
    tell(friendly(e)),
  );
$("refresh").onclick = () => refresh().catch((e) => tell(friendly(e)));
$("copy-prompt").onclick = async () => {
  const text = `Use BNB Smart Chain (chain ID 56). Read https://gh0st.fyi/agents/llms.txt. Verify GH0ST Passport ${config.passport} checks Agent ID registry ${config.agentRegistry}. Find the Agent ID token owned by my current wallet. Preview mint(agentId) with value 0; show gas and ask me to confirm before signing. Never share my keys or enable unrelated approvals. GH0ST remains on Robinhood; this is its BNB access layer.`;
  try {
    await navigator.clipboard.writeText(text);
    tell("Agent instructions copied.");
  } catch {
    tell("Clipboard unavailable. Open the agent guide below.");
  }
};
if (window.ethereum?.on) {
  for (const event of ["accountsChanged", "chainChanged"])
    window.ethereum.on(event, () => {
      generation++;
      signer = null;
      account = null;
      resetQuote();
      $("connect").textContent = "Reconnect wallet";
      controls();
    });
}
load().catch((e) => tell(friendly(e)));
