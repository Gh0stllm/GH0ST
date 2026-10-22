import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroAddress, ZeroHash, AbiCoder, keccak256, toUtf8Bytes } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const Kind = { Supply: 1, Balance: 2, V2: 3 };
const Status = { Ok: 0, Disabled: 1, CodeChanged: 2, CallFailed: 3, Malformed: 4, OutOfRange: 5,
  MetadataChanged: 6, TooSoon: 7, NoSamples: 8, NoHistory: 9, Stale: 10 };
const selectors = Object.fromEntries(['totalSupply()', 'balanceOf(address)', 'token0()', 'token1()', 'getReserves()'].map(text => [text, keccak256(toUtf8Bytes(text)).slice(0, 10)]));
let compiled, rpc, provider, alice, bob, aliceAddress, bobAddress, parityVectorCount = 0;
const measurements = {};

function collect(directory, prefix, result = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const local = join(directory, entry.name), key = prefix + '/' + entry.name;
    if (entry.isDirectory()) collect(local, key, result);
    else if (entry.name.endsWith('.sol')) result[key] = { content: readFileSync(local, 'utf8') };
  }
  return result;
}
function artifact(name) {
  const found = Object.values(compiled.contracts).flatMap(file => Object.entries(file)).find(([key]) => key === name);
  assert.ok(found, 'Missing compiled contract ' + name);
  return found[1];
}
async function mined(tx) {
  const sent = await tx, receipt = await provider.getTransactionReceipt(sent.hash) ?? await sent.wait();
  if (Number(receipt.status) !== 1) throw Error('Local transaction reverted: ' + sent.hash);
  return receipt;
}
async function deploy(name, args = []) {
  const a = artifact(name), c = await new ContractFactory(a.abi, a.evm.bytecode.object, alice).deploy(...args, { gasLimit: 15_000_000 });
  await c.waitForDeployment(); return c;
}
async function hashCode(contract) { return keccak256(await provider.getCode(await contract.getAddress())); }
const snapshotValues = snapshot => snapshot.getValue('values'); // Result.values is Array.prototype.values.
async function age(seconds = 3) { await rpc.request({ method: 'evm_increaseTime', params: [seconds] }); await rpc.request({ method: 'evm_mine', params: [] }); }
async function register(obs, kind, target, account = ZeroAddress) {
  const id = (await obs.subjectCount()) + 1n;
  await mined(obs.registerSubject(kind, await target.getAddress(), account, await hashCode(target)));
  return id;
}
async function fixture({ spacing = 2, maxAge = 60 } = {}) {
  const token = await deploy('IntelTokenMock', [1_000_000n, 18]);
  const other = await deploy('IntelTokenMock', [2_000_000n, 6]);
  const pair = await deploy('IntelPairMock', [await token.getAddress(), await other.getAddress()]);
  await mined(pair.setReserves(1000, 2000, 1));
  const obs = await deploy('S0ULObservations', [aliceAddress, spacing, maxAge]);
  return { token, other, pair, obs };
}
async function sample(obs, id, expected = Status.Ok) {
  const prediction = await obs.snapshot.staticCall(id);
  assert.equal(Number(prediction[0]), expected);
  const receipt = await mined(obs.snapshot(id, { gasLimit: 1_500_000 }));
  const event = receipt.logs.map(log => { try { return obs.interface.parseLog(log); } catch { return null; } })
    .find(log => log?.name === (expected === Status.Ok ? 'SnapshotStored' : 'SnapshotRejected'));
  assert.ok(event, 'mined snapshot must emit its actual result');
  if (expected !== Status.Ok) assert.equal(Number(event.args.status), expected);
  return receipt;
}
const relative = (current, previous) => previous === 0n ? current === 0n ? 0n : 10_000n :
  ((current - previous) * 10_000n / previous < -10_000n ? -10_000n : (current - previous) * 10_000n / previous > 10_000n ? 10_000n : (current - previous) * 10_000n / previous);

