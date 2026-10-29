import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, AbiCoder, ZeroAddress, ZeroHash, keccak256, toUtf8Bytes } from 'ethers';

// These are infrastructure tests against deliberately mutable local mocks.
// Passing them is NOT evidence of trained-model quality or inference parity.
const root = fileURLToPath(new URL('../', import.meta.url));
const executorPath = root + 'contracts/analysis/S0ULAnalysisExecutor.sol';
const mocksPath = root + 'contracts/analysis/test/S0ULAnalysisMocks.sol';
const codecPath = root + 'contracts/analysis/S0ULAnalysisCodec.sol';
const reportPath = root + 'reports/analysis-executor-evm-validation.json';
const MODEL_ID = keccak256(toUtf8Bytes('analysis-executor-local-mock-model'));
const DOMAIN = keccak256(toUtf8Bytes('analysis-executor-local-mock-domain'));
const SCHEMA = keccak256(toUtf8Bytes('analysis-executor-local-mock-schema'));
const GAS_PRICE = 2_000_000_000n;
const FEE_CEILING = 5_000_000_000n;
const MAX_REWARD = 2_000_000_000_000_000n;
const DEPOSIT = 100_000_000_000_000_000n;
const TX = Object.freeze({ gasLimit: 8_000_000, gasPrice: GAS_PRICE });
const coder = AbiCoder.defaultAbiCoder();
const gas = {};
const checks = [];
let compiled, rpc, provider, alice, bob, carol, aliceAddress, bobAddress, carolAddress;
let model, engine, adapter, codec, target, executor, snapshot, pins, sourceHashes;

function artifact(name) {
  const found = Object.values(compiled.contracts).flatMap(x => Object.entries(x)).find(([key]) => key === name);
  assert.ok(found, 'Missing artifact ' + name); return found[1];
}
async function mined(value) {
  const tx = await value;
  const receipt = await provider.getTransactionReceipt(tx.hash) ?? await tx.wait();
  assert.equal(Number(receipt.status), 1, 'local mock transaction succeeded'); return receipt;
}
async function deploy(name, args = [], signer = alice) {
  const a = artifact(name);
  const contract = await new ContractFactory(a.abi, a.evm.bytecode.object, signer).deploy(...args, TX);
  await contract.waitForDeployment(); return contract;
}
async function hashCode(address) { return keccak256(await provider.getCode(address)); }
async function deadline(seconds = 3600) { return BigInt((await provider.getBlock('latest')).timestamp + seconds); }
function constructorArgs(overrides = {}) {
  const value = { ...pins, ...overrides };
  return [value.engine, value.adapter, value.codec, value.engineCodeHash, value.adapterCodeHash,
    value.codecCodeHash, value.modelId, value.domainSha256, value.schemaHash];
}
async function open(overrides = {}, signer = alice) {
  const args = { target: await target.getAddress(), maxNewTokens: 32, feeCeiling: FEE_CEILING,
    maxReward: MAX_REWARD, deadline: await deadline(), targetCodeHash: await adapter.targetCodeHash(await target.getAddress()),
    deposit: DEPOSIT, ...overrides };
  const tx = await mined(executor.connect(signer).open(args.target, args.maxNewTokens, args.feeCeiling,
    args.maxReward, args.deadline, args.targetCodeHash, { ...TX, value: args.deposit }));
  const log = tx.logs.map(item => { try { return executor.interface.parseLog(item); } catch { return null; } })
    .find(item => item && /Opened|Begun|JobCreated|JobOpened/.test(item.name));
  let id = log?.args?.jobId ?? log?.args?.id;
  // The mock engine request ID is unique and the public reverse mapping removes
  // any reliance on event prose or a particular next-job counter name.
  if (id == null) id = await executor.engineRequestToJob((await engine.nextRequestId()) - 1n);
  assert.ok(id > 0n, 'open returned a discoverable job');
  gas.open ??= tx.gasUsed.toString(); return id;
}
async function job(id) { return (await executor.getJob(id)).toObject(); }
const requestId = value => value.requestId ?? value.engineRequestId;
const remaining = value => value.remaining ?? value.remainingWei ?? value.remainingBudget;
const paid = value => value.totalPaid ?? value.totalPaidWei;
const state = value => value.state ?? value.status;
async function advance(id, rows = 128, steps = 4, signer = bob, overrides = {}) {
  return mined(executor.connect(signer).advance(id, rows, steps, { ...TX, ...overrides }));
}
async function completeEngine(id) {
  for (let i = 0; i < 20; ++i) {
    const j = await job(id);
    if ((await engine.status(requestId(j))).done) return;
    await advance(id);
  }
  assert.fail('mock engine failed to terminate within the fixture bound');
}
async function reverts(action, message = 'operation must revert') {
  await assert.rejects(async () => { const value = await action(); if (value?.wait) await value.wait(); }, message);
}
function verify(name, fn) {
  test(name, async () => {
    try { await fn(); checks.push({ name, passed: true }); }
    catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; }
  });
}

