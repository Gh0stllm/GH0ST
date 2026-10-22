import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroAddress, ZeroHash, AbiCoder, keccak256, toUtf8Bytes } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const Kind = { Supply: 1, Balance: 2, V2: 3 };
const Status = { Ok: 0, Disabled: 1, CodeChanged: 2, CallFailed: 3, Malformed: 4, OutOfRange: 5,
  MetadataChanged: 6, TooSoon: 7, NoSamples: 8, NoHistory: 9, Stale: 10 };
const selectors = Object.fromEntries(['totalSupply()', 'balanceOf(address)', 'token0()', 'token1()', 'getReserves()'].map(text => [text, keccak256(toUtf8Bytes(text)).slice(0, 10)]));
let compiled, compiledSourceSha256, rpc, provider, alice, bob, carol, aliceAddress, bobAddress, carolAddress;
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
  assert.ok(found, 'Missing compiled contract ' + name); return found[1];
}
async function mined(tx) {
  const sent = await tx, receipt = await provider.getTransactionReceipt(sent.hash) ?? await sent.wait();
  if (Number(receipt.status) !== 1) throw Error('Local transaction reverted: ' + sent.hash); return receipt;
}
async function deploy(name, args = []) {
  const a = artifact(name), c = await new ContractFactory(a.abi, a.evm.bytecode.object, alice).deploy(...args, { gasLimit: 15_000_000 });
  await c.waitForDeployment(); return c;
}
async function hashCode(contract) { return keccak256(await provider.getCode(await contract.getAddress())); }
async function age(seconds = 3) { await rpc.request({ method: 'evm_increaseTime', params: [seconds] }); await rpc.request({ method: 'evm_mine', params: [] }); }
const snapshotValues = snapshot => snapshot.getValue('values');
const parsedEvent = (receipt, contract, name) => receipt.logs.map(log => { try { return contract.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === name);

before(async () => {
  const sources = collect(join(root, 'contracts/intel'), 'contracts/intel');
  compiledSourceSha256 = createHash('sha256').update(sources['contracts/intel/v2/S0ULPermissionlessObservations.sol'].content).digest('hex');
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
  alice = await provider.getSigner(0); bob = await provider.getSigner(1); carol = await provider.getSigner(2);
  aliceAddress = await alice.getAddress(); bobAddress = await bob.getAddress(); carolAddress = await carol.getAddress();
});
after(async () => {
  if (Object.keys(measurements).length) console.log(JSON.stringify({ format: 's0ul-intel-v2-local-gas-v1',
    chain: 'in-process Ganache31337/shanghai; no public transactions', compiler: solc.version(), observationsSourceSha256: compiledSourceSha256, observationsRuntimeBytes: artifact('S0ULPermissionlessObservations').evm.deployedBytecode.object.length/2, gas: measurements }));
  await provider?.destroy(); await rpc?.disconnect();
});

const Probe = { Ok: 0, NoCode: 1, CallFailed: 2, Malformed: 3, OutOfRange: 4, NotRequested: 5 };
async function fixture({ spacing = 2, maxAge = 60 } = {}) {
  const token = await deploy('IntelV2TokenMock', [1_000_000n, 18]);
  const other = await deploy('IntelV2TokenMock', [2_000_000n, 6]);
  const pair = await deploy('IntelV2PairMock', [await token.getAddress(), await other.getAddress()]);
  await mined(pair.setReserves(1000, 2000, 1));
  const obs = await deploy('S0ULPermissionlessObservations', [spacing, maxAge]);
  return { token, other, pair, obs };
}
async function watch(obs, kind, target, account = ZeroAddress, signer = alice) {
  const args = [kind, await target.getAddress(), account, await hashCode(target)];
  const id = await obs.connect(signer).watch.staticCall(...args);
  const receipt = await mined(obs.connect(signer).watch(...args, { gasLimit: 1_500_000 }));
  return { id, receipt, args };
}
async function sample(obs, id, expected = Status.Ok) {
  assert.equal(Number((await obs.snapshot.staticCall(id))[0]), expected);
  const receipt = await mined(obs.snapshot(id, { gasLimit: 1_500_000 }));
  const event = parsedEvent(receipt, obs, expected === Status.Ok ? 'SnapshotStored' : 'SnapshotRejected');
  assert.ok(event, 'snapshot must emit its actual stored or rejected result');
  if (expected !== Status.Ok) assert.equal(Number(event.args.status), expected);
  return receipt;
}

// All deployments and transactions below run in the in-process test chain.
test('unregistered inspection returns uint256 native/no-code facts without inventing identity or safety claims', async () => {
  const f = await fixture(), address = '0x0000000000000000000000000000000000001234';
  const native = (1n << 200n) + 123n;
  await rpc.request({ method: 'evm_setAccountBalance', params: [address, '0x' + native.toString(16)] });
  const inspection = await f.obs.inspect(address, ZeroAddress);
  assert.equal(inspection.target.toLowerCase(), address.toLowerCase()); assert.equal(inspection.nativeBalance, native);
  assert.equal(inspection.codeSize, 0n); assert.equal(inspection.compatibleKinds, 0n); assert.equal(inspection.preferredKind, 0n);
  assert.equal(inspection.supplyStatus, BigInt(Probe.NoCode)); assert.equal(inspection.poolStatus, BigInt(Probe.NoCode));
  assert.equal(await f.obs.subjectCount(), 0n); assert.equal(await f.obs.watchCount(aliceAddress), 0n);
  const block = await provider.getBlock('latest'); assert.equal(inspection.observedAt, BigInt(block.timestamp));
  const text = await f.obs.inspectText(address, ZeroAddress);
  assert.doesNotMatch(text, /\bEOA\b|externally.owned|safe to|safe contract|guaranteed|forecast|will rise|will fall/i);
  assert.match(text, /code|bytecode/i); assert.match(text, /native|balance/i);
  assert.equal(await f.obs.owner(), ZeroAddress);
  for (const [spacing, maxAge] of [[0, 60], [86401, 86401], [60, 59], [2, 86401]])
    await assert.rejects(deploy('S0ULPermissionlessObservations', [spacing, maxAge]));
});

test('inspection detects overlapping pool getters before token fallback and returns only fixed-getter facts', async () => {
  const f = await fixture(); await mined(f.token.setBalance(bobAddress, 123_456));
  const supply = await f.obs.inspect(await f.token.getAddress(), ZeroAddress);
  assert.equal(supply.compatibleKinds, 1n); assert.equal(supply.preferredKind, BigInt(Kind.Supply));
  assert.equal(supply.balanceStatus, BigInt(Probe.NotRequested)); assert.deepEqual([...supply.supplyValues], [1_000_000n,0n,0n,0n]);
  const balance = await f.obs.inspect(await f.token.getAddress(), bobAddress);
  assert.equal(balance.compatibleKinds, 3n); assert.equal(balance.preferredKind, BigInt(Kind.Balance));
  assert.deepEqual([...balance.balanceValues], [123_456n,1_000_000n,0n,0n]);
  const pool = await f.obs.inspect(await f.pair.getAddress(), bobAddress);
  assert.equal(pool.compatibleKinds, 7n); assert.equal(pool.preferredKind, BigInt(Kind.V2));
  assert.equal(pool.asset0, await f.token.getAddress()); assert.equal(pool.asset1, await f.other.getAddress());
  assert.deepEqual([...pool.poolValues], [1000n,2000n,10_000n,1n]);
  assert.equal(pool.codeHash, await hashCode(f.pair)); assert.ok(pool.codeSize > 0n);
  measurements.inspectPool = (await mined(alice.sendTransaction(await f.obs.inspect.populateTransaction(await f.pair.getAddress(), bobAddress)))).gasUsed.toString();
  assert.equal(await f.obs.subjectCount(), 0n, 'free inspection must not register any subject');
  const functions = artifact('S0ULPermissionlessObservations').abi.filter(item => item.type === 'function');
  assert.ok(functions.every(item => !['execute','delegatecall','transfer','approve','setFacts','submitSnapshot','setEnabled','registerSubject'].includes(item.name)));
});

test('inspector bounds failed, malformed, huge, reverting and gas-burning fixed getter responses', async () => {
  const f = await fixture(), hostile = await deploy('IntelV2HostileGetter', [await f.token.getAddress(), await f.other.getAddress()]);
  for (const [mode, expected] of [[1,Probe.CallFailed],[2,Probe.Malformed],[3,Probe.Malformed],[4,Probe.Malformed],
    [5,Probe.CallFailed],[6,Probe.OutOfRange],[7,Probe.CallFailed],[13,Probe.Malformed]]) {
    await mined(hostile.configure(selectors['totalSupply()'], mode, ZeroAddress, '0x'));
    const result = await f.obs.inspect(await hostile.getAddress(), bobAddress, { gasLimit: 1_500_000 });
    assert.equal(Number(result.supplyStatus), expected, 'mode ' + mode);
    assert.equal(result.preferredKind, 0n); assert.equal(result.compatibleKinds, 0n);
    assert.deepEqual([...result.supplyValues], [0n,0n,0n,0n]);
    assert.deepEqual([...result.balanceValues], [0n,0n,0n,0n], 'failed balance probes must not expose partial facts');
    assert.deepEqual([...result.poolValues], [0n,0n,0n,0n], 'failed pool probes must not expose partial reserves');
    const receipt = await mined(alice.sendTransaction({ ...await f.obs.inspect.populateTransaction(await hostile.getAddress(), bobAddress), gasLimit: 1_500_000 }));
    assert.ok(receipt.gasUsed < 500_000n, 'all probes must remain bounded in hostile mode ' + mode);
    measurements['inspectHostile' + mode] = receipt.gasUsed.toString();
    await assert.rejects(f.obs.watch.staticCall(Kind.Supply, await hostile.getAddress(), ZeroAddress, await hashCode(hostile)));
    assert.equal(await f.obs.subjectCount(), 0n);
  }
  await mined(hostile.configure(selectors['balanceOf(address)'], 9, ZeroAddress, '0x'));
  assert.equal((await f.obs.inspect(await hostile.getAddress(), bobAddress)).balanceStatus, BigInt(Probe.Malformed));
  for (const [selector, mode, expected] of [[selectors['token0()'],10,Probe.Malformed], [selectors['getReserves()'],11,Probe.OutOfRange],
    [selectors['getReserves()'],12,Probe.OutOfRange], [selectors['getReserves()'],14,Probe.Malformed], [selectors['getReserves()'],15,Probe.Malformed]]) {
    await mined(hostile.configure(selector, mode, ZeroAddress, '0x'));
    const result = await f.obs.inspect(await hostile.getAddress(), ZeroAddress);
    assert.equal(result.poolStatus, BigInt(expected)); assert.equal(result.preferredKind, BigInt(Kind.Supply));
    assert.deepEqual([...result.poolValues], [0n,0n,0n,0n]);
  }
});

test('permissionless watch deduplicates code-pinned keys and joining cannot overwrite shared history', async () => {
  const f = await fixture(), target = await f.token.getAddress(), code = await hashCode(f.token);
  const { id, receipt } = await watch(f.obs, Kind.Supply, f.token, ZeroAddress, bob);
  measurements.watchSupplyBaseline = receipt.gasUsed.toString();
  assert.equal(id, 1n); assert.equal(await f.obs.isWatching(bobAddress,id), true); assert.equal(await f.obs.isWatching(aliceAddress,id), false);
  const first = await f.obs.latest(id), firstHash = await f.obs.snapshotHash(id,1);
  assert.equal(first.sequence, 1n); assert.deepEqual([...snapshotValues(first)], [1_000_000n,0n,0n,0n]);
  const key = await f.obs.subjectKey(Kind.Supply,target,ZeroAddress,code); assert.equal(await f.obs.keyToSubject(key), id);
  await mined(f.token.setSupply(777_777));
  const join = await watch(f.obs, Kind.Supply, f.token); assert.equal(join.id, id);
  measurements.joinSharedWatch = join.receipt.gasUsed.toString();
  assert.equal(await f.obs.subjectCount(), 1n); assert.equal((await f.obs.latest(id)).sequence, 1n);
  assert.equal(await f.obs.snapshotHash(id,1), firstHash); assert.deepEqual([...snapshotValues(await f.obs.latest(id))], [...snapshotValues(first)]);
  await watch(f.obs, Kind.Supply, f.token); assert.equal(await f.obs.watchCount(aliceAddress), 1n);
  await mined(f.obs.unwatch(id)); assert.equal(await f.obs.isWatching(aliceAddress,id), false);
  assert.equal(await f.obs.isWatching(bobAddress,id), true); assert.equal((await f.obs.latest(id)).sequence, 1n);
  for (const args of [[0,target,ZeroAddress,code],[4,target,ZeroAddress,code],[Kind.Supply,bobAddress,ZeroAddress,code],
    [Kind.Supply,target,ZeroAddress,ZeroHash],[Kind.Balance,target,ZeroAddress,code],[Kind.Supply,target,bobAddress,code]])
    await assert.rejects(f.obs.watch.staticCall(...args));
});

test('watch limits are per-wallet and unwatch frees only that caller slot without global spam denial', async () => {
  const f = await fixture(), ids = [];
  for (let index = 1; index <= 64; ++index) {
    const account = '0x' + (0x10000n + BigInt(index)).toString(16).padStart(40,'0');
    ids.push((await watch(f.obs,Kind.Balance,f.token,account)).id);
  }
  assert.equal(await f.obs.watchCount(aliceAddress), 64n); assert.equal((await f.obs.watchlist(aliceAddress)).length, 64);
  const extraAccount = '0x0000000000000000000000000000000000010100';
  await assert.rejects(f.obs.watch.staticCall(Kind.Balance,await f.token.getAddress(),extraAccount,await hashCode(f.token)));
  const extra = await watch(f.obs,Kind.Balance,f.token,extraAccount,bob);
  assert.equal(extra.id,65n); assert.equal(await f.obs.watchCount(bobAddress),1n); assert.equal(await f.obs.subjectCount(),65n);
  const joined = await watch(f.obs,Kind.Balance,f.token,'0x0000000000000000000000000000000000010001',bob);
  assert.equal(joined.id,ids[0]); assert.equal(await f.obs.watchCount(bobAddress),2n);
  const oldHash = await f.obs.snapshotHash(ids[0],1);
  await mined(f.obs.unwatch(ids[0])); assert.equal(await f.obs.watchCount(aliceAddress),63n);
  assert.equal(await f.obs.isWatching(bobAddress,ids[0]),true); assert.equal(await f.obs.snapshotHash(ids[0],1),oldHash);
  await watch(f.obs,Kind.Balance,f.token,extraAccount); assert.equal(await f.obs.watchCount(aliceAddress),64n);
  assert.equal(await f.obs.subjectCount(),65n, 'joining an existing key must not allocate another global subject');
});

test('minimum spacing, ring identities, relative facts and freshness remain valid after automatic watch baseline', async () => {
  const f = await fixture({ spacing: 10, maxAge: 60 }), { id } = await watch(f.obs,Kind.Supply,f.token);
  const old = await f.obs.subject(id); await sample(f.obs,id,Status.TooSoon);
  assert.equal((await f.obs.subject(id)).lastStatus,old.lastStatus); assert.equal((await f.obs.latest(id)).sequence,1n);
  await mined(f.token.setSupply(900_000)); await age(11); await sample(f.obs,id);
  assert.equal((await f.obs.features(id,1)).vector[0],-1000n);
  for (let sequence=3;sequence<=18;++sequence) { await age(11); await sample(f.obs,id); }
  assert.equal((await f.obs.subject(id)).sequence,18n); assert.equal((await f.obs.sampleAt(id,3)).sequence,3n);
  await assert.rejects(f.obs.sampleAt(id,1)); await assert.rejects(f.obs.sampleAt(id,2));
  assert.equal((await f.obs.features(id,15)).previous.sequence,3n);
  await assert.rejects(f.obs.features(id,0)); await assert.rejects(f.obs.features(id,16));
  await age(61); assert.equal((await f.obs.features(id,1)).status,BigInt(Status.Stale));
});

test('existing-key validation rejects changed getter facts, pool metadata and runtime without inserting history', async () => {
  const f = await fixture(), hostile = await deploy('IntelV2HostileGetter',[await f.token.getAddress(),await f.other.getAddress()]);
  const supply = await watch(f.obs,Kind.Supply,hostile);
  await mined(hostile.configure(selectors['totalSupply()'],1,ZeroAddress,'0x'));
  await assert.rejects(f.obs.connect(bob).watch.staticCall(...supply.args));
  assert.equal(await f.obs.watchCount(bobAddress),0n); assert.equal((await f.obs.latest(supply.id)).sequence,1n);
  await age(); await sample(f.obs,supply.id,Status.CallFailed);
  await mined(hostile.configure(selectors['totalSupply()'],6,ZeroAddress,'0x')); await age();
  await sample(f.obs,supply.id,Status.OutOfRange); assert.equal((await f.obs.latest(supply.id)).sequence,1n);
  const pool = await watch(f.obs,Kind.V2,f.pair);
  const mutablePool = await deploy('IntelV2HostileGetter',[await f.token.getAddress(),await f.other.getAddress()]);
  const shared = await watch(f.obs,Kind.V2,mutablePool);
  await mined(mutablePool.setTokens(await f.other.getAddress(),await f.token.getAddress()));
  await assert.rejects(f.obs.connect(bob).watch.staticCall(...shared.args));
  await age(); await sample(f.obs,shared.id,Status.MetadataChanged);
  const code = await provider.getCode(await f.pair.getAddress());
  await rpc.request({method:'evm_setAccountCode',params:[await f.pair.getAddress(),'0x00']});
  await age(); await sample(f.obs,pool.id,Status.CodeChanged);
  await assert.rejects(f.obs.connect(bob).watch.staticCall(...pool.args));
  await rpc.request({method:'evm_setAccountCode',params:[await f.pair.getAddress(),code]});
  assert.equal((await f.obs.latest(pool.id)).sequence,1n);
});

test('underfunded gas reverts instead of recording invented reader failure, and getter callbacks cannot mutate history', async () => {
  const f = await fixture(), { id } = await watch(f.obs,Kind.Supply,f.token), old = await f.obs.subject(id);
  await assert.rejects(f.obs.inspect(await f.token.getAddress(),ZeroAddress,{gasLimit:70_000}));
  await age(); await assert.rejects(f.obs.snapshot.staticCall(id,{gasLimit:70_000}));
  await assert.rejects(mined(f.obs.snapshot(id,{gasLimit:70_000})), 'an actual underfunded transaction must revert and roll back');
  assert.equal((await f.obs.subject(id)).lastStatus,old.lastStatus); assert.equal((await f.obs.latest(id)).sequence,1n);
  const hostile = await deploy('IntelV2HostileGetter',[await f.token.getAddress(),await f.other.getAddress()]);
  await mined(hostile.configure(selectors['totalSupply()'],8,await f.obs.getAddress(),f.obs.interface.encodeFunctionData('snapshot',[id])));
  const attack = await watch(f.obs,Kind.Supply,hostile);
  assert.equal((await f.obs.latest(id)).sequence,1n); assert.equal((await f.obs.latest(attack.id)).sequence,1n);
  assert.equal(await f.obs.watchCount(await hostile.getAddress()),0n);
  await mined(hostile.configure(selectors['totalSupply()'],8,await f.token.getAddress(),f.token.interface.encodeFunctionData('setSupply',[1])));
  const beforeSupply = await f.token.totalSupply();
  const inspected = await f.obs.inspect(await hostile.getAddress(),ZeroAddress);
  assert.equal(inspected.supplyStatus,0n); assert.equal(await f.token.totalSupply(),beforeSupply, 'STATICCALL ancestry must block writes even to a getter target without a reentrancy guard');
});

test('permissionless histories feed model reports with exact facts, scores, hashes and observed provenance', async () => {
  const f = await fixture(), model = await deploy('S0ULIntelModel');
  const reports = await deploy('S0ULIntelReports',[await f.obs.getAddress(),await model.getAddress()]);
  const { id, receipt: watched } = await watch(f.obs,Kind.Supply,f.token);
  const baselineReceipt = await mined(reports.connect(bob).analyze(id,1));
  measurements.analyzeWatchBaseline = baselineReceipt.gasUsed.toString();
  let report = await reports.report(1), frame = await f.obs.features(id,1);
  assert.equal(report.label,5n); assert.equal(report.previousSequence,0n); assert.equal(report.currentSequence,1n);
  assert.equal(report.observedAt,frame.current.timestamp); assert.equal(report.observedBlock,frame.current.blockNumber);
  assert.equal(report.observedBlock,BigInt(watched.blockNumber), 'local Ganache EVM and RPC block counters agree in this fixture');
  assert.equal(report.createdBlock,BigInt(baselineReceipt.blockNumber));
  assert.equal(report.currentHash,await f.obs.snapshotHash(id,1));
  await assert.rejects(reports.analyze.staticCall(id,1));
  await assert.rejects(reports.captureAndAnalyze.staticCall(id,1));
  assert.equal((await f.obs.latest(id)).sequence,1n); assert.equal(await reports.reportCount(),1n);
  await mined(f.token.setSupply(900_000)); await age();
  measurements.captureTrendReport = (await mined(reports.connect(carol).captureAndAnalyze(id,1))).gasUsed.toString();
  report = await reports.report(2); frame = await f.obs.features(id,1);
  const [label,scores] = await model.classify([...frame.vector]);
  assert.equal(report.label,label); assert.equal(label,1n); assert.deepEqual([...report.scores],[...scores]);
  assert.deepEqual([...report.features],[...frame.vector]); assert.deepEqual([...report.currentValues],[...snapshotValues(frame.current)]);
  assert.deepEqual([...report.previousValues],[...snapshotValues(frame.previous)]);
  assert.equal(report.previousHash,await f.obs.snapshotHash(id,1)); assert.equal(report.currentHash,await f.obs.snapshotHash(id,2));
  assert.equal(report.modelId,await model.modelId()); assert.equal(report.elapsedSeconds,frame.current.timestamp-frame.previous.timestamp);
  const frameType = f.obs.interface.getFunction('features').outputs[0];
  assert.equal(report.featureHash,keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address',frameType],[31337,await f.obs.getAddress(),frame])));
  const text = await reports.render(2);
  assert.match(text,/900000/); assert.match(text,/-1000/); assert.match(text,/not a forecast or a safety verdict/);
  assert.doesNotMatch(text,/(?:will rise|will fall|safe to (?:buy|trade)|guaranteed profit|confidence\s*:?\s*\d+%)/i);
  await age(61); await assert.rejects(reports.analyze.staticCall(id,1));
});

test('new observation dependencies stay code-pinned and failed model inference rolls back capture atomically', async () => {
  const f = await fixture(), model = await deploy('IntelMutableClassifier');
  const reports = await deploy('S0ULIntelReports',[await f.obs.getAddress(),await model.getAddress()]);
  const { id } = await watch(f.obs,Kind.Supply,f.token); await age();
  await mined(model.setLabel(6));
  await assert.rejects(mined(reports.captureAndAnalyze(id,1,{gasLimit:2_000_000})));
  assert.equal((await f.obs.latest(id)).sequence,1n); assert.equal(await reports.reportCount(),0n);
  await mined(model.setLabel(5)); await mined(reports.analyze(id,1));
  const code = await provider.getCode(await f.obs.getAddress());
  await rpc.request({method:'evm_setAccountCode',params:[await f.obs.getAddress(),'0x00']});
  await assert.rejects(reports.analyze.staticCall(id,1));
  await rpc.request({method:'evm_setAccountCode',params:[await f.obs.getAddress(),code]});
  await mined(model.setIdentity(ZeroHash,ZeroHash)); await assert.rejects(reports.analyze.staticCall(id,1));
  assert.equal(await reports.reportCount(),1n);
});

test('unchanged proxy runtime pins do not claim to pin implementation behavior', async () => {
  const f = await fixture(), first = await deploy('IntelV2ImplementationOne'), second = await deploy('IntelV2ImplementationTwo');
  const proxy = await deploy('IntelV2MutableProxy',[await first.getAddress()]);
  const codeHash = await hashCode(proxy), { id } = await watch(f.obs,Kind.Supply,proxy);
  const baselineHash = await f.obs.snapshotHash(id,1);
  assert.equal(snapshotValues(await f.obs.latest(id))[0],1_000_000n);
  await mined(proxy.setImplementation(await second.getAddress())); assert.equal(await hashCode(proxy),codeHash);
  const inspection = await f.obs.inspect(await proxy.getAddress(),ZeroAddress);
  assert.equal(inspection.codeHash,codeHash); assert.equal(inspection.supplyStatus,0n); assert.equal(inspection.supplyValues[0],2_000_000n);
  await age(); await sample(f.obs,id);
  assert.equal(snapshotValues(await f.obs.latest(id))[0],2_000_000n); assert.equal((await f.obs.features(id,1)).vector[0],10000n);
  assert.equal(await f.obs.snapshotHash(id,1),baselineHash);
  const before = await f.obs.latest(id); await watch(f.obs,Kind.Supply,proxy,ZeroAddress,bob);
  assert.equal((await f.obs.latest(id)).sequence,before.sequence, 'a shared join must not resample an upgraded proxy');
});