before(async () => {
  const sources = collect(join(root, 'contracts/intel'), 'contracts/intel');
  compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (compiled.errors ?? []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  for (const file of Object.values(compiled.contracts)) for (const [name, a] of Object.entries(file))
    assert.ok(a.evm.deployedBytecode.object.length / 2 <= 24576, name + ' exceeds EIP170');
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai', allowUnlimitedContractSize: false },
    miner: { blockGasLimit: 30_000_000 }, wallet: { deterministic: true } });
  provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1, batchStallTime: 0 }); provider.pollingInterval = 10;
  alice = await provider.getSigner(0); bob = await provider.getSigner(1);
  aliceAddress = await alice.getAddress(); bobAddress = await bob.getAddress();
});
after(async () => {
  if (Object.keys(measurements).length) console.log(JSON.stringify({ format: 's0ul-intel-local-gas-v1',
    chain: 'in-process Ganache31337/shanghai; no public transactions', compiler: solc.version(), parity_vectors: parityVectorCount, gas: measurements }));
  await provider?.destroy(); await rpc?.disconnect();
});

test('only the owner registers or disables fixed code-pinned reader subjects', async () => {
  const f = await fixture();
  await assert.rejects(deploy('S0ULObservations', [ZeroAddress, 2, 60]));
  for (const [spacing, maxAge] of [[0, 60], [86401, 86401], [60, 59], [2, 86401]])
    await assert.rejects(deploy('S0ULObservations', [aliceAddress, spacing, maxAge]));
  const address = await f.token.getAddress(), hash = await hashCode(f.token);
  await assert.rejects(f.obs.connect(bob).registerSubject.staticCall(Kind.Supply, address, ZeroAddress, hash));
  await assert.rejects(f.obs.registerSubject.staticCall(0, address, ZeroAddress, hash));
  await assert.rejects(f.obs.registerSubject.staticCall(4, address, ZeroAddress, hash));
  await assert.rejects(f.obs.registerSubject.staticCall(Kind.Supply, bobAddress, ZeroAddress, hash));
  await assert.rejects(f.obs.registerSubject.staticCall(Kind.Supply, address, ZeroAddress, ZeroHash));
  await assert.rejects(f.obs.registerSubject.staticCall(Kind.Balance, address, ZeroAddress, hash));
  const id = await register(f.obs, Kind.Balance, f.token, bobAddress);
  const subject = await f.obs.subject(id);
  assert.equal(subject.target, address); assert.equal(subject.account, bobAddress); assert.equal(subject.codeHash, hash);
  await assert.rejects(f.obs.connect(bob).setEnabled.staticCall(id, false));
  await mined(f.obs.setEnabled(id, false)); await sample(f.obs, id, Status.Disabled);
  assert.equal((await f.obs.subject(id)).sequence, 0n);
});

test('snapshots contain only actual fixed-getter facts and sampling provenance', async () => {
  const f = await fixture(); await mined(f.token.setBalance(bobAddress, 123_456));
  const supply = await register(f.obs, Kind.Supply, f.token), balance = await register(f.obs, Kind.Balance, f.token, bobAddress), pool = await register(f.obs, Kind.V2, f.pair);
  measurements.supplySnapshot = (await sample(f.obs, supply)).gasUsed.toString();
  measurements.balanceSnapshot = (await sample(f.obs, balance)).gasUsed.toString();
  measurements.v2Snapshot = (await sample(f.obs, pool)).gasUsed.toString();
  assert.deepEqual([...snapshotValues(await f.obs.latest(supply))], [1_000_000n, 0n, 0n, 0n]);
  assert.deepEqual([...snapshotValues(await f.obs.latest(balance))], [123_456n, 1_000_000n, 0n, 0n]);
  const snapshot = await f.obs.latest(pool);
  assert.deepEqual([...snapshotValues(snapshot)], [1000n, 2000n, 10_000n, 1n]);
  assert.equal(snapshot.sequence, 1n);
  const block = await provider.getBlock(Number(snapshot.blockNumber)), parent = await provider.getBlock(Number(snapshot.blockNumber) - 1);
  assert.equal(snapshot.timestamp, BigInt(block.timestamp)); assert.equal(snapshot.parentBlockHash, parent.hash);
  assert.notEqual(snapshot.parentBlockHash, block.hash);
  assert.equal(await f.obs.snapshotHash(pool, 1), (await f.obs.features(pool, 1)).currentHash);
  const functions = artifact('S0ULObservations').abi.filter(item => item.type === 'function');
  assert.deepEqual(functions.find(item => item.name === 'snapshot').inputs.map(input => input.type), ['uint256']);
  assert.ok(functions.every(item => !['call','execute','delegatecall','transfer','approve','setFacts','submitSnapshot'].includes(item.name)));
});

