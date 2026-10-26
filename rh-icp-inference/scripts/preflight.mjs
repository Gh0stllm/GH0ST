import fs from "node:fs";
import { JsonRpcProvider } from "ethers";
import { compile } from "./compile.mjs";
import { json } from "../worker/protocol.mjs";
const lock = JSON.parse(
  fs.readFileSync(new URL("../model-lock.json", import.meta.url)),
);
const bytecode = compile().evm.deployedBytecode.object;
const wasm = new URL("../build/coordinator.wasm", import.meta.url);
const local = {
  gatewayRuntimeBytes: bytecode.length / 2,
  coordinatorWasmBuilt: fs.existsSync(wasm),
  modelRevision: lock.model.revision,
  modelSha256: lock.model.sha256,
  liveCanistersVerified: false,
};
if (process.env.RH_RPC_URL) {
  const p = new JsonRpcProvider(process.env.RH_RPC_URL);
  local.rpcChainId = (await p.getNetwork()).chainId.toString();
  if (local.rpcChainId !== String(process.env.RH_CHAIN_ID ?? 4663))
    throw Error("RH chain ID mismatch");
  p.destroy();
}
console.log(json(local));
