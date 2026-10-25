// Full local protocol transport: official EndpointV2 + Send/ReceiveUln302.
// Only DVN attestations are administrator-controlled mocks. No fork or public RPC.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { HERE, BRIDGE_MODULES, compile, assertSourcesUnchanged, confinedOutput, json, sha256 } from '../scripts/build.mjs';
import { ethers, startOptimizedChain } from './optimized-runtime.mjs';

assert.equal(process.argv.length, 2, 'This local test accepts no network or broadcast options');
const output = confinedOutput('reports/canary-transport'); fs.mkdirSync(output, { recursive: true });
const ledger = path.join(output, 'transactions.jsonl'); fs.writeFileSync(ledger, '');
const resultFile = path.join(output, 'results.json');
const report = { status: 'RUNNING', started_at: new Date().toISOString(), public_transactions_submitted: 0,
  harness_sha256: sha256(fs.readFileSync(new URL(import.meta.url))),
  public_rpc_calls: 0, neural_model_instantiated: false, mock_endpoint_used: false,
  scope: 'Official EndpointV2 and SendUln302/ReceiveUln302 in fresh independent local EVMs; both DVNs use explicitly mocked administrator attestations.',
  limitations: ['No live DVN signatures, public finality, relayer availability or production delivery is established.',
    'No neural model, model weights, inference, token liquidity or swap is used by this transport canary.'],
  contracts: [], checks: [], directions: [], transaction_count: 0, successful_transactions: 0, expected_reverts: 0, gas: 0n };
