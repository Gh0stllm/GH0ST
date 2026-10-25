// Bounded LOCAL forks of public state. Public RPC is behind a read-method allowlist;
// no eth_call, transaction submission, signatures, or application packets leave this machine.
// Neural arithmetic and remote delivery are explicit fixtures, not validation claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { compile, confinedOutput, json, sha256 } from '../scripts/build.mjs';
import { ethers, ANVIL } from './optimized-runtime.mjs';
import { jobChains, MODEL_ID } from '../scripts/job-plan.mjs';

assert.equal(process.argv.length, 2, 'This bounded test accepts no RPC URL or broadcast options');
const output = confinedOutput('reports/self-relay-fork');
fs.mkdirSync(output, { recursive: true });
const ledgerFile = path.join(output, 'transactions.jsonl'); fs.writeFileSync(ledgerFile, '');
const report = { status: 'RUNNING', started_at: new Date().toISOString(), public_transactions_submitted: 0,
  public_eth_calls: 0, neural_arithmetic: 'EXPLICIT_MOCK_NO_MODEL_ACCURACY_CLAIM',
  destination_delivery: 'NOT_TESTED_DVN_COMMIT_NOT_FABRICATED',
  local_delivery_fixture: 'LOCAL_ONLY endpoint impersonation initializes the compute job; this bypass is not a verified message delivery',
  gas_scope: 'Actual public EndpointV2, SendUln302 and two DVN implementations execute in local fork state with our local SelfRelayExecutor',
  forks: [], source_sends: [], validations: [], transactions: 0 };
const save = () => fs.writeFileSync(path.join(output, 'results.json'), json(report));
const stopCallbacks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let publicId = 0;
const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getCode', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getStorageAt', 'eth_getProof',
  'net_version', 'web3_clientVersion', 'eth_gasPrice']);
const urls = { robinhood: 'https://rpc.mainnet.chain.robinhood.com', opbnb: 'https://opbnb-mainnet-rpc.bnbchain.org' };
const cap = 16777216n;

