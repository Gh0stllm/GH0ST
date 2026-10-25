// One RH request, all GPT-2 arithmetic on the selected compute chain, one final RH result; local EVMs only.
// Weight data enters only through CREATE; CPU reference vectors are assertions, never engine inputs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, compile, assertSourcesUnchanged, confinedOutput, json, sha256 } from './build.mjs';
import { ethers, CAP, BLOCK_LIMIT, addressRuntime, checkpoint, packedInt32, decodePacket } from '../tests/harness.mjs';
import { startLayoutChains, deliverLayoutPacket } from '../tests/optimized-layout.mjs';
import { makeJobPlan } from './job-plan.mjs';

const args = process.argv.slice(2);
assert(args.every(arg => /^--(?:out|tokens|rows|target-gas|engine|compute)=/.test(arg) || ['--check-inputs', '--deploy-only', '--no-batch'].includes(arg)),
  'Unknown option: public RPC URLs and broadcasting are forbidden');
const option = (name, fallback) => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const computeChain = option('compute', 'monad');
assert(['monad', 'opbnb'].includes(computeChain), 'Only canonical verified compute chains are allowed');
const outputDirectory = confinedOutput(option('out', computeChain === 'monad' ? 'reports/job-two-chain-full' : 'reports/job-opbnb-full'));
fs.mkdirSync(outputDirectory, { recursive: true });
const reportFile = path.join(outputDirectory, 'results.json'), ledgerFile = path.join(outputDirectory, 'transactions.jsonl');
fs.writeFileSync(ledgerFile, '');
const tokenCount = Number(option('tokens', '2')), requestedRows = Number(option('rows', '512'));
const requestedTargetGas = option('target-gas', null), batching = !args.includes('--no-batch');
assert(Number.isInteger(tokenCount) && tokenCount >= 1 && tokenCount <= 3, 'Reference supports 1..3 token positions');
assert(Number.isInteger(requestedRows) && requestedRows >= 1 && requestedRows <= 512, 'Rows must be 1..512');
if (requestedTargetGas) assert(BigInt(requestedTargetGas) > 1_000_000n && BigInt(requestedTargetGas) <= 30000000n);
const MODEL_ID = '0xd5fe104a83865bb22299096cafcfe77eb1642fff8ddf0047306b4801599b4107';
const CHECKPOINT = '248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707';
const range = (start, end) => Array.from({ length: end - start }, (_, i) => start + i);
const dataDirectory = [path.join(HERE, 'data'), path.resolve(HERE, '../gpt2-bsc/data')].find(base => fs.existsSync(path.join(base, 'manifest.json')));
assert(dataDirectory, 'Missing canonical model data: run model preparation first');
const selectedPlan = makeJobPlan(dataDirectory, { verify: false, computeChain });
const stageConfig = selectedPlan.stages.map(stage => ({
  name: { robinhood: 'Robinhood', monad: 'Monad', opbnb: 'opBNB' }[stage.key], stage: stage.stage,
  chain_id: stage.chainId, endpoint_id: stage.eid, role: stage.role,
  first: stage.layerRange[0], end: stage.layerRange[1], embedding: stage.doesEmbedding, output: stage.doesOutput,
  tensors: stage.tensorIds, profile: stage.profile, maxTransactionGas: stage.maxTransactionGas,
  targetGas: String(BigInt(stage.maxTransactionGas) * 97n / 100n),
}));
const layout = { name: `whole-model-${computeChain}-job`, mode: 'whole-model-job', stages: stageConfig };
if (requestedTargetGas) for (const config of stageConfig) {
  config.targetGas = String(BigInt(requestedTargetGas) < BigInt(config.maxTransactionGas) ? BigInt(requestedTargetGas) : BigInt(config.maxTransactionGas));
}
const EIDS = stageConfig.map(stage => stage.endpoint_id);
const engineName = option('engine', 'GPT2ShardOptimized'), routerName = 'GPT2JobOApp';
assert(/^GPT2Shard(?:Optimized[A-Za-z0-9]*)?$/.test(engineName), 'Only actual model engine artifacts are allowed');
assert.equal(routerName, 'GPT2JobOApp');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
let routeId;
const sessionId = ethers.id('LOCAL_WHOLE_MODEL_JOB_SESSION:' + engineName + ':' + computeChain);
const report = { schema_version: 1, status: 'RUNNING', started_at: new Date().toISOString(),
  mode: `WHOLE_MODEL_${computeChain.toUpperCase()}_JOB_REAL_GPT2_MATH_SIMULATED_TRANSPORT`, compute_chain: computeChain, public_transactions_submitted: 0,
  weight_data_injected: false, host_inference_results_injected: false, batch_small_phases: batching,
  chain_count: stageConfig.length, stages: stageConfig, layout, route_id: routeId, session_id: sessionId, requested_token_positions: tokenCount,
  home_has_model_weights: false, interchain_messages_per_job: 2,
  engine_artifact: engineName, router_artifact: routerName,
  stage_gas_ceilings: stageConfig.map(stage => ({ stage: stage.stage, maximum: stage.maxTransactionGas, target: stage.targetGas })),
  deployments: [], tokens: [], validations: [], preflight_calls: 0, preflight_profiles: [],
  totals: { transaction_count: 0, gas_by_category: {}, gas_by_stage: {}, billed_gas_by_stage: {}, all_measured_gas: 0n, all_billed_gas_scenario: 0n },
  limitations: [
    'Profiles are explicit per stage. Ethereum profiles use generic Cancun; the Monad profile records its native Anvil fork. Public gas prices, finality and inclusion latency are not measured here.',
    'MockEndpoint carries exact official OApp packet bytes but has no DVNs, message proofs, validator security, production executor, or real messaging fees.',
    'No live gas savings are established by this local benchmark. Gas units on separate chains are not interchangeable monetary costs.',
    'The complete quantized INT8/Q12 GPT-2 model is deterministic but is not bit-identical to the floating-point checkpoint.',
    `Every model tensor is deployed once on ${stageConfig[1].name}; RH stores no weights and runs no embedding or transformer arithmetic.`,
    'Monad fee scenarios count declared gas limits; other stages count receipt gas. Zero local test gas prices are not live monetary fee measurements.',
    'Tokenization/display decoding and reference checking happen on the CPU. Every model activation, transformer block, KV update, and vocabulary row is computed by the real Solidity engine.',
    'Export is charged inside dispatch; model import/begin and simulated receive/send costs are separately labeled. Read-only verification calls incur no paid transaction gas.',
  ] };
