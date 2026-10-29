import {
  BrowserProvider,
  JsonRpcProvider,
  Contract,
  parseEther,
  formatEther,
  getAddress,
} from "../mint/vendor/ethers.js";
const $ = (id) => document.getElementById(id),
  tokenAbi = [
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
    "function approve(address,uint256) returns(bool)",
  ];
const bridgeAbi = [
  "function quoteBridge(uint256,address) view returns(uint256)",
  "function bridge(uint256,address,uint256) payable returns(bytes32)",
  "function paused() view returns(bool)",
  "function nativeCredits(address) view returns(uint256)",
  "function withdrawNativeCredit()",
  "function lockedBacking() view returns(uint256)",
  "function totalSupply() view returns(uint256)",
  "event BridgeSent(bytes32 indexed messageId,address indexed sender,address indexed recipient,uint256 amount,uint256 nonce,uint256 nativeFee)",
];
let config,
  signer,
  account,
  preview,
  revision = 0;
const tell = (x) => {
  $("message").textContent = x;
};
const fail = (e) =>
  tell(
    e.code === 4001 || e.code === "ACTION_REJECTED"
      ? "Cancelled in wallet."
      : (e.shortMessage ?? e.message),
  );
const source = () => config[$("direction").value],
  sourceKey = () => $("direction").value;
