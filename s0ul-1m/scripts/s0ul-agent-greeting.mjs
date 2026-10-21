#!/usr/bin/env node
// Fixed Hello World tool only. This does not generate neural text. No .env loading or key persistence.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import solc from 'solc';
import { AbiCoder, Contract, ContractFactory, FetchRequest, JsonRpcProvider, Wallet, getAddress, getCreateAddress, keccak256, toUtf8Bytes, ZeroHash } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command, ...argv] = process.argv.slice(2), options = {};
const basePath = resolve(root, 'deployments/robinhood-mainnet.json');
const agentPath = resolve(root, 'deployments/robinhood-mainnet-agent.json');
const buildPath = resolve(root, 'exports/solidity-agent-greeting-build/contracts.json');
const greetingPath = resolve(root, 'deployments/robinhood-mainnet-agent-greeting.json');
const pinnedController = '0x9F92776e33087DCF0d77b9BE23145efAC6cE695D';
const pinnedControllerHash = '0x0d89f81a955230d7ebb01d2549770041f796429abba6d229a2089a3e310636ed';
const gh0stDefault = '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ?
  '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const hex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const address = (a, b) => typeof a === 'string' && typeof b === 'string' && getAddress(a) === getAddress(b);
const log = value => process.stdout.write(JSON.stringify(value, (_, x) => typeof x === 'bigint' ? x.toString() : x) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const positive = (name, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  const value = Number(options[name] ?? fallback);
  assert.ok(Number.isSafeInteger(value) && value > 0 && value <= maximum, 'Invalid --' + name); return value;
};
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp.' + process.pid;
  writeFileSync(temporary, JSON.stringify(value, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n', { mode: 0o600, flush: true });
  renameSync(temporary, path);
}
function lock(path) {
  mkdirSync(dirname(path), { recursive: true });
  const file = path + '.lock', fd = openSync(file, 'wx', 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
  return () => { try { closeSync(fd); } finally { unlinkSync(file); } };
}
const reads = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas',
  'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_gasPrice', 'eth_maxPriorityFeePerGas']);
const transient = error => error?.code === 'TIMEOUT' || /^(429|503)\b/.test(String(error?.info?.responseStatus ?? error?.response?.statusCode)) ||
  [-32000, -32002, -32005].includes(error?.code) && /^(?:(?:request|upstream|gateway|connection|network|response)\s+)*(?:timeout|timed\s+out)\b/i.test(String(error?.message ?? ''));
class AgentProvider extends JsonRpcProvider {
  constructor(url, chainId) {
    const request = new FetchRequest(url); request.timeout = 15000; request.retryFunc = async () => false;
    super(request, Number(chainId), { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
    const rps = Number(options['rpc-rps'] ?? 2);
    assert.ok(Number.isFinite(rps) && rps >= 0 && rps <= 1000, 'Invalid --rpc-rps');
    this.spacing = rps ? Math.ceil(1000 / rps) + 10 : 0; this.nextAt = 0; this.queue = Promise.resolve();
    this.pollingInterval = 1000;
  }
  _send(payload) {
    const methods = (Array.isArray(payload) ? payload : [payload]).map(x => x.method), readOnly = methods.every(x => reads.has(x));
    const run = this.queue.then(async () => {
      for (let attempt = 1; attempt <= (readOnly ? 3 : 1); ++attempt) {
        assert.equal(this.destroyed, false, 'RPC provider closed');
        await sleep(Math.max(0, this.nextAt - Date.now()));
        assert.equal(this.destroyed, false, 'RPC provider closed');
        let response, failure;
        try { response = await super._send(payload); } catch (error) { failure = error; }
        finally { this.nextAt = Date.now() + this.spacing; }
        const errors = failure ? [failure] : response.filter(x => x.error).map(x => x.error);
        if (!errors.length) return response;
        if (!readOnly || attempt === 3 || !errors.every(transient)) { if (failure) throw failure; return response; }
        const seconds = Number(failure?.response?.headers?.['retry-after']);
        const after = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 0;
        assert.ok(after <= 60000, 'RPC requested a longer cooldown; retry manually');
        this.nextAt = Math.max(this.nextAt, Date.now() + after);
        log({ event: 'agent_read_retry', methods, attempt, maximumAttempts: 3 });
        await sleep(Math.max(500 * attempt, after));
      }
    });
    this.queue = run.catch(() => {}); return run;
  }
}
async function connect(base) {
  assert.ok(options.rpc && options['private-key-env'], '--rpc and --private-key-env are required');
  if (options['chain-id']) assert.equal(String(options['chain-id']), String(base.chainId), 'Requested chain differs from deployment');
  else assert.equal(String(base.chainId), '4663', 'Local fixtures require an explicit --chain-id');
  const provider = new AgentProvider(options.rpc, base.chainId);
  try {
    assert.equal(BigInt(await provider.send('eth_chainId', [])), BigInt(base.chainId), 'RPC chain differs from deployment');
    const key = process.env[options['private-key-env']]; assert.ok(key, 'Selected private-key environment variable is empty');
    return { provider, wallet: new Wallet(key, provider) };
  } catch (error) { await provider.destroy(); throw error; }
}

const name = 'S0ULAgentGreeting', sourceName = 'S0ULAgentGreeting.sol';
function artifact(build) {
  const a = build.contracts?.[sourceName]?.[name];
  assert.ok(a?.abi && /^[a-f\d]+$/i.test(a?.evm?.bytecode?.object), 'Missing or linked greeting artifact');
  return a;
}
function fingerprint(build) { return sha(canonical(build)); }
function checkBuild(build) {
  assert.ok(/^0\.8\.30\+/.test(build.compiler), 'Expected Solidity 0.8.30');
  assert.equal(build.optimizerRuns, 200); assert.equal(build.viaIR, true); assert.equal(build.evmVersion, 'shanghai');
  assert.equal(build.sourceSha256[sourceName], sha(readFileSync(resolve(root, 'extensions', sourceName))), 'Greeting source changed; compile again');
  artifact(build);
}
function compile() {
  assert.ok(/^0\.8\.30\+/.test(solc.version()), 'Installed compiler must be Solidity 0.8.30');
  const sources = { [sourceName]: { content: readFileSync(resolve(root, 'extensions', sourceName), 'utf8') } };
  const input = { language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true,
    evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } } };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal((compiled.errors ?? []).filter(x => x.severity === 'error').length, 0,
    (compiled.errors ?? []).filter(x => x.severity === 'error').map(x => x.formattedMessage).join('\n'));
  const build = { compiler: solc.version(), optimizerRuns: 200, viaIR: true, evmVersion: 'shanghai',
    sourceSha256: { [sourceName]: sha(sources[sourceName].content) }, contracts: compiled.contracts };
  const a = artifact(build); assert.ok(a.evm.deployedBytecode.object.length / 2 <= 24576, 'Greeting exceeds EIP-170');
  const output = resolve(options.output ?? buildPath);
  write(output, build); write(resolve(dirname(output), 'standard-input.json'), input);
  log({ event: 'greeting_compiled', output, fingerprint: fingerprint(build), runtimeBytes: a.evm.deployedBytecode.object.length / 2 });
}
function runtimeMatches(code, a) {
  const actual = Buffer.from(code.slice(2), 'hex'), expected = Buffer.from(a.evm.deployedBytecode.object, 'hex');
  assert.equal(actual.length, expected.length, 'Greeting runtime length differs');
  for (const ranges of Object.values(a.evm.deployedBytecode.immutableReferences ?? {})) for (const { start, length } of ranges) {
    actual.fill(0, start, start + length); expected.fill(0, start, start + length);
  }
  assert.ok(actual.equals(expected), 'Greeting runtime differs from compiled source');
}
const pinAbi = [
  ...['controller','engine','model','tokenizer'].map(x => `function ${x}() view returns(address)`),
  ...['controllerCodeHash','engineCodeHash','modelCodeHash','tokenizerCodeHash','modelId','sourceCheckpoint'].map(x => `function ${x}() view returns(bytes32)`)
];
async function pins(provider, base, agent, blockTag = 'latest') {
  for (const [key, expected] of [['controller', agent.controllerCodeHash], ['engine', base.engineCodeHash], ['model', base.modelCodeHash], ['tokenizer', base.tokenizerCodeHash]]) {
    const addr = key === 'controller' ? agent.controller : base[key], code = await provider.getCode(addr, blockTag);
    assert.notEqual(code, '0x', 'Missing ' + key + ' code'); assert.ok(hex(keccak256(code), expected), key + ' code changed');
  }
  const controller = new Contract(agent.controller, pinAbi, provider), overrides = { blockTag };
  for (const key of ['engine','model','tokenizer']) assert.ok(address(await controller[key](overrides), base[key]), 'Controller ' + key + ' differs');
  for (const key of ['engineCodeHash','modelCodeHash','tokenizerCodeHash','modelId','sourceCheckpoint'])
    assert.ok(hex(await controller[key](overrides), base[key]), 'Controller ' + key + ' differs');
  return controller;
}
async function greetingPins(provider, base, agent, deployed, build, blockTag = 'latest') {
  const code = await provider.getCode(deployed.greeting, blockTag); assert.notEqual(code, '0x', 'Missing greeting code');
  runtimeMatches(code, artifact(build));
  if (deployed.greetingCodeHash) assert.ok(hex(keccak256(code), deployed.greetingCodeHash), 'Greeting code changed');
  const greeting = new Contract(deployed.greeting, artifact(build).abi, provider), overrides = { blockTag };
  for (const key of ['controller','engine','model','tokenizer']) assert.ok(address(await greeting[key](overrides), key === 'controller' ? agent.controller : base[key]), 'Greeting ' + key + ' differs');
  for (const key of ['controllerCodeHash','engineCodeHash','modelCodeHash','tokenizerCodeHash','modelId','sourceCheckpoint'])
    assert.ok(hex(await greeting[key](overrides), key === 'controllerCodeHash' ? agent.controllerCodeHash : base[key]), 'Greeting ' + key + ' differs');
  return { greeting, codeHash: keccak256(code) };
}
function receiptRecord(r) {
  return { hash: r.hash, status: r.status, gasUsed: r.gasUsed.toString(), gasPrice: r.gasPrice.toString(),
    blockNumber: r.blockNumber, blockHash: r.blockHash, contractAddress: r.contractAddress };
}
async function operate() {
  const baseRaw = readFileSync(resolve(options.deployment ?? basePath)), base = JSON.parse(baseRaw);
  const agentRaw = readFileSync(resolve(options.agent ?? agentPath)), agent = JSON.parse(agentRaw);
  const build = read(resolve(options.build ?? buildPath)); checkBuild(build);
  assert.ok(base.complete && !base.pending && agent.complete && !agent.pending, 'Source deployments must be complete');
  assert.equal(String(base.chainId), String(agent.chainId)); assert.ok(hex(agent.modelId, base.modelId) && address(agent.engine, base.engine), 'Source model/engine differs');
  if (String(base.chainId) === '4663') {
    assert.ok(address(agent.controller, pinnedController) && hex(agent.controllerCodeHash, pinnedControllerHash), 'Mainnet controller must be the pinned existing deployment');
  }
  const id = BigInt(options['request-id'] ?? 2); assert.ok(id > 0n, 'Invalid --request-id');
  const destination = resolve(options.resume ?? options.output ?? (command === 'deploy' ? greetingPath : resolve(root, 'deployments/agent-greeting-' + id + '.json')));
  if (options.resume && options.output) assert.equal(resolve(options.output), destination, '--resume and --output must match');
  const unlock = lock(destination); let provider;
  try {
    assert.ok(options.resume ? existsSync(destination) : !existsSync(destination), 'Output exists; use --resume for exact recorded hash, or a fresh output');
    const prior = options.resume ? read(destination) : null;
    const deployed = command === 'say' ? read(resolve(options.greeting ?? greetingPath)) : null;
    if (deployed) assert.ok(deployed.complete && !deployed.pending && deployed.greeting, 'Greeting deployment is incomplete');
    const connected = await connect(base); provider = connected.provider;
    const wallet = connected.wallet, sender = await wallet.getAddress();
    await pins(provider, base, agent);
    const a = artifact(build), args = [agent.controller, agent.controllerCodeHash, base.modelId];
    let greeting = null;
    if (deployed) {
      assert.equal(deployed.buildFingerprint, fingerprint(build), 'Greeting build differs');
      assert.equal(deployed.chainId, String(base.chainId)); assert.ok(address(deployed.controller, agent.controller), 'Greeting controller differs');
      greeting = (await greetingPins(provider, base, agent, deployed, build)).greeting;
    }
    const data = command === 'deploy' ? (await new ContractFactory(a.abi, a.evm.bytecode.object).getDeployTransaction(...args)).data : greeting.interface.encodeFunctionData('sayHello', [id]);
    const to = command === 'deploy' ? null : deployed.greeting;
    const identity = { operation: command, chainId: String(base.chainId), sender, controller: agent.controller, controllerCodeHash: agent.controllerCodeHash,
      engine: base.engine, modelId: base.modelId, sourceCheckpoint: base.sourceCheckpoint,
      baseDeploymentSha256: sha(baseRaw), agentDeploymentSha256: sha(agentRaw), buildFingerprint: fingerprint(build),
      compiler: build.compiler, sourceSha256: build.sourceSha256, requestId: command === 'say' ? id.toString() : null,
      constructorArguments: command === 'deploy' ? args : null, calldataKeccak256: keccak256(data), to,
      message: 'Hello World', messageOrigin: 'deterministic fixed greeting tool; not neural generation' };
    if (prior) for (const [key, value] of Object.entries(identity)) assert.equal(canonical(prior[key]), canonical(value), 'Resume identity differs: ' + key);
    const result = prior ?? { format: 'gh0st-s0ul-agent-greeting-' + (command === 'deploy' ? 'deployment' : 'operation') + '-v1',
      ...identity, pending: null, transaction: null, receipt: null, complete: false };
    let tx = result.pending ?? result.transaction;
    const agentBuild = read(resolve(options['agent-build'] ?? resolve(root, 'exports/solidity-agent-build/contracts.json')));
    const controller = new Contract(agent.controller, agentBuild.contracts['S0ULAgent.sol'].S0ULAgent.abi, provider);
    if (!prior) {
      if (command === 'say') {
        const request = await controller.requests(id), action = await controller.resultOf(id);
        assert.ok(address(request.owner, sender) && request.outcome === 2n, 'Only original owner of an executed request may greet');
        assert.notEqual(request.expectedActionHash, ZeroHash, 'Source request must have an action commitment');
        assert.ok(hex(keccak256(action[0]), request.expectedActionHash), 'Executed source action differs from commitment');
        assert.equal(await greeting.used(id), false, 'Request already greeted');
        assert.equal(await greeting.connect(wallet).sayHello.staticCall(id), 'Hello World', 'Greeting preflight differs');
        result.source = { owner: request.owner, outputHash: request.outputHash, actionHash: request.expectedActionHash, action: action[0] };
      }
      const estimate = await provider.estimateGas({ from: sender, ...(to ? { to } : {}), data, value: 0n });
      const limit = estimate + (estimate * 2000n + 9999n) / 10000n, maximum = command === 'deploy' ? 3000000 : 1000000;
      assert.ok(limit <= BigInt(positive('max-gas', maximum, maximum)), 'Estimated gas plus 20% margin exceeds cap');
      const nonce = Number(BigInt(await provider.send('eth_getTransactionCount', [sender, 'pending']))); assert.ok(Number.isSafeInteger(nonce), 'Unsupported nonce');
      tx = { hash: null, nonce, gasEstimate: estimate.toString(), gasLimit: limit.toString(), predictedAddress: to ? null : getCreateAddress({ from: sender, nonce }), submittedAt: new Date().toISOString() };
      result.pending = tx; result.transaction = tx; write(destination, result);
      const populated = await wallet.populateTransaction({ ...(to ? { to } : {}), data, nonce, value: 0n, gasLimit: limit });
      const raw = await wallet.signTransaction(populated); tx.hash = keccak256(raw); write(destination, result);
      try { await provider.broadcastTransaction(raw); }
      catch (error) { const known = await provider.getTransaction(tx.hash); if (!known) throw error; }
    } else assert.ok(tx?.hash, 'Resume requires the exact signed hash; no replacement submitted');
    const known = await provider.getTransaction(tx.hash);
    assert.ok(known && hex(known.hash, tx.hash) && address(known.from, sender) && (to ? address(known.to, to) : known.to === null) &&
      known.nonce === tx.nonce && known.chainId === BigInt(base.chainId) && known.value === 0n && hex(known.data, data) && known.gasLimit === BigInt(tx.gasLimit), 'Recorded transaction differs or is unavailable; no replacement submitted');
    const receipt = await provider.waitForTransaction(tx.hash, positive('confirmations', 1, 64), positive('receipt-timeout-ms', 180000));
    assert.ok(receipt && hex(receipt.hash, tx.hash), 'Receipt unavailable; exact pending retained');
    result.receipt = receiptRecord(receipt); write(destination, result);
    assert.equal(receipt.status, 1, 'Transaction failed; receipt retained');
    assert.ok(address(receipt.from, sender) && (to ? address(receipt.to, to) : receipt.to === null), 'Receipt identity differs');
    const block = await provider.getBlock(receipt.blockNumber); assert.ok(block && hex(block.hash, receipt.blockHash), 'Receipt block is no longer canonical');
    await pins(provider, base, agent, receipt.blockNumber);
    if (command === 'deploy') {
      assert.ok(address(receipt.contractAddress, tx.predictedAddress), 'CREATE address differs');
      const live = await greetingPins(provider, base, agent, { greeting: tx.predictedAddress, greetingCodeHash: result.greetingCodeHash }, build, receipt.blockNumber);
      result.greeting = tx.predictedAddress; result.greetingCodeHash = live.codeHash;
    } else {
      const live = await greetingPins(provider, base, agent, deployed, build, receipt.blockNumber);
      const overrides = { blockTag: receipt.blockNumber }, request = await controller.requests(id, overrides), action = await controller.resultOf(id, overrides);
      assert.ok(address(request.owner, sender) && request.outcome === 2n && hex(request.outputHash, result.source.outputHash) &&
        hex(request.expectedActionHash, result.source.actionHash) && hex(action[0], result.source.action), 'Source request changed');
      assert.equal(await live.greeting.used(id, overrides), true); assert.equal(await live.greeting.messageOf(id, overrides), 'Hello World');
      const events = receipt.logs.filter(x => address(x.address, deployed.greeting)).map(x => { try { return greeting.interface.parseLog(x); } catch { return null; } }).filter(x => x?.name === 'Greeting');
      assert.equal(events.length, 1, 'Expected exactly one Greeting event'); const e = events[0].args;
      assert.ok(e.requestId === id && address(e.owner, sender) && address(e.controller, agent.controller) && hex(e.modelId, base.modelId) &&
        hex(e.sourceOutputHash, result.source.outputHash) && hex(e.sourceActionHash, result.source.actionHash) && e.message === 'Hello World', 'Greeting event differs');
      result.greeting = deployed.greeting; result.greetingCodeHash = deployed.greetingCodeHash;
      result.event = { requestId: id.toString(), owner: e.owner, controller: e.controller, modelId: e.modelId,
        sourceOutputHash: e.sourceOutputHash, sourceActionHash: e.sourceActionHash, message: e.message };
    }
    assert.ok(hex((await provider.getBlock(receipt.blockNumber))?.hash, receipt.blockHash), 'Receipt block changed during verification');
    result.pending = null; result.complete = true; result.completedAt = new Date().toISOString(); write(destination, result);
    log({ event: prior?.complete ? 'greeting_already_complete' : 'greeting_' + command + '_completed', journal: destination,
      greeting: result.greeting, requestId: result.requestId, message: command === 'say' ? 'Hello World' : null, messageOrigin: result.messageOrigin,
      hash: tx.hash, gasUsed: receipt.gasUsed.toString() });
  } finally { try { await provider?.destroy(); } finally { unlock(); } }
}
try {
  for (let i = 0; i < argv.length; i += 2) {
    assert.ok(argv[i].startsWith('--') && argv[i + 1] !== undefined, 'Options require --name value pairs'); const key = argv[i].slice(2);
    assert.ok(['deployment','agent','agent-build','greeting','build','output','resume','rpc','private-key-env','chain-id','rpc-rps','request-id','max-gas','confirmations','receipt-timeout-ms'].includes(key), 'Unknown option: ' + key);
    assert.ok(!(key in options), 'Repeated option: ' + key); options[key] = argv[i + 1];
  }
  assert.ok(['compile','deploy','say'].includes(command), 'Use compile, deploy or say');
  if (command === 'compile') compile(); else await operate();
} catch (error) {
  const detail = error?.shortMessage ?? (error?.code === 'ERR_ASSERTION' ? error.message : 'Greeting operation failed');
  const safe = String(detail).split('\n', 1)[0].replace(/https?:\/\/[^\s]+/gi, '[endpoint omitted]').replace(/0x[a-f\d]{64,}/gi, '[hex omitted]').slice(0, 500);
  process.stderr.write('Error: ' + safe + '\n'); process.exitCode = 1;
}
