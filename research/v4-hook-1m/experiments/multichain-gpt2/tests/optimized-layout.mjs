// Pure route configuration and local-only node adapters for optimization experiments.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, sha256 } from '../scripts/build.mjs';
import { CHAIN_IDS, EIDS } from './harness.mjs';
import { startOptimizedChain } from './optimized-runtime.mjs';

export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const range = (start, end) => Array.from({ length: end - start }, (_, i) => start + i);
export function requiredTensorIds(first, end, embedding, output) {
  const ids = [];
  if (embedding) ids.push(0, 1);
  for (let layer = first; layer < end; layer++) ids.push(...range(3 + layer * 6, 9 + layer * 6));
  if (end > first) ids.push(75, 76);
  if (output) ids.push(0, 2);
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function normalizeLayout(input) {
  assert(input && typeof input === 'object');
  const source = input.stages ?? input.chains;
  assert(Array.isArray(source) && source.length >= 2 && source.length <= 4, 'An optimization scenario must use two to four distinct known chains');
  const mode = input.mode ?? 'linear';
  assert.equal(mode, 'linear', 'This runner currently supports the standard embedding-to-final-head route');
  const usedIds = new Set(), usedEids = new Set();
  let nextLayer = 0;
  const stages = source.map((entry, stage) => {
    const chain_id = Number(entry.chainId ?? entry.chain_id), endpoint_id = Number(entry.eid ?? entry.endpoint_id);
    const canonicalIndex = CHAIN_IDS.indexOf(chain_id);
    assert(canonicalIndex >= 0 && EIDS[canonicalIndex] === endpoint_id, 'Only verified chain/EID pairs are supported');
    assert(!usedIds.has(chain_id) && !usedEids.has(endpoint_id), 'A standard route requires distinct chain/EID pairs');
    usedIds.add(chain_id); usedEids.add(endpoint_id);
    const first = Number(entry.firstLayer ?? entry.first ?? entry.layerRange?.[0]);
    const end = Number(entry.endLayer ?? entry.end ?? entry.layerRange?.[1]);
    const embedding = entry.doesEmbedding ?? entry.embedding ?? stage === 0;
    const output = entry.doesOutput ?? entry.output ?? stage === source.length - 1;
    assert(Number.isInteger(first) && Number.isInteger(end) && first >= 0 && end <= 12 && end >= first, 'Invalid layer range');
    assert.equal(first, nextLayer, 'Transformer ranges must be contiguous without gaps or overlap');
    assert.equal(Boolean(embedding), stage === 0, 'Only the home stage performs token embedding');
    assert.equal(Boolean(output), stage === source.length - 1, 'Only the final stage performs the vocabulary head');
    if (stage === 0) assert(first === 0 && end === 0 && chain_id === 4663, 'Standard route keeps embedding-only Robinhood home');
    else assert(end > first, 'Every remote chain must perform at least one real transformer block');
    nextLayer = end;
    const profile = entry.profile ?? 'ethereum';
    assert(['ethereum', 'monad'].includes(profile) && (profile !== 'monad' || chain_id === 143));
    const maximum = profile === 'monad' ? 30000000n : 16777216n;
    const maxTransactionGas = BigInt(entry.maxTransactionGas ?? maximum);
    const targetGas = BigInt(entry.targetGas ?? maxTransactionGas * 97n / 100n);
    assert(maxTransactionGas > 1000000n && maxTransactionGas <= maximum && targetGas <= maxTransactionGas && targetGas > 1000000n);
    return { name: entry.name ?? entry.key ?? `stage${stage}`, stage, chain_id, endpoint_id, first, end, profile,
      maxTransactionGas: String(maxTransactionGas), targetGas: String(targetGas),
      embedding: Boolean(embedding), output: Boolean(output), tensors: requiredTensorIds(first, end, embedding, output) };
  });
  assert.equal(nextLayer, 12, 'All twelve transformer blocks are required');
  return { name: input.name ?? `custom-${stages.length}-chain-layout`, mode, chainPlan: input.chainPlan ?? null, stages };
}

export function readLayout(filename = 'config/chains.json') {
  const file = path.resolve(HERE, filename);
  assert(file.startsWith(HERE + path.sep), 'Layout file must be inside this project');
  const raw = fs.readFileSync(file);
  return { ...normalizeLayout(JSON.parse(raw)), file: path.relative(HERE, file), sha256: sha256(raw) };
}

export function layoutIdentity(layout, manifest) {
  const identity = { version: 1, modelId: manifest.model_id_hash, stages: layout.stages.map(stage => ({
    chainId: stage.chain_id, eid: stage.endpoint_id, layerRange: [stage.first, stage.end],
    doesEmbedding: stage.embedding, doesOutput: stage.output,
    tensors: stage.tensors.map(id => ({ id, sha256: manifest.tensors[id].sha256 })),
  })) };
  return '0x' + sha256(canonical(identity));
}

export async function startLayoutChains(stages, { onTransaction = () => {} } = {}) {
  const chains = [];
  try {
    for (const config of stages) {
      const chain = await startOptimizedChain({ config, onTransaction });
      chains.push(chain);
    }
    assert.equal(new Set(chains.map(chain => chain.environment.local_process_pid)).size, stages.length);
    return chains;
  } catch (error) { await Promise.allSettled(chains.map(chain => chain.stop())); throw error; }
}

export async function deliverLayoutPacket(stages, chains, endpoints, routers, packet, options = {}) {
  const destination = stages.findIndex(stage => stage.endpoint_id === Number(packet.dstEid));
  assert(destination >= 0, 'Packet destination is outside the configured local route');
  return chains[destination].tx(endpoints[destination], 'deliver', [packet.srcEid, packet.sender, packet.nonce,
    packet.guid, routers[destination].address, packet.message], { category: 'message_receive', ...options });
}