test('failed, short, overlong, huge and gas-burning getters cannot insert history', async () => {
  const f = await fixture();
  const malicious = await deploy('IntelAdversarialGetter', [await f.token.getAddress(), await f.other.getAddress()]);
  const id = await register(f.obs, Kind.Supply, malicious); await sample(f.obs, id);
  const first = await f.obs.latest(id);
  for (const [mode, expected] of [[1, Status.CallFailed], [2, Status.Malformed], [3, Status.Malformed],
    [5, Status.Malformed], [7, Status.CallFailed], [8, Status.Malformed], [4, Status.OutOfRange]]) {
    await mined(malicious.configure(selectors['totalSupply()'], mode, ZeroAddress, '0x')); await age();
    const receipt = await sample(f.obs, id, expected);
    assert.ok(receipt.gasUsed < 500_000n, 'adversarial getter must remain bounded');
    measurements['adversarialMode' + mode] = receipt.gasUsed.toString();
    const subject = await f.obs.subject(id);
    assert.equal(Number(subject.lastStatus), expected); assert.equal(subject.sequence, 1n);
    assert.equal((await f.obs.latest(id)).timestamp, first.timestamp);
  }
});

test('range, balance consistency, runtime and V2 metadata changes fail closed', async () => {
  const f = await fixture();
  const supply = await register(f.obs, Kind.Supply, f.token), balance = await register(f.obs, Kind.Balance, f.token, bobAddress), pool = await register(f.obs, Kind.V2, f.pair);
  await mined(f.token.setSupply(1n << 128n)); await sample(f.obs, supply, Status.OutOfRange);
  await mined(f.token.setSupply(1000)); await mined(f.token.setBalance(bobAddress, 1001));
  await sample(f.obs, balance, Status.Malformed);
  await sample(f.obs, pool);
  const code = await provider.getCode(await f.pair.getAddress());
  await rpc.request({ method: 'evm_setAccountCode', params: [await f.pair.getAddress(), '0x00'] });
  await age(); await sample(f.obs, pool, Status.CodeChanged);
  await rpc.request({ method: 'evm_setAccountCode', params: [await f.pair.getAddress(), code] });
  const hostilePair = await deploy('IntelAdversarialGetter', [await f.token.getAddress(), await f.other.getAddress()]);
  const id = await register(f.obs, Kind.V2, hostilePair); await sample(f.obs, id);
  for (const [selector, mode, status] of [[selectors['getReserves()'], 9, Status.OutOfRange],
    [selectors['getReserves()'], 10, Status.OutOfRange], [selectors['token0()'], 4, Status.Malformed]]) {
    await mined(hostilePair.configure(selector, mode, ZeroAddress, '0x')); await age();
    await sample(f.obs, id, status); assert.equal((await f.obs.subject(id)).sequence, 1n);
  }
  await mined(hostilePair.configure('0x00000000', 0, ZeroAddress, '0x'));
  await mined(hostilePair.setTokens(await f.other.getAddress(), await f.token.getAddress())); await age();
  await sample(f.obs, id, Status.MetadataChanged); assert.equal((await f.obs.subject(id)).sequence, 1n);
});

