import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Contract, ContractFactory, JsonRpcProvider, id, keccak256, toUtf8Bytes, verifyTypedData } from "ethers";
import { compile } from "./compile.mjs";
import { loadSources, swapSourceId } from "../worker/swaps.mjs";
import { resultTypes, json } from "../worker/protocol.mjs";
import { assertRhChain, confirmedReceipt, prepareUnsigned, receiptCost, requireAddress, requireHash, sameRuntime, RH_CHAIN_ID } from "./manual-rh-core.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const at = (file) => path.resolve(root, file);
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const options = new Set(["owner", "icp-signer", "manifest", "model-id", "artifact-hash", "fee-cap-gwei", "gas-limit-cap", "gateway", "journal", "source-id", "tx-hash", "confirmations", "out"]);

function argumentsFor(argv) {
  const [command, ...args] = argv;
  if (!["deploy", "verify", "register", "callback", "receipt"].includes(command))
    throw Error("Usage: node scripts/manual-rh.mjs <deploy|verify|register|callback|receipt> --option value (see MANUAL-RH.md)");
  const result = { command };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (!args[i]?.startsWith("--") || !options.has(key) || !args[i + 1] || args[i + 1].startsWith("--") || key in result)
      throw Error("Unknown, duplicate or missing command-line option");
    result[key] = args[i + 1];
  }
  return result;
}

function manifestFor(args) {
  const manifest = read(args.manifest ? path.resolve(args.manifest) : at("build/artifact-manifest.json"));
  if (manifest.schema !== "gh0st-icp-model-lock-v1" || !manifest.model?.id)
    throw Error("A completed artifact manifest is required");
  for (const [field, file] of [
    ["gateway_source_sha256", "contracts/GH0STInferenceGateway.sol"],
    ["coordinator_wasm_sha256", "build/coordinator.wasm"],
    ["model_wasm_sha256", "vendor/llama_cpp_canister/build/llama_cpp.wasm"],
  ]) {
    if (!/^[0-9a-f]{64}$/.test(manifest[field] ?? "") || sha(at(file)) !== manifest[field])
      throw Error(`Manifest does not match local ${field}`);
  }
  const identifiers = {
    modelId: id(manifest.model.id),
    artifactHash: keccak256(toUtf8Bytes(JSON.stringify(manifest))),
    modelWasmHash: "0x" + manifest.model_wasm_sha256,
  };
  if (args["model-id"] && requireHash(args["model-id"], "model ID") !== identifiers.modelId)
    throw Error("Explicit model ID differs from the manifest");
  if (args["artifact-hash"] && requireHash(args["artifact-hash"], "artifact hash") !== identifiers.artifactHash)
    throw Error("Explicit artifact hash differs from the manifest");
  return identifiers;
}

async function verifiedGateway(provider, address, artifact, owner, signer, identifiers) {
  const gateway = requireAddress(address, "gateway");
  if (!sameRuntime(artifact, await provider.getCode(gateway)))
    throw Error("Gateway runtime differs from the locally compiled contract");
  const contract = new Contract(gateway, artifact.abi, provider);
  const observed = await Promise.all([contract.owner(), contract.icpSigner(), contract.modelId(), contract.artifactHash()]);
  if (observed[0].toLowerCase() !== owner.toLowerCase() || observed[1].toLowerCase() !== signer.toLowerCase() || observed[2] !== identifiers.modelId || observed[3] !== identifiers.artifactHash)
    throw Error("Gateway owner, ICP signer or manifest binding differs");
  return contract;
}

