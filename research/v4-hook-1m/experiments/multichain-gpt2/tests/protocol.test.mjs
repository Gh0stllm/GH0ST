// Adversarial protocol tests: MockGPT2Shard deliberately fabricates arithmetic.
// This suite makes no model-accuracy or public-delivery claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compile, assertSourcesUnchanged, confinedOutput, json, sha256 } from '../scripts/build.mjs';
import { startLocalChains, ethers, EIDS, deliver, encodePacket, decodePacket, addressRuntime, packedInt32, CAP } from './harness.mjs';

const outputDirectory = confinedOutput('reports/protocol-tests');
fs.mkdirSync(outputDirectory, { recursive: true });
const ledger = path.join(outputDirectory, 'transactions.jsonl');
fs.writeFileSync(ledger, '');
const report = { status: 'RUNNING', scope: 'LOCAL_PROTOCOL_ONLY_WITH_EXPLICITLY_MOCKED_MODEL_MATH', public_transactions_submitted: 0,
  transport: 'MockEndpoint: no DVNs, message proof verification, finality, real executor, or live fees',
  tests: [], started_at: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(outputDirectory, 'results.json'), json(report));
const pass = (name, extra = {}) => { report.tests.push({ name, passed: true, ...extra }); save(); };
const bytes32 = value => ethers.id(value);
const modelId = '0xd5fe104a83865bb22299096cafcfe77eb1642fff8ddf0047306b4801599b4107';
const routeId = bytes32('LOCAL_PROTOCOL_TEST_ROUTE'), sessionId = bytes32('LOCAL_PROTOCOL_TEST_SESSION');
const hidden = ethers.hexlify(packedInt32(Array.from({ length: 768 }, (_, i) => i % 2 ? -i : i)));
let chains = [];

