// Local adversarial application tests. MockEndpoint is deliberately not DVN evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compile, HERE, json } from '../scripts/build.mjs';
import { ethers, startOptimizedChain } from './optimized-runtime.mjs';

const out = path.join(HERE, 'reports/canary-contract');
fs.mkdirSync(out, { recursive: true });
const report = { status: 'RUNNING', scope: 'LOCAL_CANARY_APPLICATION_GUARDS_WITH_MOCK_TRANSPORT', publicTransactions: 0, checks: [] };
const mark = name => report.checks.push(name);
const tuple = 'tuple(uint8 version,uint8 kind,bytes32 sessionId,bytes32 challenge,uint64 nonce,uint32 homeEid,uint32 computeEid,bytes32 requestHash,bytes32 reserved0,bytes32 reserved1,bytes32 reserved2,bytes32 reserved3,bytes32 reserved4)';
const coder = ethers.AbiCoder.defaultAbiCoder();
const encode = p => coder.encode([tuple], [p]);
const decode = b => coder.decode([tuple], b)[0].toObject();
const zero = ethers.ZeroHash;
const chains = [], endpoints = [];
let sequence = 0;
try {
  const built = compile({ outputDirectory: out });
  report.compiler = built.compiler;
  for (const [stage, chain_id, endpoint_id] of [[0, 4663, 30416], [1, 204, 30202]]) {
    const chain = await startOptimizedChain({ config: { stage, chain_id, endpoint_id, profile: 'ethereum' } });
    chains.push(chain);
    endpoints.push(await chain.deploy(built.artifacts.MockEndpoint, [endpoint_id], 'MockEndpoint'));
  }
  async function reject(name, chain, target, method, args = [], opts = {}) {
    await assert.rejects(() => chain.view(target, method, args, opts)); mark(name);
  }
  async function fixture() {
    const blocks = await Promise.all(chains.map(c => c.rpc('eth_getBlockByNumber', ['latest', false])));
    const deadline = Math.max(...blocks.map(b => Number(b.timestamp))) + 3600;
    const session = ethers.id('canary application test ' + sequence++);
    const pair = [];
    for (let i = 0; i < 2; i++) pair.push(await chains[i].deploy(built.artifacts.RHOpBNBCanary,
      [endpoints[i].address, chains[i].accounts[0], chains[i].accounts[0], !i, 30416, 30202, session, deadline], 'RHOpBNBCanary'));
    for (let i = 0; i < 2; i++) {
      await reject('unsealed send rejected ' + i, chains[i], pair[i], i ? 'quoteAck' : 'quotePing', i ? [] : [ethers.id('challenge')]);
      await chains[i].tx(pair[i], 'setPeer', [i ? 30416 : 30202, ethers.zeroPadValue(pair[1-i].address, 32)]);
      await chains[i].tx(pair[i], 'sealRoute');
    }
    return { pair, session, deadline };
  }
  const { pair } = await fixture(), challenge = ethers.id('local-only canary challenge');
  await reject('requester authorization', chains[0], pair[0], 'ping', [challenge], { from: chains[0].accounts[1] });
  await reject('remote cannot originate ping', chains[1], pair[1], 'ping', [challenge]);
  await reject('zero challenge rejected', chains[0], pair[0], 'quotePing', [zero]);
  await reject('ack unavailable before ping delivery', chains[1], pair[1], 'quoteAck');
  await reject('home cannot originate ack', chains[0], pair[0], 'ack');
  await reject('sealed peer frozen', chains[0], pair[0], 'setPeer', [30202, ethers.zeroPadValue(chains[0].accounts[1], 32)]);
  await reject('route cannot seal twice', chains[1], pair[1], 'sealRoute');
  await reject('ownership cannot be renounced', chains[0], pair[0], 'renounceOwnership');
  await chains[0].tx(endpoints[0], 'setNativeFee', [123]);
  assert.equal((await chains[0].value(pair[0], 'quotePing', [challenge])).nativeFee, 123n);
  assert.equal((await chains[0].tx(pair[0], 'ping', [challenge], { value: 122 })).status, '0x0');
  assert.equal(await chains[0].value(pair[0], 'pingSent'), false); mark('underpayment rolls back state');
  const requestIndex = await chains[0].value(endpoints[0], 'packetCount');
  assert.equal((await chains[0].tx(pair[0], 'ping', [challenge], { value: 124 })).status, '0x1');
  assert.equal(await chains[0].rpc('eth_getBalance', [pair[0].address, 'latest']), '0x0');
  const q = await chains[0].value(endpoints[0], 'packet', [requestIndex]);
  const packet = decode(q.message);
  assert.equal(ethers.getBytes(q.message).length, 416);
  assert.equal(packet.nonce, 1n); assert.equal(packet.kind, 1n);
  assert.equal(q.options, '0x0003010011010000000000000000000000000007a120');
  assert.equal(await chains[0].value(pair[0], 'pingGuid'), q.guid); mark('exact packet and options');
  const expectedHash = ethers.keccak256(coder.encode(['bytes32','bytes32','bytes32','uint64','uint32','uint32','bytes32','bytes32'],
    [ethers.id('GH0ST_RH_OPBNB_CANARY_V1'), packet.sessionId, challenge, 1, 30416, 30202,
      ethers.zeroPadValue(pair[0].address, 32), ethers.zeroPadValue(pair[1].address, 32)]));
  assert.equal(packet.requestHash, expectedHash); mark('challenge bound to domain/session/peers/both endpoints');
  const delivery = (p = packet, o = {}) => [o.eid ?? 30416, o.sender ?? q.sender, 1,
    o.guid ?? ethers.id('attempt ' + sequence++), pair[1].address, o.bytes ?? encode(p)];
  await reject('wrong source endpoint', chains[1], endpoints[1], 'deliver', delivery(packet, { eid: 30102 }));
  await reject('wrong source peer', chains[1], endpoints[1], 'deliver', delivery(packet, { sender: ethers.zeroPadValue(chains[1].accounts[1], 32) }));
  await reject('direct non-endpoint delivery', chains[1], pair[1], 'lzReceive', [[30416,q.sender,1],q.guid,q.message,chains[1].accounts[0],'0x']);
  for (const [key, value] of [['version', 2], ['kind', 2], ['sessionId', zero], ['challenge', zero], ['nonce', 2],
    ['homeEid', 30102], ['computeEid', 30390], ['requestHash', zero],
    ...[0,1,2,3,4].map(i => ['reserved'+i, ethers.id('nonzero')])]) {
    await reject('packet rejects altered ' + key, chains[1], endpoints[1], 'deliver', delivery({ ...packet, [key]: value }));
  }
  await reject('trailing data rejected', chains[1], endpoints[1], 'deliver', delivery(packet, { bytes: q.message+'00'.repeat(32) }));
  await reject('truncated data rejected', chains[1], endpoints[1], 'deliver', delivery(packet, { bytes: q.message.slice(0,-64) }));
  const received = await chains[1].tx(endpoints[1], 'deliver', delivery(packet, { guid: q.guid }), { gas: 500000n });
  assert.equal(received.status, '0x1'); assert.equal(await chains[1].value(pair[1], 'pingReceived'), true);
  assert.equal(await chains[1].value(pair[1], 'requestHash'), expectedHash);
  report.pingReceiveGas = String(received.gasUsed); mark('valid request accepted within callback budget');
  await reject('duplicate GUID', chains[1], endpoints[1], 'deliver', delivery(packet, { guid: q.guid }));
  await reject('same logical ping with new GUID', chains[1], endpoints[1], 'deliver', delivery());
  await reject('second source ping', chains[0], pair[0], 'ping', [ethers.id('second')], { value: 123 });
  const ackIndex = await chains[1].value(endpoints[1], 'packetCount');
  assert.equal((await chains[1].tx(pair[1], 'ack', [], { from: chains[1].accounts[1] })).status, '0x1');
  const a = await chains[1].value(endpoints[1], 'packet', [ackIndex]), ack = decode(a.message);
  assert.equal(ack.kind, 2n); assert.equal(ack.requestHash, expectedHash); mark('any funded sender can relay exact ack');
  const ackArgs = [30202,a.sender,1,a.guid,pair[0].address,a.message];
  const final = await chains[0].tx(endpoints[0], 'deliver', ackArgs, { gas: 500000n });
  assert.equal(final.status, '0x1'); assert.equal(await chains[0].value(pair[0], 'ackReceived'), true);
  assert.equal(await chains[0].value(pair[0], 'ackGuid'), a.guid);
  assert.equal(await chains[0].value(pair[0], 'challenge'), challenge);
  report.ackReceiveGas = String(final.gasUsed); mark('complete local mock round trip');
  await reject('duplicate ack rejected', chains[0], endpoints[0], 'deliver', ackArgs);
  await reject('second ack send rejected', chains[1], pair[1], 'ack');
  const expired = await fixture();
  for (const c of chains) { await c.rpc('evm_increaseTime', [3601]); await c.rpc('evm_mine'); }
  await reject('expired ping rejected', chains[0], expired.pair[0], 'ping', [challenge]);
  await reject('expired quote rejected', chains[0], expired.pair[0], 'quotePing', [challenge]);
  report.status = 'PASS_CANARY_APPLICATION_GUARDS';
  console.log(json({ status: report.status, checks: report.checks.length, pingReceiveGas: report.pingReceiveGas, ackReceiveGas: report.ackReceiveGas }));
} catch (error) {
  report.status = 'FAIL'; report.error = error.message; throw error;
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), json(report));
  await Promise.allSettled(chains.map(c => c.stop()));
}
