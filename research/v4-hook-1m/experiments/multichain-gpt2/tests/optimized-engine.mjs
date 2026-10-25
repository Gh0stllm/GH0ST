// Real layer-0 arithmetic microbenchmark. CPU embeddings are explicit input fixtures.
// This is not a full-model run: only the first block and its KV cache are executed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, compile, assertSourcesUnchanged, confinedOutput, sha256, json } from '../scripts/build.mjs';
import { ethers, addressRuntime, packedInt32, checkpoint } from './harness.mjs';
import { startOptimizedChain } from './optimized-runtime.mjs';

const args = process.argv.slice(2);
assert(args.every(arg => /^--(?:out|profile|rows)=/.test(arg)));
const option = (key, fallback) => args.find(arg => arg.startsWith('--' + key + '='))?.slice(key.length + 3) ?? fallback;
const profile = option('profile', 'ethereum'), rows = Number(option('rows', '64'));
assert(['ethereum', 'monad'].includes(profile)); assert(Number.isInteger(rows) && rows >= 1 && rows <= 64);
const outputDirectory = confinedOutput(option('out', `reports/optimized-engine-${profile}`));
fs.mkdirSync(outputDirectory, { recursive: true });
const ledgerFile = path.join(outputDirectory, 'transactions.jsonl'); fs.writeFileSync(ledgerFile, '');
const data = [path.join(HERE, 'data'), path.resolve(HERE, '../gpt2-bsc/data')].find(dir => fs.existsSync(path.join(dir, 'manifest.json')));
assert(data, 'Canonical local data required');
const manifest = JSON.parse(fs.readFileSync(path.join(data, 'manifest.json'))), reference = JSON.parse(fs.readFileSync(path.join(data, 'reference-report.json')));
const expected = reference.cases.find(item => item.id === 'eos');
const report = { status: 'RUNNING', scope: 'TWO_POSITION_REAL_LAYER0_MICROBENCHMARK_WITH_CPU_EMBEDDING_INPUT_FIXTURES',
  public_transactions_submitted: 0, full_model_inference: false, profile, max_rows: rows, variants: [],
  model_id: manifest.model_id_hash, reference_sha256: sha256(fs.readFileSync(path.join(data, 'reference-report.json'))) };
