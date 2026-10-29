import crypto from "node:crypto";
import {
  getAddress,
  keccak256,
  toUtf8Bytes,
  TypedDataEncoder,
  verifyTypedData,
} from "ethers";
import {
  quoteDomain,
  quoteTypes,
  resultDomain,
  resultTypes,
  transportPrompt,
} from "../../website/agents/protocol.mjs";

export const stringify = (value) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
export const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
export function validateConfig(c) {
  if (c.chainId !== 56 || c.originChainId !== 4663)
    throw Error("This layer must use BNB 56 over GH0ST on Robinhood 4663");
  for (const key of ["originGateway", "icpSigner"])
    if (BigInt(getAddress(c[key])) === 0n) throw Error(`Invalid ${key}`);
  for (const key of ["modelId", "artifactHash"])
    if (!/^0x[0-9a-f]{64}$/i.test(c[key] ?? "") || BigInt(c[key]) === 0n)
      throw Error(`Invalid ${key}`);
  for (const key of ["rpcUrl", "originRpcUrl"]) {
    const u = new URL(c[key]);
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )
    )
      throw Error(`Invalid ${key}`);
  }
  for (const key of ["confirmations", "originConfirmations"])
    if (!Number.isSafeInteger(c[key]) || c[key] < 1)
      throw Error(`Invalid ${key}`);
  for (const key of [
    "computeBaseWei",
    "inputByteWei",
    "outputTokenWei",
    "bnbMaxGasPriceWei",
    "originMaxGasPriceWei",
    "callbackGasLimit",
    "originGasLimit",
    "originCostsBnbWei",
  ])
    if (!/^[1-9]\d*$/.test(c[key] ?? ""))
      throw Error(`Positive ${key} is required`);
  if (
    !Number.isSafeInteger(c.quoteSeconds) ||
    c.quoteSeconds < 30 ||
    c.quoteSeconds > 300 ||
    !Number.isSafeInteger(c.requestSeconds) ||
    c.requestSeconds < 600 ||
    c.requestSeconds > 86400
  )
    throw Error("Invalid quote or request lifetime");
  if (
    !Number.isSafeInteger(c.maxPendingRequests) ||
    c.maxPendingRequests < 1 ||
    c.maxPendingRequests > 100
  )
    throw Error("Invalid admission limit");
  if (c.deployed) {
    for (const key of ["access", "passport", "agentRegistry"])
      if (BigInt(getAddress(c[key])) === 0n) throw Error(`Invalid ${key}`);
    if (!Number.isSafeInteger(c.deploymentBlock) || c.deploymentBlock < 0)
      throw Error("Missing deployment block");
  }
  return c;
}
export function pricedFee(c, prompt, maxTokens) {
  if (
    typeof prompt !== "string" ||
    ["<|im_start|>", "<|im_end|>", "<|endoftext|>"].some((x) =>
      prompt.includes(x),
    )
  )
    throw Error("Reserved model delimiter in prompt");
  const inputBytes = toUtf8Bytes(prompt).length;
  if (
    inputBytes === 0 ||
    inputBytes > 3400 ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > 128
  )
    throw Error("Prompt must be 1–3400 UTF-8 bytes and output 1–128 tokens");
  const compute =
    BigInt(c.computeBaseWei) +
    BigInt(c.inputByteWei) * BigInt(inputBytes) +
    BigInt(c.outputTokenWei) * BigInt(maxTokens);
  const bnbCallback = BigInt(c.bnbMaxGasPriceWei) * BigInt(c.callbackGasLimit);
  const origin = BigInt(c.originCostsBnbWei);
  return {
    inputBytes,
    compute,
    bnbCallback,
    origin,
    total: compute + bnbCallback + origin,
  };
}
export async function signQuote(
  c,
  signer,
  { requester, passportId, prompt, maxTokens },
  chainTime,
) {
  const breakdown = pricedFee(c, prompt, maxTokens);
  const quote = {
    requester: getAddress(requester),
    passportId: BigInt(passportId),
    promptHash: keccak256(toUtf8Bytes(prompt)),
    maxTokens,
    fee: breakdown.total,
    validUntil: chainTime + c.quoteSeconds,
    deadline: chainTime + c.requestSeconds,
    nonce: "0x" + crypto.randomBytes(32).toString("hex"),
  };
  const domain = quoteDomain(c.access),
    signature = await signer.signTypedData(domain, quoteTypes, quote);
  return {
    quote,
    signature,
    requestId: TypedDataEncoder.hash(domain, quoteTypes, quote),
    breakdown,
  };
}
export function validateOriginJob(c, item, job) {
  if (!job || !("Complete" in job.phase) || job.busy)
    throw Error("Origin inference is not complete");
  const expected = transportPrompt(c.access, item.id, item.prompt);
  if (
    job.request.prompt !== expected ||
    !same(job.request.id, item.originId) ||
    !same(job.request.prompt_hash, keccak256(toUtf8Bytes(expected))) ||
    BigInt(job.request.max_tokens) !== BigInt(item.maxTokens)
  )
    throw Error("Origin job does not match the BNB request");
  if (
    !job.answer ||
    toUtf8Bytes(job.answer).length > 8192 ||
    BigInt(job.output_tokens) < 1n ||
    BigInt(job.output_tokens) > BigInt(item.maxTokens)
  )
    throw Error("Origin answer is outside request bounds");
  const result = {
    requestId: job.request.id,
    promptHash: job.request.prompt_hash,
    modelId: c.modelId,
    artifactHash: c.artifactHash,
    answerHash: keccak256(toUtf8Bytes(job.answer)),
    inputTokens: job.input_tokens,
    outputTokens: job.output_tokens,
    modelCycles: job.model_cycles,
  };
  const signature = "0x" + Buffer.from(job.signature).toString("hex"),
    domain = resultDomain(c.originGateway);
  if (
    !same(TypedDataEncoder.hash(domain, resultTypes, result), job.digest) ||
    !same(verifyTypedData(domain, resultTypes, result, signature), c.icpSigner)
  )
    throw Error("Origin signature differs from the pinned GH0ST deployment");
  return { result, answer: job.answer, signature };
}
export function fingerprint(job) {
  return job
    ? stringify({
        phase: job.phase,
        busy: job.busy,
        chunks: String(job.chunks),
        tokens: String(job.output_tokens),
        signature: job.signature.length,
      })
    : "missing";
}
export async function canonicalReceipt(provider, hash, confirmations) {
  const r = await provider.getTransactionReceipt(hash);
  if (!r) return null;
  if (Number(r.status) !== 1) throw Error(`Transaction reverted: ${hash}`);
  const block = await provider.getBlock(r.blockNumber);
  if (!block || !same(block.hash, r.blockHash))
    throw Error("Noncanonical receipt; reconciliation required");
  if ((await provider.getBlockNumber()) - r.blockNumber < confirmations)
    return null;
  return r;
}
