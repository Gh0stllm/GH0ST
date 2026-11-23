import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";

const routes = ["https://rpc.gh0st.fyi/", "https://gh0st.fyi/gl3/rpc"];
const genesisHash = "0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483";
const chainId = "0x4726d9";
const arbGasInfo = "0x000000000000000000000000000000000000006c";
const maxGas = "0x1000000";
const readMethods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_estimateGas"]);
const hashBytes = (bytes) => "0x" + createHash("sha256").update(bytes).digest("hex");
const quantity = (amount) => "0x" + amount.toString(16);
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const isAddress = (value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const isBytes = (value) => typeof value === "string" && /^0x(?:[0-9a-f]{2})+$/i.test(value);
const hexBytes = (value) => Buffer.from(value.slice(2), "hex");
const fee = (wei) => {
  const scale = 10n ** 18n;
  return (wei / scale).toString() + "." + (wei % scale).toString().padStart(18, "0").replace(/0+$/, "").padEnd(1, "0");
};

let requestId = 0;
async function rpc(url, method, params = []) {
  assert(readMethods.has(method), "Read-only methods only");
  const id = ++requestId;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(18_000),
      });
      if (!response.ok) {
        throw Object.assign(new Error(method + " HTTP " + response.status), {
          retryable: [429, 502, 503, 504].includes(response.status),
        });
      }
      const reply = await response.json();
      assert(reply.jsonrpc === "2.0" && reply.id === id, "RPC response does not match request");
      if (reply.error) throw new Error(method + " RPC " + reply.error.code + " " + reply.error.message);
      assert(Object.hasOwn(reply, "result"), "No RPC result");
      return reply.result;
    } catch (error) {
      const networkError = error.name === "TimeoutError" || error.message === "fetch failed";
      if (attempt === 2 || !(error.retryable || networkError)) throw new Error(url + " " + error.message, { cause: error });
      await pause(300 * (attempt + 1));
    }
  }
}

async function pinBlock() {
  const readings = await Promise.all(routes.map(async (url) => {
    const [id, genesis, latest] = await Promise.all([
      rpc(url, "eth_chainId"), rpc(url, "eth_getBlockByNumber", ["0x0", false]),
      rpc(url, "eth_getBlockByNumber", ["latest", false]),
    ]);
    assert(id === chainId && genesis.hash === genesisHash, "Wrong GL3 chain or genesis");
    return BigInt(latest.number);
  }));
  const block = quantity(readings.reduce((low, height) => height < low ? height : low));
  const [primary, alternate] = await Promise.all(routes.map(url => rpc(url, "eth_getBlockByNumber", [block, false])));
  assert(primary.hash === alternate.hash && primary.baseFeePerGas === alternate.baseFeePerGas, "GL3 RPCs disagree on pinned block");
  return primary;
}

function getOverrides(artifact) {
  assert(isAddress(artifact.generator) && isBytes(artifact.code), "Missing generator address or runtime");
  assert(Array.isArray(artifact.shards) && artifact.shards.length > 0, "Missing weight shards");
  const entries = [{ address: artifact.generator, code: artifact.code }, ...artifact.shards];
  assert(entries.every(({ address, code }) => isAddress(address) && BigInt(address) > 0xffffn && isBytes(code)),
    "Invalid or reserved state-override address");
  const overrides = {};
  for (const { address, code } of entries) {
    const key = address.toLowerCase();
    assert(!Object.hasOwn(overrides, key), "Duplicate state-override address");
    overrides[key] = { code };
  }
  return overrides;
}

function verifyModelDigest(artifact, golden) {
  assert(/^[0-9a-f]{64}$/.test(artifact.modelSHA256) && golden.modelSHA256 === artifact.modelSHA256,
    "Weights and vectors refer to different fitted models");
  assert(artifact.shards.every(({ code }) => code.startsWith("0x00")), "Weight shard is missing the STOP prefix");
  const weights = Buffer.concat(artifact.shards.map(({ code }) => Buffer.from(code.slice(4), "hex")));
  assert(hashBytes(weights) === "0x" + artifact.modelSHA256, "Override shards do not hold the exact fitted model");
}