before(async () => {
  const source = readFileSync(executorPath, 'utf8'), mocks = readFileSync(mocksPath, 'utf8');
  const strictCodecSource = readFileSync(codecPath, 'utf8');
  sourceHashes = Object.fromEntries([[executorPath, source], [mocksPath, mocks], [codecPath, strictCodecSource]]
    .map(([path, content]) => [path.slice(root.length), createHash('sha256').update(content).digest('hex')]));
  compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: {
    'S0ULAnalysisExecutor.sol': { content: source }, 'S0ULAnalysisMocks.sol': { content: mocks },
    'S0ULAnalysisCodec.sol': { content: strictCodecSource },
  }, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (compiled.errors ?? []).filter(item => item.severity === 'error');
  assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join('\n'));
  assert.ok(artifact('S0ULAnalysisExecutor').evm.deployedBytecode.object.length / 2 <= 24576);
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31339, hardfork: 'shanghai' },
    miner: { blockGasLimit: 32_000_000 }, wallet: { deterministic: true } });
  provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1, batchStallTime: 0 });
  provider.pollingInterval = 10;
  alice = await provider.getSigner(0); bob = await provider.getSigner(1); carol = await provider.getSigner(2);
  [aliceAddress, bobAddress, carolAddress] = await Promise.all([alice.getAddress(), bob.getAddress(), carol.getAddress()]);
  model = await deploy('AnalysisModelMock', [MODEL_ID]);
  engine = await deploy('AnalysisEngineMock', [await model.getAddress(), MODEL_ID]);
  adapter = await deploy('AnalysisFactsAdapterMock', [SCHEMA]);
  codec = await deploy('AnalysisCodecMock', [DOMAIN]);
  target = await deploy('AnalysisTargetMock', [42]);
  pins = { engine: await engine.getAddress(), adapter: await adapter.getAddress(), codec: await codec.getAddress(),
    engineCodeHash: await hashCode(await engine.getAddress()), adapterCodeHash: await hashCode(await adapter.getAddress()),
    codecCodeHash: await hashCode(await codec.getAddress()), modelId: MODEL_ID, domainSha256: DOMAIN, schemaHash: SCHEMA };
  executor = await deploy('S0ULAnalysisExecutor', constructorArgs());
});
beforeEach(async () => { snapshot = await rpc.request({ method: 'evm_snapshot', params: [] }); });
afterEach(async () => { if (snapshot) await rpc.request({ method: 'evm_revert', params: [snapshot] }); });
after(async () => {
  const report = { format: 's0ul-analysis-executor-local-mock-validation-v1', verifiedUtc: new Date().toISOString(),
    result: checks.length > 0 && checks.every(item => item.passed) ? 'PASS' : 'FAIL',
    scope: 'Funded executor infrastructure only, in-process Ganache31339/shanghai. Engine and facts are deliberately mutable mocks; one integration case uses the real strict word codec.',
    mockFixtureOnly: true, realModelInferenceProof: false, trainedModelQualityEvaluated: false,
    publicRpcCalls: 0, publicTransactions: 0, compiler: solc.version(), optimizerRuns: 200, viaIR: true,
    sourceSha256: sourceHashes, runtimeBytes: compiled?.contracts ? artifact('S0ULAnalysisExecutor').evm.deployedBytecode.object.length / 2 : null,
    tests: { total: checks.length, passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length },
    checks, gas };
  // Never leave a stale passing report after a failed rerun against new sources.
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report)); await provider?.destroy(); await rpc?.disconnect();
});