const save = () => fs.writeFileSync(reportFile, json(report));
const check = (name, details = {}) => report.validations.push({ name, passed: true, ...details });
save();
let chains = [], compiled, deployedBuild;
function selectedDeploymentBuild(build) {
  const names = new Set();
  const visit = name => {
    if (names.has(name)) return;
    const source = build.sources[name];
    assert(source, 'Selected deployment import missing from compiler input: ' + name);
    names.add(name);
    for (const match of source.content.matchAll(/import[\s\S]*?["']([^"']+)["']\s*;/g)) {
      const imported = match[1].startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])) : match[1];
      visit(imported);
    }
  };
  for (const name of [engineName, routerName, 'MockEndpoint']) {
    assert(build.artifacts[name], 'Selected deployment artifact missing: ' + name);
    visit(build.artifacts[name].sourceFile);
  }
  report.selected_source_sha256 = Object.fromEntries([...names].sort().map(name => [name, build.compiler.source_sha256[name]]));
  report.source_assertion_scope = 'Selected engine, router, transport mock and every transitive Solidity import remain unchanged. Full initial compiler input is retained; unreferenced research sources may change independently.';
  return { ...build, resolvedPaths: Object.fromEntries([...names].map(name => [name, build.resolvedPaths[name]])) };
}
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
  const plan = selectedPlan;
  assert.equal(plan.modelId, MODEL_ID);
  for (const config of stageConfig) {
    const planned = plan.stages[config.stage];
    assert.equal(config.chain_id, planned.chainId); assert.equal(config.endpoint_id, planned.eid);
    assert.deepEqual([config.first, config.end], planned.layerRange);
    assert.equal(config.embedding, planned.doesEmbedding); assert.equal(config.output, planned.doesOutput);
    assert.deepEqual(config.tensors, planned.tensorIds);
  }
  routeId = plan.routeId;
  report.route_id = routeId;
  report.partition = { routeId, ...plan.totals, home_model_tensors: 0, compute_model_tensors: 77, model_copies: 1 };
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
  assert.equal(stageConfig.at(-1).end, 12);
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
  const targetGas = chain.targetGas;
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
  const record = { stage: config.stage, name: config.name, gas: 0n, transactions: 0, advances: [], minimum_gas_reserve: chain.cap };
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
    record.minimum_gas_reserve = record.minimum_gas_reserve < chain.cap - receipt.gasUsed ? record.minimum_gas_reserve : chain.cap - receipt.gasUsed;
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

