import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ROOT, ethers, ganache, json, sha256, solc, versions } from '../scripts/lib.mjs';

export { ROOT, ethers, ganache, json, sha256, versions };
export const CHAIN_ID = 4663n;
export const SPONSOR = ethers.getAddress('0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6');
export const PAYMENT_TOKEN = ethers.getAddress('0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559');
export const TOKEN_ABI = [
  'function symbol() view returns(string)', 'function decimals() view returns(uint8)',
  'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
];
export const TRACE_TYPE = 'tuple(int256[8] hidden,int256[8][2] expertActivations,int256[8] merged,int256[] logits,uint16 token)';

export function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    assert.ok(name.startsWith('--'), 'Every option must start with --');
    if (['--simulate-smoke', '--help'].includes(name)) result[name.slice(2)] = true;
    else { assert.ok(argv[index + 1] && !argv[index + 1].startsWith('--'), `Missing value for ${name}`); result[name.slice(2)] = argv[++index]; }
  }
  return result;
}

export function privateOutput(directory) {
  assert.ok(directory && isAbsolute(directory), '--out must be an absolute path');
  const path = resolve(directory);
  assert.ok(path !== ROOT && !path.startsWith(ROOT + '/'), '--out must be outside the Synapse source directory');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}
export function save(directory, name, value) {
  const path = join(directory, name);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, json(value), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function readRpc(envFile) {
  let endpoint = process.env.ROBINHOOD_MAINNET_RPC_URL;
  if (!endpoint && envFile) {
    const line = readFileSync(resolve(envFile), 'utf8').split(/\r?\n/).find(value => /^\s*(?:export\s+)?ROBINHOOD_MAINNET_RPC_URL\s*=/.test(value));
    if (line) {
      endpoint = line.slice(line.indexOf('=') + 1).trim();
      if ((endpoint.startsWith('"') && endpoint.endsWith('"')) || (endpoint.startsWith("'") && endpoint.endsWith("'"))) endpoint = endpoint.slice(1, -1);
    }
  }
  return endpoint || 'https://rpc.mainnet.chain.robinhood.com';
}
export function providerFor(endpoint) {
  return new ethers.JsonRpcProvider(endpoint, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
}
export async function assertChain(provider) {
  assert.equal(BigInt(await provider.send('eth_chainId', [])), CHAIN_ID, 'Refusing non-Robinhood chain');
}
export function safeError(error) {
  // Provider errors may contain a private RPC endpoint; emit the error category only.
  return { name: error?.name || 'Error', code: error?.code || null, message: error?.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Operation failed; sensitive provider detail suppressed.' };
}

function solidityFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? solidityFiles(path) : path.endsWith('.sol') ? [path] : [];
  });
}
export function productionCompile() {
  // Reuse lib.mjs's pinned compiler and exact compile() input/settings. Existing
  // compile() writes into source/results, so compile in memory for review-only use.
  const base = JSON.parse(readFileSync(join(ROOT, 'results/build/compile-input.json'), 'utf8'));
  const files = solidityFiles(join(ROOT, 'contracts')).sort();
  const sources = Object.fromEntries(files.map(path => [relative(ROOT, path), { content: readFileSync(path, 'utf8') }]));
  assert.deepEqual(base.settings.optimizer, { enabled: true, runs: 200 });
  assert.equal(base.settings.viaIR, true);
  assert.equal(base.settings.evmVersion, 'shanghai');
  assert.deepEqual(base.settings.metadata, { bytecodeHash: 'none' });
  const input = structuredClone(base);
  input.sources = sources;
  input.settings.outputSelection = { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal((output.errors ?? []).filter(item => item.severity === 'error').length, 0, 'Solidity compilation failed');
  const artifacts = {};
  for (const [source, contracts] of Object.entries(output.contracts)) for (const [name, result] of Object.entries(contracts)) {
    if (!['SynapseBackbone', 'SynapseExpert', 'SynapseGraph', 'SynapseData', 'SynapseBackboneV2', 'SynapseExpertV2', 'SynapseGraphV2'].includes(name)) continue;
    const creation = '0x' + result.evm.bytecode.object;
    const runtime = '0x' + result.evm.deployedBytecode.object;
    assert.ok((runtime.length - 2) / 2 <= 24_576, `${name} exceeds EIP-170`);
    artifacts[name] = {
      source, name, abi: result.abi, bytecode: creation, creationBytecodeHash: ethers.keccak256(creation),
      deployedBytecode: runtime, deployedBytecodeTemplateHash: ethers.keccak256(runtime),
      immutableReferences: result.evm.deployedBytecode.immutableReferences,
      runtimeBytes: (runtime.length - 2) / 2,
    };
  }
  const manifest = {
    compiler: solc.version(), versions, settings: input.settings,
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, sha256(value.content)])),
    inputSha256: sha256(json(input)),
    warnings: (output.errors ?? []).filter(item => item.severity !== 'error').map(item => item.formattedMessage),
  };
  return { input, artifacts, manifest };
}
export function modelData(directory = 'model') {
  const path = resolve(ROOT, directory);
  assert.ok(path.startsWith(ROOT + '/'), 'Candidate model must be within the Synapse source directory');
  const get = name => JSON.parse(readFileSync(join(path, name), 'utf8'));
  const manifest = get('manifest.json');
  for (const [name, digest] of Object.entries(manifest.files ?? manifest)) assert.equal(sha256(readFileSync(join(path, name))), digest, `Model digest mismatch: ${name}`);
  const model = get('model.json');
  const alternate = get('alternate-expert.json');
  assert.equal(model.scale, 256); assert.equal(model.experts.length, 2); assert.equal(alternate.replaceExpertIndex, 1);
  assert.ok(Number.isInteger(model.contextSize) && model.contextSize >= 2);
  assert.ok(Number.isInteger(model.hiddenSize) && model.hiddenSize >= 8);
  const pack = values => '0x' + values.map(value => {
    assert.ok(Number.isSafeInteger(value) && value >= -32768 && value <= 32767, 'Invalid packed i16');
    return ((value + 65536) % 65536).toString(16).padStart(4, '0');
  }).join('');
  const packed = {
    backbone: pack([...(model.embeddings ?? [...model.embedding0, ...model.embedding1]), ...model.headWeights, ...model.headBias]),
    expert0: pack([...model.experts[0].weights, ...model.experts[0].bias]),
    expert1: pack([...model.experts[1].weights, ...model.experts[1].bias]),
    alternateExpert1: pack([...alternate.weights, ...alternate.bias]),
  };
  const kernelVersion = model.schema === 'gh0st-synapse-model-v2' ? 2 : 1;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const spaceId = kernelVersion === 2
    ? ethers.keccak256(coder.encode(['string', 'uint16', 'uint16', 'uint16', 'bytes32'], ['GH0ST_SYNAPSE_Q8_MEAN2_V2', model.vocab.length, model.contextSize, model.hiddenSize, ethers.keccak256(packed.backbone)]))
    : ethers.keccak256(coder.encode(['string', 'uint16', 'bytes32'], [`GH0ST_SYNAPSE_Q8_CTX${model.contextSize}_WIDTH${model.hiddenSize}_MEAN2_V1`, model.vocab.length, ethers.keccak256(packed.backbone)]));
  return { model, alternate, manifest, packed, spaceId, kernelVersion, directory: relative(ROOT, path), fixtures: get('fixtures.json').fixtures };
}
export function normalizedTrace(trace) {
  return { hidden: Array.from(trace.hidden, Number), expertActivations: Array.from(trace.expertActivations, row => Array.from(row, Number)), merged: Array.from(trace.merged, Number), logits: Array.from(trace.logits, Number), token: Number(trace.token) };
}
export async function dataFeeComponent(provider, to, data) {
  const oracle = new ethers.Contract('0x00000000000000000000000000000000000000C8', ['function gasEstimateL1Component(address,bool,bytes) view returns(uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)'], provider);
  const result = await oracle.gasEstimateL1Component(to ?? ethers.ZeroAddress, !to, data, { from: SPONSOR });
  return { source: 'Nitro NodeInterface gasEstimateL1Component', address: '0x00000000000000000000000000000000000000C8', gasEstimateForL1: String(result.gasEstimateForL1), baseFee: String(result.baseFee), l1BaseFeeEstimate: String(result.l1BaseFeeEstimate), dataFeeEstimateWei: String(result.gasEstimateForL1 * result.baseFee), observedAt: new Date().toISOString() };
}
export function unsignedEntry({ label, nonce, to = null, data, gasEstimate, maxFeePerGas, maxPriorityFeePerGas, l1Component }) {
  const executionGasEstimate = BigInt(gasEstimate);
  gasEstimate = executionGasEstimate + BigInt(l1Component?.gasEstimateForL1 ?? 0);
  const gasLimit = (gasEstimate * 125n + 99n) / 100n;
  assert.ok(gasLimit <= 16_777_216n, 'Padded transaction exceeds fixed 16,777,216 gas cap');
  const transaction = { type: 2, chainId: CHAIN_ID, nonce, to, data, value: 0n, gasLimit, maxFeePerGas, maxPriorityFeePerGas };
  const unsigned = ethers.Transaction.from(transaction);
  const walletTransaction = {
    from: SPONSOR, ...(to ? { to } : {}), data, value: '0x0', type: '0x2', chainId: ethers.toQuantity(CHAIN_ID),
    nonce: ethers.toQuantity(nonce), gas: ethers.toQuantity(gasLimit), maxFeePerGas: ethers.toQuantity(maxFeePerGas), maxPriorityFeePerGas: ethers.toQuantity(maxPriorityFeePerGas),
  };
  return { label, nonce, from: SPONSOR, to, value: '0', data, calldataHash: ethers.keccak256(data), executionGasEstimate: String(executionGasEstimate), l1Component, gasEstimate: String(gasEstimate), gasLimit: String(gasLimit), maxFeePerGas: String(maxFeePerGas), maxPriorityFeePerGas: String(maxPriorityFeePerGas), maxExecutionCostWei: String(gasLimit * maxFeePerGas), unsignedSerialized: unsigned.unsignedSerialized, unsignedHash: unsigned.unsignedHash, walletRequest: { method: 'eth_sendTransaction', params: [walletTransaction] } };
}
