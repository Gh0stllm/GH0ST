// Complete GPT-2 inference on four isolated local EVMs. Never accepts a remote RPC URL.
// Weight data enters only through CREATE; CPU reference vectors are assertions, never engine inputs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, compile, assertSourcesUnchanged, confinedOutput, json, sha256 } from './build.mjs';
import { startLocalChains, ethers, EIDS, CHAIN_IDS, CAP, BLOCK_LIMIT, addressRuntime, checkpoint, packedInt32, decodePacket, deliver } from '../tests/harness.mjs';
import { makePlan } from './plan.mjs';

const args = process.argv.slice(2);
assert(args.every(arg => /^--(?:out|tokens|rows|target-gas)=/.test(arg) || ['--check-inputs', '--deploy-only', '--no-batch'].includes(arg)),
  'Unknown option: public RPC URLs, public broadcasting, and alternate model implementations are forbidden');
const option = (name, fallback) => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const outputDirectory = confinedOutput(option('out', 'reports/local-full'));
fs.mkdirSync(outputDirectory, { recursive: true });
const reportFile = path.join(outputDirectory, 'results.json'), ledgerFile = path.join(outputDirectory, 'transactions.jsonl');
fs.writeFileSync(ledgerFile, '');
const tokenCount = Number(option('tokens', '2')), requestedRows = Number(option('rows', '512'));
const targetGas = BigInt(option('target-gas', '16200000')), batching = !args.includes('--no-batch');
assert(Number.isInteger(tokenCount) && tokenCount >= 1 && tokenCount <= 3, 'Reference supports 1..3 token positions');
assert(Number.isInteger(requestedRows) && requestedRows >= 1 && requestedRows <= 512, 'Rows must be 1..512');
assert(targetGas > 1_000_000n && targetGas <= CAP, 'Target gas must fit the 16,777,216 comparison ceiling');
const MODEL_ID = '0xd5fe104a83865bb22299096cafcfe77eb1642fff8ddf0047306b4801599b4107';
const CHECKPOINT = '248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707';
const range = (start, end) => Array.from({ length: end - start }, (_, i) => start + i);
const stageConfig = [
  { name: 'Robinhood', first: 0, end: 0, embedding: true, output: false, tensors: [0, 1] },
  { name: 'BNB', first: 0, end: 4, embedding: false, output: false, tensors: [...range(3, 27), 75, 76] },
  { name: 'Monad', first: 4, end: 8, embedding: false, output: false, tensors: [...range(27, 51), 75, 76] },
  { name: 'Arc', first: 8, end: 12, embedding: false, output: true, tensors: [0, 2, ...range(51, 75), 75, 76] },
].map((item, stage) => ({ ...item, stage, chain_id: CHAIN_IDS[stage], endpoint_id: EIDS[stage] }));
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
let routeId;
const sessionId = ethers.id('LOCAL_FOUR_CHAIN_FULL_GPT2_SESSION_V1');
const report = { schema_version: 1, status: 'RUNNING', started_at: new Date().toISOString(),
  mode: 'FOUR_SEPARATE_LOCAL_EVM_PROCESSES_REAL_GPT2_MATH_SIMULATED_TRANSPORT', public_transactions_submitted: 0,
  weight_data_injected: false, host_inference_results_injected: false, batch_small_phases: batching,
  stages: stageConfig, route_id: routeId, session_id: sessionId, requested_token_positions: tokenCount,
  transaction_gas_ceiling: CAP, adaptive_target_gas: targetGas, local_block_gas_limit: BLOCK_LIMIT,
  deployments: [], tokens: [], validations: [], preflight_calls: 0, preflight_profiles: [],
  totals: { transaction_count: 0, gas_by_category: {}, gas_by_stage: {}, all_measured_gas: 0n },
  limitations: [
    'All nodes use the generic Ethereum Cancun EVM with target chain IDs; native chain gas schedules, gas prices, finality, and inclusion latency are not emulated.',
    'MockEndpoint carries exact official OApp packet bytes but has no DVNs, message proofs, validator security, production executor, or real messaging fees.',
    'No live gas savings are established by this local benchmark. Gas units on separate chains are not interchangeable monetary costs.',
    'The complete quantized INT8/Q12 GPT-2 model is deterministic but is not bit-identical to the floating-point checkpoint.',
    'The tied token embedding table is deployed on both Robinhood and Arc, and nonlinear LUTs on all three transformer stages; duplicate storage is counted.',
    'Tokenization/display decoding and reference checking happen on the CPU. Every model activation, transformer block, KV update, and vocabulary row is computed by the real Solidity engine.',
    'Export is charged inside dispatch; model import/begin and simulated receive/send costs are separately labeled. Read-only verification calls incur no paid transaction gas.',
  ] };