async function publicRead(url, request, stats) {
  const calls = Array.isArray(request) ? request : [request];
  assert(calls.length > 0 && calls.length <= 100);
  for (const call of calls) {
    assert(allowed.has(call.method), 'Blocked public RPC method: ' + call.method);
    stats[call.method] = (stats[call.method] ?? 0) + 1;
  }
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(10000), redirect: 'error' });
  assert(response.ok, 'Public state-fetch HTTP status ' + response.status);
  return response.json();
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function localFork(config) {
  const stateReads = {}, url = urls[config.key]; assert(url);
  const read = async (method, params) => {
    const response = await publicRead(url, { jsonrpc: '2.0', id: ++publicId, method, params }, stateReads);
    if (response.error) throw Error(method + ': ' + response.error.message);
    return response.result;
  };
  assert.equal(Number(BigInt(await read('eth_chainId', []))), config.chainId);
  const block = await read('eth_getBlockByNumber', ['latest', false]); assert(block?.hash);
  const forkInfo = { key: config.key, chain_id: config.chainId, endpoint_id: config.eid, public_rpc_url: url,
    public_state_reads: stateReads, pinned_block: { number: Number(BigInt(block.number)), hash: block.hash, timestamp: Number(BigInt(block.timestamp)) } };
  report.forks.push(forkInfo); save();
  const proxy = http.createServer(async (request, response) => {
    try {
      let body = ''; for await (const part of request) { body += part; assert(body.length < 2_000_000); }
      const decoded = JSON.parse(body), result = await publicRead(url, decoded, stateReads);
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: error.message } }));
    }
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  stopCallbacks.push(() => new Promise(resolve => proxy.close(resolve)));
  const port = await unusedPort();
  const args = ['--host', '127.0.0.1', '--port', String(port), '--chain-id', String(config.chainId), '--network', 'ethereum',
    '--hardfork', 'cancun', '--fork-url', `http://127.0.0.1:${proxy.address().port}`, '--fork-block-number', String(forkInfo.pinned_block.number),
    '--fork-state-by-number', '--no-fork-node-info', '--no-bal', '--retries', '0', '--timeout', '12000',
    '--gas-limit', '100000000', '--gas-price', '0', '--block-base-fee-per-gas', '0', '--balance', '1000000000',
    '--code-size-limit', '24576', '--silent'];
  const child = spawn(ANVIL, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostics = ''; child.stderr.on('data', part => { diagnostics = (diagnostics + String(part)).slice(-4000); });
  child.on('error', error => { diagnostics = error.message; });
  stopCallbacks.push(async () => {
    if (child.exitCode !== null) return; child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(1500)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  let id = 0;
  const rpc = async (method, params = []) => {
    const response = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(35000) });
    const result = await response.json();
    if (result.error) { const error = Error(method + ': ' + result.error.message); error.data = result.error.data; throw error; }
    return result.result;
  };
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error('Local fork exited: ' + diagnostics);
    try { ready = Number(BigInt(await rpc('eth_chainId'))) === config.chainId; if (ready) break; } catch {}
    await delay(100);
  }
  assert(ready, 'Local fork startup failed: ' + diagnostics);
  const account = (await rpc('eth_accounts'))[0];
  forkInfo.local_node_info = await rpc('anvil_nodeInfo');
  forkInfo.code = {};
  for (const address of [config.endpointV2, config.sendLibrary, ...config.requiredDVNs]) {
    const code = await rpc('eth_getCode', [address, 'latest']); assert(code.length > 2, 'Expected public contract code is absent');
    forkInfo.code[address] = { bytes: (code.length - 2) / 2, keccak256: ethers.keccak256(code) };
  }
  const contract = (address, abi) => ({ address, interface: new ethers.Interface(abi) });
  const view = async (target, method, params = []) => target.interface.decodeFunctionResult(method,
    await rpc('eth_call', [{ from: account, to: target.address, data: target.interface.encodeFunctionData(method, params), gas: ethers.toBeHex(cap) }, 'latest']));
  const send = async (request, purpose, { from = account, value = 0n } = {}) => {
    await rpc('anvil_setNextBlockBaseFeePerGas', ['0x0']);
    const hash = await rpc('eth_sendTransaction', [{ from, ...request, gas: ethers.toBeHex(cap), value: ethers.toBeHex(value), gasPrice: '0x3b9aca00' }]);
    let receipt, lastError;
    for (let attempt = 0; attempt < 40; attempt++) {
      await delay(100);
      try { receipt = await rpc('eth_getTransactionReceipt', [hash]); if (receipt) break; } catch (error) { lastError = error; }
    }
    assert(receipt, 'Missing local receipt: ' + (lastError?.message ?? hash));
    const entry = { chain_id: config.chainId, stage: config.stage, purpose, hash, from, to: request.to ?? null,
      calldata: request.data, gas: BigInt(receipt.gasUsed), value, receipt };
    fs.appendFileSync(ledgerFile, json(entry).trim().replace(/\n\s*/g, '') + '\n');
    report.transactions++;
    assert.equal(receipt.status, '0x1', 'Local transaction failed: ' + purpose);
    assert(BigInt(receipt.gasUsed) <= cap); save(); return entry;
  };
  const tx = (target, method, params = [], options) => send({ to: target.address, data: target.interface.encodeFunctionData(method, params) }, method, options);
  const deploy = async (artifact, args) => {
    const request = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object).getDeployTransaction(...args);
    const deployed = await send({ data: request.data }, 'deploy ' + artifact.sourceFile);
    return contract(deployed.receipt.contractAddress, artifact.abi);
  };
  return { config, rpc, account, contract, view, tx, deploy, forkInfo };
}

const endpointAbi = [
  'function setSendLibrary(address,uint32,address)',
  'function getSendLibrary(address,uint32) view returns(address)',
  'function setConfig(address,address,tuple(uint32 eid,uint32 configType,bytes config)[])',
  'function getConfig(address,address,uint32,uint32) view returns(bytes)',
  'event PacketSent(bytes encodedPayload,bytes options,address sendLibrary)',
];
const sendAbi = ['function isSupportedEid(uint32) view returns(bool)',
  'event DVNFeePaid(address[] requiredDVNs,address[] optionalDVNs,uint256[] fees)',
  'event ExecutorFeePaid(address executor,uint256 fee)'];