test('getter callback cannot reenter snapshot or mutate another subject history', async () => {
  const f = await fixture();
  const victim = await register(f.obs, Kind.Supply, f.token);
  const hostile = await deploy('IntelAdversarialGetter', [await f.token.getAddress(), await f.other.getAddress()]);
  const attacker = await register(f.obs, Kind.Supply, hostile);
  await mined(hostile.configure(selectors['totalSupply()'], 6, await f.obs.getAddress(), f.obs.interface.encodeFunctionData('snapshot', [victim])));
  await sample(f.obs, attacker);
  assert.equal((await f.obs.subject(attacker)).sequence, 1n);
  assert.equal((await f.obs.subject(victim)).sequence, 0n);
});

test('minimum spacing and ring history preserve exact retained sequence identities', async () => {
  const f = await fixture({ spacing: 10, maxAge: 60 }), id = await register(f.obs, Kind.Supply, f.token);
  await sample(f.obs, id);
  const lastStatus = (await f.obs.subject(id)).lastStatus;
  await sample(f.obs, id, Status.TooSoon);
  assert.equal((await f.obs.subject(id)).lastStatus, lastStatus);
  for (let sequence = 2; sequence <= 18; ++sequence) {
    await mined(f.token.setSupply(1000 + sequence)); await age(11); await sample(f.obs, id);
  }
  assert.equal(await f.obs.RING_SIZE(), 16n); assert.equal((await f.obs.subject(id)).sequence, 18n);
  await assert.rejects(f.obs.sampleAt(id, 1)); await assert.rejects(f.obs.sampleAt(id, 2));
  assert.equal(snapshotValues(await f.obs.sampleAt(id, 3))[0], 1003n);
  assert.equal(snapshotValues(await f.obs.latest(id))[0], 1018n);
  assert.equal((await f.obs.features(id, 15)).previous.sequence, 3n);
  await assert.rejects(f.obs.features(id, 0)); await assert.rejects(f.obs.features(id, 16));
  await assert.rejects(f.obs.latest(999)); await assert.rejects(f.obs.sampleAt(id, 19));
});

test('signed BPS changes, zero baselines, clipping and freshness match independent integer arithmetic', async () => {
  const f = await fixture(), id = await register(f.obs, Kind.Supply, f.token);
  let previous = 1_000_000n; await sample(f.obs, id);
  let frame = await f.obs.features(id, 1);
  assert.equal(frame.hasHistory, false);
  for (const current of [1_200_000n, 900_000n, 0n, 1n, (1n << 128n) - 1n]) {
    await mined(f.token.setSupply(current)); await age(); await sample(f.obs, id);
    frame = await f.obs.features(id, 1);
    assert.equal(frame.hasHistory, true); assert.equal(frame.fresh, true);
    assert.equal(frame.vector[0], relative(current, previous));
    if (previous === 0n) assert.ok((Number(frame.flags) & 8) !== 0);
    previous = current;
  }
  assert.ok((Number(frame.flags) & 16) !== 0, 'large relative growth must report clipping');
  await age(61); frame = await f.obs.features(id, 1);
  assert.equal(frame.fresh, false); assert.equal(Number(frame.status), Status.Stale);
});

test('V2 ratio and account supply share use raw-unit integer ratios rather than caller price data', async () => {
  const f = await fixture(), pool = await register(f.obs, Kind.V2, f.pair), balance = await register(f.obs, Kind.Balance, f.token, bobAddress);
  await sample(f.obs, pool);
  await mined(f.pair.setReserves(1100, 1800, 2)); await age(); await sample(f.obs, pool);
  const frame = await f.obs.features(pool, 1);
  const oldRatioNumerator = 2000n * 1100n, newRatioNumerator = 1800n * 1000n;
  assert.equal(frame.vector[3], relative(newRatioNumerator, oldRatioNumerator));
  assert.equal(frame.vector[0], 1000n); assert.equal(frame.vector[1], -1000n);
  await mined(f.token.setBalance(bobAddress, 123_456)); await sample(f.obs, balance);
  assert.equal((await f.obs.features(balance, 1)).vector[4], 1234n);
});