const jobPacketType = 'tuple(uint8 version,uint8 kind,bytes32 routeId,bytes32 modelId,bytes32 sessionId,bytes32 jobId,bytes32 promptHash,uint32 maxNewTokens,bytes32 trace,bytes tokens)';
const decodeJobPacket = bytes => ethers.AbiCoder.defaultAbiCoder().decode([jobPacketType], bytes)[0];
const packTokens = ids => {
  const bytes = Buffer.alloc(ids.length * 4);
  ids.forEach((id, i) => { assert(Number.isInteger(Number(id)) && id >= 0 && id < 50257); bytes.writeUInt32BE(Number(id), i * 4); });
  return ethers.hexlify(bytes);
};

try {
  const { manifest, tensors, expected } = loadInputs();
  compiled = compile({ outputDirectory }); report.compiler = compiled.compiler;
  deployedBuild = selectedDeploymentBuild(compiled);
  assert(compiled.artifacts[engineName] && compiled.artifacts[routerName] && compiled.artifacts.MockEndpoint);
  report.artifact_roles = { model_engine: engineName, router: routerName, transport_only: 'MockEndpoint', mock_model_instantiated: false };
  check('all_compiled_runtimes_fit_EIP170'); save();
  if (args.includes('--check-inputs')) {
    assertSourcesUnchanged(deployedBuild); report.status = 'PASS_OFFLINE_INPUT_AND_BUILD_PREFLIGHT';
  } else {
    chains = await startLayoutChains(stageConfig, { onTransaction: entry => {
      fs.appendFileSync(ledgerFile, JSON.stringify(entry, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
      report.totals.transaction_count++;
      report.totals.all_measured_gas += entry.gas;
      report.totals.gas_by_category[entry.category] = (report.totals.gas_by_category[entry.category] ?? 0n) + entry.gas;
      report.totals.gas_by_stage[entry.stage] = (report.totals.gas_by_stage[entry.stage] ?? 0n) + entry.gas;
      const billed = entry.billed_gas_scenario ?? entry.gas;
      report.totals.billed_gas_by_stage[entry.stage] = (report.totals.billed_gas_by_stage[entry.stage] ?? 0n) + billed;
      report.totals.all_billed_gas_scenario += billed;
    } });
    report.environment = chains.map(chain => chain.environment);
    const compute = chains[1], home = chains[0], computeConfig = stageConfig[1];
    const root = await deployData(compute, computeConfig, manifest, tensors);
    const endpoints = [], routers = [];
    const now = Number((await home.rpc('eth_getBlockByNumber', ['latest', false])).timestamp), deadline = now + 30 * 86400;
    report.deadline = deadline;
    for (let stage = 0; stage < 2; stage++) {
      const chain = chains[stage];
      endpoints.push(await chain.deploy(compiled.artifacts.MockEndpoint, [EIDS[stage]], 'MockEndpoint'));
      routers.push(await chain.deploy(compiled.artifacts[routerName], [endpoints[stage].address, chain.accounts[0], chain.accounts[0],
        stage === 0, EIDS[0], EIDS[1], routeId, sessionId, deadline], routerName));
      for (const [kind, item] of [['transport_mock', endpoints[stage]], ['job_router', routers[stage]]]) {
        report.deployments.push({ stage, kind, address: item.address, gas: item.receipt.gasUsed, transaction: item.receipt.transactionHash,
          runtime_bytes: item.runtimeBytes, runtime_keccak256: item.runtimeKeccak256 });
      }
    }
    const engine = await compute.deploy(compiled.artifacts[engineName], [root.address, root.keccak256, MODEL_ID, compute.chainId,
      0, 12, true, true, routers[1].address], engineName);
    report.deployments.push({ stage: 1, kind: 'real_model_engine', address: engine.address, gas: engine.receipt.gasUsed,
      transaction: engine.receipt.transactionHash, runtime_bytes: engine.runtimeBytes, runtime_keccak256: engine.runtimeKeccak256 });
    assert.equal((await compute.tx(routers[1], 'bindEngine', [engine.address], { category: 'route_setup' })).status, '0x1');
    for (let stage = 0; stage < 2; stage++) {
      assert.equal((await chains[stage].tx(routers[stage], 'setPeer', [EIDS[1 - stage], ethers.zeroPadValue(routers[1 - stage].address, 32)], { category: 'route_setup' })).status, '0x1');
      assert.equal((await chains[stage].tx(routers[stage], 'sealRoute', [], { category: 'route_setup' })).status, '0x1');
    }
    assert.equal(await home.value(routers[0], 'engine'), ethers.ZeroAddress, 'RH job router must have no model engine');
    save();
    if (!args.includes('--deploy-only')) {
      report.job = { prompt_token_ids: expected.input_ids, requested_outputs: tokenCount, messages: [] };
      const prompt = packTokens(expected.input_ids);
      const requestQuote = await home.value(routers[0], 'quoteRequest', [prompt, tokenCount]);
      assert.equal(requestQuote.nativeFee, 0n); assert.equal(requestQuote.lzTokenFee, 0n);
      const requestReceipt = await home.tx(routers[0], 'requestJob', [prompt, tokenCount], { category: 'job_request_send' });
      assert.equal(requestReceipt.status, '0x1');
      const request = await home.value(endpoints[0], 'packet', [0]), requestData = decodeJobPacket(request.message);
      assert.equal(requestData.version, 2n); assert.equal(requestData.kind, 1n); assert.equal(requestData.tokens, prompt);
      assert.equal(requestData.routeId, routeId); assert.equal(requestData.maxNewTokens, BigInt(tokenCount));
      const beforeReceive = await compute.value(engine, 'phase');
      const requestReceive = await deliverLayoutPacket(stageConfig, chains, endpoints, routers, request, { gas: 500000n });
      assert.equal(requestReceive.status, '0x1'); assert.equal(await compute.value(engine, 'phase'), beforeReceive, 'Request delivery cannot run model math');
      report.job.job_id = requestData.jobId;
      report.job.messages.push({ kind: 'request', source: 0, destination: 1, bytes: ethers.getBytes(request.message).length,
        packet_sha256: sha256(ethers.getBytes(request.message)), guid: request.guid, send_gas: requestReceipt.gasUsed, receive_gas: requestReceive.gasUsed });
      const started = await compute.tx(routers[1], 'activateJob', [prompt], { category: 'job_control_and_begin' });
      assert.equal(started.status, '0x1');
      for (let position = 0; position < tokenCount; position++) {
        const inputToken = Number(await compute.value(engine, 'pendingToken'));
        assert.equal(inputToken, expected.positions[position].input_token_id, 'On-chain continuation must match independent reference input');
        const record = { position, input_token: inputToken, stages: [], messages: [], reference_checks: [], logit_checks: [], kv_checks: [], completed_layers: [], verified_vocabulary_rows: 0 };
        report.active_token = record;
        const end = await executeStage(compute, engine, computeConfig, expected.positions[position], record);
        await verifyKV(compute, engine, computeConfig, expected, position, record);
        assert.equal(Number(end.bestToken), expected.positions[position].next_token_id);
        assert.equal(end.bestLogit, referenceVector(dataDirectory, expected.positions[position].stages.logits).values[Number(end.bestToken)]);
        assert.deepEqual([...record.completed_layers].sort((a, b) => a - b), range(0, 12));
        assert.equal(record.verified_vocabulary_rows, 50257);
        const expectedEvents = Object.entries(expected.positions[position].stages).filter(([, item]) => item.completed_phase !== null && item.completed_phase !== 4 && item.vector_id !== null).map(([name]) => name).sort();
        assert.deepEqual(record.reference_checks.map(item => item.name).sort(), expectedEvents);
        const continued = await compute.tx(routers[1], 'continueJob', [], { category: 'job_control_and_next_begin' });
        assert.equal(continued.status, '0x1');
        assert.equal(await compute.value(routers[1], 'processedPositions'), BigInt(position + 1));
        record.continuation_gas = continued.gasUsed;
        record.output_token = Number(end.bestToken); record.model_gas = record.stages.reduce((sum, stage) => sum + stage.gas, 0n); record.complete = true;
        report.tokens.push(record); delete report.active_token;
        console.log(`Job position${position}: token${record.output_token}; model gas${record.model_gas}`); save();
      }
      assert.equal(await compute.value(routers[1], 'completed'), true);
      const generated = Array.from(await compute.value(routers[1], 'generatedTokens'), Number);
      assert.deepEqual(generated, report.tokens.map(token => token.output_token));
      assert.equal(generated.length, tokenCount);
      const resultBytes = await compute.value(routers[1], 'resultPacket'), resultData = decodeJobPacket(resultBytes), packedOutput = packTokens(generated);
      assert.equal(resultData.kind, 2n); assert.equal(resultData.tokens, packedOutput); assert.equal(resultData.jobId, requestData.jobId);
      const resultQuote = await compute.value(routers[1], 'quoteResult'); assert.equal(resultQuote.nativeFee, 0n); assert.equal(resultQuote.lzTokenFee, 0n);
      const sent = await compute.tx(routers[1], 'dispatchResult', [], { category: 'job_result_send' }); assert.equal(sent.status, '0x1');
      const result = await compute.value(endpoints[1], 'packet', [0]); assert.equal(result.message, resultBytes);
      const received = await deliverLayoutPacket(stageConfig, chains, endpoints, routers, result, { gas: 500000n }); assert.equal(received.status, '0x1');
      assert.equal(await home.value(routers[0], 'resultFinalized'), true);
      assert.equal(await home.value(routers[0], 'resultCount'), BigInt(tokenCount));
      assert.equal(await home.value(routers[0], 'outputHash'), ethers.keccak256(packedOutput));
      assert.equal(await home.value(routers[0], 'verifyResult', [packedOutput]), true);
      assert.equal(await home.value(endpoints[0], 'packetCount'), 1n); assert.equal(await compute.value(endpoints[1], 'packetCount'), 1n);
      report.job.messages.push({ kind: 'result', source: 1, destination: 0, bytes: ethers.getBytes(resultBytes).length,
        packet_sha256: sha256(ethers.getBytes(resultBytes)), guid: result.guid, send_gas: sent.gasUsed, receive_gas: received.gasUsed });
      report.generated_token_ids = generated;
      check('one_request_and_one_final_result_for_entire_job', { packet_count: 2 });
      check('all_model_weights_and_math_on_compute_chain_no_model_on_home', { compute_chain: computeChain });
      check('all_124439808_parameters_twelve_blocks_and_full_vocabulary_executed_for_every_position', { positions: tokenCount });
      check('all_emitted_phase_vectors_and_full_logits_match_independent_CPU_reference');
      if (tokenCount >= 2) check('all_KV_entries_persist_and_match_reference_after_second_token_without_reset');
    }
    assertSourcesUnchanged(deployedBuild);
    report.status = args.includes('--deploy-only') ? 'PASS_WHOLE_MODEL_JOB_DEPLOYMENT_ONLY' : 'PASS_WHOLE_MODEL_JOB_LOCAL_BENCHMARK';
  }
  report.completed_at = new Date().toISOString(); save(); console.log(json({ status: report.status, report: reportFile, totals: report.totals }));
} catch (error) {
  report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; report.failed_at = new Date().toISOString(); save();
  console.error(error); process.exitCode = 1;
} finally { await Promise.allSettled(chains.map(chain => chain.stop())); }