const coder = ethers.AbiCoder.defaultAbiCoder();
function eventFrom(entry, target, name) {
  const events = entry.receipt.logs.filter(log => log.address.toLowerCase() === target.address.toLowerCase())
    .map(log => { try { return target.interface.parseLog(log); } catch { return null; } }).filter(event => event?.name === name);
  assert.equal(events.length, 1, 'Expected one ' + name); return events[0].args;
}
async function main() {
  const compiled = compile({ outputDirectory: output }); report.compiler = compiled.compiler; save();
  const configurations = jobChains('opbnb');
  const chains = await Promise.all(configurations.map(localFork));
  const routeId = ethers.id('LOCAL_SELF_RELAY_FORK_FIXTURE'), sessionId = ethers.id('LOCAL_SELF_RELAY_FORK_SESSION');
  const routers = [], executors = [], endpoints = [], libs = [];
  const deadline = Math.max(...chains.map(chain => chain.forkInfo.pinned_block.timestamp)) + 86400;
  for (const chain of chains) {
    const c = chain.config, stage = c.stage;
    endpoints[stage] = chain.contract(c.endpointV2, endpointAbi); libs[stage] = chain.contract(c.sendLibrary, sendAbi);
    assert.equal((await chain.view(libs[stage], 'isSupportedEid', [configurations[1-stage].eid]))[0], true, 'Official send library has no supported destination config');
    routers[stage] = await chain.deploy(compiled.artifacts.GPT2JobOApp, [c.endpointV2, chain.account, chain.account,
      stage === 0, configurations[0].eid, configurations[1].eid, routeId, sessionId, deadline]);
    executors[stage] = await chain.deploy(compiled.artifacts.GH0STSelfRelayExecutor,
      [c.sendLibrary, routers[stage].address, configurations[1-stage].eid, c.chainId]);
  }
  const engine = await chains[1].deploy(compiled.artifacts.MockGPT2Shard, [routers[1].address, MODEL_ID, 0, 12, true, true]);
  await chains[1].tx(routers[1], 'bindEngine', [engine.address]);
  for (const chain of chains) {
    const c = chain.config, stage = c.stage, remote = configurations[1-stage];
    await chain.tx(routers[stage], 'setPeer', [remote.eid, ethers.zeroPadValue(routers[1-stage].address, 32)]);
    await chain.tx(routers[stage], 'sealRoute');
    await chain.tx(endpoints[stage], 'setSendLibrary', [routers[stage].address, remote.eid, c.sendLibrary]);
    const uln = coder.encode(['tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)'],
      [[20, 2, 255, 0, c.requiredDVNs, []]]);
    const executor = coder.encode(['tuple(uint32 maxMessageSize,address executor)'], [[4480, executors[stage].address]]);
    await chain.tx(endpoints[stage], 'setConfig', [routers[stage].address, c.sendLibrary,
      [{ eid: remote.eid, configType: 2, config: uln }, { eid: remote.eid, configType: 1, config: executor }]]);
    assert.equal((await chain.view(endpoints[stage], 'getSendLibrary', [routers[stage].address, remote.eid]))[0].toLowerCase(), c.sendLibrary);
  }
  const prompt = '0x0000c450'; // public EOS token 50256
  const requestQuote = (await chains[0].view(routers[0], 'quoteRequest', [prompt, 2]))[0];
  const request = await chains[0].tx(routers[0], 'requestJob', [prompt, 2], { value: requestQuote.nativeFee });
  const requestPacket = recordSend(request, 0, 'request', requestQuote);
  // Fixture only: initialize remote state through an impersonated LOCAL endpoint.
  await chains[1].rpc('anvil_impersonateAccount', [configurations[1].endpointV2]);
  await chains[1].rpc('anvil_setBalance', [configurations[1].endpointV2, ethers.toBeHex(10n ** 20n)]);
  await chains[1].tx(routers[1], 'lzReceive', [{ srcEid: configurations[0].eid, sender: ethers.zeroPadValue(routers[0].address, 32), nonce: requestPacket.nonce },
    requestPacket.guid, requestPacket.message, chains[1].account, '0x'], { from: configurations[1].endpointV2 });
  await chains[1].rpc('anvil_stopImpersonatingAccount', [configurations[1].endpointV2]);
  await chains[1].tx(routers[1], 'activateJob', [prompt]);
  for (const token of [198, 464]) {
    await chains[1].tx(engine, 'finishForTest', ['0x', token, 1]);
    await chains[1].tx(routers[1], 'continueJob');
  }
  const resultQuote = (await chains[1].view(routers[1], 'quoteResult'))[0];
  const result = await chains[1].tx(routers[1], 'dispatchResult', [], { value: resultQuote.nativeFee });
  recordSend(result, 1, 'result', resultQuote);
  assert.equal((await chains[1].view(routers[1], 'resultDispatched'))[0], true);
  assert.equal((await chains[0].view(routers[0], 'resultFinalized'))[0], false);
  report.validations.push('Both source sends executed official EndpointV2, SendUln302, two configured DVNs and our zero-service-fee executor in pinned local forks');
  report.validations.push('Actual DVNFeePaid, ExecutorFeePaid and RelayJobAssigned events matched configured contracts; no destination commit or delivery was fabricated as evidence');
  report.status = 'PASS_LOCAL_FORK_SELF_RELAY_SOURCE_SENDS';

  function recordSend(entry, stage, kind, quote) {
    const c = configurations[stage];
    const sent = eventFrom(entry, endpoints[stage], 'PacketSent');
    const dvn = eventFrom(entry, libs[stage], 'DVNFeePaid');
    const executor = eventFrom(entry, libs[stage], 'ExecutorFeePaid');
    const assigned = eventFrom(entry, executors[stage], 'RelayJobAssigned');
    assert.deepEqual(Array.from(dvn.requiredDVNs, address => address.toLowerCase()), c.requiredDVNs);
    assert.equal(dvn.optionalDVNs.length, 0); assert.equal(dvn.fees.length, 2);
    assert.equal(executor.executor.toLowerCase(), executors[stage].address.toLowerCase()); assert.equal(executor.fee, 0n);
    assert.equal(assigned.oapp.toLowerCase(), routers[stage].address.toLowerCase()); assert.equal(assigned.payloadBytes, 416n);
    const packet = ethers.getBytes(sent.encodedPayload);
    assert.equal(packet[0], 1); assert(packet.length >= 113);
    const nonce = BigInt(ethers.hexlify(packet.slice(1, 9))), guid = ethers.hexlify(packet.slice(81, 113)), message = ethers.hexlify(packet.slice(113));
    assert.equal(ethers.getBytes(message).length, 416);
    report.source_sends.push({ stage, chain_id: c.chainId, kind, transaction: entry.hash, gas: entry.gas,
      native_fee: quote.nativeFee, lz_token_fee: quote.lzTokenFee, required_dvns: Array.from(dvn.requiredDVNs),
      dvn_fees: Array.from(dvn.fees), executor_service_fee: executor.fee,
      encoded_packet_bytes: packet.length, message_bytes: 416, guid, message_sha256: sha256(ethers.getBytes(message)) });
    save(); return { nonce, guid, message };
  }
}
save();
let timer;
try {
  await Promise.race([main(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Bounded local fork test exceeded eight minutes')), 480000); })]);
} catch (error) {
  report.status = 'FAILED_BOUNDED_LOCAL_FORK_SOURCE_SENDS'; report.error = { message: error.message, data: error.data, stack: error.stack };
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  for (const stop of stopCallbacks.reverse()) { try { await stop(); } catch {} }
  report.completed_at = new Date().toISOString(); save();
  console.log(json({ status: report.status, source_sends: report.source_sends, error: report.error, report: path.join(output, 'results.json') }));
}