verify('deployment pins dependency code, identities, schema and tokenizer domain', async () => {
  assert.equal(await executor.chainId(), 31339n); assert.equal(await executor.modelId(), MODEL_ID);
  assert.equal(await executor.schemaHash(), SCHEMA); assert.equal(await executor.domainSha256(), DOMAIN);
  for (const key of ['engineCodeHash', 'adapterCodeHash', 'codecCodeHash', 'modelId', 'domainSha256', 'schemaHash']) {
    await reverts(() => deploy('S0ULAnalysisExecutor', constructorArgs({ [key]: ZeroHash })), key);
  }
  for (const key of ['engine', 'adapter', 'codec']) {
    await reverts(() => deploy('S0ULAnalysisExecutor', constructorArgs({ [key]: ZeroAddress })), key);
  }
  for (const mode of [1, 2, 3, 4]) {
    await mined(engine.setConfigurationMode(mode));
    await reverts(() => deploy('S0ULAnalysisExecutor', constructorArgs()), 'unsupported configuration ' + mode);
  }
});

verify('opening binds the caller, exact on-chain facts and canonical prompt to an executor-owned engine request', async () => {
  const id = await open(), j = await job(id), request = requestId(j);
  assert.equal(j.owner, aliceAddress); assert.equal(j.target, await target.getAddress());
  assert.equal(state(j), 1n); assert.equal(remaining(j), DEPOSIT); assert.equal(paid(j), 0n);
  assert.equal(await executor.engineRequestToJob(request), id);
  const s = await engine.status(request); assert.equal(s.owner, await executor.getAddress());
  const [facts, prompt] = await adapter.capture(await target.getAddress());
  assert.equal(await executor.factsOf(id), facts);
  assert.deepEqual([...(await engine.tokens(request))], [...prompt]);
  assert.equal(j.promptHash, keccak256(coder.encode(['uint16[]'], [prompt])));
  assert.equal(await provider.getBalance(await executor.getAddress()), DEPOSIT);
  assert.equal(await executor.credits(bobAddress), 0n, 'funding does not transfer ETH to a keeper');
});

verify('any no-code address including zero is accepted, while a changed expected target hash fails closed', async () => {
  const id = await open({ target: ZeroAddress, targetCodeHash: await adapter.targetCodeHash(ZeroAddress) });
  assert.equal((await job(id)).target, ZeroAddress);
  await reverts(() => open({ targetCodeHash: ZeroHash }), 'target code changed');
});

verify('input bounds and bad adapter data cannot open an injected or malformed model prompt', async () => {
  for (const maxNewTokens of [0, 1, 33]) await reverts(() => open({ maxNewTokens }), 'output bounds');
  await reverts(() => open({ feeCeiling: 0n }), 'zero fee ceiling');
  await reverts(() => open({ maxReward: 0n }), 'zero per-batch reward');
  await reverts(() => open({ deadline: 1n }), 'expired deadline');
  await reverts(() => open({ deposit: 0n }), 'zero funded budget');
  for (const mode of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await mined(adapter.setMode(mode));
    await reverts(() => open(), 'bad capture mode ' + mode);
  }
});

