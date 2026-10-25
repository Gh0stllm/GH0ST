// V2 exact-arithmetic comparison on native Monad. CPU boundary vectors are explicit fixtures.
// This is a partial-model microbenchmark: real block0 or block11 plus a real vocabulary-head prefix.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, compile, assertSourcesUnchanged, confinedOutput, sha256, json } from '../scripts/build.mjs';
import { ethers, addressRuntime, packedInt32, checkpoint } from './harness.mjs';
import { startOptimizedChain } from './optimized-runtime.mjs';

const args = process.argv.slice(2);
assert(args.every(arg => /^--(?:out|profile|rows|mode|head-rows)=/.test(arg)));
const option = (key, fallback) => args.find(arg => arg.startsWith('--' + key + '='))?.slice(key.length + 3) ?? fallback;
const profile = option('profile', 'monad'), rows = Number(option('rows', '64'));
const mode=option('mode','block'), firstLayer=mode==='head'?11:0, output=mode==='head';
const headRows=Number(option('head-rows','2048'));
assert(['block','head'].includes(mode));assert(Number.isInteger(headRows)&&headRows>=1&&headRows<=50257);
assert(['ethereum', 'monad'].includes(profile)); assert(Number.isInteger(rows) && rows >= 1 && rows <= 64);
const outputDirectory = confinedOutput(option('out', `reports/v2-engine-${mode}-${profile}`));
fs.mkdirSync(outputDirectory, { recursive: true });
const ledgerFile = path.join(outputDirectory, 'transactions.jsonl'); fs.writeFileSync(ledgerFile, '');
const data = [path.join(HERE, 'data'), path.resolve(HERE, '../gpt2-bsc/data')].find(dir => fs.existsSync(path.join(dir, 'manifest.json')));
assert(data, 'Canonical local data required');
const manifest = JSON.parse(fs.readFileSync(path.join(data, 'manifest.json'))), reference = JSON.parse(fs.readFileSync(path.join(data, 'reference-report.json')));
const expected = reference.cases.find(item => item.id === 'eos');
const report = { status: 'RUNNING', scope: 'EXPLICIT_CPU_INPUT_FIXTURE_REAL_TRANSFORMER_BLOCK_AND_OPTIONAL_HEAD_PREFIX',
  public_transactions_submitted: 0, full_model_inference: false, profile, mode, firstLayer, headRows:output?headRows:0, max_rows: rows, variants: [],
  model_id: manifest.model_id_hash, reference_sha256: sha256(fs.readFileSync(path.join(data, 'reference-report.json'))) };