try {
  const build = compile({ includeTests: true, outputDirectory });
  report.compiler = build.compiler;
  chains = await startLocalChains({ onTransaction: entry => fs.appendFileSync(ledger, JSON.stringify(entry, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n') });
  report.environment = chains.map(chain => chain.environment);
  const endpoints = [], routers = [], engines = [];
  const roles = [[0, 0, true, false], [0, 4, false, false], [4, 8, false, false], [8, 12, false, true]];
  const now = Number((await chains[0].rpc('eth_getBlockByNumber', ['latest', false])).timestamp);
  const deadline = now + 86400;
  for (let stage = 0; stage < chains.length; stage++) {
    const chain = chains[stage];
    endpoints.push(await chain.deploy(build.artifacts.MockEndpoint, [EIDS[stage]], 'MockEndpoint'));
    routers.push(await chain.deploy(build.artifacts.GPT2InferenceOApp, [endpoints[stage].address, chain.accounts[0], chain.accounts[0], modelId,
      routeId, sessionId, stage, EIDS, deadline], 'GPT2InferenceOApp'));
    engines.push(await chain.deploy(build.artifacts.MockGPT2Shard, [routers[stage].address, modelId, ...roles[stage]], 'TEST_ONLY_MOCK_MATH'));
  }
  const rejected = async (name, chain, target, method, args = [], options = {}) => {
    await assert.rejects(() => chain.view(target, method, args, options), undefined, name);
    pass(name);
  };
  await rejected('unsealed route cannot begin', chains[0], routers[0], 'beginToken', [50256]);
  await rejected('seal requires bound engine and both peers', chains[0], routers[0], 'sealRoute');
  await rejected('non-admin cannot bind engine', chains[0], routers[0], 'bindEngine', [engines[0].address], { from: chains[0].accounts[1] });
  for (let stage = 0; stage < chains.length; stage++) {
    const chain = chains[stage], router = routers[stage];
    assert.equal((await chain.tx(router, 'bindEngine', [engines[stage].address])).status, '0x1');
    for (const other of [(stage + chains.length - 1) % chains.length, (stage + 1) % chains.length]) {
      assert.equal((await chain.tx(router, 'setPeer', [EIDS[other], ethers.zeroPadValue(routers[other].address, 32)])).status, '0x1');
    }
    assert.equal((await chain.tx(router, 'sealRoute')).status, '0x1');
  }
  await rejected('sealed peer configuration is immutable', chains[0], routers[0], 'setPeer', [EIDS[1], ethers.zeroPadValue(chains[0].accounts[1], 32)]);
  await rejected('sealed engine binding is immutable', chains[0], routers[0], 'bindEngine', [engines[0].address]);
  await rejected('owner cannot renounce route administration', chains[0], routers[0], 'renounceOwnership');
  await rejected('non-requester cannot begin token', chains[0], routers[0], 'beginToken', [50256], { from: chains[0].accounts[1] });
  await rejected('non-home stage cannot begin token', chains[1], routers[1], 'beginToken', [50256]);
  await rejected('vocabulary overflow rejected', chains[0], routers[0], 'beginToken', [50257]);
  await rejected('direct non-endpoint receive rejected', chains[1], routers[1], 'lzReceive', [[EIDS[0], ethers.zeroPadValue(routers[0].address, 32), 1], bytes32('direct'), '0x', chains[1].accounts[0], '0x']);
  await rejected('engine input controller is fixed', chains[0], engines[0], 'begin', [0, 50256, bytes32('bad'), '0x']);
  assert.equal((await chains[0].tx(routers[0], 'beginToken', [50256])).status, '0x1');
  await rejected('active home rejects another token', chains[0], routers[0], 'beginToken', [198]);
  await rejected('dispatch waits for completed stage', chains[0], routers[0], 'dispatch');
  await rejected('quote waits for completed stage', chains[0], routers[0], 'quoteDispatch');
  assert.equal((await chains[0].tx(engines[0], 'finishForTest', [hidden, 0, 0])).status, '0x1');
  const original = await chains[0].value(routers[0], 'outboundPacket');
  assert.equal(ethers.getBytes(original).length, 3488);
  const correct = decodePacket(original);
  const options = await chains[0].value(routers[0], 'fixedOptions');
  assert(options.startsWith('0x0003') && options.length > 10);
  pass('activation wire format is canonical ABI with exactly 3072 hidden bytes', { packet_bytes: 3488, hidden_bytes: 3072, options });

  // Underpaid transport must atomically roll back the router dispatch transition.
  await chains[0].tx(endpoints[0], 'setNativeFee', [123]);
  const underpaid = await chains[0].tx(routers[0], 'dispatch', [], { value: 122, purpose: 'expected underpaid failure' });
  assert.equal(underpaid.status, '0x0');
  assert.equal(await chains[0].value(routers[0], 'dispatched'), false);
  assert.equal(await chains[0].value(endpoints[0], 'packetCount'), 0n);
  pass('underpaid dispatch reverts atomically including outbound state');
  assert.equal((await chains[0].tx(routers[0], 'dispatch', [], { value: 123 })).status, '0x1');
  assert.equal(await chains[0].value(routers[0], 'active'), true);
  await rejected('duplicate dispatch rejected', chains[0], routers[0], 'dispatch', [], { value: 123 });
  const queued = await chains[0].value(endpoints[0], 'packet', [0]);
  assert.equal(queued.message, original, 'Mock transports exact OApp bytes');
  pass('home waits for final result after exact-byte dispatch');
  let uniqueGuid = 0;
  const injected = (packet = correct, overrides = {}) => [overrides.srcEid ?? EIDS[0], overrides.sender ?? ethers.zeroPadValue(routers[0].address, 32), 1,
    bytes32('adversarial-' + ++uniqueGuid), routers[1].address, overrides.raw ?? encodePacket(packet)];
  await rejected('wrong source EID rejected', chains[1], endpoints[1], 'deliver', injected(correct, { srcEid: EIDS[2] }));
  await rejected('wrong source peer rejected', chains[1], endpoints[1], 'deliver', injected(correct, { sender: ethers.zeroPadValue(chains[1].accounts[1], 32) }));
  for (const [label, field, value] of [
    ['version', 'version', 2], ['route', 'routeId', bytes32('other route')], ['model', 'modelId', bytes32('other model')],
    ['session', 'sessionId', bytes32('other session')], ['future position', 'position', 1], ['destination', 'destinationStage', 2],
    ['message kind', 'kind', 2], ['input vocabulary', 'inputToken', 50257], ['activation output token', 'outputToken', 1],
    ['empty trace', 'trace', ethers.ZeroHash], ['short activation', 'hidden', '0x1234'],
  ]) await rejected('wrong ' + label + ' rejected', chains[1], endpoints[1], 'deliver', injected({ ...correct, [field]: value }));
  await rejected('trailing ABI bytes rejected', chains[1], endpoints[1], 'deliver', injected(correct, { raw: original + '00'.repeat(32) }));
  await rejected('oversized ABI bytes rejected before decode', chains[1], endpoints[1], 'deliver', injected(correct, { raw: original + '00'.repeat(4096) }));
  const phaseBefore = await chains[1].value(engines[1], 'phase');
  const accepted = await deliver(chains, endpoints, routers, queued, { gas: 500_000n });
  assert.equal(accepted.status, '0x1');
  assert.equal(await chains[1].value(engines[1], 'phase'), phaseBefore);
  assert.equal(await chains[1].value(routers[1], 'awaitingActivation'), true);
  pass('500000-gas receive records payload without starting model arithmetic', { gas: accepted.gasUsed });
  await rejected('duplicate GUID rejected', chains[1], endpoints[1], 'deliver', [queued.srcEid, queued.sender, queued.nonce, queued.guid, routers[1].address, queued.message]);
  await rejected('same logical position with new GUID rejected while pending', chains[1], endpoints[1], 'deliver', injected());
  await rejected('altered activation bytes rejected', chains[1], routers[1], 'activate', [hidden.slice(0, -2) + 'ff']);
  assert.equal(await chains[1].value(engines[1], 'phase'), 0n);
  pass('rejected activation cannot mutate engine state');
  assert.equal((await chains[1].tx(routers[1], 'activate', [hidden], { from: chains[1].accounts[1] })).status, '0x1');
  await rejected('activation cannot execute twice', chains[1], routers[1], 'activate', [hidden]);
  assert.equal(await chains[1].value(engines[1], 'phase'), 2n);
  pass('any relayer may activate the committed payload');
  await chains[1].tx(engines[1], 'finishForTest', [hidden, 0, 0]);
  await chains[1].tx(routers[1], 'dispatch');
  const middle = await chains[1].value(endpoints[1], 'packet', [0]);
  assert.equal((await deliver(chains, endpoints, routers, middle, { gas: 500_000n })).status, '0x1');
  await chains[2].tx(routers[2], 'activate', [hidden]);
  await chains[2].tx(engines[2], 'finishForTest', [hidden, 0, 0]);
  await chains[2].tx(routers[2], 'dispatch');
  const toFinal = await chains[2].value(endpoints[2], 'packet', [0]);
  assert.equal((await deliver(chains, endpoints, routers, toFinal, { gas: 500_000n })).status, '0x1');
  await chains[3].tx(routers[3], 'activate', [hidden]);
  await chains[3].tx(engines[3], 'finishForTest', ['0x', 198, -160815]);
  const resultBytes = await chains[3].value(routers[3], 'outboundPacket');
  assert.equal(ethers.getBytes(resultBytes).length, 416);
  const resultPacket = decodePacket(resultBytes);
  const resultInjection = packet => [EIDS[3], ethers.zeroPadValue(routers[3].address, 32), 1, bytes32('result-' + ++uniqueGuid), routers[0].address, encodePacket(packet)];
  await rejected('final result must match pending input token', chains[0], endpoints[0], 'deliver', resultInjection({ ...resultPacket, inputToken: 1 }));
  await rejected('final result token must be in vocabulary', chains[0], endpoints[0], 'deliver', resultInjection({ ...resultPacket, outputToken: 50257 }));
  await rejected('final result must carry no activation bytes', chains[0], endpoints[0], 'deliver', resultInjection({ ...resultPacket, hidden: hidden }));
  await chains[3].tx(routers[3], 'dispatch');
  const final = await chains[3].value(endpoints[3], 'packet', [0]);
  assert.equal((await deliver(chains, endpoints, routers, final, { gas: 500_000n })).status, '0x1');
  assert.equal(await chains[0].value(routers[0], 'latestResult'), 198n);
  assert.equal(await chains[0].value(routers[0], 'nextPosition'), 1n);
  assert.equal(await chains[0].value(routers[0], 'active'), false);
  pass('final token returns to home and advances exactly one position', { token: 198, packet_bytes: 416 });
  await rejected('final logical replay with fresh GUID rejected', chains[0], endpoints[0], 'deliver', resultInjection(resultPacket));
  await rejected('completed remote position replay with new GUID rejected', chains[1], endpoints[1], 'deliver', injected());

  // A second mock token validates session ordering only. KV accuracy is covered exclusively by the real full benchmark.
  await chains[0].tx(routers[0], 'beginToken', [198]);
  for (let stage = 0; stage < chains.length; stage++) {
    if (stage > 0) await chains[stage].tx(routers[stage], 'activate', [hidden]);
    await chains[stage].tx(engines[stage], 'finishForTest', [stage === chains.length - 1 ? '0x' : hidden, stage === chains.length - 1 ? 464 : 0, -1]);
    await chains[stage].tx(routers[stage], 'dispatch', [], { value: stage === 0 ? 123 : 0 });
    const packet = await chains[stage].value(endpoints[stage], 'packet', [1]);
    assert.equal(decodePacket(packet.message).position, 1n);
    assert.equal((await deliver(chains, endpoints, routers, packet, { gas: 500_000n })).status, '0x1');
  }
  for (let stage = 0; stage < chains.length; stage++) assert.equal(await chains[stage].value(routers[stage], 'nextPosition'), 2n);
  assert.equal(await chains[0].value(routers[0], 'latestResult'), 464n);
  assert.equal(await chains[0].value(routers[0], 'finalizedCount'), 2n);
  pass('two ordered tokens complete without resetting the session (mock arithmetic only)');
  await chains[0].rpc('evm_setNextBlockTimestamp', [deadline + 1]); await chains[0].rpc('evm_mine');
  await rejected('expired session cannot begin', chains[0], routers[0], 'beginToken', [464]);
  await rejected('expired session cannot reconfigure', chains[0], routers[0], 'setPeer', [EIDS[1], ethers.zeroPadValue(routers[1].address, 32)]);
  await assert.rejects(() => chains[0].send({ to: chains[0].accounts[1] }, { gas: CAP + 1n }));
  pass('harness rejects above-cap gas before submission');

  // Real engine input guards and signed wire format, with an explicitly empty catalog and no arithmetic.
  const chain = chains[2];
  const root = await chain.deployRuntime(addressRuntime(Array(77).fill(ethers.ZeroAddress)), 'guard-only empty 77-slot catalog');
  const real = await chain.deploy(build.artifacts.GPT2Shard, [root.address, root.keccak256, modelId, 143, 6, 12, false, true, chain.accounts[0]], 'real shard guard-only fixture');
  const extreme = ethers.hexlify(packedInt32(Array.from({ length: 768 }, (_, i) => [-2147483648, 2147483647, -1, 0][i % 4])));
  await rejected('real shard controller blocks unauthorized begin', chain, real, 'begin', [0, 50256, bytes32('input'), extreme], { from: chain.accounts[1] });
  await rejected('real shard requires initial position zero', chain, real, 'begin', [1, 50256, bytes32('input'), extreme]);
  await rejected('real shard rejects short signed-vector import', chain, real, 'begin', [0, 50256, bytes32('input'), '0x']);
  await rejected('real shard rejects invalid input token', chain, real, 'begin', [0, 50257, bytes32('input'), extreme]);
  assert.equal((await chain.tx(real, 'begin', [0, 50256, bytes32('input'), extreme])).status, '0x1');
  const read = await chain.value(real, 'readVector', [0, 0, 768]);
  assert.equal(ethers.hexlify(packedInt32(read)), extreme);
  pass('real shard signed-int32 min/max import is exact (guard fixture, no model arithmetic)', { input_sha256: sha256(ethers.getBytes(extreme)) });
  await rejected('real shard rejects replacing active input', chain, real, 'begin', [1, 198, bytes32('input'), extreme]);
  await rejected('real shard rejects export before boundary', chain, real, 'exportHidden');
  await rejected('real shard rejects stale step', chain, real, 'advanceMany', [1, 128, 1]);
  await rejected('real shard rejects zero rows', chain, real, 'advanceMany', [0, 0, 1]);
  await rejected('real shard rejects 513 rows', chain, real, 'advanceMany', [0, 513, 1]);
  await rejected('real shard rejects zero steps', chain, real, 'advanceMany', [0, 128, 0]);
  await rejected('real shard rejects 65 steps', chain, real, 'advanceMany', [0, 128, 65]);
  assertSourcesUnchanged(build);
  report.status = 'PASS_LOCAL_PROTOCOL_AND_REAL_ENGINE_INPUT_GUARDS';
  report.tests_passed = report.tests.length;
  report.completed_at = new Date().toISOString(); save();
  console.log(json({ status: report.status, tests_passed: report.tests_passed, report: path.join(outputDirectory, 'results.json') }));
} catch (error) {
  report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; save();
  console.error(error); process.exitCode = 1;
} finally { await Promise.allSettled(chains.map(chain => chain.stop())); }
