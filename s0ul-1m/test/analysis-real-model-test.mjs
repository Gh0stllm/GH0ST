#!/usr/bin/env node
// Local EVM only: in-process Ganache or an owned Anvil child. No external RPC URL or private key is accepted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import solc from 'solc';
import ganache from 'ganache';
import { AbiCoder, BrowserProvider, JsonRpcProvider, Contract, ContractFactory, ZeroAddress, getBytes,
  keccak256, parseEther, toUtf8Bytes, toUtf8String } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--model', '--golden', '--output', '--max-batches', '--max-seconds', '--resume', '--backend', '--anvil-bin'].includes(key)
      || value === undefined) throw Error('Use only local --model/--golden/--output/--max-batches/--max-seconds/--resume options');
  options[key.slice(2)] = value;
}
if (!options.model || !options.golden) throw Error('Supply explicit final trained --model and --golden paths; no provisional candidate is selected automatically');
const modelPath = resolve(options.model);
const goldenPath = resolve(options.golden);
const reportPath = resolve(options.output ?? resolve(root, 'reports/analysis-real-model-validation.json'));
const backend = options.backend ?? 'ganache';
if (!['ganache', 'anvil'].includes(backend)) throw Error('Only local Ganache or locally spawned Anvil is supported');
if (backend === 'anvil' && !options['anvil-bin']) throw Error('Native local backend requires explicit --anvil-bin path');
const maxBatches = Number(options['max-batches'] ?? 1400);
const maxSeconds = Number(options['max-seconds'] ?? 1800);
if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 5000
    || !Number.isSafeInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > 7200)
  throw Error('Invalid local execution bound');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const stringify = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const log = value => process.stdout.write(stringify(value));
const coder = AbiCoder.defaultAbiCoder();
const GAS_CAP = 31_000_000n;
const GAS_PRICE = 2_000_000_000n;
const FEE_CEILING = 5_000_000_000n;
const MAX_REWARD = GAS_CAP * FEE_CEILING;
const DEPOSIT = parseEther('1000');
const CANONICAL_FEATURES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
// Keep the profile unfunded independently of a local miner's coinbase default.
const TARGET = '0x000000000000000000000000000000000000bEEF';
const codecDomain = '0xc0a58f640b73adb0cfd80b9eea45c4a72542becb30edccdfecb01cbbc37d778e';
let rpc, provider, owner, worker, engine, executor, jobId, requestId, anvilChild;
let report;
let stopRequested = false;
process.once('SIGINT', () => { stopRequested = true; });
const began = Date.now();

