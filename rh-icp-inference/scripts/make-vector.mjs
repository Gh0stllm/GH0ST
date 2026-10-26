// Public deterministic TEST KEY; this does not access or represent a live wallet.
import fs from "node:fs";
import {
  Wallet,
  id,
  keccak256,
  toUtf8Bytes,
  Interface,
  TypedDataEncoder,
} from "ethers";
import { compile } from "./compile.mjs";
import { envelope, resultTypes } from "../worker/protocol.mjs";
const wallet = new Wallet("0x" + "07".repeat(32));
const config = {
  worker: "aaaaa-aa",
  model_canister: "aaaaa-aa",
  model_id: id("qwen3-0.6b-q8_0"),
  artifact_hash: id("fixture-manifest"),
  model_wasm_hash: id("fixture-wasm"),
  chain_id: 4663,
  gateway: "0x1111111111111111111111111111111111111111",
  rpc_urls: ["https://one.example", "https://two.example"],
  confirmations: 12,
  model_cycle_budget: 400000000000,
  ecdsa_key_name: "key_1",
};
const request = {
  id: id("request-fixture"),
  requester: "0x2222222222222222222222222222222222222222",
  model_id: config.model_id,
  prompt: "Hello GH0ST",
  prompt_hash: keccak256(toUtf8Bytes("Hello GH0ST")),
  max_tokens: 50,
  deadline: 2000000000,
  tx_hash: id("request-tx"),
  log_index: 7,
  block_number: 100,
  block_hash: id("block"),
};
const job = {
  request,
  phase: { Complete: null },
  busy: false,
  answer: "Hello from ICP.",
  input_tokens: 10,
  output_tokens: 4,
  model_cycles_before: 1000000000000,
  model_cycles: 236000000000,
  chunks: 3,
  prompt_ingested: true,
  signature: [],
  digest: "",
  signer: wallet.address,
  error: "",
};
const { domain, value } = envelope(config, job);
job.digest = TypedDataEncoder.hash(domain, resultTypes, value);
job.signature = [
  ...Buffer.from(
    (await wallet.signTypedData(domain, resultTypes, value)).slice(2),
    "hex",
  ),
];
const iface = new Interface(compile().abi);
const event = iface.encodeEventLog(iface.getEvent("InferenceRequested"), [
  request.id,
  request.requester,
  request.model_id,
  request.prompt_hash,
  request.max_tokens,
  request.deadline,
  request.prompt,
]);
const receipt = {
  status: "0x1",
  transactionHash: request.tx_hash,
  blockNumber: "0x64",
  blockHash: request.block_hash,
  logs: [
    {
      address: config.gateway,
      topics: event.topics,
      data: event.data,
      logIndex: "0x7",
      removed: false,
    },
  ],
};
const output = {
  config,
  job,
  receipt,
  signer: wallet.address,
  public_key: wallet.signingKey.compressedPublicKey,
};
fs.mkdirSync(new URL("../tests/fixtures/", import.meta.url), {
  recursive: true,
});
fs.writeFileSync(
  new URL("../tests/fixtures/bridge-vector.json", import.meta.url),
  JSON.stringify(output, null, 2) + "\n",
);