verify('engine begin must produce a live request owned by the executor', async () => {
  for (const mode of [3, 4, 5]) {
    await mined(engine.setMode(mode)); await reverts(() => open(), 'bad begin status ' + mode);
  }
});

verify('bounded batching advances real engine calls and preserves inspectable Select boundaries', async () => {
  const id = await open(), j = await job(id), request = requestId(j);
  const first = await advance(id, 128, 4); gas.firstAdvance = first.gasUsed.toString();
  assert.equal(await engine.advances(request), 2n, 'stop before Select after earlier progress');
  assert.equal((await engine.status(request)).phase, 16n);
  const firstReward = await executor.credits(bobAddress); assert.ok(firstReward > 0n && firstReward <= MAX_REWARD);
  assert.equal(remaining(await job(id)) + firstReward, DEPOSIT);
  await advance(id, 128, 4);
  assert.equal(await engine.advances(request), 5n, 'one bounded batch consumes at most four existing steps');
  assert.equal((await engine.status(request)).phase, 16n);
  for (const [rows, steps] of [[0, 1], [1, 1], [127, 1], [129, 1], [128, 0], [128, 5]]) {
    await reverts(() => advance(id, rows, steps), 'bounded rows/steps');
  }
});

verify('no engine progress or failed engine calls earn no reward and roll back all effects', async () => {
  const id = await open(), j = await job(id), request = requestId(j);
  for (const mode of [1, 2, 6]) {
    await mined(engine.setMode(mode));
    await reverts(() => advance(id, 128, 1), 'no valid progress mode ' + mode);
    assert.equal(remaining(await job(id)), DEPOSIT); assert.equal(paid(await job(id)), 0n);
    assert.equal(await executor.credits(bobAddress), 0n); assert.equal(await engine.advances(request), 0n);
  }
});

verify('fee ceiling and remaining-budget reserve pause work without exceeding the deposit', async () => {
  const id = await open({ deposit: MAX_REWARD });
  await reverts(() => advance(id, 128, 1, bob, { gasPrice: FEE_CEILING + 1n }), 'fee ceiling');
  assert.equal(remaining(await job(id)), MAX_REWARD); assert.equal(await executor.credits(bobAddress), 0n);
  await advance(id, 128, 1);
  const j = await job(id), reward = await executor.credits(bobAddress);
  assert.ok(reward > 0n && reward <= MAX_REWARD); assert.equal(remaining(j) + reward, MAX_REWARD);
  await reverts(() => advance(id, 128, 1), 'insufficient next-batch reserve');
  assert.equal(remaining(await job(id)), remaining(j)); assert.equal(await executor.credits(bobAddress), reward);
});

verify('only the owner can top up and cancel; expiry prevents further charged inference', async () => {
  const id = await open({ deadline: await deadline(10) });
  await reverts(() => executor.connect(carol).topUp(id, { ...TX, value: DEPOSIT }), 'foreign top-up');
  await reverts(() => executor.connect(carol).cancel(id, TX), 'foreign cancel');
  await reverts(() => executor.topUp(id, { ...TX, value: 0n }), 'zero top-up');
  await mined(executor.topUp(id, { ...TX, value: DEPOSIT }));
  assert.equal(remaining(await job(id)), DEPOSIT * 2n);
  await rpc.request({ method: 'evm_increaseTime', params: [20] }); await rpc.request({ method: 'evm_mine', params: [] });
  await reverts(() => advance(id), 'expired execution');
  await mined(executor.cancel(id, TX));
  const j = await job(id); assert.equal(state(j), 4n); assert.equal(remaining(j), 0n);
  assert.equal((await engine.status(requestId(j))).cancelled, true);
  assert.equal(await executor.credits(aliceAddress), DEPOSIT * 2n);
  await reverts(() => executor.cancel(id, TX), 'cancel once');
});