function save() {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, stringify(report));
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function verifyBundle(manifest) {
  const directory = dirname(modelPath);
  const payload = readFileSync(resolve(directory, manifest.payload.path));
  assert.equal(payload.length, manifest.payload.nbytes);
  assert.equal(sha(payload), manifest.payload.sha256);
  assert.equal(manifest.shards.length, 48, 'the actual full model uses48shards');
  assert.equal(manifest.constructor.config.vocabSize, 512);
  assert.equal(manifest.constructor.config.dim, 128);
  assert.equal(manifest.constructor.config.layers, 4);
  assert.equal(manifest.constructor.config.hiddenDim, 640);
  assert.equal(manifest.tokenizerDomainSha256.toLowerCase(), codecDomain);
  // Preserve the original exporter canonicalization. PythonJSON writes rms_eps
  // as1e-05, while JSON.stringify writes0.00001; changing serializers changes
  // the manifest preimage despite identical parsed numeric values.
  const verified = spawnSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? 'python',
    ['-m', 's0ul.solidity_export', '--verify', directory], { cwd: root, encoding: 'utf8', maxBuffer: 1_000_000 });
  assert.equal(verified.status, 0, 'originalexporteridentityverification: ' + verified.stderr);
  const identity = JSON.parse(verified.stdout);
  assert.equal(identity.manifestHash, manifest.manifestHash, 'originalcanonicalmanifestidentity');
  assert.equal(manifest.constructor.manifestHash, manifest.manifestHash);
  for (let i = 0; i < manifest.shards.length; ++i) {
    const shard = manifest.shards[i], init = getBytes(shard.initCodeHex);
    assert.equal(shard.index, i);
    assert.equal(keccak256(init), shard.initCodeKeccak256);
    const runtime = init.slice(14);
    assert.equal(runtime[0], 0);
    assert.equal(keccak256(runtime), shard.runtimeKeccak256);
    const expected = payload.subarray(shard.offset, shard.offset + shard.payloadBytes);
    assert.deepEqual(Buffer.from(runtime.slice(1)), expected);
    assert.equal(sha(expected), shard.payloadSha256);
  }
  // The original integer and Solidity bundle have different tensor ordering.
  // Compare each complete named tensor instead of equating their payload hashes.
  const integerPath = resolve(directory, '../integer/integer-manifest.json');
  const integer = json(integerPath);
  const integerPayload = readFileSync(resolve(dirname(integerPath), integer.payload.path));
  assert.equal(integerPayload.length, integer.payload.nbytes);
  assert.equal(sha(integerPayload), integer.payload.sha256);
  assert.equal(integer.source_checkpoint_sha256, manifest.constructor.sourceCheckpoint.slice(2));
  assert.equal(integer.arrays.length, manifest.tensors.length);
  for (const tensor of manifest.tensors) {
    const original = integer.arrays.find(item => item.name === tensor.name);
    assert.ok(original, 'integer tensor exists: ' + tensor.name);
    assert.deepEqual(original.shape, tensor.shape);
    assert.equal(original.nbytes, tensor.nbytes);
    const originalBytes = integerPayload.subarray(original.offset, original.offset + original.nbytes);
    assert.equal(sha(originalBytes), original.sha256);
    assert.equal(sha(originalBytes), tensor.sha256);
    assert.deepEqual(originalBytes, payload.subarray(tensor.offset, tensor.offset + tensor.nbytes));
  }
  return { payload, integer, integerPath, identity };
}
function compile() {
  const sources = {};
  function collect(name) {
    if (sources[name]) return;
    const content = readFileSync(resolve(root, 'contracts', name), 'utf8');
    sources[name] = { content };
    for (const match of content.matchAll(/(?:from\s+|import\s+)["']([^"']+\.sol)["']/g))
      collect(posix.normalize(posix.join(posix.dirname(name), match[1])));
  }
  for (const file of ['S0ULModel.sol', 'S0ULInference.sol', 'analysis/S0ULAnalysisFacts.sol',
    'analysis/S0ULAnalysisCodec.sol', 'analysis/S0ULAnalysisExecutor.sol']) collect(file);
  const built = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (built.errors ?? []).filter(item => item.severity === 'error');
  if (errors.length) throw Error(errors.map(item => item.formattedMessage).join('\n'));
  for (const file of Object.values(built.contracts)) for (const [name, artifact] of Object.entries(file))
    assert.ok(artifact.evm.deployedBytecode.object.length / 2 <= 24_576, name + ' meetsEIP170');
  return { contracts: built.contracts, compiler: solc.version(), optimizerRuns: 200, viaIR: true,
    evmVersion: 'shanghai', sourceSha256: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, sha(value.content)])) };
}
function artifact(build, name) {
  const matches = Object.values(build.contracts).flatMap(file => Object.entries(file)).filter(([key]) => key === name);
  assert.equal(matches.length, 1, 'unique artifact ' + name);
  return matches[0][1];
}
async function mined(value, kind) {
  const transaction = await value;
  const receipt = await provider.getTransactionReceipt(transaction.hash) ?? await transaction.wait();
  assert.equal(Number(receipt.status), 1, kind + ' succeeded onlocalEVM');
  report.transactions.push({ kind, hash: receipt.hash, gasUsed: receipt.gasUsed.toString(),
    gasPrice: receipt.gasPrice.toString(), blockNumber: receipt.blockNumber, status: 1 });
  save(); return receipt;
}
async function deploy(build, name, args = []) {
  const a = artifact(build, name);
  const contract = await new ContractFactory(a.abi, a.evm.bytecode.object, owner)
    .deploy(...args, { gasLimit: GAS_CAP, gasPrice: GAS_PRICE });
  await mined(contract.deploymentTransaction(), 'deploy:' + name);
  return contract;
}
async function hashCode(address) { return keccak256(await provider.getCode(address)); }

