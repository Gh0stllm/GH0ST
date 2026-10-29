import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Contract, keccak256 } from "ethers";
import { validateConfig, stringify, same } from "../worker/core.mjs";
import {
  originAbi,
  accessAbi,
  passportAbi,
} from "../../website/agents/protocol.mjs";
export async function preflight(c) {
  validateConfig(c);
  const bnb = new JsonRpcProvider(c.rpcUrl),
    rh = new JsonRpcProvider(c.originRpcUrl);
  try {
    const [bc, rc] = await Promise.all([
      bnb.send("eth_chainId", []),
      rh.send("eth_chainId", []),
    ]);
    if (BigInt(bc) !== 56n || BigInt(rc) !== 4663n) throw Error("Wrong chain");
    const origin = new Contract(c.originGateway, originAbi, rh),
      live = {
        icpSigner: await origin.icpSigner(),
        modelId: await origin.modelId(),
        artifactHash: await origin.artifactHash(),
      };
    for (const key of Object.keys(live))
      if (!same(live[key], c[key])) throw Error(`Pinned origin ${key} changed`);
    const result = {
      checkedAt: new Date().toISOString(),
      chainId: 56,
      originChainId: 4663,
      originGateway: c.originGateway,
      ...live,
      deployed: c.deployed,
    };
    if (c.agentRegistry) {
      const registry = new Contract(
          c.agentRegistry,
          [
            "function name() view returns(string)",
            "function supportsInterface(bytes4) view returns(bool)",
          ],
          bnb,
        ),
        code = await bnb.getCode(c.agentRegistry);
      if (code === "0x" || !(await registry.supportsInterface("0x80ac58cd")))
        throw Error("Agent registry is not ERC-721");
      result.agentRegistry = {
        address: c.agentRegistry,
        name: await registry.name(),
        runtimeCodeHash: keccak256(code),
      };
    }
    if (c.deployed) {
      const a = new Contract(c.access, accessAbi, bnb),
        p = new Contract(c.passport, passportAbi, bnb);
      for (const [key, expected] of [
        ["passport", c.passport],
        ["rhGateway", c.originGateway],
        ...Object.entries(live),
      ])
        if (!same(await a[key](), expected)) throw Error(`BNB ${key} mismatch`);
      if (!same(await p.agentRegistry(), c.agentRegistry))
        throw Error("Passport uses another registry");
      result.accessCodeHash = keccak256(await bnb.getCode(c.access));
      result.passportCodeHash = keccak256(await bnb.getCode(c.passport));
      result.paused = await a.paused();
    }
    return result;
  } finally {
    bnb.destroy();
    rh.destroy();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(
    fs.readFileSync(
      process.argv[2] ?? new URL("../config.example.json", import.meta.url),
      "utf8",
    ),
  );
  if (process.argv[3]) config.agentRegistry = process.argv[3];
  console.log(stringify(await preflight(config)));
}