function getVectors(golden, sampleLimit) {
  const source = Array.isArray(golden) ? golden : golden.vectors;
  assert(Array.isArray(source) && source.length > 0, "Missing golden vectors");
  const vectors = source.map((vector) => {
    const seed = vector.seed.startsWith("0x") ? vector.seed : "0x" + vector.seed;
    const source = vector.packed ?? vector.packedHex ?? vector.bitmap ?? vector.pixels;
    const packed = source.startsWith("0x") ? source : "0x" + source;
    assert(/^0x[0-9a-f]{32}$/i.test(seed) && /^0x[0-9a-f]{512}$/i.test(packed), "Wrong seed or packed image length");
    assert(Number.isInteger(vector.style) && vector.style >= 0 && vector.style <= 255, "Invalid style byte");
    assert(Number.isInteger(vector.subject) && vector.subject >= 0 && vector.subject < 12, "Invalid subject");
    return { seed, subject: vector.subject, style: vector.style, packed: packed.toLowerCase(), imageHash: vector.imageHash };
  });
  const bySubject = Array.from({ length: 12 }, (_, subject) => vectors.filter(vector => vector.subject === subject));
  assert(bySubject.every(choices => choices.length > 0), "Expected at least one reference image per subject");
  const count = Math.min(sampleLimit, bySubject.length);
  const gasSubjects = Array.from({ length: count }, (_, index) => (
    count === 1 ? 0 : Math.floor(index * (bySubject.length - 1) / (count - 1))
  ));
  return bySubject.map((choices, subject) => {
    const sampleIndex = gasSubjects.indexOf(subject);
    const fixture = choices[(sampleIndex < 0 ? subject : sampleIndex) % choices.length];
    return { ...fixture, measureGas: sampleIndex >= 0 };
  });
}

function encodeGenerator(selector, vector) {
  const seedWord = vector.seed.slice(2).padEnd(64, "0");
  return "0x" + selector + seedWord + word(vector.subject) + word(vector.style);
}

function decodeImage(result) {
  assert(isBytes(result) && result.length === 2 + 128 + 512, "Malformed generated image result");
  assert(BigInt("0x" + result.slice(2, 66)) === 32n && BigInt("0x" + result.slice(66, 130)) === 256n,
    "Unexpected generated image layout");
  return "0x" + result.slice(130).toLowerCase();
}

async function estimate(url, call, block, overrides) {
  const total = BigInt(await rpc(url, "eth_estimateGas", [call, block.number, overrides]));
  // Use direct estimates because NodeInterface's nested estimate may omit the
  // outer call's code overrides. Both of these calls execute the supplied code.
  const executionOnly = BigInt(await rpc(url, "eth_estimateGas", [
    { ...call, skipL1Charging: true }, block.number, overrides,
  ]));
  assert(total > 0n && total <= BigInt(maxGas) && executionOnly > 0n && executionOnly <= BigInt(maxGas),
    "Invalid transaction gas estimate");
  return {
    estimatedGas: Number(total),
    executionOnlyEstimateGas: Number(executionOnly),
    estimatedFeeGH0ST: fee(total * BigInt(block.baseFeePerGas)),
  };
}