async function freeLocalPort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const port = server.address().port;
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
  return port;
}

async function localProvider(databasePath) {
  if (backend === 'ganache') {
    rpc = ganache.provider({ logging: { quiet: true }, database: { dbPath: databasePath },
      chain: { chainId: 4663, hardfork: 'shanghai' },
      wallet: { deterministic: true, totalAccounts: 3, defaultBalance: 1_000_000 },
      miner: { blockGasLimit: Number(GAS_CAP), coinbase: '0x000000000000000000000000000000000000c0fe' } });
    provider = new BrowserProvider(rpc, 'any', { cacheTimeout: -1 });
  } else {
    const binary = resolve(options['anvil-bin']), version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, 'local Anvil binary executes');
    const port = await freeLocalPort();
    report.nativeBackend = { binary, binarySha256: sha(readFileSync(binary)), version: version.stdout.trim(),
      host: '127.0.0.1', port, forkedPublicChain: false };
    anvilChild = spawn(binary, ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663',
      '--hardfork', 'shanghai', '--gas-limit', String(GAS_CAP), '--accounts', '3', '--balance', '1000000',
      '--state', databasePath, '--quiet', '--threads', '2'], { stdio: ['ignore', 'ignore', 'ignore'] });
    provider = new JsonRpcProvider('http://127.0.0.1:' + port, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
    let ready = false;
    for (let attempt = 0; attempt < 50; ++attempt) {
      if (anvilChild.exitCode !== null) throw Error('Local Anvil exited before startup');
      try { ready = BigInt(await provider.send('eth_chainId', [])) === 4663n; } catch {}
      if (ready) break;
      await new Promise(accept => setTimeout(accept, 50));
    }
    if (!ready) throw Error('Local Anvil did not become ready within the bounded startup window');
    save();
  }
  provider.pollingInterval = 10;
}

