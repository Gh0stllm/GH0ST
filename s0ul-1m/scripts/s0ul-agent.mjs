#!/usr/bin/env node
// Explicit controller operations only; no .env loading, inference loop or key persistence.
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
const buildPath = resolve(root, 'exports/solidity-agent-build/contracts.json');
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
function artifact(build, name) {
  const result = build.contracts?.[name + '.sol']?.[name];
  assert.ok(result?.abi && /^[a-f\d]+$/i.test(result?.evm?.bytecode?.object), 'Missing or linked artifact ' + name);
  return result;
}
function fingerprint(build) {
  const a = artifact(build, 'S0ULAgent');
  return sha(canonical({ compiler: build.compiler, optimizerRuns: build.optimizerRuns, viaIR: build.viaIR,
    evmVersion: build.evmVersion, sourceSha256: build.sourceSha256, abi: a.abi,
    creation: a.evm.bytecode.object, runtime: a.evm.deployedBytecode.object }));
}
function checkBuild(build, base) {
  assert.ok(/^0\.8\.30\+/.test(build.compiler), 'Expected Solidity 0.8.30');
  assert.equal(build.optimizerRuns, 200); assert.equal(build.viaIR, true); assert.equal(build.evmVersion, 'shanghai');
  for (const [name, hash] of Object.entries(base.sourceSha256)) assert.equal(build.sourceSha256[name], hash, 'Existing deployed source changed: ' + name);
  artifact(build, 'S0ULAgent');
}
function compile() {
  assert.ok(/^0\.8\.30\+/.test(solc.version()), 'Installed compiler must be Solidity 0.8.30');
  const sources = Object.fromEntries(readdirSync(resolve(root, 'contracts')).filter(x => x.endsWith('.sol'))
    .map(name => [name, { content: readFileSync(resolve(root, 'contracts', name), 'utf8') }]));
  const input = { language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true,
    evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter(x => x.severity === 'error');
  assert.equal(errors.length, 0, errors.map(x => x.formattedMessage).join('\n'));
  for (const file of Object.values(output.contracts)) for (const [name, a] of Object.entries(file))
    assert.ok(a.evm.deployedBytecode.object.length / 2 <= 24576, name + ' exceeds EIP-170');
  const build = { compiler: solc.version(), optimizerRuns: 200, viaIR: true, evmVersion: 'shanghai',
    sourceSha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, sha(source.content)])), contracts: output.contracts };
  const base = read(resolve(options.deployment ?? basePath)); checkBuild(build, base);
  const previous = resolve(options['base-build'] ?? resolve(root, 'exports/solidity-build/contracts.json'));
  if (options['base-build'] || existsSync(previous)) {
    const old = artifact(read(previous), 'S0ULInference'), current = artifact(build, 'S0ULInference');
    assert.equal(current.evm.bytecode.object, old.evm.bytecode.object, 'Existing inference creation bytecode changed');
    assert.equal(current.evm.deployedBytecode.object, old.evm.deployedBytecode.object, 'Existing inference runtime template changed');
    build.existingInferenceBytecodeUnchanged = true;
  }
  const destination = resolve(options.output ?? buildPath);
  write(destination, build);
  write(resolve(dirname(destination), 'standard-input.json'), input);
  log({ event: 'agent_compiled', output: destination, compiler: build.compiler, fingerprint: fingerprint(build),
    existingInferenceBytecodeUnchanged: build.existingInferenceBytecodeUnchanged ?? false });
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
async function basePins(base, build, provider, token) {
  assert.equal(base.complete, true); assert.equal(base.pending, null); assert.equal(base.transactions.length, base.shards.length + 3);
  const engine = new Contract(base.engine, artifact(build, 'S0ULInference').abi, provider);
  const model = new Contract(base.model, artifact(build, 'S0ULModel').abi, provider);
  for (const name of ['engine', 'model', 'tokenizer']) {
    const code = await provider.getCode(base[name]); assert.notEqual(code, '0x', 'Missing ' + name + ' code');
    assert.ok(hex(keccak256(code), base[name + 'CodeHash']), 'Changed ' + name + ' runtime');
  }
  assert.ok(address(await engine.model(), base.model) && address(await engine.tokenizer(), base.tokenizer), 'Engine dependency pins differ');
  assert.ok(hex(await engine.modelId(), base.modelId) && hex(await model.modelId(), base.modelId), 'Model identity differs');
  assert.ok(hex(await model.sourceCheckpoint(), base.sourceCheckpoint), 'Checkpoint differs');
  const code = await provider.getCode(token); assert.notEqual(code, '0x', 'GH0ST asset has no code on this chain; no fallback is allowed');
  return { engine, gh0stCodeHash: keccak256(code) };
}
async function controllerPins(controller, base, token, tokenHash) {
  for (const [getter, expected] of [['engine', base.engine], ['model', base.model], ['tokenizer', base.tokenizer], ['gh0stToken', token]])
    assert.ok(address(await controller[getter](), expected), 'Controller ' + getter + ' pin differs');
  for (const [getter, expected] of [['engineCodeHash', base.engineCodeHash], ['modelCodeHash', base.modelCodeHash],
    ['tokenizerCodeHash', base.tokenizerCodeHash], ['modelId', base.modelId], ['sourceCheckpoint', base.sourceCheckpoint], ['gh0stCodeHash', tokenHash]])
    assert.ok(hex(await controller[getter](), expected), 'Controller ' + getter + ' pin differs');
}
async function completion(engine, tokenizer, id, sender, expectedText, allowPartial = false) {
  const state = await engine.status(id);
  assert.ok(address(state.owner, sender) && !state.cancelled && (allowPartial || state.done), 'Only the original direct engine owner may adopt; finalization requires completion');
  const ids = (await engine.tokens(id)).map(Number), output = (await engine.outputTokens(id)).map(Number);
  if (!state.done) return { promptIds: ids.slice(0, Number(state.promptLength)), outputIds: output, output: null };
  assert.ok(output.length >= 2 && output.length <= 32 && output.at(-1) === 2 && !output.slice(0, -1).some(x => x < 4 || x >= 421), 'Generated action must end with EOS and contain no controls/reserved tokens');
  const decoded = await tokenizer.decode(output.slice(0, -1), false);
  if (expectedText !== undefined) assert.ok(hex(decoded, '0x' + Buffer.from(expectedText, 'utf8').toString('hex')), 'Generated action differs from --expect-action');
  return { promptIds: ids.slice(0, Number(state.promptLength)), outputIds: output, output: decoded };
}
function publicReceipt(receipt) {
  return { hash: receipt.hash, status: receipt.status, gasUsed: receipt.gasUsed.toString(), gasPrice: receipt.gasPrice.toString(),
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, contractAddress: receipt.contractAddress };
}
async function operate() {
  const baseFile = resolve(options.deployment ?? basePath), baseRaw = readFileSync(baseFile), base = JSON.parse(baseRaw);
  const build = read(resolve(options.build ?? buildPath)); checkBuild(build, base);
  const id = BigInt(options['request-id'] ?? 1); assert.ok(id > 0n, 'Invalid --request-id');
  const operation = command === 'bind' ? 'adopt' : command;
  const destination = resolve(options.resume ?? options.output ?? (operation === 'deploy' ? agentPath : resolve(root, 'deployments/agent-' + operation + '-' + id + '.json')));
  if (options.resume && options.output) assert.equal(resolve(options.output), destination, '--resume and --output must match');
  const unlock = lock(destination); let provider;
  try {
    assert.ok(options.resume ? existsSync(destination) : !existsSync(destination), options.resume ? 'Resume journal is missing' : 'Output exists; use --resume or a fresh --output');
    const prior = options.resume ? read(destination) : null;
    const deployed = operation === 'deploy' ? null : read(resolve(options.agent ?? agentPath));
    if (deployed) assert.ok(deployed.complete && deployed.controller && deployed.chainId === String(base.chainId), 'Agent deployment is incomplete or on another chain');
    const token = getAddress(options['gh0st-token'] ?? deployed?.gh0stToken ?? prior?.gh0stToken ?? gh0stDefault);
    const connected = await connect(base); provider = connected.provider;
    const wallet = connected.wallet, sender = await wallet.getAddress();
    const pins = await basePins(base, build, provider, token);
    const controller = deployed ? new Contract(deployed.controller, artifact(build, 'S0ULAgent').abi, provider) : null;
    if (deployed) {
      assert.equal(deployed.buildFingerprint, fingerprint(build), 'Agent build differs');
      assert.ok(hex(keccak256(await provider.getCode(deployed.controller)), deployed.controllerCodeHash), 'Controller code changed');
      await controllerPins(controller, base, token, pins.gh0stCodeHash);
    }
    let mask = positive('action-mask', 1, 1023), expectedText = options['expect-action'];
    if (mask & 168) assert.ok(expectedText !== undefined, 'Write actions require --expect-action');
    if (expectedText !== undefined) assert.ok(toUtf8Bytes(expectedText).length > 0 && toUtf8Bytes(expectedText).length <= 100, 'Expected action length must be 1..100 bytes');
    const expectedActionHash = expectedText === undefined ? ZeroHash : keccak256(toUtf8Bytes(expectedText));
    const args = operation === 'deploy' ? [base.engine, base.engineCodeHash, base.modelId, token] :
      operation === 'adopt' ? expectedText === undefined ? [id, mask] : [id, mask, expectedActionHash] : [id];
    const method = operation === 'adopt' ? expectedText === undefined ? 'adopt' : 'adoptConstrained' : 'finalize';
    const data = operation === 'deploy' ? (await new ContractFactory(artifact(build, 'S0ULAgent').abi, artifact(build, 'S0ULAgent').evm.bytecode.object).getDeployTransaction(...args)).data : controller.interface.encodeFunctionData(method, args);
    const to = operation === 'deploy' ? null : deployed.controller;
    const identity = { operation, chainId: String(base.chainId), sender, engine: base.engine, modelId: base.modelId,
      gh0stToken: token, gh0stCodeHash: pins.gh0stCodeHash, baseDeploymentSha256: sha(baseRaw), buildFingerprint: fingerprint(build),
      requestId: operation === 'deploy' ? null : id.toString(), allowedActions: mask, expectedActionHash, calldataKeccak256: keccak256(data), to,
      compiler: build.compiler, sourceSha256: build.sourceSha256, constructorArguments: operation === 'deploy' ? args : null };
    if (prior) for (const [key, value] of Object.entries(identity)) assert.equal(canonical(prior[key]), canonical(value), 'Resume identity differs: ' + key);
    const result = prior ?? { format: operation === 'deploy' ? 'gh0st-s0ul-agent-deployment-v1' : 'gh0st-s0ul-agent-operation-v1',
      ...identity, pending: null, transaction: null, receipt: null, complete: false };
    let tx = result.pending ?? result.transaction;
    if (!prior) {
      if (operation !== 'deploy') {
        const tokenizer = new Contract(base.tokenizer, artifact(build, 'S0ULTokenizer').abi, provider);
        result.proposal = await completion(pins.engine, tokenizer, id, sender, expectedText ?? (mask === 1 ? 'WAIT' : undefined), operation === 'adopt');
        const bound = await controller.requests(id);
        if (operation === 'adopt') assert.equal(bound.owner, '0x0000000000000000000000000000000000000000', 'Request is already bound');
        else {
          assert.ok(address(bound.owner, sender) && bound.allowedActions === BigInt(mask) && bound.outcome === 1n, 'Bound owner/mask/outcome differs');
          assert.ok(hex(bound.expectedActionHash, expectedActionHash), 'Bound action commitment differs');
        }
        const connectedController = controller.connect(wallet);
        const simulated = await connectedController[method].staticCall(...args);
        if (operation === 'finalize') assert.equal(simulated, true, 'Controller would reject this action');
      }
      const estimate = await provider.estimateGas({ from: sender, ...(to ? { to } : {}), data, value: 0n });
      const limit = estimate + (estimate * 2000n + 9999n) / 10000n;
      assert.ok(limit <= BigInt(positive('max-gas', 8000000, 8000000)), 'Estimated gas plus 20% margin exceeds cap');
      const nonce = Number(BigInt(await provider.send('eth_getTransactionCount', [sender, 'pending'])));
      assert.ok(Number.isSafeInteger(nonce), 'Unsupported sender nonce');
      tx = { hash: null, nonce, gasEstimate: estimate.toString(), gasLimit: limit.toString(),
        predictedAddress: to ? null : getCreateAddress({ from: sender, nonce }), submittedAt: new Date().toISOString() };
      result.pending = tx; result.transaction = tx; write(destination, result);
      const populated = await wallet.populateTransaction({ ...(to ? { to } : {}), data, nonce, value: 0n, gasLimit: limit });
      const raw = await wallet.signTransaction(populated); tx.hash = keccak256(raw); write(destination, result);
      try { await provider.broadcastTransaction(raw); }
      catch (error) { const known = await provider.getTransaction(tx.hash); if (!known) throw error; }
    } else assert.ok(tx?.hash, 'Resume requires an exact recorded signed hash; no replacement is submitted');
    const known = await provider.getTransaction(tx.hash);
    assert.ok(known && hex(known.hash, tx.hash) && address(known.from, sender) && (to ? address(known.to, to) : known.to === null) &&
      known.nonce === tx.nonce && known.chainId === BigInt(base.chainId) && known.value === 0n && hex(known.data, data) && known.gasLimit === BigInt(tx.gasLimit), 'Signed transaction differs or is unavailable; no replacement is submitted');
    const receipt = await provider.waitForTransaction(tx.hash, positive('confirmations', 1, 64), positive('receipt-timeout-ms', 180000));
    assert.ok(receipt && hex(receipt.hash, tx.hash), 'Receipt unavailable; exact pending hash retained');
    result.receipt = publicReceipt(receipt); write(destination, result);
    assert.equal(receipt.status, 1, 'Transaction failed; receipt retained and no replacement submitted');
    assert.ok(address(receipt.from, sender) && (to ? address(receipt.to, to) : receipt.to === null), 'Receipt destination/sender differs');
    if (operation === 'deploy') {
      assert.ok(address(receipt.contractAddress, tx.predictedAddress), 'Controller CREATE address differs');
      const code = await provider.getCode(tx.predictedAddress); assert.ok(code !== '0x' && code.length / 2 - 1 <= 24576, 'Missing or oversized controller code');
      if (result.controllerCodeHash) assert.ok(hex(keccak256(code), result.controllerCodeHash), 'Controller runtime changed');
      result.controller = tx.predictedAddress; result.controllerCodeHash = keccak256(code);
      await controllerPins(new Contract(result.controller, artifact(build, 'S0ULAgent').abi, provider), base, token, pins.gh0stCodeHash);
    } else {
      const state = await controller.requests(id);
      assert.ok(address(state.owner, sender) && state.allowedActions === BigInt(mask) && state.adopted, 'Controller binding differs');
      assert.equal(state.outcome, operation === 'adopt' ? 1n : 2n, 'Controller outcome differs');
      assert.ok(hex(state.expectedActionHash, expectedActionHash), 'Controller action commitment differs');
      const proposal = result.proposal;
      const coder = AbiCoder.defaultAbiCoder();
      assert.ok(hex(state.promptHash, keccak256(coder.encode(['uint16[]'], [proposal.promptIds]))), 'Controller prompt hash differs');
      if (operation === 'finalize') {
        assert.ok(hex(state.outputHash, keccak256(coder.encode(['uint16[]'], [proposal.outputIds]))), 'Controller output hash differs');
        const action = await controller.resultOf(id); assert.ok(hex(action[0], proposal.output), 'Executed action output differs');
        result.action = { kind: Number(state.action), output: action[0], result: action[1] };
      }
      result.controller = deployed.controller; result.controllerCodeHash = deployed.controllerCodeHash;
      result.bound = { owner: state.owner, allowedActions: Number(state.allowedActions), stateRevision: state.stateRevision.toString(),
        adopted: state.adopted, outcome: Number(state.outcome), action: Number(state.action), reason: Number(state.reason),
        promptHash: state.promptHash, outputHash: state.outputHash, expectedActionHash: state.expectedActionHash };
    }
    result.pending = null; result.complete = true; result.completedAt = new Date().toISOString(); write(destination, result);
    log({ event: prior?.complete ? 'agent_already_complete' : 'agent_' + operation + '_completed', journal: destination,
      controller: result.controller, requestId: result.requestId, hash: tx.hash, gasUsed: receipt.gasUsed.toString() });
  } finally { try { await provider?.destroy(); } finally { unlock(); } }
}