test('two-day elapsed-time capping never claims BPS clipping and reports preserve the actual window', async () => {
  const f = await reportFixture();
  await mined(f.reports.captureAndAnalyze(f.id, 1)); await age(172800);
  await mined(f.reports.captureAndAnalyze(f.id, 1));
  const frame = await f.obs.features(f.id, 1), report = await f.reports.report(2);
  const elapsed = frame.current.timestamp - frame.previous.timestamp;
  assert.ok(elapsed >= 172800n); assert.equal(frame.elapsedSeconds, elapsed);
  assert.equal(frame.vector[5], 86400n); assert.equal(frame.flags, 7n);
  assert.equal(frame.fresh, true); assert.equal(frame.vector[0], 0n);
  assert.equal(report.elapsedSeconds, elapsed);
  assert.equal(report.observedAt, frame.current.timestamp); assert.equal(report.previousObservedAt, frame.previous.timestamp);
  assert.doesNotMatch(await f.reports.render(2), /relative changes were clipped/);
});

test('trained integer head matches every independent parity vector and rejects invalid feature ranges', async () => {
  const vectors = JSON.parse(readFileSync(join(root, 'intel-model/parity-vectors.json'), 'utf8'));
  const model = await deploy('S0ULIntelModel');
  assert.equal(await model.modelId(), vectors.modelId);
  assert.equal(await model.trainingManifestHash(), vectors.trainingManifestHash);
  assert.equal(await model.weightsHash(), vectors.weightsHash);
  assert.equal(await model.trainingDataHash(), vectors.trainingDataHash);
  assert.notEqual(await model.modelId(), '0x6b0817a3bc4d0ba1f03ec6e14387285e1bcda0e40fdd40d7daee2cbc3c2ff89a', 'new numeric head must not impersonate the language model');
  for (const vector of vectors.vectors) {
    const [label, scores] = await model.classify(vector.features);
    assert.equal(Number(label), vector.label, JSON.stringify(vector.features));
    assert.deepEqual([...scores].map(String), vector.scores, JSON.stringify(vector.features));
  }
  for (const vector of vectors.invalidVectors) await assert.rejects(model.classify(vector));
  for (const vector of [[-10001,0,0,0,0,0,1,7], [0,0,0,0,-1,0,1,7], [0,0,0,0,0,-1,1,7], [0,0,0,0,0,0,1,-1]])
    await assert.rejects(model.classify(vector));
  parityVectorCount = vectors.vectors.length;
  for (const [name, vector] of [['classifierNormal', [0,0,0,0,0,300,1,7]], ['classifierPool', [10000,-10000,4000,7000,0,86400,3,23]], ['classifierAbstain', [0,0,0,0,0,0,1,6]]])
    measurements[name] = (await mined(alice.sendTransaction(await model.classify.populateTransaction(vector)))).gasUsed.toString();
});

async function reportFixture(options) {
  const f = await fixture(options), model = await deploy('S0ULIntelModel');
  const reports = await deploy('S0ULIntelReports', [await f.obs.getAddress(), await model.getAddress()]);
  const id = await register(f.obs, Kind.Supply, f.token);
  return { ...f, model, reports, id };
}