export async function main(argv = process.argv.slice(2)) {
  const args = argumentsFor(argv);
  const rpc = process.env.RH_RPC_URL;
  if (!rpc) throw Error("Set RH_RPC_URL privately; it is never stored in output");
  const provider = new JsonRpcProvider(rpc, RH_CHAIN_ID, { staticNetwork: true });
  let report;
  try {
    await assertRhChain(provider);
    const receipt = args["tx-hash"]
      ? await confirmedReceipt(provider, args["tx-hash"], Number(args.confirmations ?? 12))
      : null;
    if (args.command === "receipt") {
      if (!receipt) throw Error("receipt requires --tx-hash");
      report = { operation: "confirmed-receipt", transactionHash: receipt.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, contractAddress: receipt.contractAddress, ...receiptCost(receipt) };
    } else {
      const owner = requireAddress(args.owner, "--owner");
      // Deliberately no default: use signer_address from the deployed coordinator.
      const signer = requireAddress(args["icp-signer"], "--icp-signer");
      const identifiers = manifestFor(args);
      const artifact = compile();
      const quote = (tx, nonce) => prepareUnsigned(provider, { owner, ...tx, nonce, feeCapGwei: args["fee-cap-gwei"], gasLimitCap: BigInt(args["gas-limit-cap"] ?? "5000000") });
      report = { operation: args.command, owner, icpSigner: signer, ...identifiers };
      if (args.command === "deploy") {
        const factory = new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object);
        const tx = await factory.getDeployTransaction(owner, signer, identifiers.modelId, identifiers.artifactHash);
        report.deployment = await quote({ data: tx.data });
        report.nextStep = "Sign deployment externally, then verify its receipt before preparing registration. Predicted address depends on the recorded nonce remaining unused.";
      } else {
        const gateway = args.gateway ?? receipt?.contractAddress;
        const contract = await verifiedGateway(provider, gateway, artifact, owner, signer, identifiers);
        report.gateway = await contract.getAddress();
        if (args.command === "verify") {
          if (!receipt || receipt.contractAddress?.toLowerCase() !== report.gateway.toLowerCase())
            throw Error("verify requires the deployment --tx-hash for this gateway");
          const tx = await provider.getTransaction(receipt.hash);
          const expected = await new ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object).getDeployTransaction(owner, signer, identifiers.modelId, identifiers.artifactHash);
          if (!tx || tx.from.toLowerCase() !== owner.toLowerCase() || tx.to != null || tx.data !== expected.data)
            throw Error("Deployment sender or creation calldata differs from the reviewed constructor");
          report.deployment = { transactionHash: receipt.hash, blockNumber: receipt.blockNumber, ...receiptCost(receipt), runtimeVerified: true };
        } else if (args.command === "register") {
          const pools = loadSources(read(at("swap-sources.json")), Number(RH_CHAIN_ID));
          const nonce = await provider.getTransactionCount(owner, "pending");
          report.registrations = [];
          for (const pool of pools) {
            const key = keccak256(contract.interface.getAbiCoder().encode(["address", "bytes32"], [pool.manager, pool.pool_id]));
            if (await contract.authorizedSwapPool(key)) continue;
            const tx = await contract.setSwapPool.populateTransaction(pool.manager, pool.pool_id, true);
            report.registrations.push({ manager: pool.manager, poolId: pool.pool_id, ...(await quote(tx, nonce + report.registrations.length)) });
          }
          const total = report.registrations.reduce((sum, tx) => sum + tx.cost.maxCostWei, 0n);
          if (total > await provider.getBalance(owner)) throw Error("Owner cannot fund the complete registration batch");
          report.maximumBatchCostWei = total;
        } else {
          if (!args.journal) throw Error("callback requires --journal");
          const sourceId = requireHash(args["source-id"], "--source-id");
          const journal = read(path.resolve(args.journal));
          if (String(journal.binding?.chainId) !== String(RH_CHAIN_ID) || journal.binding?.gateway?.toLowerCase() !== report.gateway.toLowerCase())
            throw Error("Journal is bound to another chain or gateway");
          const item = journal.requests?.find((item) => item.id.toLowerCase() === sourceId);
          if (item?.kind !== "swap" || !item.source || !item.result) throw Error("Journal has no signed swap result for this source ID");
          const signed = item.result;
          if (swapSourceId(Number(RH_CHAIN_ID), item.source) !== sourceId || signed.result.requestId !== sourceId)
            throw Error("Journal swap source differs from its signed result");
          if (signed.result.modelId !== identifiers.modelId || signed.result.artifactHash !== identifiers.artifactHash || keccak256(toUtf8Bytes(signed.answer)) !== signed.result.answerHash)
            throw Error("Signed result differs from the manifest or exact answer");
          const domain = { name: "GH0ST ICP Inference", version: "1", chainId: RH_CHAIN_ID, verifyingContract: report.gateway };
          if (verifyTypedData(domain, resultTypes, signed.result, signed.signature).toLowerCase() !== signer.toLowerCase())
            throw Error("Result signature is not the pinned ICP signer");
          if (Number((await contract.requests(sourceId)).status) !== 0) throw Error("Swap result is already recorded or has conflicting state");
          const source = { manager: item.source.manager, poolId: item.source.pool_id, transactionHash: item.source.transaction_hash, logIndex: item.source.log_index };
          const tx = await contract.fulfillSwapInference.populateTransaction(source, signed.result, signed.answer, signed.signature);
          report.callback = { sourceId, answer: signed.answer, answerHash: signed.result.answerHash, ...(await quote(tx)) };
        }
      }
    }
    report = { schema: "gh0st-manual-rh-v1", preparedAt: new Date().toISOString(), chainId: String(RH_CHAIN_ID), broadcast: false, ...report };
    const output = path.resolve(args.out ?? at(`build/manual-rh/${args.command}-${Date.now()}.json`));
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, json(report) + "\n", { mode: 0o600, flag: "wx" });
    console.log(json({ output, operation: report.operation, broadcast: false, gateway: report.gateway ?? report.deployment?.predictedGateway, modelId: report.modelId, artifactHash: report.artifactHash }));
    return report;
  } finally {
    provider.destroy();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    let message = String(error.message ?? error);
    if (process.env.RH_RPC_URL) message = message.split(process.env.RH_RPC_URL).join("[private RH RPC]");
    console.error(message.replace(/\/v2\/[^\s"'?]+/g, "/v2/[redacted]"));
    process.exitCode = 1;
  });
}