async function continueRequest() {
  const baseFile = resolve(options.deployment ?? basePath), baseRaw = readFileSync(baseFile), base = JSON.parse(baseRaw);
  const build = read(resolve(options.build ?? buildPath)); checkBuild(build, base);
  const deployed = read(resolve(options.agent ?? agentPath));
  assert.ok(deployed.complete && deployed.controller && deployed.chainId === String(base.chainId), 'Agent deployment is incomplete or on another chain');
  const id = BigInt(options['request-id'] ?? 1); assert.ok(id > 0n, 'Invalid --request-id');
  const output = resolve(options.resume ?? options.output ?? resolve(root, 'deployments/agent-continue-' + id + '.json'));
  if (options.resume && options.output) assert.equal(resolve(options.output), output, '--resume and --output must match');
  const unlock = lock(output); let provider;
  try {
    assert.ok(options.resume ? existsSync(output) : !existsSync(output), 'Use a fresh output, or --resume for exact pending-hash reconciliation only');
    const prior = options.resume ? read(output) : null;
    const token = getAddress(deployed.gh0stToken);
    const connected = await connect(base); provider = connected.provider;
    const wallet = connected.wallet, sender = await wallet.getAddress();
    const pins = await basePins(base, build, provider, token);
    assert.equal(deployed.buildFingerprint, fingerprint(build), 'Agent build differs');
    assert.ok(hex(keccak256(await provider.getCode(deployed.controller)), deployed.controllerCodeHash), 'Controller code changed');
    const controller = new Contract(deployed.controller, artifact(build, 'S0ULAgent').abi, provider);
    await controllerPins(controller, base, token, pins.gh0stCodeHash);
    const bound = await controller.requests(id);
    assert.ok(address(bound.owner, sender) && bound.outcome === 1n, 'Only the bound owner may continue a running controller request');
    const mask = Number(bound.allowedActions), expectedText = options['expect-action'];
    if (options['action-mask']) assert.equal(positive('action-mask', 1, 1023), mask, 'Bound action mask differs');
    if (mask & 168) assert.ok(expectedText !== undefined, 'Write actions require --expect-action');
    const expectedActionHash = expectedText === undefined ? ZeroHash : keccak256(toUtf8Bytes(expectedText));
    assert.ok(hex(bound.expectedActionHash, expectedActionHash), 'Bound action commitment differs');
    const rows = positive('rows', 128, 128), cap = BigInt(positive('max-step-gas', 31000000, 31000000));
    const identity = { format: 'gh0st-s0ul-agent-continuation-v1', chainId: String(base.chainId), sender,
      controller: deployed.controller, controllerCodeHash: deployed.controllerCodeHash, engine: base.engine, modelId: base.modelId,
      requestId: id.toString(), rowsPerStep: rows, allowedActions: mask, expectedActionHash,
      buildFingerprint: fingerprint(build), baseDeploymentSha256: sha(baseRaw) };
    if (prior) for (const [key, value] of Object.entries(identity)) assert.equal(canonical(prior[key]), canonical(value), 'Resume identity differs: ' + key);
    const result = prior ?? { ...identity, transactions: [], decisions: [], pending: null, complete: false };
    const record = receipt => {
      result.transactions.push({ ...publicReceipt(receipt), plannedSteps: result.pending.steps });
      result.pending = null;
      result.totalGasThisInvocation = result.transactions.reduce((sum, entry) => sum + BigInt(entry.gasUsed), 0n).toString();
      write(output, result);
      assert.equal(receipt.status, 1, 'Continuation failed; confirmed receipt retained, no retry submitted');
    };
    const receivePending = async () => {
      const p = result.pending;
      assert.ok(p?.hash, 'Resume requires a recorded signed hash; no replacement submitted');
      const data = controller.interface.encodeFunctionData('advanceBatch', [id, rows, p.steps]);
      assert.ok(hex(keccak256(data), p.calldataKeccak256), 'Pending continuation calldata differs');
      const known = await provider.getTransaction(p.hash);
      assert.ok(known && hex(known.hash, p.hash) && address(known.from, sender) && address(known.to, deployed.controller) &&
        known.nonce === p.nonce && known.chainId === BigInt(base.chainId) && known.value === 0n &&
        hex(known.data, data) && known.gasLimit === BigInt(p.gasLimit), 'Pending continuation differs or is unavailable; no replacement submitted');
      const receipt = await provider.waitForTransaction(p.hash, positive('confirmations', 1, 64), positive('receipt-timeout-ms', 180000));
      assert.ok(receipt && hex(receipt.hash, p.hash) && address(receipt.from, sender) && address(receipt.to, deployed.controller), 'Continuation receipt differs or is unavailable');
      record(receipt);
    };
    if (prior) {
      if (result.pending) await receivePending();
      const state = await pins.engine.status(id); result.complete = state.done;
      result.generatedTokenIds = (await pins.engine.outputTokens(id)).map(Number);
      result.saturatedValues = state.saturationCount;
      write(output, result);
      log({ event: 'agent_continuation_reconciled', journal: output, requestId: id, complete: result.complete });
      if (!result.complete) process.exitCode = 2;
      return;
    }
    for (let i = 0; i < positive('max-transactions', 10000); ++i) {
      const state = await pins.engine.status(id);
      assert.ok(address(state.owner, bound.adopted ? sender : deployed.controller) && !state.cancelled, 'Engine owner/cancellation differs');
      if (state.done) { result.complete = true; break; }
      if (Number(state.phase) === 16 && !result.decisions.some(x => x.generated === Number(state.generated))) {
        const [prefix, logits] = await Promise.all([pins.engine.tokens(id), pins.engine.logits(id)]);
        result.decisions.push({ position: Number(state.position), generated: Number(state.generated), prefix_ids: prefix.map(Number), logits: logits.map(Number) });
        write(output, result);
      }
      let chosen;
      for (let steps = 4; steps >= 1; --steps) {
        const data = controller.interface.encodeFunctionData('advanceBatch', [id, rows, steps]);
        try {
          const estimate = await provider.estimateGas({ from: sender, to: deployed.controller, data, value: 0n, gasLimit: cap });
          const limit = estimate + (estimate * 2000n + 9999n) / 10000n;
          if (limit <= cap) { chosen = { steps, data, estimate, limit }; break; }
        } catch { /* Try a smaller bounded batch; no transaction was sent. */ }
      }
      assert.ok(chosen, 'No 1..4 step batch fits the gas cap; no transaction submitted');
      const nonce = Number(BigInt(await provider.send('eth_getTransactionCount', [sender, 'pending'])));
      assert.ok(Number.isSafeInteger(nonce), 'Unsupported sender nonce');
      result.pending = { hash: null, nonce, steps: chosen.steps, calldataKeccak256: keccak256(chosen.data),
        gasEstimate: chosen.estimate.toString(), gasLimit: chosen.limit.toString(), submittedAt: new Date().toISOString() };
      write(output, result);
      const populated = await wallet.populateTransaction({ to: deployed.controller, data: chosen.data, nonce, value: 0n, gasLimit: chosen.limit });
      const raw = await wallet.signTransaction(populated); result.pending.hash = keccak256(raw); write(output, result);
      try { await provider.broadcastTransaction(raw); }
      catch (error) { const known = await provider.getTransaction(result.pending.hash); if (!known) throw error; }
      await receivePending();
      log({ event: 'agent_continued', requestId: id, transactions: result.transactions.length, steps: chosen.steps });
    }
    const state = await pins.engine.status(id);
    result.complete = state.done; result.generatedTokenIds = (await pins.engine.outputTokens(id)).map(Number);
    result.saturatedValues = state.saturationCount; write(output, result);
    log({ event: 'agent_continuation_finished', journal: output, requestId: id, complete: result.complete, transactions: result.transactions.length });
    if (!result.complete) process.exitCode = 2;
  } finally { try { await provider?.destroy(); } finally { unlock(); } }
}

try {
  for (let i = 0; i < argv.length; i += 2) {
    assert.ok(argv[i].startsWith('--') && argv[i + 1] !== undefined, 'Options require --name value pairs');
    const key = argv[i].slice(2);
    assert.ok(['deployment', 'output', 'base-build', 'build', 'rpc', 'private-key-env', 'chain-id', 'rpc-rps', 'resume', 'agent',
      'gh0st-token', 'request-id', 'action-mask', 'expect-action', 'max-gas', 'confirmations', 'receipt-timeout-ms', 'rows', 'max-step-gas', 'max-transactions'].includes(key), 'Unknown option: ' + key);
    assert.ok(!(key in options), 'Repeated option: ' + key); options[key] = argv[i + 1];
  }
  assert.ok(['compile', 'deploy', 'adopt', 'bind', 'finalize', 'continue'].includes(command), 'Use compile, deploy, adopt, bind, continue or finalize');
  if (command === 'compile') compile(); else if (command === 'continue') await continueRequest(); else await operate();
} catch (error) {
  process.stderr.write('Error: ' + String(error?.shortMessage ?? error?.message ?? 'Agent operation failed').split('\n', 1)[0].slice(0, 500) + '\n');
  process.exitCode = 1;
}