function reset() {
  preview = null;
  $("preview").hidden = true;
}
async function refresh() {
  if (!config.deployed) return;
  const sr = source(),
    p = new JsonRpcProvider(sr.rpcUrl),
    bridge = new Contract(sr.bridge, bridgeAbi, p);
  if (account) {
    const token = new Contract(
      sourceKey() === "robinhood" ? config.nativeToken : sr.bridge,
      tokenAbi,
      p,
    );
    $("balance").textContent =
      "Balance: " + formatEther(await token.balanceOf(account)) + " GH0ST";
    const credit = await bridge.nativeCredits(account);
    $("credit").textContent =
      "Unused fee credit: " +
      formatEther(credit) +
      " " +
      (sourceKey() === "robinhood" ? "ETH" : "BNB");
    $("withdraw-credit").disabled = !signer || credit === 0n;
  }
  const rp = new JsonRpcProvider(config.robinhood.rpcUrl),
    bp = new JsonRpcProvider(config.bnb.rpcUrl),
    [locked, supply] = await Promise.all([
      new Contract(config.robinhood.bridge, bridgeAbi, rp).lockedBacking(),
      new Contract(config.bnb.bridge, bridgeAbi, bp).totalSupply(),
    ]);
  $("backing-stats").textContent =
    formatEther(locked) +
    " GH0ST locked on Robinhood. " +
    formatEther(supply) +
    " GH0ST issued on BNB. The difference can include transfers in flight.";
  $("addresses").textContent =
    "Robinhood escrow: " +
    config.robinhood.bridge +
    " · BNB GH0ST: " +
    config.bnb.bridge;
}
async function connect() {
  if (!window.ethereum) throw Error("Open in your wallet browser to bridge.");
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const sr = source(),
    chainId = "0x" + sr.chainId.toString(16);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName:
            sourceKey() === "robinhood" ? "Robinhood Chain" : "BNB Smart Chain",
          nativeCurrency: {
            name: sourceKey() === "robinhood" ? "Ether" : "BNB",
            symbol: sourceKey() === "robinhood" ? "ETH" : "BNB",
            decimals: 18,
          },
          rpcUrls: [sr.rpcUrl],
          blockExplorerUrls: [sr.explorer],
        },
      ],
    });
  }
  const provider = new BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  account = await signer.getAddress();
  if ((await provider.getNetwork()).chainId !== BigInt(sr.chainId))
    throw Error("Select the sending chain.");
  if (!$("recipient").value) $("recipient").value = account;
  $("connect").textContent = account.slice(0, 6) + "…" + account.slice(-4);
  $("quote").disabled = !config.deployed;
  await refresh();
}
$("connect").onclick = () => connect().catch(fail);
$("direction").onchange = () => {
  revision++;
  reset();
  signer = null;
  $("quote").disabled = true;
  $("connect").textContent = "Connect sending chain";
  refresh().catch(fail);
};
for (const x of ["amount", "recipient"]) $(x).oninput = reset;
$("quote").onclick = async () => {
  $("quote").disabled = true;
  const version = revision;
  try {
    const sr = source(),
      amount = parseEther($("amount").value),
      recipient = getAddress($("recipient").value),
      bridge = new Contract(sr.bridge, bridgeAbi, signer);
    if (amount <= 0n) throw Error("Enter a positive amount.");
    if (await bridge.paused()) throw Error("This bridge direction is paused.");
    const fee = await bridge.quoteBridge(amount, recipient),
      maxFee = (fee * 120n + 99n) / 100n;
    let approval = false;
    const token = new Contract(
      sourceKey() === "robinhood" ? config.nativeToken : sr.bridge,
      tokenAbi,
      signer,
    );
    if ((await token.balanceOf(account)) < amount)
      throw Error("Not enough GH0ST.");
    if (sourceKey() === "robinhood")
      approval = (await token.allowance(account, sr.bridge)) < amount;
    if (version !== revision) return;
    preview = {
      sr,
      amount,
      recipient,
      maxFee,
      approval,
      bridge,
      token,
      account,
      version,
    };
    $("fee").textContent =
      "Up to " +
      formatEther(maxFee) +
      " " +
      (sourceKey() === "robinhood" ? "ETH" : "BNB") +
      " for CCIP";
    $("fee-detail").textContent =
      "Current CCIP quote: " +
      formatEther(fee) +
      ". Transaction gas is additional. Any unused fee buffer becomes withdrawal credit.";
    $("send").textContent = approval
      ? "Approve exact GH0ST amount"
      : "Bridge " + formatEther(amount) + " GH0ST";
    $("preview").hidden = false;
  } catch (e) {
    fail(e);
  } finally {
    $("quote").disabled = !signer || !config.deployed;
  }
};
$("send").onclick = async () => {
  const p = preview;
  if (!p || p.version !== revision || p.account !== account)
    return tell("Review a fresh bridge quote.");
  $("send").disabled = true;
  try {
    if (p.approval) {
      const tx = await p.token.approve(p.sr.bridge, p.amount);
      tell("Waiting for approval…");
      await tx.wait();
      if (preview !== p) return;
      p.approval = false;
      $("send").textContent = "Bridge " + formatEther(p.amount) + " GH0ST";
      tell("Approval confirmed. Review and click Bridge to send.");
      return;
    }
    const tx = await p.bridge.bridge(p.amount, p.recipient, p.maxFee, {
      value: p.maxFee,
    });
    tell("Waiting for the source transaction…");
    const receipt = await tx.wait();
    const event = receipt.logs
      .filter((l) => l.address.toLowerCase() === p.sr.bridge.toLowerCase())
      .map((l) => {
        try {
          return p.bridge.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l) => l?.name === "BridgeSent");
    if (!event) throw Error("Source receipt has no bridge message.");
    const el = $("receipt");
    el.replaceChildren();
    const a = document.createElement("a");
    a.href = p.sr.explorer + "/tx/" + receipt.hash;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Source transaction ↗";
    const text = document.createElement("p");
    text.textContent = "CCIP message: " + event.args.messageId;
    const link = document.createElement("a");
    link.href = "https://ccip.chain.link";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Track delivery in CCIP ↗";
    el.append(a, text, link);
    reset();
    await refresh();
    tell(
      "Transfer sent. Wait for destination delivery before using the tokens.",
    );
  } catch (e) {
    fail(e);
  } finally {
    $("send").disabled = false;
  }
};
$("withdraw-credit").onclick = async () => {
  try {
    const bridge = new Contract(source().bridge, bridgeAbi, signer),
      tx = await bridge.withdrawNativeCredit();
    await tx.wait();
    await refresh();
    tell("Unused fee credit withdrawn.");
  } catch (e) {
    fail(e);
  }
};
if (window.ethereum?.on)
  for (const event of ["accountsChanged", "chainChanged"])
    window.ethereum.on(event, () => {
      revision++;
      reset();
      signer = null;
      $("quote").disabled = true;
      $("withdraw-credit").disabled = true;
      $("connect").textContent = "Reconnect wallet";
    });
config = await (await fetch("./config.json", { cache: "no-store" })).json();
$("deployment").textContent = config.deployed
  ? "CHECK CONTRACT STATUS BEFORE BRIDGING"
  : "IMPLEMENTATION PREVIEW / BRIDGE DEPLOYMENT PENDING";
await refresh().catch(fail);