test('reports bind on-chain snapshots, exact model scores, ABI feature hash and observed provenance', async () => {
  const f = await reportFixture();
  measurements.captureBaselineReport = (await mined(f.reports.connect(bob).captureAndAnalyze(f.id, 1))).gasUsed.toString();
  assert.equal(await f.reports.reportCount(), 1n);
  let r = await f.reports.report(1);
  assert.equal(r.label, 5n); assert.equal(r.previousSequence, 0n);
  assert.match(await f.reports.render(1), /Baseline snapshot recorded; no prior-sample trend is asserted/);
  await mined(f.token.setSupply(900_000)); await age();
  measurements.captureTrendReport = (await mined(f.reports.captureAndAnalyze(f.id, 1))).gasUsed.toString();
  r = await f.reports.report(2); const frame = await f.obs.features(f.id, 1);
  const [label, scores] = await f.model.classify([...frame.vector]);
  assert.equal(r.subjectId, f.id); assert.equal(r.label, label); assert.equal(label, 1n);
  assert.deepEqual([...r.scores], [...scores]); assert.deepEqual([...r.features], [...frame.vector]);
  assert.deepEqual([...r.currentValues], [...snapshotValues(frame.current)]);
  assert.deepEqual([...r.previousValues], [...snapshotValues(frame.previous)]);
  assert.equal(r.currentHash, await f.obs.snapshotHash(f.id, 2));
  assert.equal(r.previousHash, await f.obs.snapshotHash(f.id, 1));
  assert.equal(r.modelId, await f.model.modelId());
  const frameType = f.obs.interface.getFunction('features').outputs[0];
  const expectedHash = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address',frameType], [31337, await f.obs.getAddress(), frame]));
  assert.equal(r.featureHash, expectedHash);
  assert.equal(r.observedBlock, frame.current.blockNumber); assert.equal(r.createdBlock, r.observedBlock);
  assert.equal(await f.reports.latestReport(f.id), 2n);
  const rendered = await f.reports.render(2);
  assert.match(rendered, /900000/); assert.match(rendered, /-1000/);
  assert.match(rendered, /not a forecast or a safety verdict/);
  assert.doesNotMatch(rendered, /(?:will rise|will fall|safe to (?:buy|trade)|guaranteed profit|confidence\s*:?\s*\d+%)/i);
  measurements.renderTrendReport = (await mined(alice.sendTransaction(await f.reports.render.populateTransaction(2)))).gasUsed.toString();
  const functions = artifact('S0ULIntelReports').abi.filter(item => item.type === 'function');
  for (const name of ['analyze','captureAndAnalyze']) assert.deepEqual(functions.find(item => item.name === name).inputs.map(i => i.type), ['uint256','uint8']);
});

test('duplicate analysis cannot replay and later samples cannot rewrite recorded facts', async () => {
  const f = await reportFixture(); await mined(f.reports.captureAndAnalyze(f.id, 1));
  await assert.rejects(f.reports.analyze.staticCall(f.id, 1));
  const recorded = await f.reports.report(1);
  await mined(f.token.setSupply(777_777)); await age(); await sample(f.obs, f.id);
  await mined(f.reports.analyze(f.id, 1));
  assert.deepEqual([...(await f.reports.report(1)).currentValues], [...recorded.currentValues]);
  assert.equal((await f.reports.report(2)).currentValues[0], 777_777n);
  assert.equal(await f.reports.reportCount(), 2n);
  await assert.rejects(f.reports.report(0)); await assert.rejects(f.reports.render(3));
});

test('absent, stale, disabled and rejected observations cannot be presented as a new report', async () => {
  const f = await reportFixture();
  await assert.rejects(f.reports.analyze.staticCall(f.id, 1));
  await mined(f.reports.captureAndAnalyze(f.id, 1));
  const before = await f.obs.subject(f.id);
  await assert.rejects(f.reports.captureAndAnalyze.staticCall(f.id, 1));
  assert.equal((await f.obs.subject(f.id)).sequence, before.sequence);
  await age(61); await assert.rejects(f.reports.analyze.staticCall(f.id, 1));
  await mined(f.obs.setEnabled(f.id, false)); await assert.rejects(f.reports.analyze.staticCall(f.id, 1));
  await mined(f.obs.setEnabled(f.id, true)); await mined(f.token.setSupply(1n << 128n));
  await sample(f.obs, f.id, Status.OutOfRange);
  await assert.rejects(f.reports.analyze.staticCall(f.id, 1));
  assert.equal(await f.reports.reportCount(), 1n);
  assert.equal((await f.reports.report(1)).currentValues[0], 1_000_000n);
});