verify('final report decodes only actual terminal engine tokens and settles exactly once', async () => {
  const id = await open(); await reverts(() => executor.finalize(id, TX), 'not ready');
  await completeEngine(id);
  const expected = await codec.decode([64, 65, 2], false);
  gas.finalize = (await mined(executor.connect(bob).finalize(id, TX))).gasUsed.toString();
  const j = await job(id); assert.equal(state(j), 2n);
  assert.equal(await executor.reportOf(id), expected);
  const reward = await executor.credits(bobAddress); assert.ok(reward > 0n);
  assert.equal(remaining(j) + reward, DEPOSIT);
  await reverts(() => executor.connect(carol).finalize(id, TX), 'report exactly once');
  assert.equal(await executor.credits(carolAddress), 0n); assert.equal(await executor.reportOf(id), expected);
  await reverts(() => advance(id), 'terminal job');
});

verify('bad EOS, special or out-of-range tokens are rejected without a template fallback', async () => {
  for (const output of [[64, 65], [1, 64, 2], [64, 512, 2], [63, 64, 2], [151, 64, 2], [2], []]) {
    await mined(engine.setOutput(output)); const id = await open(); await completeEngine(id);
    await mined(executor.connect(bob).finalize(id, TX));
    assert.equal(state(await job(id)), 3n, 'reject invalid model output ' + output.join(','));
    assert.equal(await executor.reportOf(id), '0x', 'never replace an invalid model output with fixed prose');
  }
});

verify('the real strict word codec receives terminal EOS and decodes exact generated engine tokens', async () => {
  const original = executor;
  try {
    const strictCodec = await deploy('S0ULAnalysisCodec');
    executor = await deploy('S0ULAnalysisExecutor', constructorArgs({
      codec: await strictCodec.getAddress(), codecCodeHash: await hashCode(await strictCodec.getAddress()),
      domainSha256: await strictCodec.domainSha256(),
    }));
    await mined(engine.setOutput([74, 95, 126, 2]));
    const id = await open(); await completeEngine(id); await mined(executor.connect(bob).finalize(id, TX));
    assert.equal(state(await job(id)), 2n);
    assert.equal(await executor.reportOf(id), '0x' + Buffer.from('Native balance present.').toString('hex'));
    assert.deepEqual([...(await executor.outputTokensOf(id))], [74n, 95n, 126n, 2n]);
    assert.equal(await executor.reportOf(id), await strictCodec.decode([...(await engine.outputTokens(requestId(await job(id))))], false));
  } finally { executor = original; }
});

verify('codec failure, empty output and oversized output never publish substitute analysis', async () => {
  for (const mode of [1, 2, 3]) {
    await mined(codec.setMode(mode)); const id = await open(); await completeEngine(id);
    await mined(executor.connect(bob).finalize(id, TX));
    assert.equal(state(await job(id)), 3n); assert.equal(await executor.reportOf(id), '0x');
  }
});

verify('unused completed budget is credited once to its owner and never to a caller-selected recipient', async () => {
  const id = await open(); await completeEngine(id); await mined(executor.connect(bob).finalize(id, TX));
  const rest = remaining(await job(id)); assert.ok(rest > 0n);
  await reverts(() => executor.connect(carol).refundCompleted(id, TX), 'foreign refund');
  await mined(executor.refundCompleted(id, TX));
  assert.equal(remaining(await job(id)), 0n); assert.equal(await executor.credits(aliceAddress), rest);
  const before = await executor.credits(aliceAddress);
  await mined(executor.refundCompleted(id, TX));
  assert.equal(await executor.credits(aliceAddress), before);
  assert.equal((await executor.credits(aliceAddress)) + (await executor.credits(bobAddress)), DEPOSIT);
});

