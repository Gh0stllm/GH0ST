import {
  TypedDataEncoder,
  keccak256,
  toUtf8Bytes,
  verifyTypedData,
} from "ethers";

export const resultTypes = {
  InferenceResult: [
    ["requestId", "bytes32"],
    ["promptHash", "bytes32"],
    ["modelId", "bytes32"],
    ["artifactHash", "bytes32"],
    ["answerHash", "bytes32"],
    ["inputTokens", "uint64"],
    ["outputTokens", "uint64"],
    ["modelCycles", "uint128"],
  ].map(([name, type]) => ({ name, type })),
};

export function envelope(config, job) {
  return {
    domain: {
      name: "GH0ST ICP Inference",
      version: "1",
      chainId: config.chain_id,
      verifyingContract: config.gateway,
    },
    value: {
      requestId: job.request.id,
      promptHash: job.request.prompt_hash,
      modelId: config.model_id,
      artifactHash: config.artifact_hash,
      answerHash: keccak256(toUtf8Bytes(job.answer)),
      inputTokens: job.input_tokens,
      outputTokens: job.output_tokens,
      modelCycles: job.model_cycles,
    },
  };
}
export function validateJob(config, job, expectedSigner) {
  if (!("Complete" in job.phase)) throw Error("Job has not completed");
  const { domain, value } = envelope(config, job);
  const sig = "0x" + Buffer.from(job.signature).toString("hex");
  if (TypedDataEncoder.hash(domain, resultTypes, value) !== job.digest)
    throw Error("Canister and client digests differ");
  if (
    verifyTypedData(domain, resultTypes, value, sig).toLowerCase() !==
    expectedSigner.toLowerCase()
  )
    throw Error("Wrong ICP signer");
  if (
    value.promptHash !== keccak256(toUtf8Bytes(job.request.prompt)) ||
    BigInt(value.outputTokens) > BigInt(job.request.max_tokens)
  )
    throw Error("Prompt/token binding failed");
  return { result: value, answer: job.answer, signature: sig };
}
export function json(value) {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}
