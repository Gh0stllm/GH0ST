import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, JsonRpcProvider, ContractFactory, ZeroAddress, keccak256 } from 'ethers';

const project = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = resolve(project, process.env.S0UL_FIXTURE_ROOT ?? 'exports/solidity-tests');
const reportPath = resolve(project, process.env.S0UL_INFERENCE_REPORT ?? 'reports/solidity-inference-local.json');
const stepsPerCall = Number(process.env.S0UL_ROWS_PER_STEP ?? 32);
const advanceGasLimit = stepsPerCall <= 32 ? 12000000 : 25000000;
const rpcURL = process.env.S0UL_RPC_URL ?? null;
if (rpcURL !== null) {
  const endpoint = new URL(rpcURL);
  assert.equal(endpoint.protocol, 'http:', 'Only a local development HTTP RPC is permitted');
  assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname), 'RPC backend must be a loopback development node');
  assert.equal(endpoint.username + endpoint.password, '', 'Development RPC URL must not contain credentials');
  assert.equal(endpoint.search + endpoint.hash, '', 'Development RPC URL must not contain a query or fragment');
}
assert.ok(Number.isInteger(stepsPerCall) && stepsPerCall >= 1 && stepsPerCall <= 128);
const fixtureNames = ['tiny-random', 'tiny-zero', 'tiny-eos'];
if (existsSync(join(fixtureRoot, 'full-model/model.json'))) fixtureNames.push('full-model');
if (existsSync(join(fixtureRoot, 'full-text/model.json'))) fixtureNames.push('full-text');
for (const name of fixtureNames) {
  assert.ok(existsSync(join(fixtureRoot, name, 'model.json')), `Missing ${name}; run scripts/make_solidity_vectors.py first`);
}
const sources = Object.fromEntries(readdirSync(join(project, 'contracts')).filter(name => name.endsWith('.sol')).map(name =>
  [name, { content: readFileSync(join(project, 'contracts', name), 'utf8') }]));
sources['FakeTokenizer.sol'] = { content: 'pragma solidity 0.8.30; contract FakeTokenizer { function domainSha256() external pure returns(bytes32) { return 0x7de4830b9e32e5884d2ee9776fdae6c8c1b42a9278342ae22d7105b039e9a726; } }' };
const compilerInput = { language: 'Solidity', sources, settings: {
  optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
} };
const compiled = JSON.parse(solc.compile(JSON.stringify(compilerInput)));
const errors = (compiled.errors ?? []).filter(error => error.severity === 'error');
assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
for (const file of ['S0ULModel.sol', 'S0ULInference.sol', 'S0ULTokenizer.sol']) {
  for (const [name, artifact] of Object.entries(compiled.contracts[file] ?? {})) {
    const codeBytes = artifact.evm.deployedBytecode.object.length / 2;
    assert.ok(codeBytes <= 24576, `${name} exceeds standard EIP-170 runtime code limit: ${codeBytes}`);
  }
}
const sha = data => createHash('sha256').update(data).digest('hex');
let rpc, provider, alice, bob, tokenizer;
const deployments = new Map();
const report = {
  format: 's0ul-complete-solidity-local-parity-v1',
  recorded_utc: new Date().toISOString(),
  compiler: { version: solc.version(), optimizer_runs: 200, via_ir: true, evm_version: 'shanghai' },
  chain: { kind: 'in-process Ganache', block_gas_limit: 30000000, unlimited_contract_size: false, public_chain_deployed: false },
  source_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, sha(Buffer.from(source.content))])),
  runtime_code_bytes: Object.fromEntries(['S0ULModel', 'S0ULInference', 'S0ULTokenizer'].map(name => [name, compiled.contracts[`${name}.sol`]?.[name]?.evm.deployedBytecode.object.length / 2])),
  cases: [],
  limits: ['Local EVM measurements are not Robinhood Chain fees or public deployment evidence.', 'Exact integer parity does not establish task correctness or autonomous action safety.', 'Tiny constructed fixtures test behavior; only an explicitly labelled full-model case exercises 984192 parameters.'],
};

function artifact(file, name) {
  const value = compiled.contracts[file]?.[name];
  assert.ok(value, `Missing artifact ${file}:${name}`);
  return value;
}
async function deploy(file, name, args = []) {
  const value = artifact(file, name);
  const contract = await new ContractFactory(value.abi, value.evm.bytecode.object, alice).deploy(...args, { gasLimit: 15000000 });
  const receipt = await contract.deploymentTransaction().wait();
  await contract.waitForDeployment();
  return { contract, gas: receipt.gasUsed };
}