const save = () => fs.writeFileSync(reportFile, json(report));
const check = (name, details = {}) => report.validations.push({ name, passed: true, ...details });
save();
let chains = [], compiled;
const dataDirectory = [path.join(HERE, 'data'), path.resolve(HERE, '../gpt2-bsc/data')].find(base => fs.existsSync(path.join(base, 'manifest.json')));
const checkedFile = (base, filename) => {
  const file = path.resolve(base, filename);
  assert(file.startsWith(base + path.sep), 'Input filename leaves pinned data directory');
  return file;
};
const referenceCache = new Map();
function referenceVector(base, descriptor) {
  const file = checkedFile(base, descriptor.file);
  if (!referenceCache.has(file)) {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, descriptor.count * 4, 'Independent vector byte length');
    assert.equal(sha256(bytes), descriptor.sha256, 'Independent vector file commitment');
    referenceCache.set(file, { bytes, values: Array.from({ length: descriptor.count }, (_, i) => BigInt(bytes.readInt32BE(i * 4))) });
  }
  return referenceCache.get(file);
}
function loadInputs() {
  assert(dataDirectory, 'Missing canonical model data: run model preparation first');
  const manifestBytes = fs.readFileSync(path.join(dataDirectory, 'manifest.json'));
  const referenceBytes = fs.readFileSync(path.join(dataDirectory, 'reference-report.json'));
  const manifest = JSON.parse(manifestBytes), reference = JSON.parse(referenceBytes);
  const plan = makePlan(dataDirectory, { verify: false });
  for (const config of stageConfig) {
    const planned = plan.stages[config.stage];
    assert.equal(config.chain_id, planned.chainId); assert.equal(config.endpoint_id, planned.eid);
    assert.deepEqual([config.first, config.end], planned.layerRange);
    assert.deepEqual(config.tensors, planned.tensorIds);
  }
  routeId = plan.routeId; report.route_id = routeId;
  report.partition = { routeId, ...plan.totals };
  assert.equal(manifest.model_id_hash, MODEL_ID); assert.equal(reference.model_id_hash, MODEL_ID);
  assert.equal(manifest.checkpoint_sha256, CHECKPOINT); assert.equal(reference.checkpoint_sha256, CHECKPOINT);
  assert.equal(manifest.unique_parameter_count, 124439808); assert.equal(manifest.tensors.length, 77);
  assert.deepEqual(manifest.architecture, { layers: 12, width: 768, heads: 12, head_width: 64, vocabulary: 50257,
    context_tokens: 1024, mlp_width: 3072, tied_input_output_embedding: true });
  const identity = { checkpoint_sha256: manifest.checkpoint_sha256, architecture: manifest.architecture,
    runtime_arithmetic: manifest.runtime_arithmetic, tensor_sha256s_in_id_order: manifest.tensors.map(t => t.sha256) };
  assert.equal('0x' + sha256(canonical(identity)), MODEL_ID, 'Model hash must pin architecture, arithmetic and every ordered tensor');
  const expected = reference.cases.find(item => item.id === 'eos');
  assert(expected && expected.positions.length >= tokenCount && expected.input_ids.length === 1);
  assert.equal(expected.input_ids[0], 50256);
  const tensors = new Map();
  for (let id = 0; id < 77; id++) {
    const tensor = manifest.tensors[id]; assert.equal(tensor.id, id);
    const bytes = fs.readFileSync(checkedFile(dataDirectory, tensor.file));
    assert.equal(bytes.length, tensor.bytes); assert.equal(sha256(bytes), tensor.sha256);
    assert.equal(bytes.length, tensor.rows * tensor.row_bytes);
    let nextOffset = 0;
    for (const shard of tensor.shards) {
      assert.equal(shard.offset, nextOffset, 'Ordered shards must cover tensor bytes without gaps');
      assert(shard.length > 0 && shard.length + 1 <= 24576);
      const runtime = Buffer.concat([Buffer.from([0]), bytes.subarray(shard.offset, shard.offset + shard.length)]);
      assert.equal(runtime.length, shard.runtime_bytes); assert.equal(sha256(runtime), shard.runtime_sha256);
      nextOffset += shard.length;
    }
    assert.equal(nextOffset, bytes.length); tensors.set(id, bytes);
  }
  for (const position of expected.positions.slice(0, tokenCount)) for (const descriptor of Object.values(position.stages)) referenceVector(dataDirectory, descriptor);
  const used = new Set(stageConfig.flatMap(stage => stage.tensors));
  assert.equal(used.size, 77, 'Route must cover all model tensors and LUTs');
  assert.deepEqual(stageConfig.slice(1).map(stage => [stage.first, stage.end]), [[0, 4], [4, 8], [8, 12]]);
  report.model = { model_id: MODEL_ID, checkpoint_sha256: CHECKPOINT, unique_parameter_count: 124439808,
    manifest_sha256: sha256(manifestBytes), data_directory: path.relative(HERE, dataDirectory), architecture: manifest.architecture,
    runtime_arithmetic: manifest.runtime_arithmetic, quantization: manifest.quantization,
    unique_tensor_bytes: [...tensors.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    deployed_tensor_bytes_including_duplicates: stageConfig.reduce((sum, stage) => sum + stage.tensors.reduce((n, id) => n + tensors.get(id).length, 0), 0) };
  report.model.duplicate_tensor_bytes = report.model.deployed_tensor_bytes_including_duplicates - report.model.unique_tensor_bytes;
  report.reference = { reference_sha256: sha256(referenceBytes), file: path.relative(HERE, path.join(dataDirectory, 'reference-report.json')),
    execution: reference.execution, arithmetic: reference.arithmetic, token_ids: expected.integer_generated_ids, verified_vector_files: referenceCache.size };
  check('canonical_model_identity_architecture_every_tensor_and_reference_file_verified');
  return { manifest, tensors, expected };
}

async function deployData(chain, config, manifest, tensors) {
  const catalogs = Array(77).fill(ethers.ZeroAddress), commitments = [];
  let count = 0;
  for (const id of config.tensors) {
    const tensor = manifest.tensors[id], bytes = tensors.get(id), addresses = [], shardHashes = [];
    for (let shardIndex = 0; shardIndex < tensor.shards.length; shardIndex++) {
      const descriptor = tensor.shards[shardIndex];
      const runtime = Buffer.concat([Buffer.from([0]), bytes.subarray(descriptor.offset, descriptor.offset + descriptor.length)]);
      const deployed = await chain.deployRuntime(runtime, `stage${config.stage} tensor${id} shard${shardIndex}`);
      report.deployments.push({ stage: config.stage, kind: 'weight_shard', tensor: id, shard: shardIndex, address: deployed.address,
        bytes: deployed.bytes, sha256: sha256(runtime), keccak256: deployed.keccak256, gas: deployed.receipt.gasUsed, transaction: deployed.receipt.transactionHash });
      addresses.push(deployed.address); shardHashes.push(deployed.keccak256); count++;
      if (count % 250 === 0) { console.log(`${config.name}: ${count} CREATE-deployed weight shards`); save(); }
    }
    let catalogAddresses = addresses;
    if (addresses.length > 767) {
      catalogAddresses = [];
      for (let offset = 0; offset < addresses.length; offset += 767) {
        const page = await chain.deployRuntime(addressRuntime(addresses.slice(offset, offset + 767)), `stage${config.stage} tensor${id} catalog page`);
        catalogAddresses.push(page.address);
        report.deployments.push({ stage: config.stage, kind: 'tensor_catalog_page', tensor: id, address: page.address,
          bytes: page.bytes, keccak256: page.keccak256, gas: page.receipt.gasUsed, transaction: page.receipt.transactionHash });
      }
    }
    const catalog = await chain.deployRuntime(addressRuntime(catalogAddresses), `stage${config.stage} tensor${id} catalog`);
    catalogs[id] = catalog.address;
    report.deployments.push({ stage: config.stage, kind: 'tensor_catalog', tensor: id, address: catalog.address,
      bytes: catalog.bytes, keccak256: catalog.keccak256, gas: catalog.receipt.gasUsed, transaction: catalog.receipt.transactionHash });
    commitments.push({ tensor: id, shards: shardHashes, catalog: catalog.keccak256 });
  }
  const root = await chain.deployRuntime(addressRuntime(catalogs), `stage${config.stage} root catalog`);
  report.deployments.push({ stage: config.stage, kind: 'root_catalog', address: root.address, bytes: root.bytes,
    keccak256: root.keccak256, gas: root.receipt.gasUsed, transaction: root.receipt.transactionHash });
  fs.writeFileSync(path.join(outputDirectory, `catalog-commitments-stage${config.stage}.json`), json(commitments));
  check(`stage${config.stage}_every_required_tensor_byte_CREATE_deployed_and_verified`, { tensor_ids: config.tensors, weight_shards: count,
    catalog_commitments_sha256: sha256(json(commitments)) });
  return root;
}

const rowHints = new Map(), stepHints = new Map();
async function selectWork(chain, engine, state) {
  const phase = Number(state.phase), key = `${chain.stage}:${phase}`, probes = [];
  const dryRun = async (method, values, work) => {
    report.preflight_calls++;
    try { await chain.view(engine, method, values, { gas: targetGas }); probes.push({ ...work, method: 'eth_call', fits: true }); return true; }
    catch (error) { probes.push({ ...work, method: 'eth_call', fits: false, reason: error.message.slice(0, 180) }); return false; }
  };
  if (batching && [1, 2, 4, 5, 7, 10].includes(phase)) {
    const rows = Math.min(requestedRows, 128);
    let low = 0, high = 65, candidate = Math.min(64, stepHints.get(key) ?? 1);
    const probe = steps => dryRun('advanceMany', [state.stepNumber, rows, steps], { rows, steps });
    if (await probe(candidate)) {
      low = candidate;
      while (low < 64) { candidate = Math.min(64, low * 2); if (await probe(candidate)) low = candidate; else { high = candidate; break; } }
    } else high = candidate;
    while (high - low > 1) { candidate = Math.floor((high + low) / 2); if (await probe(candidate)) low = candidate; else high = candidate; }
    assert(low > 0, `Stage${chain.stage} phase${phase} has no batch within gas target`);
    stepHints.set(key, low);
    return { method: 'advanceMany', rows, steps: low, probes };
  }
  const lengths = { 3: 2304, 6: 768, 8: 3072, 9: 768, 11: 50257 };
  const remaining = lengths[phase] === undefined ? requestedRows : lengths[phase] - Number(state.cursor);
  const maximum = Math.min(requestedRows, remaining, phase === 4 || phase === 5 ? 128 : requestedRows);
  const previous = rowHints.get(key);
  let candidate = Math.min(maximum, previous ? Math.max(1, Math.floor(previous.rows * Number(targetGas) / Number(previous.gas) * .99)) : maximum);
  const probe = rows => dryRun('advance', [state.stepNumber, rows], { rows });
  if (lengths[phase] === undefined) {
    assert(await probe(maximum), `Indivisible stage${chain.stage} phase${phase} exceeds gas target`);
    return { method: 'advance', rows: maximum, probes };
  }
  if (await probe(candidate)) return { method: 'advance', rows: candidate, probes };
  // Capped eth_call probes avoid assuming gas is linear across packed-storage boundaries.
  let high = candidate, low = 0;
  while (candidate > 1) {
    candidate = Math.max(1, Math.floor(candidate * .8));
    if (await probe(candidate)) { low = candidate; break; } high = candidate;
  }
  assert(low > 0, `Stage${chain.stage} phase${phase} cannot advance even one row`);
  for (let i = 0; i < 6 && high - low > 1; i++) {
    candidate = Math.floor((low + high) / 2); if (await probe(candidate)) low = candidate; else high = candidate;
  }
  return { method: 'advance', rows: low, probes };
}

function verifyEvents(engine, receipt, expectedPosition, tokenRecord, stageRecord) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  for (const log of receipt.logs.filter(log => log.address.toLowerCase() === engine.address.toLowerCase())) {
    const event = engine.interface.parseLog(log); if (!event) continue;
    if (event.name === 'PhaseComplete') {
      const phase = Number(event.args.phase), layer = Number(event.args.layer), head = Number(event.args.head), vectorId = Number(event.args.vectorId);
      const match = Object.entries(expectedPosition.stages).find(([, item]) => item.vector_id !== null && Number(item.completed_phase) === phase && item.completed_phase !== null &&
        (item.layer === null || item.layer === undefined || Number(item.layer) === layer) && (item.head === null || item.head === undefined || Number(item.head) === head));
      assert(match, `Independent phase reference absent: ${phase}/${layer}/${head}`);
      const [name, descriptor] = match;
      assert.equal(vectorId, descriptor.vector_id);
      const values = referenceVector(dataDirectory, descriptor).values;
      assert.equal(ethers.keccak256(coder.encode(['int256[]'], [values])), event.args.vectorHash, `CPU phase commitment differs: ${name}`);
      assert(!tokenRecord.reference_checks.some(item => item.name === name), 'A phase completed more than once: ' + name);
      tokenRecord.reference_checks.push({ stage: stageRecord.stage, name, phase, layer, head, vector_id: vectorId,
        count: descriptor.count, sha256: descriptor.sha256, keccak256: event.args.vectorHash });
      if (phase === 9) tokenRecord.completed_layers.push(layer);
    } else if (event.name === 'LogitChunk') {
      const start = Number(event.args.start), count = Number(event.args.count);
      assert.equal(start, tokenRecord.verified_vocabulary_rows, 'Full vocabulary rows must be covered once in order');
      const values = referenceVector(dataDirectory, expectedPosition.stages.logits).values.slice(start, start + count);
      assert.equal(values.length, count);
      assert.equal(ethers.keccak256(coder.encode(['int256[]'], [values])), event.args.logitsHash, 'Full vocabulary CPU logit commitment');
      tokenRecord.verified_vocabulary_rows += count;
      tokenRecord.logit_checks.push({ start, count, keccak256: event.args.logitsHash });
    }
  }
}