test('report dependencies and model identity remain pinned on every analysis', async () => {
  const f = await fixture(), model = await deploy('IntelMutableClassifier');
  await assert.rejects(deploy('S0ULIntelReports', [ZeroAddress, await model.getAddress()]));
  await assert.rejects(deploy('S0ULIntelReports', [await f.obs.getAddress(), bobAddress]));
  const reports = await deploy('S0ULIntelReports', [await f.obs.getAddress(), await model.getAddress()]);
  const id = await register(f.obs, Kind.Supply, f.token); await sample(f.obs, id);
  await mined(model.setIdentity(ZeroHash, keccak256(toUtf8Bytes('changed'))));
  await assert.rejects(reports.analyze.staticCall(id, 1));
  await mined(model.setIdentity('0x' + '0'.repeat(63) + '1', '0x' + '0'.repeat(63) + '2'));
  const code = await provider.getCode(await model.getAddress());
  await rpc.request({ method: 'evm_setAccountCode', params: [await model.getAddress(), '0x00'] });
  await assert.rejects(reports.analyze.staticCall(id, 1));
  await rpc.request({ method: 'evm_setAccountCode', params: [await model.getAddress(), code] });
  await rpc.request({ method: 'evm_setAccountCode', params: [await f.obs.getAddress(), '0x00'] });
  await assert.rejects(reports.analyze.staticCall(id, 1));
  assert.equal(await reports.reportCount(), 0n);
});

test('failed classification atomically rolls back capture and labels cannot cross reader kinds', async () => {
  const f = await fixture(), model = await deploy('IntelMutableClassifier');
  const reports = await deploy('S0ULIntelReports', [await f.obs.getAddress(), await model.getAddress()]);
  const id = await register(f.obs, Kind.Supply, f.token);
  await mined(model.setLabel(6));
  await assert.rejects(mined(reports.captureAndAnalyze(id, 1, { gasLimit: 2_000_000 })));
  assert.equal((await f.obs.subject(id)).sequence, 0n); assert.equal(await reports.reportCount(), 0n);
  await mined(model.setLabel(5)); await mined(reports.captureAndAnalyze(id, 1));
  await mined(f.token.setSupply(900_000)); await age(); await sample(f.obs, id);
  await mined(model.setLabel(3)); await assert.rejects(reports.analyze.staticCall(id, 1));
  assert.equal(await reports.reportCount(), 1n);
});

test('zero baselines and clipped reserve ratios render their limits rather than invented market claims', async () => {
  const f = await fixture(), model = await deploy('S0ULIntelModel');
  const reports = await deploy('S0ULIntelReports', [await f.obs.getAddress(), await model.getAddress()]);
  const pool = await register(f.obs, Kind.V2, f.pair);
  await mined(reports.captureAndAnalyze(pool, 1));
  await mined(f.pair.setReserves(1, 20_000, 2)); await age(); await mined(reports.captureAndAnalyze(pool, 1));
  const trend = await reports.render(2);
  assert.match(trend, /not a USD price; reserve changes are not trading volume/);
  assert.match(trend, /clipped to \+\/-10000 bps/);
  await mined(f.pair.setReserves(0, 0, 3)); await age(); await mined(reports.captureAndAnalyze(pool, 1));
  await mined(f.pair.setReserves(1000, 2000, 4)); await age(); await mined(reports.captureAndAnalyze(pool, 1));
  assert.equal((await reports.report(4)).label, 5n);
  assert.match(await reports.render(4), /baseline was zero; an ordinary percentage comparison is undefined/);
});
