import fs from "node:fs";
import { Contract, ContractFactory, getAddress, formatEther } from "ethers";
import { compile } from "./compile.mjs";
import { bridgePreflight, validateBridgeConfig } from "./bridge-preflight.mjs";
import { readProvider } from "./read-provider.mjs";
import { stringify } from "../worker/core.mjs";
const [stage, file, ...flags] = process.argv.slice(2),
  c = JSON.parse(
    fs.readFileSync(
      file ?? new URL("../bridge.config.example.json", import.meta.url),
    ),
  );
if (
  ![
    "escrow",
    "token",
    "bind-rh",
    "bind-bnb",
    "activate-rh",
    "activate-bnb",
    "bind-payment",
  ].includes(stage)
)
  throw Error(
    "Usage: node scripts/prepare-bridge.mjs <escrow|token|bind-rh|bind-bnb|activate-rh|activate-bnb|bind-payment> CONFIG [--calldata-only]",
  );
const calldataOnly = flags.includes("--calldata-only");
if (flags.some((x) => x !== "--calldata-only")) throw Error("Unknown flag");
if (calldataOnly && !["escrow", "token"].includes(stage))
  throw Error("Calldata-only mode is limited to initial deployments");
validateBridgeConfig(c);
const evidence = calldataOnly ? null : await bridgePreflight(c),
  rh = ["escrow", "bind-rh", "activate-rh"].includes(stage),
  key = rh ? "robinhood" : "bnb",
  network = c[key],
  remote = c[rh ? "bnb" : "robinhood"],
  provider = calldataOnly
    ? null
    : readProvider(network.rpcUrl, network.chainId);
try {
  let tx;
  if (stage === "escrow" || stage === "token") {
    const name = rh ? "GH0STRobinhoodEscrow" : "GH0STBridgedToken",
      artifact = compile()[name];
    const args = [
      network.router,
      network.selector,
      remote.selector,
      c.nativeToken,
      c.owner,
      c.maxTransfer,
      ...(rh ? [] : [c.supplyCap]),
    ];
    tx = await new ContractFactory(
      artifact.abi,
      artifact.evm.bytecode.object,
    ).getDeployTransaction(...args);
  } else {
    if (!c.deployed)
      throw Error("Record and verify both deployments before configuring them");
    if (stage === "bind-payment") {
      if (!c.access)
        throw Error("Confirmed Access contract address is required");
      const access = new Contract(
        c.access,
        [
          "function owner() view returns(address)",
          "function paymentToken() view returns(address)",
          "function bindPaymentToken(address)",
        ],
        provider,
      );
      if (
        getAddress(await access.owner()) !== getAddress(c.owner) ||
        BigInt(await access.paymentToken()) !== 0n
      )
        throw Error("Access binding is not available to this owner");
      tx = {
        to: c.access,
        data: access.interface.encodeFunctionData("bindPaymentToken", [
          network.bridge,
        ]),
        value: 0n,
      };
    } else {
      const bridge = new Contract(
        network.bridge,
        ["function bindPeer(address)", "function setPaused(bool)"],
        provider,
      );
      if (stage.startsWith("activate"))
        for (const [name, state] of Object.entries(evidence.chains))
          if (
            getAddress(state.bridge.peer) !==
            getAddress(c[name === "robinhood" ? "bnb" : "robinhood"].bridge)
          )
            throw Error("Both peers must be bound before activation");
      tx = {
        to: network.bridge,
        data: bridge.interface.encodeFunctionData(
          stage.startsWith("bind") ? "bindPeer" : "setPaused",
          [stage.startsWith("bind") ? remote.bridge : false],
        ),
        value: 0n,
      };
    }
  }
  if (calldataOnly) {
    console.log(
      stringify({
        stage,
        preparedAt: new Date().toISOString(),
        broadcast: false,
        mode: "calldata-only",
        preflightRequired: true,
        note: "Unsigned deployment data only. Rerun live preflight and obtain current gas, balance and nonce before signing.",
        transaction: { ...tx, from: c.owner, chainId: network.chainId },
      }),
    );
  } else {
    const [estimateRaw, priceRaw, balanceRaw, nonceRaw] = await Promise.all([
      provider.send("eth_estimateGas", [
        { ...tx, from: c.owner, value: "0x0" },
      ]),
      provider.send("eth_gasPrice", []),
      provider.send("eth_getBalance", [c.owner, "latest"]),
      provider.send("eth_getTransactionCount", [c.owner, "pending"]),
    ]);
    const gasEstimate = BigInt(estimateRaw);
    const gasLimit = (gasEstimate * 120n + 99n) / 100n;
    const gasPrice = BigInt(priceRaw),
      balance = BigInt(balanceRaw);
    const transaction = {
      ...tx,
      from: c.owner,
      chainId: network.chainId,
      nonce: Number(BigInt(nonceRaw)),
      gasLimit,
      type: 0,
      gasPrice,
    };
    const maxCost = gasLimit * gasPrice;
    console.log(
      stringify({
        stage,
        preparedAt: new Date().toISOString(),
        broadcast: false,
        evidence,
        gasEstimate,
        maximumNativeCost: formatEther(maxCost),
        nativeBalance: formatEther(balance),
        funded: balance >= maxCost,
        transaction,
      }),
    );
  }
} finally {
  provider?.destroy();
}