async function executeStage(chain, engine, config, expectedPosition, tokenRecord) {
  const record = { stage: config.stage, name: config.name, gas: 0n, transactions: 0, advances: [], minimum_gas_reserve: CAP };
  tokenRecord.stages.push(record);
  let state = checkpoint(await chain.view(engine, 'checkpoint'));
  const finalPhase = config.output ? 12n : 13n;
  while (state.phase !== finalPhase) {
    assert(state.phase > 0n && state.phase < 12n, 'Unexpected running phase');
    assert(record.transactions < 100000, 'No bounded progress');
    const before = state, work = await selectWork(chain, engine, before);
    const values = work.method === 'advanceMany' ? [before.stepNumber, work.rows, work.steps] : [before.stepNumber, work.rows];
    const receipt = await chain.tx(engine, work.method, values, { category: 'model_compute' });
    assert.equal(receipt.status, '0x1', 'Exact-state preflight approved a failing transaction');
    record.gas += receipt.gasUsed; record.transactions++;
    record.minimum_gas_reserve = record.minimum_gas_reserve < CAP - receipt.gasUsed ? record.minimum_gas_reserve : CAP - receipt.gasUsed;
    state = checkpoint(await chain.view(engine, 'checkpoint'));
    assert(state.stepNumber > before.stepNumber, 'Each computation transaction must progress');
    record.advances.push({ phase: before.phase, layer: before.layer, head: before.head, cursor: before.cursor,
      method: work.method, selected_rows: work.rows, requested_steps: work.steps ?? 1, steps_completed: state.stepNumber - before.stepNumber,
      gas: receipt.gasUsed, transaction: receipt.transactionHash, end_phase: state.phase, end_layer: state.layer, end_cursor: state.cursor });
    if (work.probes.length > 1 || !report.preflight_profiles.some(item => item.stage === chain.stage && item.phase === Number(before.phase))) {
      report.preflight_profiles.push({ stage: chain.stage, position: state.position, phase: Number(before.phase), layer: before.layer, cursor: before.cursor, ...work });
    }
    if (work.method === 'advance' && state.phase === before.phase && [3, 6, 8, 9, 11].includes(Number(before.phase))) {
      rowHints.set(`${chain.stage}:${before.phase}`, { rows: work.rows, gas: receipt.gasUsed });
    }
    verifyEvents(engine, receipt, expectedPosition, tokenRecord, record);
    if (state.phase !== before.phase || state.layer !== before.layer || record.transactions % 100 === 0) save();
    if (record.transactions % 100 === 0) console.log(`Position${tokenRecord.position} ${config.name}: ${record.transactions} advances, layer${state.layer} phase${state.phase} cursor${state.cursor}`);
  }
  record.final_checkpoint = state; record.complete = true;
  return state;
}

