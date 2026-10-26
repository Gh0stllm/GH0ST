import fs from "node:fs";
import crypto from "node:crypto";
import { keccak256, toUtf8Bytes, id } from "ethers";
const lock = JSON.parse(
  fs.readFileSync(new URL("../model-lock.json", import.meta.url)),
);
const shaFile = async (file) => {
  const hash = crypto.createHash("sha256");
  for await (const b of fs.createReadStream(file)) hash.update(b);
  return hash.digest("hex");
};
const modelFile = process.env.MODEL_FILE ?? "models/" + lock.model.filename;
if (
  fs.statSync(modelFile).size !== lock.model.bytes ||
  (await shaFile(modelFile)) !== lock.model.sha256
)
  throw Error("GGUF differs from pinned Qwen artifact");
const manifest = {
  ...lock,
  model_wasm_sha256: await shaFile(
    "vendor/llama_cpp_canister/build/llama_cpp.wasm",
  ),
  coordinator_wasm_sha256: await shaFile("build/coordinator.wasm"),
  gateway_source_sha256: await shaFile("contracts/GH0STInferenceGateway.sol"),
};
delete manifest.status;
const content = JSON.stringify(manifest);
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/artifact-manifest.json", content + "\n");
console.log(
  JSON.stringify(
    {
      modelId: id("qwen3-0.6b-q8_0"),
      artifactHash: keccak256(toUtf8Bytes(content)),
      modelWasmHash: "0x" + manifest.model_wasm_sha256,
    },
    null,
    2,
  ),
);
