import fs from "node:fs";
import { Contract, ContractFactory, JsonRpcProvider, getAddress } from "ethers";
import { compile } from "./compile.mjs";
import { preflight } from "./preflight.mjs";
import { stringify } from "../worker/core.mjs";
const [stage, configPath, ownerArg, registryArg] = process.argv.slice(2);
if (
  ![
    "passport",
    "access",
    "registration",
    "authorize-relay",
    "fund-rewards",
  ].includes(stage) ||
  !configPath ||
  !ownerArg
)
  throw Error(
    "Usage: node scripts/prepare-deployment.mjs <passport|access|registration|authorize-relay|fund-rewards> CONFIG OWNER [REGISTRY_OR_RELAY_OR_AMOUNT]",
  );
const c = JSON.parse(fs.readFileSync(configPath, "utf8")),
  owner = getAddress(ownerArg);
await preflight(c);
const chainId = stage === "authorize-relay" ? 4663 : 56,
  provider = new JsonRpcProvider(chainId === 56 ? c.rpcUrl : c.originRpcUrl);
try {
  let tx;
  if (stage === "passport") {
    const registry = getAddress(registryArg ?? c.agentRegistry),
      probe = new Contract(
        registry,
        ["function supportsInterface(bytes4) view returns(bool)"],
        provider,
      );
    if (!(await probe.supportsInterface("0x80ac58cd")))
      throw Error("Agent ID registry is not ERC-721");
    const a = compile().GH0STPassport;
    tx = await new ContractFactory(
      a.abi,
      a.evm.bytecode.object,
    ).getDeployTransaction(registry);
  } else if (stage === "access") {
    if (!c.passport || (await provider.getCode(c.passport)) === "0x")
      throw Error("Deploy and verify the passport before preparing access");
    const a = compile().GH0STAccess;
    tx = await new ContractFactory(
      a.abi,
      a.evm.bytecode.object,
    ).getDeployTransaction([
      c.passport,
      c.icpSigner,
      c.originGateway,
      c.modelId,
      c.artifactHash,
      c.quoteSigner ?? owner,
      c.treasury ?? owner,
      c.rewardPerRequestWei ?? "0",
      c.maxRewardsPerPassport ?? "0",
      c.maxRewardBudgetWei ?? "0",
    ]);
  } else if (stage === "registration") {
    if (!c.deployed)
      throw Error("Verify the BNB deployment before registering the service");
    const registry = getAddress(registryArg),
      probe = new Contract(
        registry,
        ["function register(string agentURI) returns(uint256)"],
        provider,
      );
    if ((await provider.getCode(registry)) === "0x")
      throw Error("ERC-8004 registry has no deployed code");
    tx = {
      to: registry,
      data: probe.interface.encodeFunctionData("register", [
        "https://gh0st.fyi/agents/agent-registration.json",
      ]),
      value: 0n,
    };
  } else if (stage === "authorize-relay") {
    const contract = new Contract(
      c.originGateway,
      [
        "function setRequester(address,bool)",
        "function owner() view returns(address)",
      ],
      provider,
    );
    if (getAddress(await contract.owner()) !== owner)
      throw Error(
        "Only the existing GH0ST gateway owner can authorize the relay",
      );
    tx = {
      to: c.originGateway,
      data: contract.interface.encodeFunctionData("setRequester", [
        getAddress(registryArg),
        true,
      ]),
      value: 0n,
    };
  } else {
    if (
      !c.deployed ||
      !/^\d+$/.test(registryArg ?? "") ||
      BigInt(registryArg) === 0n
    )
      throw Error("Provide the explicit reward funding amount in wei");
    tx = {
      to: c.access,
      data: new Contract(
        c.access,
        ["function fundRewards() payable"],
        provider,
      ).interface.encodeFunctionData("fundRewards"),
      value: BigInt(registryArg),
    };
  }
  const estimate = await provider.estimateGas({ ...tx, from: owner }),
    gas = (estimate * 120n + 99n) / 100n,
    fees = await provider.getFeeData(),
    cap = BigInt(chainId === 56 ? c.bnbMaxGasPriceWei : c.originMaxGasPriceWei);
  if (!fees.gasPrice || fees.gasPrice > cap)
    throw Error("Current gas price exceeds configured cap");
  console.log(
    stringify({
      stage,
      owner,
      chainId,
      maximumGasCostWei: gas * cap,
      transaction: {
        ...tx,
        from: owner,
        chainId,
        gasLimit: gas,
        nonce: await provider.getTransactionCount(owner, "pending"),
        ...(chainId === 56
          ? { type: 0, gasPrice: fees.gasPrice }
          : {
              type: 2,
              maxFeePerGas: cap,
              maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
            }),
      },
      broadcast: false,
    }),
  );
} finally {
  provider.destroy();
}