const save = () => fs.writeFileSync(resultFile, json(report));
const checked = (name, details = {}) => { report.checks.push({ name, passed: true, ...details }); save(); };
const configs = [
  { stage: 0, chain_id: 4663, endpoint_id: 30416, profile: 'ethereum' },
  { stage: 1, chain_id: 204, endpoint_id: 30202, profile: 'ethereum' },
];
const coder = ethers.AbiCoder.defaultAbiCoder(), confirmations = 20;
let compiled, protocolBuild, chains = [];
function compileOfficialProtocol() {
  // The vendored protocol release targets OZ4 constructors. Compile it separately
  // from the application's OZ5 graph, without changing any Solidity source bytes.
  const solc = createRequire(path.join(HERE, 'package.json'))('solc');
  const sources = { 'CanaryOfficialImports.sol': { content: [
    '// SPDX-License-Identifier: MIT', 'pragma solidity 0.8.30;',
    'import {EndpointV2} from "@layerzerolabs/lz-evm-protocol-v2/contracts/EndpointV2.sol";',
    'import {SendUln302} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/uln302/SendUln302.sol";',
    'import {ReceiveUln302} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/uln302/ReceiveUln302.sol";',
  ].join('\n') } };
  const paths = {};
  const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
  const input = { language: 'Solidity', sources, settings };
  const result = JSON.parse(solc.compile(JSON.stringify(input), { import: name => {
    const candidates = name.startsWith('@openzeppelin/contracts/')
      ? [path.join(HERE, 'node_modules', '@openzeppelin/contracts-v4', name.slice('@openzeppelin/contracts/'.length)),
        path.join(BRIDGE_MODULES, '@openzeppelin/contracts-v4', name.slice('@openzeppelin/contracts/'.length))]
      : [path.join(HERE, 'node_modules', name), path.join(BRIDGE_MODULES, name)];
    const found = candidates.find(file => fs.existsSync(file));
    if (!found) return { error: 'Missing pinned protocol dependency: ' + name };
    const content = fs.readFileSync(found, 'utf8'); sources[name] = { content }; paths[name] = found;
    return { contents: content };
  } }));
  const errors = (result.errors ?? []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  const artifacts = {};
  for (const [file, contracts] of Object.entries(result.contracts)) for (const [name, artifact] of Object.entries(contracts)) {
    artifact.sourceFile = file; artifact.runtimeBytes = artifact.evm.deployedBytecode.object.length / 2;
    if (artifact.evm.bytecode.object) assert(artifact.runtimeBytes <= 24576, name + ' exceeds EIP170');
    artifacts[name] = artifact;
  }
  const compiler = { version: solc.version(), settings, openzeppelin_graph: '@openzeppelin/contracts-v4',
    source_sha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, sha256(source.content)])),
    input_sha256: sha256(json(input)) };
  fs.writeFileSync(path.join(output, 'protocol-compiler-input.json'), json(input));
  fs.writeFileSync(path.join(output, 'protocol-compiler.json'), json(compiler));
  return { artifacts, compiler, paths };
}
const sentEvent = (receipt, contract, name) => {
  const events = receipt.logs.filter(log => log.address.toLowerCase() === contract.address.toLowerCase())
    .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } }).filter(event => event?.name === name);
  assert.equal(events.length, 1, 'Expected one ' + name); return events[0].args;
};
function decodePacket(encoded) {
  const bytes = ethers.getBytes(encoded); assert.equal(bytes[0], 1); assert(bytes.length >= 113);
  return { encoded, header: ethers.hexlify(bytes.slice(0, 81)),
    nonce: BigInt(ethers.hexlify(bytes.slice(1, 9))), srcEid: Number(BigInt(ethers.hexlify(bytes.slice(9, 13)))),
    sender: ethers.hexlify(bytes.slice(13, 45)), dstEid: Number(BigInt(ethers.hexlify(bytes.slice(45, 49)))),
    receiver: ethers.getAddress(ethers.hexlify(bytes.slice(61, 81))), guid: ethers.hexlify(bytes.slice(81, 113)),
    message: ethers.hexlify(bytes.slice(113)), payloadHash: ethers.keccak256(bytes.slice(81)) };
}
const alter = (value, index) => { const bytes = ethers.getBytes(value); bytes[index] ^= 1; return ethers.hexlify(bytes); };
async function success(chain, target, method, args = [], options = {}) {
  const receipt = await chain.tx(target, method, args, { category: 'protocol', ...options });
  assert.equal(receipt.status, '0x1', method + ' failed'); return receipt;
}
async function rejection(name, chain, target, method, args = [], options = {}) {
  const receipt = await chain.tx(target, method, args, { category: 'expected_rejection', ...options });
  assert.equal(receipt.status, '0x0', 'Expected revert: ' + name); report.expected_reverts++;
  checked(name, { transaction: receipt.transactionHash, gas: receipt.gasUsed }); return receipt;
}
async function deploy(chain, name, args) {
  const artifact = ['EndpointV2', 'SendUln302', 'ReceiveUln302'].includes(name) ? protocolBuild.artifacts[name] : compiled.artifacts[name];
  assert(artifact, 'Missing artifact: ' + name);
  const c = await chain.deploy(artifact, args, name);
  report.contracts.push({ stage: chain.stage, name, address: c.address, runtime_bytes: c.runtimeBytes,
    runtime_keccak256: c.runtimeKeccak256, deployment_transaction: c.receipt.transactionHash }); save(); return c;
}