async function verifyRoute(url, artifact, block, overrides, vectors) {
  const existing = await Promise.all(Object.keys(overrides).map(address => rpc(url, "eth_getCode", [address, block.number])));
  assert(existing.every(code => code === "0x"), "Test addresses already have deployed code on GL3");
  const parentPrice = await rpc(url, "eth_call", [{ to: arbGasInfo, data: "0xf5d6ded7" }, block.number]);
  const samples = [];
  for (const vector of vectors) {
    const generate = encodeGenerator("0565a8f8", vector);
    const record = encodeGenerator("192cab41", vector);
    const readCall = { to: artifact.generator, data: generate, gas: maxGas };
    const recordCall = { to: artifact.generator, data: record, gas: maxGas };
    const returned = await rpc(url, "eth_call", [readCall, block.number, overrides]);
    assert(decodeImage(returned) === vector.packed, "Generated pixels differ from the integer model");
    const resultHash = await rpc(url, "eth_call", [recordCall, block.number, overrides]);
    assert(/^0x[0-9a-f]{64}$/i.test(resultHash), "Record must return a 32-byte image hash");
    if (vector.imageHash) assert(resultHash.toLowerCase() === vector.imageHash.toLowerCase(), "Image hash differs from the reference");
    const sample = {
      seed: vector.seed,
      subject: vector.subject,
      style: vector.style,
      pixelsSHA256: hashBytes(hexBytes(vector.packed)),
      pixelsMatched: true,
      recordHash: resultHash,
    };
    if (vector.measureGas) {
      sample.generateGas = await estimate(url, readCall, block, overrides);
      sample.recordGas = await estimate(url, recordCall, block, overrides);
    }
    samples.push(sample);
  }

  const deployEstimates = [];
  for (const entry of artifact.deployment ?? []) {
    const { id, initCode, usesShards } = entry;
    assert(typeof id === "string" && isBytes(initCode), "Invalid deployment init code");
    const dependencyOverrides = Object.fromEntries(Object.entries(overrides)
      .filter(([address]) => usesShards && address !== artifact.generator.toLowerCase()));
    const estimated = BigInt(await rpc(url, "eth_estimateGas", [
      { data: initCode, gas: maxGas }, block.number, dependencyOverrides,
    ]));
    assert(estimated > 0n && estimated <= BigInt(maxGas), "Invalid deployment estimate");
    deployEstimates.push({
      id, initCodeBytes: hexBytes(initCode).length,
      estimatedGas: Number(estimated), estimatedFeeGH0ST: fee(estimated * BigInt(block.baseFeePerGas)),
    });
  }
  return { url, parentPricePerCompressedByteGH0ST: fee(16n * BigInt(parentPrice)), samples, deployEstimates };
}

const [artifactPath, goldenPath, evidencePath, sampleLimit = "3"] = process.argv.slice(2);
assert(artifactPath && goldenPath && /^\d+$/.test(sampleLimit) && Number(sampleLimit) >= 1 && Number(sampleLimit) <= 8,
  "Usage: node readonly-gl3.mjs OVERRIDE.json GOLDEN.json [EVIDENCE.json] [sample count 1–8]");
const [artifactBytes, goldenBytes] = await Promise.all([readFile(artifactPath), readFile(goldenPath)]);
const artifact = JSON.parse(artifactBytes);
const golden = JSON.parse(goldenBytes);
const overrides = getOverrides(artifact);
if (artifact.modelSHA256 || golden.modelSHA256) verifyModelDigest(artifact, golden);
const vectors = getVectors(golden, Number(sampleLimit));
const block = await pinBlock();
const results = await Promise.all(routes.map(url => verifyRoute(url, artifact, block, overrides, vectors)));
assert(results[0].parentPricePerCompressedByteGH0ST === results[1].parentPricePerCompressedByteGH0ST,
  "RPCs disagree on parent posting price");
for (let index = 0; index < vectors.length; index++) {
  assert(results[0].samples[index].recordHash === results[1].samples[index].recordHash, "RPCs disagree on record output");
}
for (const url of routes) {
  const header = await rpc(url, "eth_getBlockByNumber", [block.number, false]);
  assert(header.hash === block.hash, "Pinned block changed during verification");
}
const evidence = {
  kind: "read-only-live-gl3-state-override",
  observedAt: new Date().toISOString(),
  chainId: Number(BigInt(chainId)),
  anchor: { number: Number(BigInt(block.number)), hash: block.hash, baseFeeWei: BigInt(block.baseFeePerGas).toString() },
  overrideSHA256: hashBytes(artifactBytes),
  goldenSHA256: hashBytes(goldenBytes),
  modelSHA256: artifact.modelSHA256 ?? null,
  packedModelSHA256: artifact.packedModelSHA256 ?? null,
  generatorRuntimeBytes: hexBytes(artifact.code).length,
  shardRuntimeBytes: artifact.shards.map(shard => hexBytes(shard.code).length),
  results,
};
const formatted = JSON.stringify(evidence, null, 2) + "\n";
if (evidencePath) await writeFile(evidencePath, formatted);
process.stdout.write(formatted);