async function deployFixture(name) {
  if (deployments.has(name)) return deployments.get(name);
  const directory = join(fixtureRoot, name);
  if (name === 'full-text' && deployments.has('full-model')) {
    const base = deployments.get('full-model');
    const expected = JSON.parse(readFileSync(join(directory, 'expected.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(directory, 'model.json'), 'utf8'));
    assert.equal(manifest.payload.sha256, base.manifest.payload.sha256);
    const fixture = { ...base, name, directory, expected, deploymentGas: 0n, reusedDeployment: 'full-model' };
    deployments.set(name, fixture);
    return fixture;
  }
  const manifest = JSON.parse(readFileSync(join(directory, 'model.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(join(directory, 'expected.json'), 'utf8'));
  const payload = readFileSync(join(directory, manifest.payload.path));
  assert.equal(sha(payload), manifest.payload.sha256);
  assert.equal(payload.length, manifest.payload.nbytes);
  const addresses = [], hashes = [];
  let deploymentGas = 0n;
  for (const shard of manifest.shards) {
    const tx = await alice.sendTransaction({ data: shard.initCodeHex, gasLimit: 6000000 });
    const receipt = await tx.wait();
    assert.ok(receipt.contractAddress);
    const runtime = await provider.getCode(receipt.contractAddress);
    assert.equal(keccak256(runtime), shard.runtimeKeccak256);
    assert.equal((runtime.length - 2) / 2, shard.runtimeBytes);
    assert.ok((runtime.length - 2) / 2 <= 24576);
    addresses.push(receipt.contractAddress);
    hashes.push(shard.runtimeKeccak256);
    deploymentGas += receipt.gasUsed;
  }
  const cfg = manifest.constructor.config ?? manifest.config;
  const modelArgs = [cfg, manifest.constructor.sourceCheckpoint, manifest.constructor.manifestHash, addresses, hashes, manifest.constructor.shardBytes];
  const { contract: model, gas: modelGas } = await deploy('S0ULModel.sol', 'S0ULModel', modelArgs);
  deploymentGas += modelGas;
  const tokenizerAddress = cfg.vocabSize === 512 && manifest.tokenizerDomainSha256 ? await tokenizer.getAddress() : ZeroAddress;
  const { contract: engine, gas: engineGas } = await deploy('S0ULInference.sol', 'S0ULInference', [await model.getAddress(), tokenizerAddress]);
  deploymentGas += engineGas;
  const fixture = { name, directory, manifest, expected, payload, addresses, hashes, modelArgs, model, engine, deploymentGas };
  deployments.set(name, fixture);
  return fixture;
}

async function begin(engine, prompt, maximum, text = null) {
  const call = text === null ? engine.begin : engine.beginText;
  const id = text === null ? await engine.begin.staticCall(prompt, maximum) : await engine.beginText.staticCall(text, maximum);
  const tx = text === null ? await engine.begin(prompt, maximum, { gasLimit: 10000000 }) : await engine.beginText(text, maximum, { gasLimit: 10000000 });
  return { id, receipt: await tx.wait() };
}

before(async () => {
  if (rpcURL !== null) {
    provider = new JsonRpcProvider(rpcURL, undefined, { cacheTimeout: -1, batchMaxCount: 1, pollingInterval: 10 });
    assert.equal(BigInt(await provider.send('eth_chainId', [])), 31337n, 'RPC must use local development chain 31337');
    const client = String(await provider.send('web3_clientVersion', []));
    assert.ok(client.toLowerCase().includes('anvil'), 'Native RPC backend must identify itself as Anvil');
    const block = await provider.getBlock('latest');
    assert.equal(block.gasLimit, 30000000n, 'Local RPC must use the benchmark 30m block gas limit');
    report.chain = { kind: 'loopback Anvil JSON-RPC', client_version: client, chain_id: 31337, block_gas_limit: 30000000, unlimited_contract_size: false, public_chain_deployed: false, endpoint: rpcURL };
  } else {
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { hardfork: 'shanghai', allowUnlimitedContractSize: false },
    miner: { blockGasLimit: 30000000, instamine: 'eager' },
    wallet: { deterministic: true, defaultBalance: 1000000 },
  });
  provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  }
  alice = await provider.getSigner(0);
  bob = await provider.getSigner(1);
  const tokenizerDeployment = await deploy('S0ULTokenizer.sol', 'S0ULTokenizer');
  tokenizer = tokenizerDeployment.contract;
  report.shared_tokenizer_deployment_gas = tokenizerDeployment.gas.toString();
});

after(async () => {
  if (report.cases.length) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  await provider?.destroy();
  await rpc?.disconnect();
});

for (const name of fixtureNames) {
  test(`${name}: complete cached Solidity inference matches every reference logit and greedy token`, { timeout: 7200000 }, async () => {
    const fixture = await deployFixture(name);
    const { engine, model, expected, manifest } = fixture;
    const modelId = await model.modelId();
    assert.equal(await model.sourceCheckpoint(), manifest.constructor.sourceCheckpoint);
    const owner = await alice.getAddress();
    const { id, receipt: beginReceipt } = await begin(engine, expected.prompt_ids, expected.max_new_tokens, expected.prompt_text);
    let totalGas = beginReceipt.gasUsed, maximumStepGas = beginReceipt.gasUsed, transactions = 1;
    let decisions = 0, advances = 0;
    const started = performance.now();
    const phases = {};
    while (true) {
      const status = await engine.status(id);
      assert.equal(status.owner, owner);
      assert.equal(status.cancelled, false);
      if (status.done) break;
      const phase = Number(status.phase);
      phases[phase] = (phases[phase] ?? 0) + 1;
      if (phase === 16) {
        const decision = expected.decisions[decisions];
        assert.ok(decision, 'Unexpected additional model decision');
        assert.deepEqual(Array.from(await engine.tokens(id), Number), decision.prefix_ids);
        const logits = Array.from(await engine.logits(id), Number);
        assert.deepEqual(logits, decision.logits, `${name} logits disagree at decision ${decisions}`);
        assert.equal(logits.indexOf(Math.max(...logits)), decision.next_id);
        decisions++;
      }
      const runner = name === 'tiny-random' && advances % 2 ? engine.connect(bob) : engine;
      const tx = await runner.advance(id, stepsPerCall, { gasLimit: advanceGasLimit });
      const receipt = await tx.wait();
      totalGas += receipt.gasUsed;
      if (receipt.gasUsed > maximumStepGas) maximumStepGas = receipt.gasUsed;
      assert.ok(receipt.gasUsed <= BigInt(advanceGasLimit), 'Inference step exceeded its CLI gas budget');
      transactions++;
      advances++;
      assert.ok(advances < 20000, 'Continuation state did not terminate within its finite bound');
      if (advances % 100 === 0) process.stdout.write(JSON.stringify({ event: 'solidity_progress', fixture: name, advances, decisions, gas: totalGas.toString(), elapsed_seconds: (performance.now() - started) / 1000 }) + '\n');
    }
    assert.equal(decisions, expected.decisions.length);
    assert.deepEqual(Array.from(await engine.tokens(id), Number), expected.expected_tokens);
    assert.deepEqual(Array.from(await engine.outputTokens(id), Number), expected.expected_output_ids);
    assert.equal(await model.modelId(), modelId);
    const finalStatus = await engine.status(id);
    assert.equal(Number(finalStatus.generated), expected.expected_output_ids.length);
    assert.equal(Number(finalStatus.phase), 17);
    await assert.rejects(engine.advance.staticCall(id, 1));
    await assert.rejects(engine.connect(bob).cancel.staticCall(id));
    const measured = {
      fixture: name, source_kind: expected.source_kind, parameter_count: expected.parameter_count,
      source_checkpoint_sha256: expected.source_checkpoint_sha256,
      model_id: modelId, model_manifest_sha256: sha(readFileSync(join(fixture.directory, 'model.json'))),
      payload_sha256: manifest.payload.sha256, shards: manifest.shards.length,
      prompt_ids: expected.prompt_ids, prompt_text: expected.prompt_text,
      output_ids: expected.expected_output_ids, checked_logit_vectors: decisions,
      checked_logit_values: decisions * expected.config.vocab_size,
      all_integer_logits_exact: true, greedy_outputs_exact: true,
      saturation_count_incremental: Number(finalStatus.saturationCount),
      transactions, advances, row_limit_per_step: stepsPerCall, rowsPerStep: stepsPerCall, inference_transaction_gas_limit: advanceGasLimit,
      inference_gas: totalGas.toString(), maximum_transaction_gas: maximumStepGas.toString(),
      deployment_gas: fixture.deploymentGas.toString(), reused_deployment: fixture.reusedDeployment ?? null,
      elapsed_seconds: (performance.now() - started) / 1000,
      phase_call_counts: phases,
    };
    report.cases.push(measured);
    process.stdout.write(JSON.stringify({ event: 'solidity_case_completed', ...measured }) + '\n');
  });
}

test('request input bounds, immutable ownership and cancellation are enforced', async () => {
  const { engine } = await deployFixture('tiny-random');
  await assert.rejects(engine.begin.staticCall([], 1));
  await assert.rejects(engine.begin.staticCall([16], 1));
  await assert.rejects(engine.begin.staticCall([1, 3], 0));
  await assert.rejects(engine.begin.staticCall([1, 3], 33));
  await assert.rejects(engine.begin.staticCall(Array(12).fill(1), 1));
  await assert.rejects(engine.advance.staticCall(0, 1));
  const { id } = await begin(engine, [1, 3], 1);
  await assert.rejects(engine.advance.staticCall(id, 0));
  await assert.rejects(engine.advance.staticCall(id, 129));
  await assert.rejects(engine.connect(bob).cancel.staticCall(id));
  await (await engine.cancel(id)).wait();
  const state = await engine.status(id);
  assert.equal(state.cancelled, true);
  assert.equal(Number(state.phase), 18);
  await assert.rejects(engine.advance.staticCall(id, 1));
  await assert.rejects(engine.beginText.staticCall('Wait.', 1));
});

test('model byte ranges and shard identity reject corruption and preserve cross-boundary bytes', async () => {
  const { model, modelArgs, manifest, payload } = await deployFixture('tiny-random');
  await assert.rejects(model.readTensor(999, 0, 1));
  await assert.rejects(model.readTensor(0, 0, 100000));
  await assert.rejects(model.readTensor(0, (1n << 256n) - 1n, 1));
  let crossed = false;
  for (const tensor of manifest.tensors) {
    const boundary = Math.ceil((tensor.offset + 1) / manifest.constructor.shardBytes) * manifest.constructor.shardBytes;
    if (boundary > tensor.offset && boundary < tensor.offset + tensor.nbytes) {
      const relative = boundary - tensor.offset - 3;
      const start = Math.max(0, relative), length = Math.min(17, tensor.nbytes - start);
      const expected = '0x' + payload.subarray(tensor.offset + start, tensor.offset + start + length).toString('hex');
      assert.equal(await model.readTensor(tensor.id, start, length), expected);
      crossed = true;
      break;
    }
  }
  assert.ok(crossed, 'Fixture must exercise at least one cross-shard tensor read');
  const badHashes = [...modelArgs[4]];
  badHashes[0] = '0x' + '00'.repeat(32);
  await assert.rejects(deploy('S0ULModel.sol', 'S0ULModel', [modelArgs[0], modelArgs[1], modelArgs[2], modelArgs[3], badHashes, modelArgs[5]]));
});


test('tokenizer self-reported identity cannot substitute for the pinned runtime code', async () => {
  const tiny = await deployFixture('tiny-random');
  await assert.rejects(deploy('S0ULInference.sol', 'S0ULInference', [await tiny.model.getAddress(), await tokenizer.getAddress()]));
  if (fixtureNames.includes('full-model')) {
    const full = await deployFixture('full-model');
    const { contract: fake } = await deploy('FakeTokenizer.sol', 'FakeTokenizer');
    assert.equal(await fake.domainSha256(), await tokenizer.domainSha256());
    await assert.rejects(deploy('S0ULInference.sol', 'S0ULInference', [await full.model.getAddress(), await fake.getAddress()]));
  }
});


test('varying row budgets preserve cursors, partial tails and exact cached outputs', { timeout: 7200000 }, async () => {
  const { engine, expected } = await deployFixture('tiny-random');
  const { id } = await begin(engine, expected.prompt_ids, expected.max_new_tokens);
  const rowBudgets = [1, 3, 32, 128];
  const observed = new Set();
  let advances = 0, decisions = 0;
  while (true) {
    const state = await engine.status(id);
    if (state.done) break;
    if (Number(state.phase) === 16) {
      const decision = expected.decisions[decisions++];
      assert.ok(decision);
      assert.deepEqual(Array.from(await engine.tokens(id), Number), decision.prefix_ids);
      assert.deepEqual(Array.from(await engine.logits(id), Number), decision.logits);
    }
    const rows = rowBudgets[advances % rowBudgets.length];
    const budget = rows <= 32 ? 12000000 : 25000000;
    observed.add(rows);
    const receipt = await (await engine.advance(id, rows, { gasLimit: budget })).wait();
    assert.ok(receipt.gasUsed <= BigInt(budget));
    assert.ok(++advances < 5000);
  }
  assert.equal(decisions, expected.decisions.length);
  assert.deepEqual(Array.from(await engine.outputTokens(id), Number), expected.expected_output_ids);
  assert.deepEqual([...observed].sort((a, b) => a - b), rowBudgets);
  report.varying_row_budget_check = { fixture: 'tiny-random', row_budgets: rowBudgets, advances, checked_logit_vectors: decisions, exact: true, cli_gas_budgets_enforced: true };
});
