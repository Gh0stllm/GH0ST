// Offline partition and deployment accounting. Does not sign or contact a chain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL_ID = '0xd5fe104a83865bb22299096cafcfe77eb1642fff8ddf0047306b4801599b4107';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const canonicalJson = value => JSON.stringify(canonical(value));

export function tensorLayout(id) {
  if(id===0)return {rows:50257,width:768,row_bytes:772};
  if(id===1)return {rows:1024,width:768,row_bytes:3072};
  if(id===2)return {rows:1,width:768,row_bytes:6144};
  if(id===75)return {rows:1,width:4097,row_bytes:16388};
  if(id===76)return {rows:1,width:2049,row_bytes:4098};
  assert(id>=3&&id<75);
  const offset=(id-3)%6;
  if(offset<2)return {rows:1,width:768,row_bytes:6144};
  return {rows:offset===2?2304:offset===4?3072:768,width:offset===5?3072:768,row_bytes:offset===5?3080:776};
}

export function tensorIds(stage, count, start, end) {
  const ids = [];
  if (stage === 0) ids.push(0, 1);
  for (let layer = start; layer < end; layer++) for (let offset = 0; offset < 6; offset++) ids.push(3 + layer * 6 + offset);
  if (end > start) ids.push(75, 76);
  if (stage === count - 1) ids.push(0, 2);
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function makePlan(dataDirectory, { verify = true, configuration = null } = {}) {
  const config = configuration ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'config/chains.json')));
  const manifestFile = path.join(dataDirectory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  assert.equal(manifest.unique_parameter_count, 124439808);
  assert.equal(manifest.model_id_hash, MODEL_ID);
  assert.equal(manifest.architecture.width, 768);
  assert.equal(manifest.architecture.layers, 12);
  assert.equal(manifest.tensors.length, 77);
  const identity = { checkpoint_sha256: manifest.checkpoint_sha256, architecture: manifest.architecture,
    runtime_arithmetic: manifest.runtime_arithmetic, tensor_sha256s_in_id_order: manifest.tensors.map(t => t.sha256) };
  assert.equal('0x' + hash(canonicalJson(identity)), MODEL_ID, 'Export identity changed');
  assert(config.chains.length >= 2 && config.chains.length <= 8);
  assert.equal(config.chains[0].key, 'robinhood');
  let expectedLayer = 0;
  const seenChains = new Set(), seenEids = new Set();
  const stages = config.chains.map((chain, index) => {
    assert.equal(chain.stage, index);
    assert(!seenChains.has(chain.chainId) && !seenEids.has(chain.eid), 'Each stage must own a distinct chain');
    seenChains.add(chain.chainId); seenEids.add(chain.eid);
    const [start, end] = chain.layerRange;
    assert.equal(start, expectedLayer, 'Layer gap or overlap');
    assert(index === 0 ? end === 0 : end > start && end <= 12, 'Invalid stage partition');
    expectedLayer = end;
    const ids = tensorIds(index, config.chains.length, start, end);
    let payloadBytes = 0, weightContracts = 0, catalogs = 1;
    const tensors = ids.map(id => {
      const t = manifest.tensors[id]; assert.equal(t.id, id);
      const layout=tensorLayout(id), perShard=Math.floor(24575/layout.row_bytes);
      for(const [field,value] of Object.entries(layout))assert.equal(t[field],value,'Canonical tensor layout differs: '+id+'/'+field);
      assert.equal(t.bytes,layout.rows*layout.row_bytes);
      assert.equal(t.rows_per_shard,perShard);
      assert.equal(t.shards.length,Math.ceil(layout.rows/perShard));
      t.shards.forEach((shard,index)=>{
        const first=index*perShard,rows=Math.min(perShard,layout.rows-first);
        assert.equal(shard.first_row,first,'Canonical shard order differs');
        assert.equal(shard.rows,rows);
        assert.equal(shard.offset,first*layout.row_bytes);
        assert.equal(shard.length,rows*layout.row_bytes);
        assert.equal(shard.runtime_bytes,1+rows*layout.row_bytes);
        assert.equal(shard.file,t.file);
      });
      if (verify) {
        const file = path.resolve(dataDirectory, t.file);
        assert(file.startsWith(path.resolve(dataDirectory) + path.sep));
        const payload = fs.readFileSync(file);
        assert.equal(hash(payload), t.sha256, 'Weight tensor hash mismatch: ' + t.name);
        for (const shard of t.shards) {
          const runtime = Buffer.concat([Buffer.from([0]), payload.subarray(shard.offset, shard.offset + shard.length)]);
          assert(runtime.length <= 24576);
          assert.equal(hash(runtime), shard.runtime_sha256, 'Weight shard hash mismatch');
        }
      }
      payloadBytes += t.bytes; weightContracts += t.shards.length;
      catalogs += 1 + (t.shards.length > 767 ? Math.ceil(t.shards.length / 767) : 0);
      return { id, name: t.name, sha256: t.sha256, bytes: t.bytes, shards: t.shards.length };
    });
    return { ...chain, tensorIds: ids, tensors, payloadBytes, weightContracts, catalogContracts: catalogs,
      doesEmbedding: index === 0, doesOutput: index === config.chains.length - 1,
      activationBytes: index === config.chains.length - 1 ? 0 : 3072 };
  });
  assert.equal(expectedLayer, 12, 'Not all transformer blocks assigned');
  assert.deepEqual([...new Set(stages.flatMap(s => s.tensorIds))].sort((a,b)=>a-b), Array.from({length:77},(_,i)=>i), 'Model coverage incomplete');
  const routeIdentity = { version: 1, modelId: MODEL_ID, stages: stages.map(s => ({ chainId: s.chainId, eid: s.eid,
    layerRange: s.layerRange, doesEmbedding: s.doesEmbedding, doesOutput: s.doesOutput, tensors: s.tensors.map(t=>({id:t.id,sha256:t.sha256})) })) };
  const payloadBytes = stages.reduce((n,s)=>n+s.payloadBytes,0);
  const uniquePayloadBytes = manifest.tensors.reduce((n,t)=>n+t.bytes,0);
  return { schemaVersion: 1, status: 'OFFLINE_VALIDATED_PARTITION', modelId: MODEL_ID,
    routeId: '0x' + hash(canonicalJson(routeIdentity)), uniqueParameters: manifest.unique_parameter_count,
    checkpointSha256: manifest.checkpoint_sha256, manifestSha256: hash(fs.readFileSync(manifestFile)),
    verifiedAllWeights: verify, stages, totals: { payloadBytes, uniquePayloadBytes,
      duplicatedPayloadBytes: payloadBytes - uniquePayloadBytes,
      weightContracts: stages.reduce((n,s)=>n+s.weightContracts,0),
      catalogContracts: stages.reduce((n,s)=>n+s.catalogContracts,0),
      inferenceContracts: stages.length * 2,
      messagesPerPosition: stages.length,
      activationMessagesPerPosition: stages.length - 1, resultMessagesPerPosition: 1 },
    limits: { hiddenBytes:3072, activationPacketBytes:3488, resultPacketBytes:416, maxContext:1024 },
    publicTransactions:0, note:'Splitting does not prove lower gas. Compare receipt costs and actual per-hop fees in a common currency.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(x => x.startsWith('--data=') || x.startsWith('--out=') || x.startsWith('--config=')));
  const local = path.join(ROOT,'data'), fallback = path.resolve(ROOT,'../gpt2-bsc/data');
  const data = path.resolve(args.find(x=>x.startsWith('--data='))?.slice(7) ?? (fs.existsSync(path.join(local,'manifest.json')) ? local : fallback));
  const out = path.resolve(ROOT, args.find(x=>x.startsWith('--out='))?.slice(6) ?? 'reports/partition.json');
  assert(out.startsWith(ROOT + path.sep), 'Output must stay in this project');
  const configPath=args.find(x=>x.startsWith('--config='))?.slice(9);
  const configuration=configPath?JSON.parse(fs.readFileSync(path.resolve(ROOT,configPath))):null;
  const plan = makePlan(data,{configuration});
  fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(plan,null,2)+'\n');
  console.log(JSON.stringify({status:plan.status, modelId:plan.modelId,routeId:plan.routeId,stages:plan.stages.map(s=>({chain:s.key,layers:s.layerRange,payloadBytes:s.payloadBytes})),totals:plan.totals,output:out},null,2));
}
