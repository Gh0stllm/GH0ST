// Adversarial job-protocol tests with explicitly mocked model arithmetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compile, assertSourcesUnchanged, HERE, json, sha256 } from '../scripts/build.mjs';
import { ethers, startOptimizedChain } from './optimized-runtime.mjs';

const dir = path.join(HERE, 'reports/job-protocol'); fs.mkdirSync(dir, { recursive: true });
const report = { status: 'RUNNING', scope: 'ADVERSARIAL_JOB_PROTOCOL_WITH_EXPLICITLY_MOCKED_MATH', public_transactions: 0, checks: [] };
const pass = (name, fields = {}) => report.checks.push({ name, ...fields });
const pack = values => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32BE(v, i * 4)); return ethers.hexlify(b); };
const tuple = 'tuple(uint8 version,uint8 kind,bytes32 routeId,bytes32 modelId,bytes32 sessionId,bytes32 jobId,bytes32 promptHash,uint32 maxNewTokens,bytes32 trace,bytes tokens)';
const encode = packet => ethers.AbiCoder.defaultAbiCoder().encode([tuple], [packet]);
const decode = bytes => ethers.AbiCoder.defaultAbiCoder().decode([tuple], bytes)[0].toObject();
const model = '0xd5fe104a83865bb22299096cafcfe77eb1642fff8ddf0047306b4801599b4107';
const chains = [];
let nonce = 0;
try {
  const built = compile({ outputDirectory: dir }); report.compiler = built.compiler;
  const names = new Set();
  const visit = name => {
    if (names.has(name)) return; names.add(name);
    for (const m of built.sources[name].content.matchAll(/import[\s\S]*?["']([^"']+)["']\s*;/g)) {
      visit(m[1].startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name), m[1])) : m[1]);
    }
  };
  for (const n of ['GPT2JobOApp', 'MockEndpoint', 'MockGPT2Shard']) visit(built.artifacts[n].sourceFile);
  const selected = { ...built, resolvedPaths: Object.fromEntries([...names].map(n => [n, built.resolvedPaths[n]])) };
  for (const [stage, chain_id, endpoint_id, profile] of [[0, 4663, 30416, 'ethereum'], [1, 143, 30390, 'monad']]) {
    chains.push(await startOptimizedChain({ config: { stage, chain_id, endpoint_id, profile } }));
  }
  const endpoints = [];
  for (let i = 0; i < 2; ++i) endpoints.push(await chains[i].deploy(built.artifacts.MockEndpoint, [i ? 30390 : 30416], 'MockEndpoint'));
  const rejected = async (name, chain, target, method, args = [], options = {}) => {
    await assert.rejects(() => chain.view(target, method, args, options)); pass(name);
  };
  async function fixture() {
    const now = Number((await chains[0].rpc('eth_getBlockByNumber', ['latest', false])).timestamp);
    const session = ethers.id('job test ' + nonce++), route = ethers.id('RH MONAD JOB V2');
    const routers = [];
    for (let i = 0; i < 2; ++i) routers.push(await chains[i].deploy(built.artifacts.GPT2JobOApp,
      [endpoints[i].address, chains[i].accounts[0], chains[i].accounts[0], i === 0, 30416, 30390, route, session, now + 3600], 'GPT2JobOApp'));
    const engine = await chains[1].deploy(built.artifacts.MockGPT2Shard, [routers[1].address, model, 0, 12, true, true], 'TEST_ONLY_MOCK_MATH');
    await chains[1].tx(routers[1], 'bindEngine', [engine.address]);
    for (let i = 0; i < 2; ++i) {
      await chains[i].tx(routers[i], 'setPeer', [i ? 30416 : 30390, ethers.zeroPadValue(routers[1 - i].address, 32)]);
      await chains[i].tx(routers[i], 'sealRoute');
    }
    return { routers, engine, route, session };
  }
  const { routers, engine } = await fixture();
  await rejected('only requester can submit', chains[0], routers[0], 'requestJob', [pack([10]), 1], { from: chains[0].accounts[1] });
  await rejected('compute side cannot submit home request', chains[1], routers[1], 'requestJob', [pack([10]), 1]);
  await rejected('empty prompt rejected', chains[0], routers[0], 'quoteRequest', ['0x', 1]);
  await rejected('non-four-byte prompt rejected', chains[0], routers[0], 'quoteRequest', ['0x010203', 1]);
  await rejected('invalid token rejected', chains[0], routers[0], 'quoteRequest', [pack([50257]), 1]);
  await rejected('zero output count rejected', chains[0], routers[0], 'quoteRequest', [pack([10]), 0]);
  await rejected('context budget enforced', chains[0], routers[0], 'quoteRequest', [pack(Array(1024).fill(10)), 2]);
  await rejected('sealed peers cannot change', chains[0], routers[0], 'setPeer', [30390, ethers.zeroPadValue(chains[0].accounts[1], 32)]);
  await rejected('home cannot bind an engine', chains[0], routers[0], 'bindEngine', [engine.address]);
  await rejected('result unavailable before execution', chains[1], routers[1], 'resultPacket');
  const input = pack([10, 20]);
  await chains[0].tx(endpoints[0], 'setNativeFee', [123]);
  assert.equal((await chains[0].value(routers[0], 'quoteRequest', [input, 2])).nativeFee, 123n);
  const failed = await chains[0].tx(routers[0], 'requestJob', [input, 2], { value: 122 });
  assert.equal(failed.status, '0x0'); assert.equal(await chains[0].value(routers[0], 'requested'), false);
  pass('underpaid request rolls back job state');
  const requestIndex = await chains[0].value(endpoints[0], 'packetCount');
  assert.equal((await chains[0].tx(routers[0], 'requestJob', [input, 2], { value: 123 })).status, '0x1');
  const q = await chains[0].value(endpoints[0], 'packet', [requestIndex]), packet = decode(q.message);
  assert.equal(packet.tokens, input); assert.equal(packet.maxNewTokens, 2n); assert.equal(packet.version, 2n);
  pass('request packs four bytes per token', { packet_bytes: ethers.getBytes(q.message).length });
  const injection = (p = packet, changes = {}) => [changes.srcEid ?? 30416, changes.sender ?? q.sender, q.nonce,
    changes.guid ?? ethers.id('injected-' + nonce++), routers[1].address, changes.raw ?? encode(p)];
  await rejected('wrong origin eid rejected', chains[1], endpoints[1], 'deliver', injection(packet, { srcEid: 30102 }));
  await rejected('wrong peer rejected', chains[1], endpoints[1], 'deliver', injection(packet, { sender: ethers.zeroPadValue(chains[1].accounts[1], 32) }));
  for (const [field, value] of [['version', 1], ['kind', 2], ['routeId', ethers.id('wrong')], ['modelId', ethers.id('wrong')],
    ['sessionId', ethers.id('wrong')], ['jobId', ethers.id('wrong')], ['promptHash', ethers.id('wrong')], ['trace', ethers.ZeroHash], ['maxNewTokens', 0]]) {
    await rejected('invalid request ' + field, chains[1], endpoints[1], 'deliver', injection({ ...packet, [field]: value }));
  }
  await rejected('trailing request bytes rejected', chains[1], endpoints[1], 'deliver', injection(packet, { raw: q.message + '00'.repeat(32) }));
  const received = await chains[1].tx(endpoints[1], 'deliver', [30416, q.sender, q.nonce, q.guid, routers[1].address, q.message], { gas: 500000n });
  assert.equal(received.status, '0x1'); assert.equal(await chains[1].value(engine, 'phase'), 0n);
  pass('receive callback fits 500k and performs no model arithmetic', { gas: String(received.gasUsed) });
  await rejected('duplicate guid rejected', chains[1], endpoints[1], 'deliver', injection(packet, { guid: q.guid }));
  await rejected('same logical job with fresh guid rejected', chains[1], endpoints[1], 'deliver', injection());
  await rejected('altered activation rejected', chains[1], routers[1], 'activateJob', [pack([10, 21])]);
  await chains[1].tx(routers[1], 'activateJob', [input], { from: chains[1].accounts[1] });
  assert.equal(await chains[1].value(engine, 'pendingToken'), 10n);
  await rejected('duplicate activation rejected', chains[1], routers[1], 'activateJob', [input]);
  await rejected('cannot consume incomplete model position', chains[1], routers[1], 'continueJob');
  for (const [position, prediction, nextInput, visible] of [[0, 100, 20, false], [1, 198, 198, true], [2, 464, null, true]]) {
    assert.equal(await chains[1].value(engine, 'position'), BigInt(position));
    await chains[1].tx(engine, 'finishForTest', ['0x', prediction, -1]);
    await chains[1].tx(routers[1], 'continueJob', [], { from: chains[1].accounts[1] });
    if (nextInput !== null) assert.equal(await chains[1].value(engine, 'pendingToken'), BigInt(nextInput));
    pass('position ' + position + ' consumed with correct prompt/generation transition', { visible });
  }
  assert.deepEqual(Array.from(await chains[1].value(routers[1], 'generatedTokens')), [198n, 464n]);
  assert.equal(await chains[1].value(routers[1], 'processedPositions'), 3n);
  assert.equal(await chains[1].value(routers[1], 'completed'), true);
  await rejected('completed job cannot advance twice', chains[1], routers[1], 'continueJob');
  const resultIndex = await chains[1].value(endpoints[1], 'packetCount');
  const resultBytes = await chains[1].value(routers[1], 'resultPacket'), result = decode(resultBytes);
  assert.equal(result.tokens, pack([198, 464]));
  await chains[1].tx(routers[1], 'dispatchResult');
  const resultQ = await chains[1].value(endpoints[1], 'packet', [resultIndex]);
  const resultInjection = p => [30390, resultQ.sender, resultQ.nonce, ethers.id('bad-result-' + nonce++), routers[0].address, encode(p)];
  for (const [field, value] of [['jobId', ethers.id('wrong')], ['promptHash', ethers.id('wrong')], ['maxNewTokens', 3], ['tokens', pack([198])], ['tokens', pack([198, 50257])]]) {
    await rejected('invalid final result ' + field, chains[0], endpoints[0], 'deliver', resultInjection({ ...result, [field]: value }));
  }
  const finalReceipt = await chains[0].tx(endpoints[0], 'deliver', [30390, resultQ.sender, resultQ.nonce, resultQ.guid, routers[0].address, resultQ.message], { gas: 500000n });
  assert.equal(finalReceipt.status, '0x1'); assert.equal(await chains[0].value(routers[0], 'resultFinalized'), true);
  assert.equal(await chains[0].value(routers[0], 'resultCount'), 2n);
  assert.equal(await chains[0].value(routers[0], 'verifyResult', [pack([198, 464])]), true);
  assert.equal(await chains[0].value(routers[0], 'verifyResult', [pack([198, 465])]), false);
  pass('one final packet commits all output tokens at home', { packet_bytes: ethers.getBytes(resultQ.message).length, gas: String(finalReceipt.gasUsed) });
  await rejected('duplicate final result rejected', chains[0], endpoints[0], 'deliver', resultInjection(result));
  await rejected('second request rejected in single-use session', chains[0], routers[0], 'requestJob', [input, 2], { value: 123 });
  await rejected('second result dispatch rejected', chains[1], routers[1], 'dispatchResult');

  // Bound the callback at its largest valid prompt and result sizes. Math is deliberately mocked.
  await chains[0].tx(endpoints[0], 'setNativeFee', [0]);
  const huge = await fixture();
  let ix = await chains[0].value(endpoints[0], 'packetCount');
  await chains[0].tx(huge.routers[0], 'requestJob', [pack(Array(1024).fill(50256)), 1]);
  let queued = await chains[0].value(endpoints[0], 'packet', [ix]);
  let receipt = await chains[1].tx(endpoints[1], 'deliver', [30416, queued.sender, queued.nonce, queued.guid, huge.routers[1].address, queued.message], { gas: 500000n });
  assert.equal(receipt.status, '0x1'); pass('1024-token prompt callback fits fixed budget', { gas: String(receipt.gasUsed) });
  const hugeResult = await fixture();
  ix = await chains[0].value(endpoints[0], 'packetCount');
  await chains[0].tx(hugeResult.routers[0], 'requestJob', [pack([50256]), 1024]);
  queued = await chains[0].value(endpoints[0], 'packet', [ix]);
  const requested = decode(queued.message);
  const batch = { ...requested, kind: 2, trace: ethers.id('TEST_ONLY_FABRICATED_1024_TOKEN_RESULT'), tokens: pack(Array(1024).fill(50256)) };
  receipt = await chains[0].tx(endpoints[0], 'deliver', [30390, ethers.zeroPadValue(hugeResult.routers[1].address, 32), 1,
    ethers.id('TEST_ONLY_MAX_RESULT'), hugeResult.routers[0].address, encode(batch)], { gas: 500000n });
  assert.equal(receipt.status, '0x1'); pass('1024-token result callback fits fixed budget', { gas: String(receipt.gasUsed) });
  assertSourcesUnchanged(selected);
  report.selected_source_sha256 = Object.fromEntries([...names].sort().map(n => [n, built.compiler.source_sha256[n]]));
  report.status = 'PASS_ADVERSARIAL_JOB_PROTOCOL';
} catch (error) { report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; throw error; }
finally { await Promise.allSettled(chains.map(c => c.stop())); fs.writeFileSync(path.join(dir, 'results.json'), json(report)); }
console.log(json({ status: report.status, checks: report.checks.length }));
