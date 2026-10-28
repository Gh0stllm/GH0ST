import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { Principal } from "@icp-sdk/core/principal";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { id, keccak256, toUtf8Bytes } from "ethers";

const [modelCanister, output = "build/coordinator-init.did"] = process.argv.slice(2);
if (!modelCanister) throw Error("Usage: node scripts/prepare-coordinator.mjs ACTUAL_MODEL_CANISTER [OUTPUT_FILE]");
Principal.fromText(modelCanister);
const manifest = JSON.parse(fs.readFileSync("build/artifact-manifest.json","utf8"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (sha("build/coordinator.wasm") !== manifest.coordinator_wasm_sha256 ||
    sha("vendor/llama_cpp_canister/build/llama_cpp.wasm") !== manifest.model_wasm_sha256)
  throw Error("Rebuild artifact manifest after changing binaries");
const pools = execFileSync(process.execPath,["scripts/swap-sources-candid.mjs"],{encoding:"utf8"}).trim();
if (!process.env.ICP_IDENTITY_FILE) throw Error("Set ICP_IDENTITY_FILE to the private worker identity path");
const worker = Ed25519KeyIdentity.fromJSON(fs.readFileSync(process.env.ICP_IDENTITY_FILE,"utf8")).getPrincipal().toText();
const text = `(record {
  worker = principal ${JSON.stringify(worker)};
  model_canister = principal ${JSON.stringify(modelCanister)};
  model_id = ${JSON.stringify(id(manifest.model.id))};
  artifact_hash = ${JSON.stringify(keccak256(toUtf8Bytes(JSON.stringify(manifest))))};
  model_wasm_hash = ${JSON.stringify("0x"+manifest.model_wasm_sha256)};
  chain_id = 4663 : nat64;
  gateway = "0x0000000000000000000000000000000000000000";
  rpc_urls = vec { "https://rpc.mainnet.chain.robinhood.com"; "https://robinhood-rpc.publicnode.com" };
  confirmations = 12 : nat64;
  model_cycle_budget = ${manifest.limits.model_cycle_budget} : nat;
  ecdsa_key_name = "key_1";
  swap_sources = ${pools};
})\n`;
fs.writeFileSync(output,text,{mode:0o600});
console.log(`Prepared coordinator initialization for model ${modelCanister}: ${output}`);