try {
  compiled = compile({ includeTests: true, outputDirectory: output }); report.compiler = compiled.compiler;
  protocolBuild = compileOfficialProtocol(); report.protocol_compiler = protocolBuild.compiler;
  assert(compiled.artifacts.RHOpBNBCanary, 'Parent canary contract must be present before running this test');
  for (const config of configs) chains.push(await startOptimizedChain({ config, onTransaction: entry => {
    fs.appendFileSync(ledger, JSON.stringify(entry, (_, value) => typeof value === 'bigint' ? String(value) : value) + '\n');
    report.transaction_count++; report.gas += entry.gas;
    if (entry.status === '0x1') report.successful_transactions++;
  } }));
  assert.equal(new Set(chains.map(chain => chain.environment.local_process_pid)).size, 2);
  report.environment = chains.map(chain => chain.environment);
  assert(chains.every(chain => chain.environment.forked === false));
  const nodes = [];
  const session = ethers.id('GH0ST_CANARY_INDEPENDENT_REAL_LOCAL_TRANSPORT');
  const now = Math.max(...await Promise.all(chains.map(async chain => Number(BigInt((await chain.rpc('eth_getBlockByNumber', ['latest', false])).timestamp)))));
  for (const chain of chains) {
    const stage = chain.stage, remote = configs[1-stage];
    const endpoint = await deploy(chain, 'EndpointV2', [configs[stage].endpoint_id, chain.accounts[0]]);
    const send = await deploy(chain, 'SendUln302', [endpoint.address, 1000000, 0]);
    const receive = await deploy(chain, 'ReceiveUln302', [endpoint.address]);
    const dvns = [];
    for (let i = 0; i < 2; i++) dvns.push(await deploy(chain, 'CanaryMockDVN', [send.address, receive.address]));
    dvns.sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
    const app = await deploy(chain, 'RHOpBNBCanary', [endpoint.address, chain.accounts[0], chain.accounts[0], stage === 0,
      configs[0].endpoint_id, configs[1].endpoint_id, session, now + 86400]);
    const executor = await deploy(chain, 'GH0STSelfRelayExecutor', [send.address, app.address, remote.endpoint_id, configs[stage].chain_id]);
    const uln = { confirmations, requiredDVNCount: 2, optionalDVNCount: 0, optionalDVNThreshold: 0,
      requiredDVNs: dvns.map(dvn => dvn.address), optionalDVNs: [] };
    await success(chain, send, 'setDefaultUlnConfigs', [[{ eid: remote.endpoint_id, config: uln }]]);
    await success(chain, receive, 'setDefaultUlnConfigs', [[{ eid: remote.endpoint_id, config: uln }]]);
    await success(chain, send, 'setDefaultExecutorConfigs', [[{ eid: remote.endpoint_id, config: { maxMessageSize: 4480, executor: executor.address } }]]);
    await success(chain, endpoint, 'registerLibrary', [send.address]);
    await success(chain, endpoint, 'registerLibrary', [receive.address]);
    await success(chain, endpoint, 'setDefaultSendLibrary', [remote.endpoint_id, send.address]);
    await success(chain, endpoint, 'setDefaultReceiveLibrary', [remote.endpoint_id, receive.address, 0]);
    nodes.push({ endpoint, send, receive, app, executor, dvns, uln });
  }
  for (const chain of chains) {
    const stage = chain.stage, n = nodes[stage], remote = configs[1-stage];
    await success(chain, n.app, 'setPeer', [remote.endpoint_id, ethers.zeroPadValue(nodes[1-stage].app.address, 32)]);
    await success(chain, n.app, 'sealRoute');
    await success(chain, n.endpoint, 'setSendLibrary', [n.app.address, remote.endpoint_id, n.send.address]);
    await success(chain, n.endpoint, 'setReceiveLibrary', [n.app.address, remote.endpoint_id, n.receive.address, 0]);
    const custom = coder.encode(['tuple(uint64,uint8,uint8,uint8,address[],address[])'],
      [[confirmations, 2, 255, 0, n.dvns.map(dvn => dvn.address), []]]);
    await success(chain, n.endpoint, 'setConfig', [n.app.address, n.send.address, [{ eid: remote.endpoint_id, configType: 2, config: custom }]]);
    await success(chain, n.endpoint, 'setConfig', [n.app.address, n.receive.address, [{ eid: remote.endpoint_id, configType: 2, config: custom }]]);
    checked('official_libraries_and_two_required_dvns_configured_stage_' + stage);
  }
  const challenge = ethers.id('CANARY_TRANSPORT_PUBLIC_TEST_CHALLENGE');
  await rejection('ack_cannot_precede_authenticated_ping', chains[1], nodes[1].app, 'ack');
  await rejection('requester_restriction_on_ping', chains[0], nodes[0].app, 'ping', [challenge], { from: chains[0].accounts[1] });
  const pingFee = await chains[0].value(nodes[0].app, 'quotePing', [challenge]);
  const pingReceipt = await success(chains[0], nodes[0].app, 'ping', [challenge], { value: pingFee.nativeFee });
  const ping = decodePacket(sentEvent(pingReceipt, nodes[0].endpoint, 'PacketSent').encodedPayload);
  assert.equal(ethers.getBytes(ping.message).length, 416);
  assert.equal(await chains[0].value(nodes[0].app, 'pingSent'), true);
  await rejection('one_ping_only', chains[0], nodes[0].app, 'ping', [challenge]);
  await transfer(ping, 0, 'pingReceived');
  assert.equal(await chains[1].value(nodes[1].app, 'challenge'), challenge);
  assert.equal(await chains[1].value(nodes[1].app, 'requestHash'), await chains[0].value(nodes[0].app, 'requestHash'));
  const ackFee = await chains[1].value(nodes[1].app, 'quoteAck');
  const ackReceipt = await success(chains[1], nodes[1].app, 'ack', [], { value: ackFee.nativeFee, from: chains[1].accounts[1] });
  const ack = decodePacket(sentEvent(ackReceipt, nodes[1].endpoint, 'PacketSent').encodedPayload);
  await transfer(ack, 1, 'ackReceived');
  assert.equal(await chains[0].value(nodes[0].app, 'ackReceived'), true);
  assert.equal(await chains[1].value(nodes[1].app, 'ackSent'), true);
  await rejection('one_ack_only', chains[1], nodes[1].app, 'ack');
  checked('complete_canary_ping_ack_roundtrip_through_real_official_protocol');
  assertSourcesUnchanged(compiled);
  for (const [name, file] of Object.entries(protocolBuild.paths)) assert.equal(sha256(fs.readFileSync(file)), protocolBuild.compiler.source_sha256[name]);
  report.status = 'PASS_OFFICIAL_LOCAL_CANARY_TRANSPORT_WITH_MOCK_DVN_ATTESTATIONS';

  async function transfer(packet, sourceStage, flag) {
    const source = nodes[sourceStage], stage = 1-sourceStage, n = nodes[stage], chain = chains[stage];
    const origin = { srcEid: packet.srcEid, sender: packet.sender, nonce: packet.nonce };
    const delivery = [origin, packet.receiver, packet.guid, packet.message, '0x'];
    assert.equal(packet.receiver.toLowerCase(), n.app.address.toLowerCase());
    assert.equal(packet.dstEid, configs[stage].endpoint_id);
    assert.equal(packet.srcEid, configs[sourceStage].endpoint_id);
    assert.equal(packet.nonce, 1n);
    assert.equal(await chain.value(n.app, flag), false);
    await rejection(`stage${stage}_delivery_before_any_attestation_blocked`, chain, n.endpoint, 'lzReceive', delivery);
    await rejection(`stage${stage}_commit_without_attestations_blocked`, chain, n.receive, 'commitVerification', [packet.header, packet.payloadHash]);
    await success(chain, n.receive, 'verify', [packet.header, packet.payloadHash, confirmations], { from: chain.accounts[1] });
    await rejection(`stage${stage}_unconfigured_attestor_does_not_satisfy_quorum`, chain, n.receive, 'commitVerification', [packet.header, packet.payloadHash]);
    await rejection(`stage${stage}_only_test_admin_can_control_mock_dvn`, chain, n.dvns[0], 'attest', [packet.header, packet.payloadHash, confirmations], { from: chain.accounts[1] });
    await success(chain, n.dvns[0], 'attest', [packet.header, packet.payloadHash, confirmations]);
    await rejection(`stage${stage}_one_dvn_cannot_commit`, chain, n.receive, 'commitVerification', [packet.header, packet.payloadHash]);
    await rejection(`stage${stage}_one_dvn_cannot_deliver`, chain, n.endpoint, 'lzReceive', delivery);
    await success(chain, n.dvns[0], 'attest', [packet.header, packet.payloadHash, confirmations]);
    await rejection(`stage${stage}_duplicate_first_dvn_does_not_make_two`, chain, n.receive, 'commitVerification', [packet.header, packet.payloadHash]);
    await success(chain, n.dvns[1], 'attest', [packet.header, packet.payloadHash, confirmations-1]);
    await rejection(`stage${stage}_insufficient_confirmations_blocked`, chain, n.receive, 'commitVerification', [packet.header, packet.payloadHash]);
    await success(chain, n.dvns[1], 'attest', [packet.header, packet.payloadHash, confirmations]);
    await rejection(`stage${stage}_both_attested_but_uncommitted_cannot_deliver`, chain, n.endpoint, 'lzReceive', delivery);
    const commit = await success(chain, n.receive, 'commitVerification', [packet.header, packet.payloadHash]);
    sentEvent(commit, n.endpoint, 'PacketVerified');
    assert.equal(await chain.value(n.endpoint, 'inboundPayloadHash', [packet.receiver, packet.srcEid, packet.sender, packet.nonce]), packet.payloadHash);
    await rejection(`stage${stage}_changed_message_blocked`, chain, n.endpoint, 'lzReceive', [origin, packet.receiver, packet.guid, alter(packet.message, 10), '0x']);
    await rejection(`stage${stage}_changed_guid_blocked`, chain, n.endpoint, 'lzReceive', [origin, packet.receiver, alter(packet.guid, 0), packet.message, '0x']);
    await rejection(`stage${stage}_changed_sender_blocked`, chain, n.endpoint, 'lzReceive', [{ ...origin, sender: ethers.zeroPadValue(chain.accounts[2], 32) }, packet.receiver, packet.guid, packet.message, '0x']);
    assert.equal(await chain.value(n.app, flag), false);
    const receive = await success(chain, n.endpoint, 'lzReceive', delivery, { from: chain.accounts[1], gas: 500000n });
    sentEvent(receive, n.endpoint, 'PacketDelivered'); const appEvent = sentEvent(receive, n.app, 'ProbeReceived');
    assert.equal(appEvent.guid, packet.guid); assert.equal(await chain.value(n.app, flag), true);
    assert.equal(await chain.value(n.app, 'acceptedGuid', [packet.guid]), true);
    assert.equal(await chain.value(n.endpoint, 'inboundPayloadHash', [packet.receiver, packet.srcEid, packet.sender, packet.nonce]), ethers.ZeroHash);
    await rejection(`stage${stage}_delivered_packet_replay_blocked`, chain, n.endpoint, 'lzReceive', delivery);
    await success(chain, n.dvns[0], 'attest', [packet.header, packet.payloadHash, confirmations]);
    await success(chain, n.dvns[1], 'attest', [packet.header, packet.payloadHash, confirmations]);
    await rejection(`stage${stage}_recommit_delivered_nonce_blocked`, chain, n.receive, 'commitVerification', [packet.header, packet.payloadHash]);
    for (const dvn of source.dvns) assert.equal(await chains[sourceStage].value(dvn, 'assignedJobs'), 1n);
    report.directions.push({ source_stage: sourceStage, destination_stage: stage, guid: packet.guid, payload_hash: packet.payloadHash,
      packet_sha256: sha256(ethers.getBytes(packet.encoded)), message_bytes: ethers.getBytes(packet.message).length,
      commit_transaction: commit.transactionHash, delivery_transaction: receive.transactionHash, commit_gas: commit.gasUsed, delivery_gas: receive.gasUsed });
    checked('two_dvn_committed_delivery_stage_' + stage);
  }
} catch (error) {
  report.status = 'FAILED_OFFICIAL_LOCAL_CANARY_TRANSPORT'; report.error = { message: error.message, stack: error.stack, data: error.data };
  process.exitCode = 1;
} finally {
  await Promise.allSettled(chains.map(chain => chain.stop()));
  report.completed_at = new Date().toISOString();
  report.ledger_sha256 = sha256(fs.readFileSync(ledger)); save();
  console.log(json({ status: report.status, checks: report.checks.length, expected_reverts: report.expected_reverts,
    transactions: report.transaction_count, directions: report.directions, error: report.error, report: resultFile }));
}
