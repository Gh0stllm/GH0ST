#!/usr/bin/env node
/** Verify the complete deployed Genesis export without signing or sending transactions. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'ethers';
import { shardLeaf, verifyProof, merkleTree } from './prepare-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const INDEX = '0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0';
const INDEX_HASH = '0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307';
const MERKLE_ROOT = '0x3b327e697b57bae646264f3fe99fb4921c40f44d92ef0173c272f7e3edcb61d2';
const MODEL_SHA = '9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9';
const MODEL_BYTES = 48_626_528;
const PAYLOAD_BYTES = 98_303;
const COUNT = 495;
const CONCURRENCY = 6;
const MAX_ATTEMPTS = 3;
const DEADLINE_MS = 240_000;
const READ_ONLY = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(message);
};

const report = {
  schemaVersion: 1,
  status: 'RUNNING',
  startedAtUTC: new Date().toISOString(),
  rpcPublicEndpoint: RPC,
  readOnly: true,
  publicTransactionsSent: 0,
  allowedPublicMethods: [...READ_ONLY],
  requestConcurrency: CONCURRENCY,
  requestTimeoutMs: 20_000,
  maxRequestAttempts: MAX_ATTEMPTS,
  overallDeadlineMs: DEADLINE_MS,
  upstreamMethodCounts: {},
  retryCount: 0,
  expectedShardCount: COUNT,
  verifiedShardCount: 0,
  expectedModelBytes: MODEL_BYTES,
  expectedModelSHA256: MODEL_SHA,
  expectedMerkleRoot: MERKLE_ROOT,
  shards: [],
};
const deadline = new AbortController();
const timer = setTimeout(() => deadline.abort(new Error('Full-shard verification deadline exceeded')), DEADLINE_MS);
let requestId = 0;

async function rpc(method, params = []) {
  if (!READ_ONLY.has(method)) throw new Error('Refusing a non-read-only public RPC method');
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    deadline.signal.throwIfAborted();
    try {
      report.upstreamMethodCounts[method] = (report.upstreamMethodCounts[method] ?? 0) + 1;
      const id = ++requestId;
      const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'GH0ST-Full-Shard-ReadOnly-Verification/1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.any([deadline.signal, AbortSignal.timeout(20_000)]),
      });
      if (!response.ok) throw new Error('Read-only RPC HTTP ' + response.status);
      const value = await response.json();
      if (value.error)
        throw new Error('Read-only RPC ' + method + ' error ' + value.error.code + ': ' +
          String(value.error.message || 'Unknown provider error').slice(0, 240));
      if (value.id !== id || value.jsonrpc !== '2.0' || value.result === undefined)
        throw new Error('Read-only RPC returned an invalid/error response for ' + method);
      return value.result;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS || deadline.signal.aborted) throw error;
      report.retryCount++;
      await new Promise(resolve => setTimeout(resolve, attempt * 300));
    }
  }
}

function runtimeBytes(hex, label) {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(hex))
    throw new Error('Invalid runtime hex for ' + label);
  return Buffer.from(hex.slice(2), 'hex');
}

async function main() {
  const [sourceBytes, proofBytes, configBytes] = await Promise.all([
    fs.readFile(path.join(ROOT, 'config/source-shards.json')),
    fs.readFile(path.join(ROOT, 'config/shard-proofs.json')),
    fs.readFile(path.join(ROOT, 'config/mainnet.json')),
  ]);
  const source = JSON.parse(sourceBytes);
  const proofs = JSON.parse(proofBytes);
  const config = JSON.parse(configBytes);
  report.sourceManifestSHA256 = sha256(sourceBytes);
  report.proofsFileSHA256 = sha256(proofBytes);
  equal(source.chain_id, 4663, 'Source chain differs');
  equal(source.supply, COUNT, 'Source shard count differs');
  equal(source.weight_export_sha256, MODEL_SHA, 'Source model hash differs');
  equal(source.weight_export_length_bytes, MODEL_BYTES, 'Source model length differs');
  equal(source.full_shard_payload_length_bytes, PAYLOAD_BYTES, 'Source payload size differs');
  equal(source.weight_index_address.toLowerCase(), INDEX, 'Source index address differs');
  equal(source.weight_index_runtime_keccak256.toLowerCase(), INDEX_HASH, 'Source index hash differs');
  equal(proofs.root, MERKLE_ROOT, 'Proof root differs from published production root');
  equal(proofs.height, 9, 'Proof depth differs');
  equal(config.chainId, 4663, 'Configuration chain differs');
  equal(config.weightIndex.toLowerCase(), INDEX, 'Configuration index differs');
  equal(config.expectedIndexCodeHash, INDEX_HASH, 'Configuration index hash differs');
  equal(config.shardMerkleRoot, MERKLE_ROOT, 'Configuration Merkle root differs');
  if (!Number.isSafeInteger(config.preflightBlockNumber) || config.preflightBlockNumber < 1 ||
      !/^0x[0-9a-f]{64}$/.test(config.preflightBlockHash))
    throw new Error('Invalid pinned preflight block');
  report.chainId = 4663;
  report.priorPreflightBlockNumber = config.preflightBlockNumber;
  report.blockSelection = 'Fresh official-RPC head pinned once before fetching any code; all code requests use this single block number.';
  const records = source.records.slice().sort((a, b) => a.token_id - b.token_id);
  equal(records.length, COUNT, 'Source record count differs');
  equal(proofs.records.length, COUNT, 'Proof record count differs');
  const leaves = [];
  let offset = 0;
  for (let i = 0; i < COUNT; i++) {
    const r = records[i];
    const p = proofs.records[i];
    equal(r.token_id, i + 1, 'Source token IDs are not contiguous');
    equal(r.shard_index, i, 'Source shard index differs');
    equal(r.payload_offset_bytes, offset, 'Source logical offset differs');
    equal(r.payload_length_bytes, Math.min(PAYLOAD_BYTES, MODEL_BYTES - offset), 'Source logical length differs');
    equal(r.runtime_length_bytes, r.payload_length_bytes + 1, 'Source runtime length differs');
    equal(p.tokenId, r.token_id, 'Proof token ID differs');
    equal(p.shardIndex, r.shard_index, 'Proof shard index differs');
    equal(p.shardAddress.toLowerCase(), r.shard_address.toLowerCase(), 'Proof shard address differs');
    equal(p.runtimeCodeHash.toLowerCase(), r.runtime_code_hash.toLowerCase(), 'Proof runtime hash differs');
    equal(p.offset, r.payload_offset_bytes, 'Proof logical offset differs');
    equal(p.length, r.payload_length_bytes, 'Proof logical length differs');
    const leaf = shardLeaf(r);
    equal(p.leaf, leaf, 'Proof leaf differs');
    equal(p.proof.length, 9, 'Proof sibling count differs');
    equal(verifyProof(leaf, p.proof, MERKLE_ROOT), true, 'Invalid published shard proof');
    leaves.push(leaf);
    offset += r.payload_length_bytes;
  }
  equal(offset, MODEL_BYTES, 'Source does not cover the complete logical export');
  equal(merkleTree(leaves).root, MERKLE_ROOT, 'Rebuilt Merkle root differs');
  report.all495SourceProofsVerified = true;
  const chain = await rpc('eth_chainId');
  equal(Number(BigInt(chain)), 4663, 'Official RPC is not chain 4663');
  const blockTag = await rpc('eth_blockNumber');
  report.blockNumber = Number(BigInt(blockTag));
  const [block, indexHex] = await Promise.all([
    rpc('eth_getBlockByNumber', [blockTag, false]),
    rpc('eth_getCode', [INDEX, blockTag]),
  ]);
  if (!/^0x[0-9a-f]{64}$/.test(block?.hash)) throw new Error('Pinned block has an invalid hash');
  report.blockHash = block.hash;
  equal(Number(BigInt(block.number)), report.blockNumber, 'Pinned block number differs');
  const index = runtimeBytes(indexHex, 'weight index');
  equal(keccak256(index), INDEX_HASH, 'Live index code hash differs');
  equal(index.length, 49 + 20 * COUNT, 'Live index runtime length differs');
  equal(index[0], 0, 'Index lacks leading STOP');
  equal(index.subarray(1, 5).toString('ascii'), 'G4IX', 'Index header magic differs');
  equal(index.readUInt32BE(5), PAYLOAD_BYTES, 'Index payload size differs');
  equal(index.readBigUInt64BE(9), BigInt(MODEL_BYTES), 'Index model size differs');
  equal(index.subarray(17, 49).toString('hex'), MODEL_SHA, 'Index model SHA-256 differs');
  const addresses = records.map((record, i) => {
    const address = '0x' + index.subarray(49 + i * 20, 69 + i * 20).toString('hex');
    equal(address, record.shard_address.toLowerCase(), 'Live index address differs at token ' + (i + 1));
    return address;
  });
  equal(new Set(addresses).size, COUNT, 'Duplicate live shard addresses');
  report.indexAddress = INDEX;
  report.indexCodeHash = INDEX_HASH;
  report.all495IndexAddressesMatch = true;
  const payloads = new Array(COUNT);
  const checked = new Array(COUNT);
  let next = 0;
  let stopped = false;
  async function worker() {
    try {
      while (!stopped && next < COUNT) {
        const i = next++;
        const r = records[i];
        const code = runtimeBytes(await rpc('eth_getCode', [addresses[i], blockTag]), 'token ' + r.token_id);
        equal(code.length, r.runtime_length_bytes, 'Live runtime length differs at token ' + r.token_id);
        equal(code[0], 0, 'Live shard lacks leading STOP at token ' + r.token_id);
        const hash = keccak256(code);
        equal(hash, r.runtime_code_hash.toLowerCase(), 'Live runtime hash differs at token ' + r.token_id);
        const observedLeaf = shardLeaf({
          tokenId: r.token_id, shardAddress: addresses[i], runtimeCodeHash: hash,
          offset: r.payload_offset_bytes, length: code.length - 1,
        });
        equal(verifyProof(observedLeaf, proofs.records[i].proof, MERKLE_ROOT), true,
          'Live shard does not satisfy proof at token ' + r.token_id);
        payloads[i] = code.subarray(1);
        checked[i] = { tokenId: r.token_id, shardAddress: addresses[i], runtimeBytes: code.length, runtimeCodeHash: hash };
        report.verifiedShardCount++;
        if (report.verifiedShardCount % 50 === 0 || report.verifiedShardCount === COUNT)
          console.log('Verified live shards: ' + report.verifiedShardCount + '/' + COUNT);
      }
    } catch (error) {
      stopped = true;
      throw error;
    }
  }
  const outcomes = await Promise.allSettled(Array.from({ length: CONCURRENCY }, worker));
  report.shards = checked.filter(Boolean);
  const failure = outcomes.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  equal(report.verifiedShardCount, COUNT, 'Not every deployed shard was verified');
  const exportHash = createHash('sha256');
  let logicalBytes = 0;
  for (const payload of payloads) {
    exportHash.update(payload);
    logicalBytes += payload.length;
  }
  const observedSHA = exportHash.digest('hex');
  report.observedModelBytes = logicalBytes;
  report.observedModelSHA256 = observedSHA;
  equal(logicalBytes, MODEL_BYTES, 'Reassembled logical export byte count differs');
  equal(observedSHA, MODEL_SHA, 'Reassembled logical export SHA-256 differs');
  const finalBlock = await rpc('eth_getBlockByNumber', [blockTag, false]);
  equal(finalBlock?.hash, report.blockHash, 'Pinned block changed during verification');
  report.all495RuntimeHashesMatch = true;
  report.all495RuntimeLengthsMatch = true;
  report.all495LiveShardProofsVerified = true;
  report.completeLogicalExportMatches = true;
  report.pinnedBlockHashRechecked = true;
  report.status = 'PASS';
}

try {
  await main();
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error?.message || 'Full-shard verification failed').slice(0, 500);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  report.finishedAtUTC = new Date().toISOString();
  report.durationMs = Date.parse(report.finishedAtUTC) - Date.parse(report.startedAtUTC);
  await fs.writeFile(path.join(ROOT, 'config/full-shard-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    status: report.status, blockNumber: report.blockNumber, verifiedShardCount: report.verifiedShardCount,
    modelBytes: report.observedModelBytes, modelSHA256: report.observedModelSHA256,
    publicTransactionsSent: report.publicTransactionsSent, durationMs: report.durationMs,
    failure: report.failure, report: 'config/full-shard-validation.json',
  }, null, 2));
}
