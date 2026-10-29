import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Contract, getAddress, keccak256 } from "ethers";
import { readProvider } from "./read-provider.mjs";
export function validateBridgeConfig(c) {
  if (
    c.robinhood.chainId !== 4663 ||
    c.bnb.chainId !== 56 ||
    c.robinhood.selector !== "6180753054346818345" ||
    c.bnb.selector !== "11344663589394136015"
  )
    throw Error("Bridge must connect the reviewed Robinhood/BNB selectors");
  if (
    BigInt(c.maxTransfer) <= 0n ||
    BigInt(c.maxTransfer) > BigInt(c.supplyCap) ||
    c.decimals !== 18
  )
    throw Error("Invalid bridge amount limits");
  if (
    BigInt(getAddress(c.owner)) === 0n ||
    BigInt(getAddress(c.nativeToken)) === 0n
  )
    throw Error("Zero owner or token");
  for (const key of ["robinhood", "bnb"]) getAddress(c[key].router);
  return c;
}
export async function bridgePreflight(c) {
  validateBridgeConfig(c);
  const report = {
    checkedAt: new Date().toISOString(),
    chains: {},
    broadcast: false,
  };
  await Promise.all(
    [
      ["robinhood", "bnb"],
      ["bnb", "robinhood"],
    ].map(async ([key, remoteKey]) => {
      const config = c[key],
        provider = readProvider(config.rpcUrl, config.chainId);
      try {
        const router = new Contract(
          config.router,
          ["function isChainSupported(uint64) view returns(bool)"],
          provider,
        );
        const [chainId, code, laneSupported] = await Promise.all([
          provider.send("eth_chainId", []),
          provider.getCode(config.router),
          router.isChainSupported(c[remoteKey].selector),
        ]);
        if (BigInt(chainId) !== BigInt(config.chainId))
          throw Error("RPC chain mismatch");
        if (code === "0x") throw Error("CCIP router is not deployed");
        if (!laneSupported) throw Error("Direct CCIP lane is unavailable");
        report.chains[key] = {
          chainId: config.chainId,
          router: getAddress(config.router),
          routerCodeHash: keccak256(code),
          remoteSelector: c[remoteKey].selector,
          laneSupported: true,
        };
        if (key === "robinhood") {
          const token = new Contract(
            c.nativeToken,
            [
              "function name() view returns(string)",
              "function symbol() view returns(string)",
              "function decimals() view returns(uint8)",
              "function totalSupply() view returns(uint256)",
            ],
            provider,
          );
          const [code, name, symbol, decimals, totalSupply] = await Promise.all(
            [
              provider.getCode(c.nativeToken),
              token.name(),
              token.symbol(),
              token.decimals(),
              token.totalSupply(),
            ],
          );
          if (keccak256(code) !== c.nativeTokenCodeHash)
            throw Error("Original GH0ST bytecode changed");
          if (symbol !== "GH0ST" || decimals !== 18n)
            throw Error("Wrong source token");
          report.originalToken = {
            address: getAddress(c.nativeToken),
            name,
            symbol: "GH0ST",
            decimals: 18,
            totalSupply: String(totalSupply),
            codeHash: keccak256(code),
          };
        }
        if (c.deployed) {
          if (!config.bridge || !c[remoteKey].bridge)
            throw Error("Both confirmed bridge addresses are required");
          const bridge = new Contract(
            config.bridge,
            [
              "function localSelector() view returns(uint64)",
              "function remoteSelector() view returns(uint64)",
              "function nativeToken() view returns(address)",
              "function peer() view returns(address)",
              "function getRouter() view returns(address)",
              "function paused() view returns(bool)",
              "function owner() view returns(address)",
            ],
            provider,
          );
          const [
            local,
            remote,
            native,
            routerAddress,
            owner,
            peer,
            paused,
            bridgeCode,
          ] = await Promise.all([
            bridge.localSelector(),
            bridge.remoteSelector(),
            bridge.nativeToken(),
            bridge.getRouter(),
            bridge.owner(),
            bridge.peer(),
            bridge.paused(),
            provider.getCode(config.bridge),
          ]);
          if (
            local !== BigInt(config.selector) ||
            remote !== BigInt(c[remoteKey].selector) ||
            getAddress(native) !== getAddress(c.nativeToken) ||
            getAddress(routerAddress) !== getAddress(config.router) ||
            getAddress(owner) !== getAddress(c.owner)
          )
            throw Error("Deployed bridge does not match configuration");
          if (
            BigInt(peer) !== 0n &&
            getAddress(peer) !== getAddress(c[remoteKey].bridge)
          )
            throw Error("Bridge peer differs; do not activate");
          report.chains[key].bridge = {
            address: config.bridge,
            peer,
            paused,
            codeHash: keccak256(bridgeCode),
          };
        }
      } finally {
        provider.destroy();
      }
    }),
  );
  return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(
      await bridgePreflight(
        JSON.parse(
          fs.readFileSync(
            process.argv[2] ??
              new URL("../bridge.config.example.json", import.meta.url),
          ),
        ),
      ),
      null,
      2,
    ),
  );