verify('worker rewards are pull credits; rejected withdrawals preserve credits and reentrancy cannot double-spend', async () => {
  const receiver = await deploy('AnalysisReentrantWorkerMock'), address = await receiver.getAddress();
  const destination = await executor.getAddress();
  const id = await open();
  await mined(receiver.runAdvance(destination, id, 128, 4, TX));
  const credit = await executor.credits(address); assert.ok(credit > 0n);
  assert.equal(await receiver.received(), 0n, 'advance never makes an ETH callback');
  await mined(receiver.setRejectPayment(true));
  await reverts(() => receiver.claim(destination, TX), 'payment rejected');
  assert.equal(await executor.credits(address), credit);
  await mined(receiver.setRejectPayment(false));
  await mined(receiver.claim(destination, TX));
  assert.equal(await executor.credits(address), 0n); assert.equal(await receiver.received(), credit);
  assert.equal(await receiver.receiveCount(), 1n); assert.equal(await receiver.reentrySucceeded(), false);
  await reverts(() => receiver.claim(destination, TX), 'empty withdrawal');
});

verify('an engine callback cannot enter the executor again or claim unearned work', async () => {
  const id = await open();
  await mined(engine.setCallback(await executor.getAddress(), executor.interface.encodeFunctionData('advance', [id, 128, 1])));
  await mined(engine.setMode(7)); await advance(id, 128, 1);
  assert.equal(await engine.callbackSucceeded(), false);
  assert.equal(await executor.credits(await engine.getAddress()), 0n);
  assert.ok(await executor.credits(bobAddress) > 0n);
});

verify('dependency bytecode and identity changes fail closed before charging further work', async () => {
  const id = await open();
  for (const contract of [engine, adapter, codec, model]) {
    const address = await contract.getAddress(), code = await provider.getCode(address);
    await rpc.request({ method: 'evm_setAccountCode', params: [address, '0x00'] });
    await reverts(() => advance(id, 128, 1), 'changed dependency code');
    await rpc.request({ method: 'evm_setAccountCode', params: [address, code] });
    assert.equal(remaining(await job(id)), DEPOSIT); assert.equal(await executor.credits(bobAddress), 0n);
  }
  await mined(engine.setIdentity(await model.getAddress(), ZeroAddress, ZeroHash));
  await reverts(() => advance(id, 128, 1), 'changed engine model identity');
  await mined(engine.setIdentity(await model.getAddress(), ZeroAddress, MODEL_ID));
  await mined(engine.setConfigurationMode(1));
  await reverts(() => advance(id, 128, 1), 'changed engine configuration hash');
  await mined(engine.setConfigurationMode(0));
  await mined(adapter.setSchemaHash(ZeroHash));
  await reverts(() => advance(id, 128, 1), 'changed facts schema');
  await mined(adapter.setSchemaHash(SCHEMA));
  await mined(codec.setDomainSha256(ZeroHash));
  await reverts(() => advance(id, 128, 1), 'changed output vocabulary domain');
  await mined(codec.setDomainSha256(DOMAIN));
  await mined(model.setModelId(ZeroHash));
  await reverts(() => advance(id, 128, 1), 'changed model identity');
  assert.equal(remaining(await job(id)), DEPOSIT); assert.equal(await executor.credits(bobAddress), 0n);
});

verify('owner cancellation refunds the exact unspent balance even after engine code has changed', async () => {
  const id = await open(); await advance(id, 128, 1);
  const rest = remaining(await job(id)), reward = await executor.credits(bobAddress);
  await rpc.request({ method: 'evm_setAccountCode', params: [await engine.getAddress(), '0x00'] });
  await reverts(() => advance(id, 128, 1), 'changed engine prevents paid work');
  await mined(executor.cancel(id, TX));
  assert.equal(state(await job(id)), 4n); assert.equal(remaining(await job(id)), 0n);
  assert.equal(await executor.credits(aliceAddress), rest);
  assert.equal((await executor.credits(aliceAddress)) + reward, DEPOSIT);
  await reverts(() => executor.connect(carol).withdraw(TX), 'foreign address has no credit');
});