async function run() {
  assert.ok(existsSync(modelPath), 'trained integer export must exist first');
  assert.ok(existsSync(goldenPath), 'independent integer golden must exist first');
  const manifest = json(modelPath), golden = json(goldenPath);
  const { payload, integer, integerPath, identity } = verifyBundle(manifest);
  assert.deepEqual(golden.features, CANONICAL_FEATURES);
  const expectedPrompt = golden.prompt_ids;
  const expectedIds = golden.generated_token_ids;
  assert.equal(expectedPrompt.length, 16);
  assert.equal(golden.max_new_tokens, 32);
  assert.equal(golden.all_decisions_checked_against_full_reference, true);
  assert.equal(expectedIds.at(-1), 2);
  assert.equal(manifest.constructor.sourceCheckpoint.slice(2), golden.checkpoint_sha256);
  assert.equal(integer.payload.sha256, golden.integer_payload_sha256);
  assert.equal(manifest.payload.sha256, golden.solidity_payload_sha256);
  assert.equal(golden.decisions.length, expectedIds.length);
  for (const decision of golden.decisions) assert.equal(decision.logits.length, 512);
  const build = compile();
  const fingerprint = sha(stable({ backend, target: TARGET, sourceSha256: build.sourceSha256,
    manifestSha256: sha(readFileSync(modelPath)), goldenSha256: sha(readFileSync(goldenPath)) }));
  const databasePath = resolve('/tmp', 's0ul-analysis-real-evm-' + backend + '-' + fingerprint.slice(0, 20) + (backend === 'anvil' ? '.json' : ''));
  const resume = options.resume === 'true';
  if (resume) {
    report = json(reportPath);
    assert.equal(report.fingerprint, fingerprint, 'resume preserves frozen sources and model');
    assert.equal(report.localDatabasePath, databasePath);
  } else {
    assert.ok(!existsSync(databasePath), 'new local run requires a fresh chain or --resume true');
    report = { format: 's0ul-analysis-real-model-local-evm-v1', result: 'RUNNING',
      localOnly: true, backend, network: 'local' + backend + '; chainId4663 is local configuration, not Robinhood mainnet',
      publicRpcCalls: 0, submittedPublicTransactions: 0, realFundsSpent: '0',
      fingerprint, localDatabasePath: databasePath, startedUtc: new Date().toISOString(),
      build: { compiler: build.compiler, optimizerRuns: 200, viaIR: true, evmVersion: 'shanghai', sourceSha256: build.sourceSha256 },
      model: { manifestPath: modelPath, manifestSha256: sha(readFileSync(modelPath)), payloadSha256: sha(payload),
        integerManifestPath: integerPath, integerManifestSha256: sha(readFileSync(integerPath)),
        integerPayloadSha256: integer.payload.sha256, allNamedIntegerTensorsExact: true,
        canonicalManifestVerifiedByOriginalExporter: identity,
        sourceCheckpoint: manifest.constructor.sourceCheckpoint, manifestHash: manifest.manifestHash, shards: 48,
        parameterCount: 984192, codecDomain, schemaSha256: manifest.analysisFeatureSchemaSha256 },
      golden: { path: goldenPath, sha256: sha(readFileSync(goldenPath)), decisions: golden.decisions.length,
        source: 'Pythonintegerforward; all512decisionlogits, notfloatargmaxonly' },
      target: TARGET, features: CANONICAL_FEATURES, promptIds: expectedPrompt,
      transactions: [], decisions: [], gasPreflights: [], continuationBatches: 0,
      limits: ['One known no-code regression input only; no accuracy on arbitrary real addresses or analyst reasoning is established.',
        'All transaction costs are simulated local EVM gas; no real network fees were paid.',
        'No runtime templates or caller-supplied report replace generated model tokens.'] };
    save();
  }
  await localProvider(databasePath);
  owner = await provider.getSigner(0); worker = await provider.getSigner(1);
  assert.equal((await provider.getNetwork()).chainId, 4663n);
  const ownerAddress = await owner.getAddress(), workerAddress = await worker.getAddress();
  if (!report.deployment) {
    const addresses = [];
    for (const shard of manifest.shards) {
      const receipt = await mined(owner.sendTransaction({ data: shard.initCodeHex, gasLimit: 8_000_000n, gasPrice: GAS_PRICE }), 'deploy:shard:' + shard.index);
      assert.equal(await hashCode(receipt.contractAddress), shard.runtimeKeccak256);
      addresses.push(receipt.contractAddress);
      if ((shard.index + 1) % 12 === 0) log({ event: 'local_shards_deployed', count: shard.index + 1 });
    }
    const constructor = manifest.constructor;
    const model = await deploy(build, 'S0ULModel', [constructor.config, constructor.sourceCheckpoint,
      constructor.manifestHash, addresses, manifest.shards.map(item => item.runtimeKeccak256), constructor.shardBytes]);
    const modelAddress = await model.getAddress();
    const inference = await deploy(build, 'S0ULInference', [modelAddress, ZeroAddress]);
    const reader = await deploy(build, 'S0ULUniversalReader');
    const facts = await deploy(build, 'S0ULAnalysisFacts', [await reader.getAddress(), await hashCode(await reader.getAddress())]);
    const codec = await deploy(build, 'S0ULAnalysisCodec');
    assert.equal(await codec.domainSha256(), codecDomain);
    const control = await deploy(build, 'S0ULAnalysisExecutor', [await inference.getAddress(), await facts.getAddress(), await codec.getAddress(),
      await hashCode(await inference.getAddress()), await hashCode(await facts.getAddress()), await hashCode(await codec.getAddress()),
      await model.modelId(), await codec.domainSha256(), await facts.schemaHash()]);
    report.deployment = { model: modelAddress, modelId: await model.modelId(), engine: await inference.getAddress(),
      reader: await reader.getAddress(), adapter: await facts.getAddress(), codec: await codec.getAddress(),
      executor: await control.getAddress(), shards: addresses,
      codeHashes: Object.fromEntries(await Promise.all([['model', model], ['engine', inference], ['reader', reader], ['adapter', facts], ['codec', codec], ['executor', control]]
        .map(async ([name, contract]) => [name, await hashCode(await contract.getAddress())]))) };
    save();
  }
  const address = report.deployment;
  engine = new Contract(address.engine, artifact(build, 'S0ULInference').abi, provider);
  executor = new Contract(address.executor, artifact(build, 'S0ULAnalysisExecutor').abi, provider);
  const reader = new Contract(address.reader, artifact(build, 'S0ULUniversalReader').abi, provider);
  const adapter = new Contract(address.adapter, artifact(build, 'S0ULAnalysisFacts').abi, provider);
  const codec = new Contract(address.codec, artifact(build, 'S0ULAnalysisCodec').abi, provider);
  if (!report.jobId) {
    assert.equal(await provider.getBalance(TARGET), 0n, 'canonicaltargetremainsunfunded');
    const [factsBytes, prompt] = await adapter.capture(TARGET, { gasLimit: GAS_CAP });
    assert.deepEqual(prompt.map(Number), expectedPrompt, 'actualon-chainfeaturepromptmatchescanonicalgolden');
    const profile = await reader.profile(TARGET);
    assert.equal(profile.codeBytes, 0n);
    const latest = await provider.getBlock('latest');
    const receipt = await mined(executor.connect(owner).open(TARGET, 32, FEE_CEILING, MAX_REWARD,
      BigInt(latest.timestamp + 86_400), profile.codeHash, { value: DEPOSIT, gasLimit: GAS_CAP, gasPrice: GAS_PRICE }), 'open');
    const event = receipt.logs.map(item => { try { return executor.interface.parseLog(item); } catch { return null; } }).find(item => item?.name === 'JobOpened');
    assert.ok(event, 'actualfundedjobevent');
    jobId = event.args.jobId; requestId = event.args.requestId;
    const job = await executor.getJob(jobId);
    assert.equal(job.owner.toLowerCase(), ownerAddress.toLowerCase());
    assert.equal(job.target, TARGET);
    assert.equal(job.modelId, address.modelId);
    assert.equal(job.promptHash, keccak256(coder.encode(['uint16[]'], [expectedPrompt])));
    assert.equal(job.factsHash, keccak256(await executor.factsOf(jobId)));
    assert.equal(job.totalFunded, DEPOSIT);
    assert.deepEqual((await engine.tokens(requestId)).map(Number), expectedPrompt);
    assert.equal((await engine.status(requestId)).owner.toLowerCase(), address.executor.toLowerCase());
    report.jobId = jobId.toString(); report.requestId = requestId.toString();
    report.factsHash = job.factsHash; report.promptHash = job.promptHash; report.openCaptureBytes = (getBytes(factsBytes)).length;
    save(); log({ event: 'local_real_model_job_opened', jobId, requestId, promptTokens: expectedPrompt.length });
  } else { jobId = BigInt(report.jobId); requestId = BigInt(report.requestId); }
  const preflightShapes = new Set(report.gasPreflights.map(item => item.shape));
  let batchesThisInvocation = 0;
  while (!stopRequested && batchesThisInvocation < maxBatches && (Date.now() - began) / 1000 < maxSeconds) {
    const state = await engine.status(requestId);
    assert.equal(state.cancelled, false);
    if (Number(state.phase) === 16) {
      const index = Number(state.generated), expected = golden.decisions[index];
      assert.ok(expected, 'goldenexistsforeveryactualdecision');
      const logits = (await engine.logits(requestId)).map(Number);
      assert.deepEqual(logits, expected.logits.map(Number), 'all512integerlogitsmatchatdecision' + index);
      if (!report.decisions.some(item => item.index === index)) {
        report.decisions.push({ index, tokenId: Number(expected.token_id), logitsMatched: 512,
          logitsSha256: sha(JSON.stringify(logits)), saturationCount: state.saturationCount.toString() });
        save();
      }
    }
    if (state.done) break;
    let steps = 4;
    // Representative phasepreflights avoid re-executing expensive transformer
    // batches through Ganache's binary-search estimator on every paid step.
    // Every submitted transaction still has the same hard31M operational cap.
    const shape = [1, 11, 12].includes(Number(state.phase)) ? String(state.phase) : null;
    if (shape && !preflightShapes.has(shape)) {
      for (; steps >= 1; --steps) {
        try {
          const estimate = await executor.connect(worker).advance.estimateGas(jobId, 128, steps, { gasPrice: GAS_PRICE });
          if ((estimate * 12n + 9n) / 10n > GAS_CAP) continue;
          report.gasPreflights.push({ shape, phase: Number(state.phase), position: Number(state.position), steps,
            gasEstimate: estimate.toString(), paddedGas: ((estimate * 12n + 9n) / 10n).toString() });
          preflightShapes.add(shape); save(); break;
        } catch (error) { if (steps === 1) throw error; }
      }
      if (steps < 1) throw Error('Nooperationallyfeasiblelocalbatch');
    }
    const receipt = await mined(executor.connect(worker).advance(jobId, 128, steps,
      { gasLimit: GAS_CAP, gasPrice: GAS_PRICE }), 'advance');
    assert.ok(receipt.gasUsed <= GAS_CAP);
    report.continuationBatches++;
    batchesThisInvocation++;
    if (report.continuationBatches % 25 === 0) log({ event: 'local_real_model_progress', batches: report.continuationBatches,
      phase: Number(state.phase), position: Number(state.position), generated: Number(state.generated), elapsedSeconds: Math.round((Date.now() - began) / 1000) });
  }
  const finalState = await engine.status(requestId);
  if (!finalState.done) {
    report.result = 'PARTIAL'; report.completed = false; report.lastStatus = finalState.toObject();
    report.resumeCommand = 'node test/analysis-real-model-test.mjs --model ' + JSON.stringify(modelPath)
      + ' --golden ' + JSON.stringify(goldenPath) + ' --output ' + JSON.stringify(reportPath)
      + ' --backend ' + backend + (backend === 'anvil' ? ' --anvil-bin ' + JSON.stringify(resolve(options['anvil-bin'])) : '') + ' --resume true';
    save(); log({ event: 'local_bounded_pause', batchesThisInvocation, phase: Number(finalState.phase), position: Number(finalState.position) });
    process.exitCode = 2; return;
  }
  const actualIds = (await engine.outputTokens(requestId)).map(Number);
  assert.deepEqual(actualIds, expectedIds, 'fullactualmodelgeneratedtokensmatchintegerreference');
  assert.equal(report.decisions.length, expectedIds.length);
  const decoded = toUtf8String(await codec.decode(actualIds, false));
  assert.equal(decoded, golden.response);
  let job = await executor.getJob(jobId);
  if (Number(job.state) === 1) {
    await mined(executor.connect(worker).finalize(jobId, { gasLimit: 8_000_000n, gasPrice: GAS_PRICE }), 'finalize');
    job = await executor.getJob(jobId);
  }
  assert.equal(Number(job.state), 2, 'realmodelreportcompleted');
  assert.equal(Number(job.failure), 0);
  assert.equal(toUtf8String(await executor.reportOf(jobId)), decoded);
  assert.deepEqual((await executor.outputTokensOf(jobId)).map(Number), actualIds);
  assert.equal(job.outputHash, keccak256(coder.encode(['uint16[]'], [actualIds])));
  const remainingBeforeRefund = DEPOSIT - job.totalPaid;
  if (job.remaining > 0n) {
    assert.equal(job.totalPaid + job.remaining, DEPOSIT, 'fundingconservedbeforeownerrefund');
    await mined(executor.connect(owner).refundCompleted(jobId, { gasLimit: 500_000n, gasPrice: GAS_PRICE }), 'refundCompleted');
  }
  const workerCredit = await executor.credits(workerAddress), ownerCredit = await executor.credits(ownerAddress);
  assert.ok(workerCredit === job.totalPaid || workerCredit === 0n && report.transactions.some(item => item.kind === 'workerWithdraw'));
  assert.ok(ownerCredit === remainingBeforeRefund || ownerCredit === 0n && report.transactions.some(item => item.kind === 'ownerWithdraw'));
  assert.equal(await provider.getBalance(address.executor), (await executor.credits(ownerAddress)) + (await executor.credits(workerAddress)));
  if (workerCredit > 0n) await mined(executor.connect(worker).withdraw({ gasLimit: 500_000n, gasPrice: GAS_PRICE }), 'workerWithdraw');
  if (ownerCredit > 0n) await mined(executor.connect(owner).withdraw({ gasLimit: 500_000n, gasPrice: GAS_PRICE }), 'ownerWithdraw');
  assert.equal(await provider.getBalance(address.executor), 0n);
  assert.equal(await executor.credits(ownerAddress), 0n); assert.equal(await executor.credits(workerAddress), 0n);
  job = await executor.getJob(jobId);
  report.result = 'PASS'; report.completed = true; report.completedUtc = new Date().toISOString();
  report.generatedTokenIds = actualIds; report.response = decoded; report.outputHash = job.outputHash;
  report.comparison = { decisions: report.decisions.length, logitsPerDecision: 512,
    totalLogitsMatched: report.decisions.length * 512, outputTokensExact: true, strictCodecExact: true,
    finalReportEqualsActualGeneratedWords: true, noCallerSuppliedReport: true };
  report.accounting = { totalFundedWei: DEPOSIT.toString(), workerCreditedWei: job.totalPaid.toString(),
    ownerRefundWei: remainingBeforeRefund.toString(), allCreditsWithdrawn: true, finalExecutorBalanceWei: '0' };
  report.localGas = { deployment: report.transactions.filter(item => item.kind.startsWith('deploy:')).reduce((n, item) => n + BigInt(item.gasUsed), 0n).toString(),
    fullJob: report.transactions.filter(item => !item.kind.startsWith('deploy:')).reduce((n, item) => n + BigInt(item.gasUsed), 0n).toString(),
    allTransactions: report.transactions.reduce((n, item) => n + BigInt(item.gasUsed), 0n).toString(),
    operationalTransactionCap: GAS_CAP.toString(), maximumActualTransaction: report.transactions.reduce((n, item) => BigInt(item.gasUsed) > n ? BigInt(item.gasUsed) : n, 0n).toString() };
  report.elapsedSeconds = Math.round((Date.now() - Date.parse(report.startedUtc)) / 1000);
  report.invocationElapsedSeconds = Math.round((Date.now() - began) / 1000);
  report.wallTimeIncludesAnyResumePauses = true;
  save(); log({ event: 'local_real_model_integration_pass', response: decoded, comparison: report.comparison,
    continuationBatches: report.continuationBatches, elapsedSeconds: report.elapsedSeconds });
}

try { await run(); }
catch (error) {
  if (report) { report.result = 'FAIL'; report.completed = false; report.error = error.stack ?? error.message; save(); }
  process.stderr.write((error.stack ?? error.message) + '\n'); process.exitCode = 1;
} finally {
  if (provider) await provider.destroy();
  if (rpc) await rpc.disconnect();
  if (anvilChild && anvilChild.exitCode === null) {
    const closed = new Promise(accept => anvilChild.once('exit', accept));
    anvilChild.kill('SIGINT');
    await Promise.race([closed, new Promise(accept => setTimeout(accept, 5000))]);
    if (anvilChild.exitCode === null) anvilChild.kill('SIGKILL');
  }
}