async function verifyKV(chain, engine, config, expected, position, tokenRecord) {
  // Check every saved prefix position again after incremental decoding to prove persistence.
  for (let previous = 0; previous <= position; previous++) for (let layer = config.first; layer < config.end; layer++) {
    const reference = referenceVector(dataDirectory, expected.positions[previous].stages[`l${String(layer).padStart(2, '0')}-qkv`]).values;
    for (const isValue of [false, true]) {
      const actual = await chain.value(engine, 'readKV', [layer, previous, isValue]);
      const values = reference.slice(isValue ? 1536 : 768, isValue ? 2304 : 1536);
      assert.deepEqual(Array.from(actual), values, `KV mismatch stage${config.stage} layer${layer} position${previous} ${isValue ? 'value' : 'key'}`);
      tokenRecord.kv_checks.push({ stage: config.stage, layer, cached_position: previous, side: isValue ? 'value' : 'key', sha256: sha256(packedInt32(actual)) });
    }
  }
}

try {
  const { manifest, tensors, expected } = loadInputs();
  compiled = compile({ outputDirectory }); report.compiler = compiled.compiler;
  assert(compiled.artifacts.GPT2Shard && compiled.artifacts.GPT2InferenceOApp && compiled.artifacts.MockEndpoint);
  report.artifact_roles = { model_engine: 'GPT2Shard', router: 'GPT2InferenceOApp', transport_only: 'MockEndpoint',
    mock_model_instantiated: false };
  check('all_compiled_runtimes_fit_EIP170'); save();
  if (args.includes('--check-inputs')) {
    assertSourcesUnchanged(compiled); report.status = 'PASS_OFFLINE_INPUT_AND_BUILD_PREFLIGHT';
  } else {
    chains = await startLocalChains({ onTransaction: entry => {
      fs.appendFileSync(ledgerFile, JSON.stringify(entry, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
      report.totals.transaction_count++;
      report.totals.all_measured_gas += entry.gas;
      report.totals.gas_by_category[entry.category] = (report.totals.gas_by_category[entry.category] ?? 0n) + entry.gas;
      report.totals.gas_by_stage[entry.stage] = (report.totals.gas_by_stage[entry.stage] ?? 0n) + entry.gas;
    } });
    report.environment = chains.map(chain => chain.environment);
    const roots = await Promise.all(stageConfig.map((config, stage) => deployData(chains[stage], config, manifest, tensors)));
    const endpoints = [], routers = [], engines = [];
    const now = Number((await chains[0].rpc('eth_getBlockByNumber', ['latest', false])).timestamp), deadline = now + 30 * 86400;
    report.deadline = deadline;
    for (let stage = 0; stage < chains.length; stage++) {
      const chain = chains[stage], config = stageConfig[stage];
      endpoints.push(await chain.deploy(compiled.artifacts.MockEndpoint, [EIDS[stage]], 'MockEndpoint'));
      routers.push(await chain.deploy(compiled.artifacts.GPT2InferenceOApp, [endpoints[stage].address, chain.accounts[0], chain.accounts[0], MODEL_ID,
        routeId, sessionId, stage, EIDS, deadline], 'GPT2InferenceOApp'));
      engines.push(await chain.deploy(compiled.artifacts.GPT2Shard, [roots[stage].address, roots[stage].keccak256, MODEL_ID, chain.chainId,
        config.first, config.end, config.embedding, config.output, routers[stage].address], 'GPT2Shard'));
      for (const [kind, item] of [['transport_mock', endpoints[stage]], ['router', routers[stage]], ['real_model_engine', engines[stage]]]) {
        report.deployments.push({ stage, kind, address: item.address, gas: item.receipt.gasUsed, transaction: item.receipt.transactionHash,
          runtime_bytes: item.runtimeBytes, runtime_keccak256: item.runtimeKeccak256 });
      }
      assert.equal((await chain.tx(routers[stage], 'bindEngine', [engines[stage].address], { category: 'route_setup' })).status, '0x1');
    }
    for (let stage = 0; stage < chains.length; stage++) {
      for (const other of [(stage + chains.length - 1) % chains.length, (stage + 1) % chains.length]) {
        assert.equal((await chains[stage].tx(routers[stage], 'setPeer', [EIDS[other], ethers.zeroPadValue(routers[other].address, 32)], { category: 'route_setup' })).status, '0x1');
      }
      assert.equal((await chains[stage].tx(routers[stage], 'sealRoute', [], { category: 'route_setup' })).status, '0x1');
    }
    save();
    if (!args.includes('--deploy-only')) {
      let inputToken = expected.input_ids[0];
      for (let position = 0; position < tokenCount; position++) {
        assert.equal(inputToken, expected.positions[position].input_token_id, 'Reference must follow actual previous greedy output');
        const record = { position, input_token: inputToken, stages: [], messages: [], reference_checks: [], logit_checks: [], kv_checks: [], completed_layers: [], verified_vocabulary_rows: 0 };
        report.active_token = record;
        assert.equal((await chains[0].tx(routers[0], 'beginToken', [inputToken], { category: 'activation_import_and_begin' })).status, '0x1');
        for (let stage = 0; stage < chains.length; stage++) {
          const config = stageConfig[stage], chain = chains[stage], engine = engines[stage];
          if (stage > 0) {
            const previous = record.messages.at(-1);
            assert.equal((await chain.tx(routers[stage], 'activate', [previous.hidden], { category: 'activation_import_and_begin' })).status, '0x1');
          }
          const end = await executeStage(chain, engine, config, expected.positions[position], record);
          await verifyKV(chain, engine, config, expected, position, record);
          const packetBytes = await chain.value(routers[stage], 'outboundPacket'), packet = decodePacket(packetBytes);
          if (!config.output) {
            const descriptor = expected.positions[position].stages[config.embedding ? 'embedding' : `l${String(config.end - 1).padStart(2, '0')}-residual2`];
            assert.equal(sha256(ethers.getBytes(packet.hidden)), descriptor.sha256, 'Exported hidden vector differs from independent CPU boundary');
            assert.equal(packet.hidden, await chain.value(engine, 'exportHidden'));
          } else {
            assert.equal(Number(end.bestToken), expected.positions[position].next_token_id);
            const best = referenceVector(dataDirectory, expected.positions[position].stages.logits).values[Number(end.bestToken)];
            assert.equal(end.bestLogit, best); assert.equal(packet.hidden, '0x');
          }
          const queuedIndex = await chain.value(endpoints[stage], 'packetCount');
          const quote = await chain.value(routers[stage], 'quoteDispatch');
          assert.equal(quote.nativeFee, 0n); assert.equal(quote.lzTokenFee, 0n);
          const sent = await chain.tx(routers[stage], 'dispatch', [], { category: 'message_send_and_hidden_export' });
          assert.equal(sent.status, '0x1');
          const queued = await chain.value(endpoints[stage], 'packet', [queuedIndex]);
          assert.equal(queued.message, packetBytes, 'Transport must carry exact OApp packet bytes');
          const destination = (stage + 1) % chains.length;
          assert.equal(Number(queued.dstEid), EIDS[destination]); assert.equal(queued.receiver, ethers.zeroPadValue(routers[destination].address, 32));
          const beforeReceive = await chains[destination].value(engines[destination], 'phase');
          const received = await deliver(chains, endpoints, routers, queued, { gas: 500_000n });
          assert.equal(received.status, '0x1', 'Packet receiver exceeded its fixed 500000 gas budget or rejected correct bytes');
          assert.equal(await chains[destination].value(engines[destination], 'phase'), beforeReceive, 'Transport delivery must not run model arithmetic');
          record.messages.push({ stage, destination_stage: destination, guid: queued.guid, packet_sha256: sha256(ethers.getBytes(packetBytes)),
            bytes: ethers.getBytes(packetBytes).length, hidden: packet.hidden, hidden_sha256: sha256(ethers.getBytes(packet.hidden)),
            send_gas: sent.gasUsed, receive_gas: received.gasUsed, quoted_native_fee: quote.nativeFee, simulated_transport: true });
          save();
        }
        assert.deepEqual([...record.completed_layers].sort((a, b) => a - b), range(0, 12), 'All 12 blocks must complete exactly once');
        assert.equal(record.verified_vocabulary_rows, 50257, 'Every vocabulary logit must match the CPU reference');
        // The kernel emits PhaseComplete for completed output vectors, but not individual
        // attention score heads (phase4). Their effect is covered by the full attention output.
        const expectedEvents = Object.entries(expected.positions[position].stages).filter(([, item]) => item.completed_phase !== null && item.completed_phase !== 4 && item.vector_id !== null).map(([name]) => name).sort();
        assert.deepEqual(record.reference_checks.map(item => item.name).sort(), expectedEvents, 'Every emitted phase vector must match its independent reference exactly once');
        assert.equal(await chains[0].value(routers[0], 'latestResult'), BigInt(expected.positions[position].next_token_id));
        assert.equal(await chains[0].value(routers[0], 'latestResultPosition'), BigInt(position));
        assert.equal(await chains[0].value(routers[0], 'finalizedCount'), BigInt(position + 1));
        record.output_token = Number(await chains[0].value(routers[0], 'latestResult'));
        record.complete = true;
        record.model_gas = record.stages.reduce((sum, stage) => sum + stage.gas, 0n);
        // Full hidden bytes remain in the canonical receipt ledger; keep the high-level report compact.
        for (const message of record.messages) delete message.hidden;
        report.tokens.push(record); delete report.active_token; inputToken = record.output_token;
        console.log(`Completed position${position}: token${inputToken}; model gas${record.model_gas}`); save();
      }
      report.generated_token_ids = report.tokens.map(token => token.output_token);
      check('complete_124439808_parameter_model_executed_on_four_local_EVMs_for_every_requested_position', { positions: tokenCount });
      check('all_emitted_phase_vector_and_full_50257_logit_commitments_match_independent_CPU_reference');
      if (tokenCount >= 2) check('all_KV_entries_persist_and_match_reference_after_second_token_without_reset');
    }
    assertSourcesUnchanged(compiled);
    report.status = args.includes('--deploy-only') ? 'PASS_FOUR_CHAIN_COMPLETE_MODEL_DEPLOYMENT_ONLY' : 'PASS_FOUR_CHAIN_FULL_MODEL_LOCAL_BENCHMARK';
  }
  report.completed_at = new Date().toISOString(); save(); console.log(json({ status: report.status, report: reportFile, totals: report.totals }));
} catch (error) {
  report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; report.failed_at = new Date().toISOString(); save();
  console.error(error); process.exitCode = 1;
} finally { await Promise.allSettled(chains.map(chain => chain.stop())); }