const save = () => fs.writeFileSync(path.join(outputDirectory, 'results.json'), json(report));
const readReference = descriptor => {
  const bytes = fs.readFileSync(path.join(data, descriptor.file)); assert.equal(sha256(bytes), descriptor.sha256);
  return { bytes, values: Array.from({ length: descriptor.count }, (_, i) => BigInt(bytes.readInt32BE(i * 4))) };
};
let chain;
try {
  const build = compile({ outputDirectory }); report.compiler = build.compiler;
  assert(build.artifacts.GPT2ShardOptimized, 'Candidate engine is absent');
  chain = await startOptimizedChain({ config: { stage: 0, chain_id: profile === 'monad' ? 143 : 56,
    endpoint_id: profile === 'monad' ? 30390 : 30102, profile },
    onTransaction: entry => fs.appendFileSync(ledgerFile, JSON.stringify(entry, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n') });
  report.environment = chain.environment;
  const catalog = Array(77).fill(ethers.ZeroAddress);
  for (const id of [3, 4, 5, 6, 7, 8, 75, 76]) {
    const tensor = manifest.tensors[id], bytes = fs.readFileSync(path.join(data, tensor.file)); assert.equal(sha256(bytes), tensor.sha256);
    const shards = [];
    for (const [index, descriptor] of tensor.shards.entries()) {
      const runtime = Buffer.concat([Buffer.from([0]), bytes.subarray(descriptor.offset, descriptor.offset + descriptor.length)]);
      assert.equal(sha256(runtime), descriptor.runtime_sha256);
      shards.push((await chain.deployRuntime(runtime, `real layer0 tensor${id} shard${index}`)).address);
    }
    assert(shards.length <= 767, 'Microbenchmark expects direct catalogs');
    catalog[id] = (await chain.deployRuntime(addressRuntime(shards), `real tensor${id} catalog`)).address;
  }
  const root = await chain.deployRuntime(addressRuntime(catalog), 'real layer0 root');
  const engines = [];
  for (const name of ['GPT2Shard', 'GPT2ShardOptimized']) {
    const engine = await chain.deploy(build.artifacts[name], [root.address, root.keccak256, manifest.model_id_hash,
      chain.chainId, 0, 1, false, false, chain.accounts[0]], name);
    engines.push(engine);
    report.variants.push({ name, runtime_bytes: engine.runtimeBytes, positions: [], compute_gas: 0n });
  }
  for (let position = 0; position < 2; position++) {
    for (const [variantIndex, engine] of engines.entries()) {
      const variant = report.variants[variantIndex], cpu = expected.positions[position];
      const input = ethers.hexlify(readReference(cpu.stages.embedding).bytes);
      const begin = await chain.tx(engine, 'begin', [position, cpu.input_token_id, ethers.id('explicit-micro-input'), input], { category: 'input_fixture' });
      assert.equal(begin.status, '0x1');
      const record = { position, input_fixture_sha256: cpu.stages.embedding.sha256, input_fixture_gas: begin.gasUsed,
        gas: 0n, phases: {}, reference_checks: [], transactions: 0 };
      variant.positions.push(record);
      let state = checkpoint(await chain.view(engine, 'checkpoint'));
      while (state.phase !== 13n) {
        const before = state;
        const receipt = await chain.tx(engine, 'advance', [state.stepNumber, rows], { category: 'model_compute' });
        assert.equal(receipt.status, '0x1', `Real layer0 advance failed ${variant.name} phase${state.phase} cursor${state.cursor}`);
        record.gas += receipt.gasUsed; record.transactions++;
        record.phases[before.phase] = (record.phases[before.phase] ?? 0n) + receipt.gasUsed;
        state = checkpoint(await chain.view(engine, 'checkpoint')); assert(state.stepNumber > before.stepNumber);
        for (const log of receipt.logs.filter(log => log.address.toLowerCase() === engine.address.toLowerCase())) {
          const event = engine.interface.parseLog(log);
          if (event?.name !== 'PhaseComplete') continue;
          const match = Object.entries(cpu.stages).find(([, item]) => item.completed_phase !== null && item.vector_id !== null &&
            Number(item.completed_phase) === Number(event.args.phase) && (item.layer === null || item.layer === 0) &&
            (item.head === null || item.head === Number(event.args.head)));
          assert(match); const [name, descriptor] = match;
          assert.equal(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['int256[]'], [readReference(descriptor).values])), event.args.vectorHash, name);
          record.reference_checks.push(name);
        }
      }
      const hidden = await chain.value(engine, 'exportHidden');
      assert.equal(sha256(ethers.getBytes(hidden)), cpu.stages['l00-residual2'].sha256);
      for (let cached = 0; cached <= position; cached++) for (const value of [false, true]) {
        const actual = await chain.value(engine, 'readKV', [0, cached, value]);
        const qkv = readReference(expected.positions[cached].stages['l00-qkv']).values;
        assert.deepEqual(Array.from(actual), qkv.slice(value ? 1536 : 768, value ? 2304 : 1536));
      }
      const names = Object.entries(cpu.stages).filter(([, item]) => item.layer === 0 && item.completed_phase !== null && item.completed_phase !== 4 && item.vector_id !== null).map(([name]) => name).sort();
      assert.deepEqual(record.reference_checks.sort(), names);
      variant.compute_gas += record.gas; record.output_sha256 = sha256(ethers.getBytes(hidden)); save();
      console.log(`${variant.name} position${position}: ${record.gas} gas; ${record.reference_checks.length} CPU phase vectors verified`);
    }
    assert.equal(report.variants[0].positions[position].output_sha256, report.variants[1].positions[position].output_sha256);
  }
  assertSourcesUnchanged(build);
  report.gas_savings = report.variants[0].compute_gas - report.variants[1].compute_gas;
  report.gas_savings_percent = Number(report.gas_savings) / Number(report.variants[0].compute_gas) * 100;
  report.status = 'PASS_REAL_LAYER0_CANDIDATE_EQUIVALENCE'; save(); console.log(json(report));
} catch (error) { report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; save(); throw error; }
finally { if (chain) await chain.stop(); }
