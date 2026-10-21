#!/usr/bin/env node
// Explicit CLI transactions only. This module never loads .env files.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import solc from 'solc';
import { AbiCoder, Contract, ContractFactory, FetchRequest, JsonRpcProvider, Wallet, getAddress, getCreateAddress, keccak256 } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command, ...argv] = process.argv.slice(2);
const options = {};
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw Error('Options require --name value pairs');
  options[argv[i].slice(2)] = argv[i + 1];
}
const number = (name, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  const value = Number(options[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw Error(`Invalid --${name}`);
  return value;
};
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp.' + process.pid;
  writeFileSync(temporary, JSON.stringify(value, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n', { mode: 0o600, flush: true });
  renameSync(temporary, path);
};
const log = value => process.stdout.write(JSON.stringify(value, (_, x) => typeof x === 'bigint' ? x.toString() : x) + '\n');
const digest = data => createHash('sha256').update(data).digest('hex');

function compile() {
  const sources = Object.fromEntries(readdirSync(resolve(root, 'contracts')).filter(x => x.endsWith('.sol')).map(name =>
    [name, { content: readFileSync(resolve(root, 'contracts', name), 'utf8') }]));
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (output.errors ?? []).filter(x => x.severity === 'error');
  if (errors.length) throw Error(errors.map(x => x.formattedMessage).join('\n'));
  for (const file of Object.values(output.contracts)) for (const [name, artifact] of Object.entries(file)) {
    if (artifact.evm.deployedBytecode.object.length / 2 > 24_576) throw Error(`${name} exceeds EIP-170`);
  }
  return { compiler: solc.version(), optimizerRuns: 200, viaIR: true, evmVersion: 'shanghai',
    sourceSha256: Object.fromEntries(Object.entries(sources).map(([name, x]) => [name, digest(x.content)])),
    contracts: output.contracts };
}

// Public deployment RPCs may impose a per-request rate limit. Queueing all
// payloads also covers ethers' internal nonce, fee, network and receipt calls.
const retryableReadMethods = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionCount',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getCode', 'eth_call', 'eth_estimateGas',
  'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getLogs', 'net_version'
]);
const rpcTimeoutMs = 15_000;
function transientReadFailure(error) {
  if (error?.code === 'TIMEOUT' || error?.code === 'ETIMEDOUT') return true;
  const status = error?.status ?? error?.statusCode ?? error?.info?.responseStatus ?? error?.response?.status;
  if (/^(429|503)(\b|$)/.test(String(status))) return true;
  return [-32000, -32002, -32005].includes(error?.code) &&
    /^(?:(?:request|upstream|gateway|connection|network|response)\s+)*(?:timeout|timed\s+out)(?:\b|$)/i.test(String(error?.message ?? '').trim());
}
function readFailureDetails(error) {
  const statusText = error?.status ?? error?.statusCode ?? error?.info?.responseStatus ?? error?.response?.statusCode;
  const status = /^(\d{3})(\b|$)/.exec(String(statusText))?.[1];
  const code = Number.isSafeInteger(error?.code) || ['TIMEOUT', 'ETIMEDOUT', 'SERVER_ERROR', 'NETWORK_ERROR', 'UNKNOWN_ERROR', 'BAD_DATA'].includes(error?.code) ? error.code : undefined;
  let body;
  try { body = JSON.parse(error?.info?.responseBody ?? 'null'); } catch { /* do not log arbitrary response text */ }
  const candidate = body?.reason ?? body?.error?.reason ?? body?.error?.data?.reason ?? body?.data?.reason;
  const reason = ['public_pool_busy', 'rate_limit_exceeded', 'rate_limited', 'too_many_requests', 'pool_busy', 'pool_saturated', 'quota_exceeded', 'upstream_timeout', 'request_timeout', 'upstream_unavailable'].includes(candidate) ? candidate : undefined;
  return { ...(status ? { status: Number(status) } : {}), ...(code !== undefined ? { code } : {}), ...(reason ? { reason } : {}) };
}
function retryAfterMs(error) {
  const status = readFailureDetails(error).status;
  const header = error?.response?.headers?.['retry-after'];
  const seconds = typeof header === 'string' && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
  const delay = Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : typeof header === 'string' ? Math.max(0, Date.parse(header) - Date.now()) : 0;
  return Math.max(status === 429 ? 1000 : 0, Number.isFinite(delay) ? delay : 0);
}
class DeploymentProvider extends JsonRpcProvider {
  constructor(url, rps, fixedNetwork) {
    const request = new FetchRequest(url);
    request.timeout = rpcTimeoutMs;
    // Disable transport-level 429 retries, which would also repeat broadcasts.
    request.retryFunc = async () => false;
    super(request, fixedNetwork, { cacheTimeout: -1, batchMaxCount: number('rpc-batch-max', 1, 12), staticNetwork: fixedNetwork !== undefined });
    this.requestSpacing = rps ? Math.ceil(1000 / rps) + 10 : 0;
    this.nextRequestAt = 0;
    this.requestQueue = Promise.resolve();
  }
  async _send(payload) {
    if (Array.isArray(payload) && payload.length > 1 && payload.some(x => !retryableReadMethods.has(x.method))) {
      // Ethers can group unrelated requests. Never put a send in an HTTP batch
      // or repeat it when retrying a read from the same original group.
      const results = [];
      let reads = [];
      const flushReads = async () => {
        if (reads.length) { results.push(...await this._send(reads)); reads = []; }
      };
      for (const request of payload) {
        if (retryableReadMethods.has(request.method)) reads.push(request);
        else { await flushReads(); results.push(...await this._send(request)); }
      }
      await flushReads();
      return results;
    }
    const methods = (Array.isArray(payload) ? payload : [payload]).map(x => x.method);
    const readOnly = methods.every(method => retryableReadMethods.has(method));
    const operation = this.requestQueue.then(async () => {
      const deadline = Date.now() + 60_000;
      for (let attempt = 1; attempt <= (readOnly ? 6 : 1); ++attempt) {
        const wait = this.nextRequestAt - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        let response, failure;
        try { response = await super._send(payload); }
        catch (error) { failure = error; }
        finally { this.nextRequestAt = Date.now() + this.requestSpacing; }
        const errors = failure ? [failure] : response.filter(x => x.error).map(x => x.error);
        if (!errors.length) return response;
        const details = errors.map(readFailureDetails);
        const publicPoolBusy = details.every(x => x.status === 429 && x.reason === 'public_pool_busy');
        const maximumAttempts = readOnly ? publicPoolBusy ? 6 : 3 : 1;
        const retryAfter = Math.max(...errors.map(retryAfterMs));
        this.nextRequestAt = Math.max(this.nextRequestAt, Date.now() + retryAfter);
        const delay = Math.max(500 * attempt, retryAfter);
        const retry = readOnly && errors.every(transientReadFailure) && attempt < maximumAttempts &&
          retryAfter <= 60_000 && (!publicPoolBusy || Date.now() + Math.max(delay, this.requestSpacing) + rpcTimeoutMs <= deadline);
        if (readOnly) log({ event: retry ? 'rpc_read_retry' : 'rpc_read_failed', methods, attempt, maximumAttempts, ...details[0] });
        if (!retry) {
          if (failure) throw failure;
          return response;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    });
    this.requestQueue = operation.catch(() => {});
    return operation;
  }
}

async function connection(expectedChain) {
  if (!options.rpc) throw Error('--rpc is required');
  const rps = Number(options['rpc-rps'] ?? (BigInt(expectedChain) === 4663n ? 3 : 0));
  if (!Number.isFinite(rps) || rps < 0 || rps > 1000) throw Error('Invalid --rpc-rps');
  let provider = new DeploymentProvider(options.rpc, rps);
  try {
    // Verify the endpoint explicitly before pinning the production network or
    // creating any signer. Static network then avoids a chain query per read.
    const actualChain = BigInt(await provider.send('eth_chainId', []));
    if (actualChain !== BigInt(expectedChain)) throw Error('RPC chain ID does not match the requested deployment');
    if (actualChain === 4663n) {
      const nextRequestAt = provider.nextRequestAt;
      await provider.destroy();
      provider = new DeploymentProvider(options.rpc, rps, 4663);
      provider.nextRequestAt = nextRequestAt;
    }
    provider.pollingInterval = number('poll-ms', 1000, 60000);
    let signer;
    if (options['private-key-env']) {
      const key = process.env[options['private-key-env']];
      if (!key) throw Error('Selected private-key environment variable is empty');
      signer = new Wallet(key, provider);
    } else {
      const account = options.account ?? '0';
      signer = await provider.getSigner(/^\d+$/.test(account) ? Number(account) : account);
    }
    return { provider, signer, chainId: actualChain };
  } catch (error) {
    try { await provider.destroy(); } catch { /* preserve the connection error */ }
    throw error;
  }
}

const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
const same = (a, b) => canonical(a) === canonical(b);
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && getAddress(a) === getAddress(b);
const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const contractNames = ['S0ULModel', 'S0ULTokenizer', 'S0ULInference'];
function buildFingerprint(build) {
  const artifacts = Object.fromEntries(contractNames.map(name => {
    const artifact = build.contracts?.[name + '.sol']?.[name];
    if (!artifact?.evm?.bytecode?.object || !artifact?.evm?.deployedBytecode?.object || !artifact.abi) throw Error('Missing deployment artifact ' + name);
    return [name, { abi: artifact.abi, creation: keccak256('0x' + artifact.evm.bytecode.object), runtimeTemplate: keccak256('0x' + artifact.evm.deployedBytecode.object) }];
  }));
  return digest(canonical({ compiler: build.compiler, optimizerRuns: build.optimizerRuns, viaIR: build.viaIR, evmVersion: build.evmVersion, sourceSha256: build.sourceSha256, artifacts }));
}
function deploymentLock(destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const path = destination + '.lock';
  let descriptor;
  try { descriptor = openSync(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let prior;
    try { prior = json(path); } catch { throw Error('Deployment lock is unreadable; verify no other deployment is active before removing it'); }
    let alive = true;
    if (prior.host === hostname() && Number.isSafeInteger(prior.pid) && prior.pid > 0) {
      try { process.kill(prior.pid, 0); } catch (cause) { if (cause.code === 'ESRCH') alive = false; }
    }
    if (alive) throw Error('Deployment journal is locked by another process; no transaction submitted');
    unlinkSync(path);
    descriptor = openSync(path, 'wx', 0o600);
  }
  writeFileSync(descriptor, JSON.stringify({ pid: process.pid, host: hostname(), started: new Date().toISOString() }));
  return () => { closeSync(descriptor); unlinkSync(path); };
}
function gasPolicy(previous = {}) {
  if (options['max-deploy-gas'] && options['deploy-gas'] && options['max-deploy-gas'] !== options['deploy-gas']) throw Error('Use only one deployment gas cap');
  const maximum = Number(options['max-deploy-gas'] ?? options['deploy-gas'] ?? previous.maxDeployGas ?? 12_000_000);
  const margin = Number(options['gas-margin-bps'] ?? previous.marginBps ?? 2000);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(margin) || margin < 0 || margin > 10000) throw Error('Invalid deployment gas cap or margin');
  return { maxDeployGas: String(maximum), marginBps: margin };
}
function stageAt(index, manifest) {
  if (index < manifest.shards.length) return { key: 'shard:' + index, kind: 'shard', index };
  const kind = ['model', 'tokenizer', 'engine'][index - manifest.shards.length];
  if (!kind) throw Error('Deployment journal has too many transactions');
  return { key: kind, kind };
}
async function creationFor(stage, result, manifest, build) {
  if (stage.kind === 'shard') return manifest.shards[stage.index].initCodeHex;
  const name = { model: 'S0ULModel', tokenizer: 'S0ULTokenizer', engine: 'S0ULInference' }[stage.kind];
  const artifact = build.contracts[name + '.sol'][name];
  const a = manifest.constructor;
  const args = stage.kind === 'model' ? [a.config, a.sourceCheckpoint, a.manifestHash, result.shards, manifest.shards.map(x => x.runtimeKeccak256), a.shardBytes] : stage.kind === 'engine' ? [result.model, result.tokenizer] : [];
  return (await new ContractFactory(artifact.abi, artifact.evm.bytecode.object).getDeployTransaction(...args)).data;
}
function expectedModelId(result, manifest) {
  const a = manifest.constructor;
  return keccak256(AbiCoder.defaultAbiCoder().encode([
    'tuple(uint16 vocabSize,uint16 dim,uint16 layers,uint16 heads,uint16 hiddenDim,uint16 maxSeqLen,uint32 epsQ28,uint32 attentionScaleQ14)',
    'bytes32', 'bytes32', 'address[]', 'bytes32[]', 'uint32', 'uint256'
  ], [a.config, a.sourceCheckpoint, a.manifestHash, result.shards, manifest.shards.map(x => x.runtimeKeccak256), a.shardBytes, manifest.payload.nbytes]));
}
function validateJournal(result, manifest, build, sender, chainId, manifestSha256, fingerprint) {
  if (result.format !== 'gh0st-s0ul-deployment-v1' || result.journalVersion !== 2) throw Error('Resume requires a version-2 deployment journal');
  if (result.chainId !== String(chainId)) throw Error('Resume chain identity mismatch');
  if (!sameAddress(result.sender, sender)) throw Error('Resume deployer wallet mismatch');
  if (!sameHex(result.sourceCheckpoint, manifest.constructor.sourceCheckpoint) || !sameHex(result.modelManifestHash, manifest.manifestHash) || result.modelManifestSha256 !== manifestSha256) throw Error('Resume model bundle identity mismatch');
  if (result.buildFingerprint !== fingerprint || result.compiler !== build.compiler || !same(result.sourceSha256, build.sourceSha256)) throw Error('Resume compiler/build identity mismatch');
  if (!Array.isArray(result.transactions) || !Array.isArray(result.shards)) throw Error('Malformed deployment journal');
  const total = manifest.shards.length + 3;
  if (result.transactions.length > total || (result.complete && (result.transactions.length !== total || result.pending))) throw Error('Inconsistent completed deployment journal');
  const seen = new Set();
  let priorNonce = -1;
  for (let i = 0; i < result.transactions.length; ++i) {
    const entry = result.transactions[i], stage = stageAt(i, manifest);
    if (entry.key !== stage.key || entry.kind !== stage.kind || entry.index !== stage.index || typeof entry.hash !== 'string' || seen.has(entry.hash.toLowerCase()) || !Number.isSafeInteger(entry.nonce) || entry.nonce <= priorNonce) throw Error('Malformed, duplicate or unordered confirmed deployment transaction');
    seen.add(entry.hash.toLowerCase()); priorNonce = entry.nonce;
    if (!sameAddress(entry.address, entry.predictedAddress) || !sameAddress(entry.address, getCreateAddress({ from: sender, nonce: entry.nonce }))) throw Error('Confirmed deployment address/nonce mismatch');
    if (stage.kind === 'shard') { if (!sameAddress(result.shards[i], entry.address)) throw Error('Confirmed shard address differs from journal'); }
    else if (!sameAddress(result[stage.kind], entry.address) || !sameHex(result[stage.kind + 'CodeHash'], entry.runtimeCodeHash)) throw Error('Confirmed contract address/code hash differs from journal');
  }
  if (result.shards.length !== Math.min(result.transactions.length, manifest.shards.length)) throw Error('Unexpected unconfirmed shard addresses');
  for (const [offset, kind] of ['model', 'tokenizer', 'engine'].entries()) {
    if (result.transactions.length <= manifest.shards.length + offset && result[kind] !== undefined) throw Error('Unexpected unconfirmed ' + kind + ' address');
  }
  if (result.pending) {
    const p = result.pending, stage = stageAt(result.transactions.length, manifest);
    if (p.key !== stage.key || p.kind !== stage.kind || p.index !== stage.index || !Number.isSafeInteger(p.nonce) || p.nonce <= priorNonce || !sameAddress(p.predictedAddress, getCreateAddress({ from: sender, nonce: p.nonce })) || (p.hash && seen.has(p.hash.toLowerCase()))) throw Error('Malformed pending deployment transaction');
  }
}
async function verifyMined(entry, stage, data, result, manifest, build, provider, confirmed) {
  const [transaction, receipt, code] = await Promise.all([provider.getTransaction(entry.hash), provider.getTransactionReceipt(entry.hash), provider.getCode(entry.predictedAddress)]);
  if (!transaction || !receipt || receipt.status !== 1) throw Error('Deployment receipt missing or unsuccessful for ' + stage.key);
  if (transaction.to !== null || transaction.value !== 0n || !sameAddress(transaction.from, result.sender) || transaction.chainId !== BigInt(result.chainId) || transaction.nonce !== entry.nonce || !sameHex(transaction.data, data) || !sameHex(entry.creationCodeKeccak256, keccak256(data)) || !sameAddress(receipt.contractAddress, entry.predictedAddress) || !sameAddress(receipt.from, result.sender)) throw Error('Deployment transaction/receipt identity mismatch for ' + stage.key);
  if (transaction.gasLimit !== BigInt(entry.gasLimit) || BigInt(entry.gasEstimate) <= 0n || BigInt(entry.gasEstimate) > transaction.gasLimit) throw Error('Deployment gas metadata mismatch for ' + stage.key);
  const runtimeHash = keccak256(code);
  if (code === '0x') throw Error('Missing deployed code for ' + stage.key);
  if (stage.kind === 'shard' && !sameHex(runtimeHash, manifest.shards[stage.index].runtimeKeccak256)) throw Error('Deployed shard hash mismatch for ' + stage.key);
  if (stage.kind === 'tokenizer' && !sameHex(runtimeHash, keccak256('0x' + build.contracts['S0ULTokenizer.sol'].S0ULTokenizer.evm.deployedBytecode.object))) throw Error('Deployed tokenizer code differs from compiled implementation');
  if (confirmed && (!sameHex(runtimeHash, entry.runtimeCodeHash) || entry.blockNumber !== receipt.blockNumber || !sameHex(entry.blockHash, receipt.blockHash) || entry.gasUsed !== receipt.gasUsed.toString())) throw Error('Confirmed deployment code/receipt changed for ' + stage.key);
  return { ...entry, address: receipt.contractAddress, runtimeCodeHash: runtimeHash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
}
async function verifyIdentities(result, manifest, build, provider) {
  if (result.model) {
    const m = new Contract(result.model, build.contracts['S0ULModel.sol'].S0ULModel.abi, provider);
    const [identity, checkpoint, manifestPin, config, count, bytes, shardSize] = await Promise.all([m.modelId(), m.sourceCheckpoint(), m.manifestHash(), m.configuration(), m.shardCount(), m.payloadLength(), m.shardBytes()]);
    if (!sameHex(identity, expectedModelId(result, manifest)) || !sameHex(identity, result.modelId) || !sameHex(checkpoint, manifest.constructor.sourceCheckpoint) || !sameHex(manifestPin, manifest.manifestHash) || count !== BigInt(result.shards.length) || bytes !== BigInt(manifest.payload.nbytes) || shardSize !== BigInt(manifest.constructor.shardBytes)) throw Error('Model registry identity mismatch');
    for (const [key, value] of Object.entries(manifest.constructor.config)) if (config[key] !== BigInt(value)) throw Error('Model registry configuration mismatch');
    for (let i = 0; i < result.shards.length; i += 4) await Promise.all(result.shards.slice(i, i + 4).map(async (address, offset) => {
      const info = await m.shardInfo(i + offset);
      if (!sameAddress(info[0], address) || !sameHex(info[1], manifest.shards[i + offset].runtimeKeccak256)) throw Error('Model registry shard pin mismatch');
    }));
  }
  if (result.tokenizer) {
    const t = new Contract(result.tokenizer, build.contracts['S0ULTokenizer.sol'].S0ULTokenizer.abi, provider);
    if (!sameHex(await t.domainSha256(), manifest.tokenizerDomainSha256)) throw Error('Tokenizer domain identity mismatch');
  }
  if (result.engine) {
    const e = new Contract(result.engine, build.contracts['S0ULInference.sol'].S0ULInference.abi, provider);
    const [m, t, id] = await Promise.all([e.model(), e.tokenizer(), e.modelId()]);
    if (!sameAddress(m, result.model) || !sameAddress(t, result.tokenizer) || !sameHex(id, result.modelId)) throw Error('Inference engine model/tokenizer identity mismatch');
  }
}
async function deploy(build) {
  if (!options.model || !options['chain-id']) throw Error('deploy requires --model model.json and --chain-id');
  const destination = resolve(options.resume ?? options.output ?? resolve(root, 'deployments/s0ul.json'));
  if (options.resume && options.output && resolve(options.output) !== destination) throw Error('--resume and --output must identify the same deployment journal');
  const unlock = deploymentLock(destination);
  let provider;
  try {
    const resuming = options.resume !== undefined;
    if (!resuming && existsSync(destination)) throw Error('Deployment output already exists; use --resume PATH or choose a new --output');
    if (resuming && !existsSync(destination)) throw Error('Resume deployment journal does not exist');
    const prior = resuming ? json(destination) : null;
    const policy = gasPolicy(prior?.gasPolicy);
    const fingerprint = buildFingerprint(build);
    const modelPath = resolve(options.model);
    if (modelPath !== resolve(dirname(modelPath), 'model.json')) throw Error('--model must identify the verified model.json file');
    const verification = spawnSync(options.python ?? 'python', ['-m', 's0ul.solidity_export', '--verify', dirname(modelPath)], { cwd: root, encoding: 'utf8' });
    if (verification.status !== 0) throw Error('Model export integrity verification failed: ' + verification.stderr);
    const manifest = json(modelPath), manifestSha256 = digest(readFileSync(modelPath));
    const connected = await connection(number('chain-id', 0));
    provider = connected.provider;
    const { signer, chainId } = connected, sender = await signer.getAddress();
    const result = prior ?? { format: 'gh0st-s0ul-deployment-v1', journalVersion: 2, chainId: String(chainId),
      sourceCheckpoint: manifest.constructor.sourceCheckpoint, modelManifestHash: manifest.manifestHash,
      modelManifestPath: modelPath, modelManifestSha256: manifestSha256, compiler: build.compiler,
      sourceSha256: build.sourceSha256, buildFingerprint: fingerprint, sender, shards: [], transactions: [], pending: null, complete: false };
    validateJournal(result, manifest, build, sender, chainId, manifestSha256, fingerprint);
    // All confirmed entries are checked before any new signature or broadcast.
    for (let i = 0; i < result.transactions.length; i += 4) await Promise.all(result.transactions.slice(i, i + 4).map(async (entry, offset) => {
      const stage = stageAt(i + offset, manifest), data = await creationFor(stage, result, manifest, build);
      await verifyMined(entry, stage, data, result, manifest, build, provider, true);
    }));
    await verifyIdentities(result, manifest, build, provider);
    result.gasPolicy = policy;
    write(destination, result);
    const confirmations = number('confirmations', 1, 64), timeout = number('receipt-timeout-ms', 180_000);
    const maxNewDeployments = number('max-new-deployments', Number.MAX_SAFE_INTEGER);
    const expectedNextNonce = options['expected-next-nonce'] === undefined ? null : Number(options['expected-next-nonce']);
    if (expectedNextNonce !== null && (!Number.isSafeInteger(expectedNextNonce) || expectedNextNonce < 0)) throw Error('Invalid --expected-next-nonce');
    let nonceGuardChecked = expectedNextNonce === null;
    const checkNonceBeforeSigning = async nonce => {
      if (nonceGuardChecked) return;
      const current = Number(BigInt(await provider.send('eth_getTransactionCount', [sender, 'pending'])));
      if (nonce !== expectedNextNonce || current !== expectedNextNonce) throw Error('Expected next nonce differs from pending sender nonce; no transaction was signed');
      nonceGuardChecked = true;
      log({ event: 'deployment_nonce_guard_checked', nonce: expectedNextNonce });
    };
    let confirmedThisInvocation = 0;
    const saveConfirmed = async (pending, receipt) => {
      if (!receipt || receipt.status !== 1) throw Error('Deployment transaction unsuccessful; pending journal retained');
      const stage = stageAt(result.transactions.length, manifest), data = await creationFor(stage, result, manifest, build);
      const entry = await verifyMined(pending, stage, data, result, manifest, build, provider, false);
      result.transactions.push(entry);
      if (stage.kind === 'shard') result.shards.push(entry.address);
      else { result[stage.kind] = entry.address; result[stage.kind + 'CodeHash'] = entry.runtimeCodeHash; }
      if (stage.kind === 'model') result.modelId = expectedModelId(result, manifest);
      result.pending = null;
      result.totalDeploymentGas = result.transactions.reduce((sum, x) => sum + BigInt(x.gasUsed), 0n).toString();
      write(destination, result);
      await verifyIdentities(result, manifest, build, provider);
      ++confirmedThisInvocation;
      log({ event: 'deployment_confirmed', stage: stage.key, address: entry.address, hash: entry.hash, gasUsed: entry.gasUsed });
    };
    if (result.pending) {
      const p = result.pending;
      if (!p.hash) throw Error('Prepared transaction has no recorded hash; inspect the sender nonce before manual recovery. No replacement was submitted');
      const stage = stageAt(result.transactions.length, manifest), data = await creationFor(stage, result, manifest, build);
      if (!sameHex(p.creationCodeKeccak256, keccak256(data))) throw Error('Pending creation-code identity mismatch');
      const known = await provider.getTransaction(p.hash);
      if (!known || known.to !== null || known.nonce !== p.nonce || !sameAddress(known.from, sender) || !sameHex(known.data, data) || known.chainId !== chainId || known.value !== 0n) throw Error('Pending transaction missing or differs from journal; verify its hash/nonce before recovery. No replacement was submitted');
      log({ event: 'deployment_waiting', stage: p.key, hash: p.hash, predictedAddress: p.predictedAddress });
      const receipt = await provider.waitForTransaction(p.hash, confirmations, timeout);
      await saveConfirmed(p, receipt);
    }
    for (let i = result.transactions.length; i < manifest.shards.length + 3; ++i) {
      if (confirmedThisInvocation >= maxNewDeployments) {
        log({ event: 'deployment_paused', confirmedThisInvocation, confirmedTotal: result.transactions.length, maxNewDeployments });
        process.exitCode = 2;
        return;
      }
      const stage = stageAt(i, manifest), data = await creationFor(stage, result, manifest, build);
      const estimate = await provider.estimateGas({ from: sender, data, value: 0n });
      const limit = estimate + (estimate * BigInt(policy.marginBps) + 9999n) / 10000n;
      const block = await provider.getBlock('latest');
      if (limit > BigInt(policy.maxDeployGas) || (block && limit > block.gasLimit)) throw Error('Estimated deployment gas plus margin exceeds the configured cap/block limit for ' + stage.key);
      const nonce = Number(BigInt(await provider.send('eth_getTransactionCount', [sender, 'pending'])));
      if (!Number.isSafeInteger(nonce)) throw Error('Sender nonce exceeds the supported integer range');
      if (!nonceGuardChecked && nonce !== expectedNextNonce) throw Error('Expected next nonce differs from pending sender nonce; no transaction was signed');
      const pending = { ...stage, hash: null, nonce, predictedAddress: getCreateAddress({ from: sender, nonce }),
        creationCodeKeccak256: keccak256(data), gasEstimate: estimate.toString(), gasLimit: limit.toString(), submittedAt: new Date().toISOString() };
      result.pending = pending;
      // Reserve the exact nonce before sending; an ambiguous RPC send failure
      // leaves a durable marker and cannot silently restart at another nonce.
      write(destination, result);
      let transaction;
      if (signer instanceof Wallet) {
        const populated = await signer.populateTransaction({ data, nonce, gasLimit: limit, value: 0n });
        await checkNonceBeforeSigning(nonce);
        const raw = await signer.signTransaction(populated);
        pending.hash = keccak256(raw);
        write(destination, result); // hash/address are durable before broadcast
        try { transaction = await provider.broadcastTransaction(raw); }
        catch (broadcastError) {
          // A provider may accept a transaction before reporting a send error.
          // Reconcile only this exact signed hash; never retry or change nonce.
          let known;
          try { known = await provider.getTransaction(pending.hash); }
          catch { throw broadcastError; }
          if (!known) throw broadcastError;
          if (!sameHex(known.hash, pending.hash) || known.to !== null || known.nonce !== nonce ||
              !sameAddress(known.from, sender) || !sameHex(known.data, data) ||
              known.chainId !== chainId || known.value !== 0n) {
            throw Error('Broadcast reconciliation transaction differs from signed journal; no replacement was submitted');
          }
          transaction = known;
          log({ event: 'deployment_broadcast_reconciled', stage: stage.key, hash: pending.hash });
        }
      } else {
        await checkNonceBeforeSigning(nonce);
        transaction = await signer.sendTransaction({ data, nonce, gasLimit: limit, value: 0n });
        pending.hash = transaction.hash;
        write(destination, result); // durable before waiting for its receipt
      }
      if (!sameHex(transaction.hash, pending.hash)) throw Error('Broadcast transaction hash differs from the signed journal');
      log({ event: 'deployment_pending', stage: stage.key, hash: pending.hash, predictedAddress: pending.predictedAddress, gasEstimate: pending.gasEstimate, gasLimit: pending.gasLimit });
      const receipt = await provider.waitForTransaction(pending.hash, confirmations, timeout);
      await saveConfirmed(pending, receipt);
    }
    await verifyIdentities(result, manifest, build, provider);
    result.complete = true;
    result.completedAt = new Date().toISOString();
    write(destination, result);
    log({ event: prior?.complete ? 'deployment_already_complete' : 'deployment_completed', ...result });
  } finally { try { await provider?.destroy(); } finally { unlock(); } }
}

async function infer(build) {
  if (!options.deployment) throw Error('infer requires --deployment');
  const deployment = json(resolve(options.deployment));
  if (!deployment.complete) throw Error('Deployment is incomplete');
  const { provider, signer } = await connection(deployment.chainId);
  const engine = new Contract(deployment.engine, build.contracts['S0ULInference.sol'].S0ULInference.abi, signer);
  const tokenizer = new Contract(deployment.tokenizer, build.contracts['S0ULTokenizer.sol'].S0ULTokenizer.abi, provider);
  const output = resolve(options.output ?? resolve(root, 'deployments/last-inference.json'));
  const rows = number('rows', 32, 128);
  const gasLimit = BigInt(number('step-gas', rows > 32 ? 25_000_000 : 12_000_000));
  let requestId = options.session ? BigInt(options.session) : null;
  const result = { format: 'gh0st-s0ul-inference-receipts-v1', chainId: deployment.chainId,
    engine: deployment.engine, modelId: deployment.modelId, requestId, rowsPerStep: rows,
    stepGasLimit: gasLimit.toString(), transactions: [], decisions: [], pending: null, complete: false };
  const record = receipt => {
    result.transactions.push({ hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), status: receipt.status,
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash });
    result.pending = null;
    result.totalGasThisInvocation = result.transactions.reduce((sum, x) => sum + BigInt(x.gasUsed), 0n);
    write(output, result);
  };
  try {
    if (existsSync(output)) throw Error('Inference output already exists; choose a new --output to preserve its receipts and pending hash');
    if (BigInt(rows) > await engine.MAX_ROWS()) throw Error('--rows exceeds this deployed engine\'s row limit');
    if ((await engine.modelId()) !== deployment.modelId) throw Error('Engine model identity differs from deployment record');
    if ((await engine.model()).toLowerCase() !== deployment.model.toLowerCase() ||
        (await engine.tokenizer()).toLowerCase() !== deployment.tokenizer.toLowerCase()) {
      throw Error('Engine model/tokenizer addresses differ from deployment record');
    }
    const model = new Contract(deployment.model, build.contracts['S0ULModel.sol'].S0ULModel.abi, provider);
    if ((await model.modelId()) !== deployment.modelId ||
        (await model.sourceCheckpoint()).toLowerCase() !== deployment.sourceCheckpoint.toLowerCase() ||
        (await model.manifestHash()) !== deployment.modelManifestHash) {
      throw Error('Model registry identity differs from deployment record');
    }
    for (const name of ['engine', 'model', 'tokenizer']) {
      const expected = deployment[name + 'CodeHash'];
      if (expected && keccak256(await provider.getCode(deployment[name])) !== expected) throw Error('Deployed ' + name + ' code hash differs from saved record');
    }
    const sender = await signer.getAddress();
    const sendInference = async (method, args) => {
      const data = engine.interface.encodeFunctionData(method, args);
      const nonce = Number(BigInt(await provider.send('eth_getTransactionCount', [sender, 'pending'])));
      if (!Number.isSafeInteger(nonce)) throw Error('Sender nonce exceeds the supported integer range');
      const pending = { method, hash: null, nonce, from: sender, to: deployment.engine,
        chainId: deployment.chainId, requestId, calldataKeccak256: keccak256(data),
        gasLimit: gasLimit.toString(), value: '0', submittedAt: new Date().toISOString() };
      result.pending = pending;
      write(output, result);
      let transaction;
      if (signer instanceof Wallet) {
        const populated = await signer.populateTransaction({ to: deployment.engine, data, nonce, gasLimit, value: 0n });
        const raw = await signer.signTransaction(populated);
        pending.hash = keccak256(raw);
        write(output, result);
        try { transaction = await provider.broadcastTransaction(raw); }
        catch (broadcastError) {
          let known;
          try { known = await provider.getTransaction(pending.hash); } catch { throw broadcastError; }
          if (!known) throw broadcastError;
          if (!sameHex(known.hash, pending.hash) || !sameAddress(known.from, sender) ||
              !sameAddress(known.to, deployment.engine) || known.nonce !== nonce ||
              !sameHex(known.data, data) || known.chainId !== BigInt(deployment.chainId) ||
              known.value !== 0n || known.gasLimit !== gasLimit) {
            throw Error('Inference broadcast reconciliation differs from signed journal; no replacement was submitted');
          }
          transaction = known;
          log({ event: 'inference_broadcast_reconciled', method, hash: pending.hash });
        }
      } else {
        transaction = await signer.sendTransaction({ to: deployment.engine, data, nonce, gasLimit, value: 0n });
        pending.hash = transaction.hash;
        write(output, result);
      }
      if (!sameHex(transaction.hash, pending.hash)) throw Error('Inference broadcast hash differs from signed journal');
      log({ event: 'inference_pending', method, hash: pending.hash, nonce, requestId });
      const receipt = await provider.waitForTransaction(pending.hash, number('confirmations', 1, 64), number('receipt-timeout-ms', 180_000));
      if (!receipt || !sameHex(receipt.hash, pending.hash)) throw Error('Inference receipt unavailable; pending hash retained');
      record(receipt);
      if (receipt.status !== 1) throw Error('Inference transaction unsuccessful; confirmed receipt retained');
      return receipt;
    };
    if (requestId === null) {
      if (options.prompt === undefined) throw Error('Use --prompt text or --session existing-id');
      const budget = number('max-new-tokens', 16, 32);
      await engine.beginText.staticCall(options.prompt, budget);
      const receipt = await sendInference('beginText', [options.prompt, budget]);
      const event = receipt.logs.map(x => { try { return engine.interface.parseLog(x); } catch { return null; } }).find(x => x?.name === 'Begun');
      if (!event) throw Error('Missing request event');
      requestId = event.args.requestId; result.requestId = requestId; write(output, result);
      log({ event: 'request_started', requestId });
    }
    for (let i = 0; i < number('max-transactions', 20_000); i++) {
      const state = await engine.status(requestId);
      if (state.cancelled) throw Error('Request was cancelled');
      if (state.done) { result.complete = true; break; }
      if (Number(state.phase) === 16 && !result.decisions.some(x => x.generated === Number(state.generated))) {
        const [prefix, logits] = await Promise.all([engine.tokens(requestId), engine.logits(requestId)]);
        result.decisions.push({ position: Number(state.position), generated: Number(state.generated),
          prefix_ids: prefix.map(Number), logits: logits.map(Number) });
        write(output, result);
      }
      await sendInference('advance', [requestId, rows]);
      if (i % 25 === 0) { write(output, result); log({ event: 'continuation', requestId, transactions: result.transactions.length, phase: Number(state.phase), position: Number(state.position) }); }
    }
    const state = await engine.status(requestId);
    result.complete = state.done; result.saturatedValues = state.saturationCount;
    result.generatedTokenIds = (await engine.outputTokens(requestId)).map(Number);
    const content = result.generatedTokenIds.includes(2) ? result.generatedTokenIds.slice(0, result.generatedTokenIds.indexOf(2)) : result.generatedTokenIds;
    result.response = Buffer.from((await tokenizer.decode(content, false)).slice(2), 'hex').toString('utf8');
    result.totalGasThisInvocation = result.transactions.reduce((sum, x) => sum + BigInt(x.gasUsed), 0n);
    write(output, result); log(result);
    if (!result.complete) process.exitCode = 2;
  } finally { await provider.destroy(); }
}

try {
if (!['compile', 'deploy', 'infer'].includes(command)) {
  process.stdout.write('Usage: node scripts/s0ul-solidity.mjs compile|deploy|infer --name value ...\n');
  process.stdout.write('deploy: --rpc URL --chain-id ID --model model.json (--output NEW.json | --resume EXISTING.json) [--account 0 | --private-key-env NAME] [--max-deploy-gas 12000000] [--gas-margin-bps 2000] [--rpc-rps 3] [--rpc-batch-max 1] [--expected-next-nonce N] [--max-new-deployments N]\n');
  process.stdout.write('infer: --rpc URL --deployment deployment.json --prompt TEXT [--session ID] [--max-new-tokens 16] [--rows 32]\n');
  process.exitCode = 1;
} else {
  const build = options.build ? json(resolve(options.build)) : compile();
  if (command === 'compile') {
    const path = resolve(options.output ?? resolve(root, 'exports/solidity-build/contracts.json'));
    write(path, build); log({ event: 'compiled', output: path, compiler: build.compiler });
  } else if (command === 'deploy') await deploy(build);
  else await infer(build);
}
} catch (error) {
  // Ethers' full error can contain the entire signed transaction. Keep output
  // to its concise explanation (or a bounded ordinary application error).
  const message = String(error?.shortMessage ?? error?.message ?? 'Command failed').split('\n', 1)[0].slice(0, 500);
  process.stderr.write('Error: ' + message + '\n');
  process.exitCode = 1;
}