const save = () => fs.writeFileSync(path.join(outputDirectory, 'results.json'), json(report));
const readReference = descriptor => {
  const bytes = fs.readFileSync(path.join(data, descriptor.file)); assert.equal(sha256(bytes), descriptor.sha256);
  return { bytes, values: Array.from({ length: descriptor.count }, (_, i) => BigInt(bytes.readInt32BE(i * 4))) };
};
let chain;
try {
  const build = compile({ outputDirectory }); report.compiler = build.compiler;
  assert(build.artifacts.GPT2ShardOptimizedV2, 'V2 candidate engine is absent');
  chain = await startOptimizedChain({ config: { stage: 0, chain_id: profile === 'monad' ? 143 : 56,
    endpoint_id: profile === 'monad' ? 30390 : 30102, profile },
    onTransaction: entry => fs.appendFileSync(ledgerFile, JSON.stringify(entry, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n') });
  report.environment = chain.environment;
  const catalog = Array(77).fill(ethers.ZeroAddress);
  for (const id of [...(output?[0,2]:[]),...Array.from({length:6},(_,i)=>3+firstLayer*6+i),75,76]) {
    const tensor = manifest.tensors[id], bytes = fs.readFileSync(path.join(data, tensor.file)); assert.equal(sha256(bytes), tensor.sha256);
    const shards = [];
    for (const [index, descriptor] of tensor.shards.entries()) {
      const runtime = Buffer.concat([Buffer.from([0]), bytes.subarray(descriptor.offset, descriptor.offset + descriptor.length)]);
      assert.equal(sha256(runtime), descriptor.runtime_sha256);
      shards.push((await chain.deployRuntime(runtime, `real layer0 tensor${id} shard${index}`)).address);
    }
    let addresses=shards;
    if(shards.length>767){addresses=[];for(let start=0;start<shards.length;start+=767)addresses.push((await chain.deployRuntime(addressRuntime(shards.slice(start,start+767)),`real tensor${id} catalog page`)).address);}
    catalog[id] = (await chain.deployRuntime(addressRuntime(addresses), `real tensor${id} catalog`)).address;
  }
  const root = await chain.deployRuntime(addressRuntime(catalog), 'real layer0 root');
  const engines = [];
  for (const name of ['GPT2ShardOptimized', 'GPT2ShardOptimizedV2']) {
    const engine = await chain.deploy(build.artifacts[name], [root.address, root.keccak256, manifest.model_id_hash,
      chain.chainId, firstLayer, firstLayer+1, false, output, chain.accounts[0]], name);
    engines.push(engine);
    report.variants.push({ name, address:engine.address, runtime_bytes: engine.runtimeBytes, positions: [], compute_gas: 0n });
  }
  for (let position = 0; position < (output?1:2); position++) {
    for (const [variantIndex, engine] of engines.entries()) {
      const variant = report.variants[variantIndex], cpu = expected.positions[position];
      const inputDescriptor=cpu.stages[output?'l10-residual2':'embedding'];
      const input = ethers.hexlify(readReference(inputDescriptor).bytes);
      const begin = await chain.tx(engine, 'begin', [position, cpu.input_token_id, ethers.id('explicit-micro-input'), input], { category: 'input_fixture' });
      assert.equal(begin.status, '0x1');
      const record = { position, input_fixture_sha256: inputDescriptor.sha256, input_fixture_gas: begin.gasUsed,
        gas: 0n, phases: {}, reference_checks: [], verified_head_rows:0, transactions: 0 };
      variant.positions.push(record);
      let state = checkpoint(await chain.view(engine, 'checkpoint'));
      while (output ? !(state.phase===11n && state.cursor>=BigInt(headRows)) && state.phase!==12n : state.phase!==13n) {
        const before = state;
        const limit=output&&state.phase===11n?Math.min(rows,headRows-Number(state.cursor)):rows;
        const receipt = await chain.tx(engine, 'advance', [state.stepNumber, limit], { category: 'model_compute' });
        assert.equal(receipt.status, '0x1', `Real layer0 advance failed ${variant.name} phase${state.phase} cursor${state.cursor}`);
        record.gas += receipt.gasUsed; record.transactions++;
        record.phases[before.phase] = (record.phases[before.phase] ?? 0n) + receipt.gasUsed;
        state = checkpoint(await chain.view(engine, 'checkpoint')); assert(state.stepNumber > before.stepNumber);
        for (const log of receipt.logs.filter(log => log.address.toLowerCase() === engine.address.toLowerCase())) {
          const event = engine.interface.parseLog(log);
          if(event?.name==='LogitChunk'){assert.equal(Number(event.args.start),record.verified_head_rows);record.verified_head_rows+=Number(event.args.count);const values=readReference(cpu.stages.logits).values.slice(Number(event.args.start),Number(event.args.start+event.args.count));assert.equal(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['int256[]'],[values])),event.args.logitsHash);continue;}
          if (event?.name !== 'PhaseComplete') continue;
          const match = Object.entries(cpu.stages).find(([, item]) => item.completed_phase !== null && item.vector_id !== null &&
            Number(item.completed_phase) === Number(event.args.phase) && (item.layer === null || item.layer === firstLayer || (output&&item.layer===12)) &&
            (item.head === null || item.head === Number(event.args.head)));
          assert(match); const [name, descriptor] = match;
          assert.equal(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['int256[]'], [readReference(descriptor).values])), event.args.vectorHash, name);
          record.reference_checks.push(name);
        }
      }
      if(output)assert.equal(record.verified_head_rows,headRows);
      const hidden = output ? ethers.hexlify(packedInt32(await chain.value(engine,'readVector',[1,0,768]))) : await chain.value(engine, 'exportHidden');
      assert.equal(sha256(ethers.getBytes(hidden)),cpu.stages[output?'final-ln':'l00-residual2'].sha256);
      for (let cached = 0; cached <= position; cached++) for (const value of [false, true]) {
        const actual = await chain.value(engine, 'readKV', [firstLayer, cached, value]);
        const qkv = readReference(expected.positions[cached].stages[output?'l11-qkv':'l00-qkv']).values;
        assert.deepEqual(Array.from(actual), qkv.slice(value ? 1536 : 768, value ? 2304 : 1536));
      }
      const names = Object.entries(cpu.stages).filter(([, item]) => (item.layer===firstLayer||(output&&item.layer===12)) && item.completed_phase !== null && item.completed_phase !== 4 && item.vector_id !== null).map(([name]) => name).sort();
      assert.deepEqual(record.reference_checks.sort(), names);
      variant.compute_gas += record.gas; record.output_sha256 = sha256(ethers.getBytes(hidden)); save();
      console.log(`${variant.name} position${position}: ${record.gas} gas; ${record.reference_checks.length} CPU phase vectors verified`);
    }
    assert.equal(report.variants[0].positions[position].output_sha256, report.variants[1].positions[position].output_sha256);
  }
  const selectedPaths=Object.fromEntries(Object.entries(build.resolvedPaths).filter(([name])=>['contracts/GPT2ShardOptimized.sol','contracts/GPT2DotOptimized.sol','contracts/GPT2ShardOptimizedV2.sol','contracts/GPT2DotOptimizedV2.sol'].includes(name)));
  assertSourcesUnchanged({...build,resolvedPaths:selectedPaths});
  const entries=fs.readFileSync(ledgerFile,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  for(const variant of report.variants){const entriesFor=entries.filter(entry=>entry.category==='model_compute'&&entry.to?.toLowerCase()===variant.address.toLowerCase());variant.declared_gas=entriesFor.reduce((sum,entry)=>sum+BigInt(entry.declared_gas),0n);variant.billed_gas_scenario=profile==='monad'?variant.declared_gas:variant.compute_gas;}
  report.billed_gas_savings=report.variants[0].billed_gas_scenario-report.variants[1].billed_gas_scenario;
  report.billed_gas_savings_percent=Number(report.billed_gas_savings)/Number(report.variants[0].billed_gas_scenario)*100;
  report.gas_savings = report.variants[0].compute_gas - report.variants[1].compute_gas;
  report.gas_savings_percent = Number(report.gas_savings) / Number(report.variants[0].compute_gas) * 100;
  report.status = 'PASS_V2_REAL_BLOCK_HEAD_SAMPLE_EQUIVALENCE'; save(); console.log(json(report));
} catch (error) { report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; save(); throw error; }
finally { if (chain) await chain.stop(); }
