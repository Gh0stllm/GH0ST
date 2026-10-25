// Read-only production identity/provenance audit. This file never creates a signer,
// reads a signing key, sends a transaction, or changes LayerZero configuration.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AbiCoder, Interface, getAddress, getCreateAddress, keccak256, ZeroAddress, ZeroHash } from 'ethers';
import { compile, assertSourcesUnchanged, HERE, json } from './build.mjs';
import { makePlan, MODEL_ID, canonicalJson, tensorLayout } from './plan.mjs';

const coder = AbiCoder.defaultAbiCoder();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const hex = n => '0x' + BigInt(n).toString(16);
const digestPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt']);

class VerificationError extends Error {
  constructor(code, stage = null) { super(code); this.code = code; this.stage = stage; }
}
const requireThat = (condition, code) => { if (!condition) throw new VerificationError(code); };
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const validAddress = value => typeof value === 'string' && addressPattern.test(value) && !equal(value, ZeroAddress);
const validHash = value => typeof value === 'string' && digestPattern.test(value) && !equal(value, ZeroHash);

export const SUPPORTED_ENGINES = Object.freeze(['GPT2Shard', 'GPT2ShardOptimized']);
const TRUSTED_ROUTE_FILES = Object.freeze(['config/chains.json', 'config/chains.optimized.json']);

// The runtime manifest selects audited local sources, never supplied bytecode or arbitrary JSON.
export function resolveProductionSelection(config = {}) {
  const engineContract = config.engineContract ?? 'GPT2Shard';
  requireThat(SUPPORTED_ENGINES.includes(engineContract), 'CONFIG_ENGINE_NOT_ALLOWED');
  const requested = config.routeConfiguration ?? 'config/chains.json';
  requireThat(typeof requested === 'string', 'CONFIG_ROUTE_FILE_NOT_ALLOWED');
  const resolved = path.resolve(HERE, requested);
  const routeConfiguration = TRUSTED_ROUTE_FILES.find(name => path.resolve(HERE, name) === resolved);
  requireThat(Boolean(routeConfiguration), 'CONFIG_ROUTE_FILE_NOT_ALLOWED');
  requireThat(fs.realpathSync(resolved) === path.resolve(fs.realpathSync(HERE), routeConfiguration), 'CONFIG_ROUTE_FILE_SYMLINK');
  const bytes = fs.readFileSync(resolved);
  const routeConfigurationSha256 = hash(bytes);
  requireThat(config.routeConfigurationSha256 === undefined
    || config.routeConfigurationSha256 === routeConfigurationSha256, 'CONFIG_ROUTE_FILE_HASH');
  return {engineContract, routeConfiguration, routeConfigurationSha256, configuration: JSON.parse(bytes)};
}

export function nativeTransactionGasCeiling(chain, plannedChain = chain) {
  const nativeMaximum = chain.chainId === 143 && chain.key === 'monad' ? 30000000n : 16777216n;
  const configuredMaximum = BigInt(plannedChain.maxTransactionGas ?? nativeMaximum);
  requireThat(configuredMaximum > 100000n && configuredMaximum <= nativeMaximum, 'CONFIG_NATIVE_GAS_CEILING');
  return configuredMaximum;
}

export function validateRuntimeConfig(config, plan) {
  const selection = resolveProductionSelection(config);
  requireThat(config?.schemaVersion === 1, 'CONFIG_SCHEMA');
  requireThat(config.enabled === undefined || typeof config.enabled === 'boolean', 'CONFIG_ENABLED');
  requireThat(equal(config.modelId, MODEL_ID) && equal(config.modelId, plan.modelId), 'CONFIG_MODEL_ID');
  requireThat(validHash(config.routeId) && equal(config.routeId, plan.routeId), 'CONFIG_ROUTE_ID');
  requireThat(validHash(config.sessionId), 'CONFIG_SESSION_ID');
  requireThat(Array.isArray(config.chains) && config.chains.length === plan.stages.length, 'CONFIG_ROUTE_LENGTH');
  requireThat(typeof config.verificationFile === 'string' && config.verificationFile.length > 0
    && config.verificationFile.endsWith('.json'), 'CONFIG_VERIFICATION_FILE');
  for (const optionalAddress of ['admin', 'requester']) {
    requireThat(config[optionalAddress] === undefined || validAddress(config[optionalAddress]), 'CONFIG_OPTIONAL_ADDRESS');
  }
  requireThat(config.deadline === undefined || safeInteger(config.deadline), 'CONFIG_DEADLINE');
  config.chains.forEach((chain, stage) => {
    const expected = plan.stages[stage];
    requireThat(chain.stage === stage && chain.key === expected.key
      && chain.chainId === expected.chainId && chain.eid === expected.eid, 'CONFIG_STAGE_IDENTITY');
    requireThat(/^[a-z][a-z0-9_-]{0,63}$/.test(chain.key), 'CONFIG_STAGE_KEY');
    requireThat(typeof chain.rpcEnv === 'string' && /^[A-Z][A-Z0-9_]*$/.test(chain.rpcEnv), 'CONFIG_RPC_ENV');
    for (const field of ['router', 'engine', 'root']) requireThat(validAddress(chain[field]), 'CONFIG_DEPLOYED_ADDRESS');
    requireThat(new Set([chain.router, chain.engine, chain.root].map(x => x.toLowerCase())).size === 3, 'CONFIG_ADDRESS_COLLISION');
    requireThat(validHash(chain.engineDeploymentTx) && validHash(chain.routerDeploymentTx), 'CONFIG_CREATION_TRANSACTION');
    requireThat(safeInteger(chain.deploymentBlock), 'CONFIG_DEPLOYMENT_BLOCK');
    requireThat(chain.confirmations === undefined || (safeInteger(chain.confirmations) && chain.confirmations >= 1), 'CONFIG_CONFIRMATIONS');
    try {
      requireThat(chain.engineContract === undefined || chain.engineContract === selection.engineContract, 'CONFIG_CHAIN_ENGINE');
      requireThat(BigInt(chain.maxTransactionGas) > 100000n && BigInt(chain.maxTransactionGas) <= nativeTransactionGasCeiling(chain, expected),
        'CONFIG_TRANSACTION_GAS');
      requireThat(BigInt(chain.maxMessageFeeWei) >= 0n, 'CONFIG_MESSAGE_FEE');
    } catch (error) {
      if (error instanceof VerificationError) throw error;
      throw new VerificationError('CONFIG_GAS_OR_FEE');
    }
  });
  return config;
}

// Model identity commits tensor bytes, so independently bind their packing/order
// to the exact addressing scheme implemented by GPT2Shard._row/_nextRow.
export function verifyManifestLayout(manifest) {
  requireThat(Array.isArray(manifest.tensors) && manifest.tensors.length === 77, 'MANIFEST_TENSOR_COUNT');
  for (let id = 0; id < 77; id++) {
    const tensor = manifest.tensors[id], layout = tensorLayout(id);
    const rowsPerShard = Math.floor(24575 / layout.row_bytes);
    requireThat(tensor.id === id && tensor.rows === layout.rows && tensor.width === layout.width
      && tensor.row_bytes === layout.row_bytes && tensor.rows_per_shard === rowsPerShard
      && tensor.bytes === layout.rows * layout.row_bytes, 'MANIFEST_TENSOR_LAYOUT');
    requireThat(Array.isArray(tensor.shards) && tensor.shards.length === Math.ceil(layout.rows / rowsPerShard), 'MANIFEST_SHARD_COUNT');
    tensor.shards.forEach((shard, index) => {
      const firstRow = index * rowsPerShard;
      const rows = Math.min(rowsPerShard, layout.rows - firstRow);
      requireThat(shard.file === undefined || shard.file === tensor.file, 'MANIFEST_SHARD_FILE');
      requireThat(shard.first_row === firstRow && shard.rows === rows
        && shard.offset === firstRow * layout.row_bytes && shard.length === rows * layout.row_bytes
        && shard.runtime_bytes === 1 + rows * layout.row_bytes, 'MANIFEST_SHARD_LAYOUT');
    });
  }
}

function rpcClient(url, stage) {
  let id = 0, requests = 0;
  // URL and transport error details remain private, including embedded RPC tokens.
  let parsed;
  try { parsed = new URL(url); } catch { throw new VerificationError('RPC_URL_INVALID', stage); }
  requireThat(['http:', 'https:'].includes(parsed.protocol), 'RPC_URL_PROTOCOL');
  async function request(method, params = []) {
    requireThat(READ_METHODS.has(method), 'NON_READ_RPC_FORBIDDEN');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        requests++;
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(30000), redirect: 'error' });
        if (!response.ok) throw new Error('transport');
        const body = await response.json();
        if (body.error || !Object.hasOwn(body, 'result')) throw new Error('rpc');
        return body.result;
      } catch {
        if (attempt === 2) throw new VerificationError('RPC_READ_FAILED_' + method, stage);
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }
  return { request, requestCount: () => requests };
}

function codeBytes(code) {
  requireThat(typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code), 'DEPLOYED_CODE_ABSENT');
  return Buffer.from(code.slice(2), 'hex');
}

function addressTable(code, count) {
  const bytes = codeBytes(code);
  requireThat(bytes.length === 1 + 32 * count && bytes[0] === 0, 'CATALOG_FORMAT');
  return Array.from({ length: count }, (_, i) => {
    const word = bytes.subarray(1 + i * 32, 1 + (i + 1) * 32);
    requireThat(word.subarray(0, 12).equals(Buffer.alloc(12)), 'CATALOG_ADDRESS_PADDING');
    return getAddress('0x' + word.subarray(12).toString('hex'));
  });
}

async function parallelMap(items, concurrency, fn) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await fn(items[index], index);
    }
  }));
  return output;
}

export async function verifyCreation({ rpc, chain, address, transactionHash, artifact, blockTag, expectedArgs }) {
  const [transaction, receipt] = await Promise.all([
    rpc.request('eth_getTransactionByHash', [transactionHash]), rpc.request('eth_getTransactionReceipt', [transactionHash]),
  ]);
  requireThat(transaction && receipt && equal(transaction.hash, transactionHash)
    && equal(receipt.transactionHash, transactionHash), 'CREATION_TRANSACTION_ABSENT');
  requireThat(transaction.to === null && receipt.status === '0x1' && equal(receipt.contractAddress, address), 'CREATION_TRANSACTION_KIND');
  requireThat(validAddress(transaction.from) && equal(getCreateAddress({ from: transaction.from, nonce: transaction.nonce }), address), 'CREATION_ADDRESS_DERIVATION');
  requireThat(transaction.blockNumber !== null && BigInt(transaction.blockNumber) <= BigInt(blockTag)
    && equal(transaction.blockNumber, receipt.blockNumber) && equal(transaction.blockHash, receipt.blockHash), 'CREATION_TRANSACTION_BLOCK');
  const deployedBlock = await rpc.request('eth_getBlockByNumber', [transaction.blockNumber, false]);
  requireThat(deployedBlock && equal(deployedBlock.hash, receipt.blockHash), 'CREATION_TRANSACTION_REORG');
  requireThat(BigInt(chain.deploymentBlock) <= BigInt(transaction.blockNumber), 'CONFIG_LOG_START_AFTER_DEPLOYMENT');
  requireThat(BigInt(blockTag) - BigInt(transaction.blockNumber) + 1n >= BigInt(chain.confirmations ?? 1), 'CREATION_CONFIRMATIONS');
  const prefix = '0x' + artifact.evm.bytecode.object;
  const input = transaction.input ?? transaction.data;
  requireThat(typeof input === 'string' && input.toLowerCase().startsWith(prefix.toLowerCase()), 'CREATION_BYTECODE_MISMATCH');
  const iface = new Interface(artifact.abi);
  const types = iface.deploy.inputs.map(item => item.format('sighash'));
  let args;
  try { args = coder.decode(types, '0x' + input.slice(prefix.length)); }
  catch { throw new VerificationError('CREATION_ARGUMENTS_INVALID'); }
  requireThat(equal(input, prefix + iface.encodeDeploy(args).slice(2)), 'CREATION_ARGUMENTS_NONCANONICAL');
  expectedArgs(args);
  requireThat(BigInt(transaction.value ?? 0) === 0n, 'CREATION_VALUE_UNEXPECTED');
  const actualCode = await rpc.request('eth_getCode', [address, blockTag]);
  codeBytes(actualCode);
  // eth_call runs the audited constructor in a discarded state overlay. This
  // derives every immutable patch; it sends no transaction and changes no state.
  const replayedCode = await rpc.request('eth_call', [{ from: transaction.from, data: input,
    value: transaction.value ?? '0x0', gas: transaction.gas }, blockTag]);
  requireThat(equal(actualCode, replayedCode), 'IMMUTABLE_PATCHED_RUNTIME_MISMATCH');
  return { args, code: actualCode, codeHash: keccak256(actualCode), deploymentTx: transactionHash,
    deploymentBlock: Number(BigInt(transaction.blockNumber)), deploymentBlockHash: transaction.blockHash,
    deployer: getAddress(transaction.from), runtimeVerification: 'exact audited creation input and discarded constructor replay' };
}

async function verifyWeights({ rpc, root, rootCode, stagePlan, manifest, dataDirectory, blockTag, progress }) {
  const roots = addressTable(rootCode, 77), needed = new Set(stagePlan.tensorIds);
  roots.forEach((address, id) => requireThat(needed.has(id) ? !equal(address, ZeroAddress) : equal(address, ZeroAddress), 'ROOT_TENSOR_COVERAGE'));
  let weightShards = 0, catalogs = 1, payloadBytes = 0;
  const tensors = [], catalogHashes = [{ address: root, codeHash: keccak256(rootCode) }];
  for (const id of stagePlan.tensorIds) {
    const tensor = manifest.tensors[id], shardCount = tensor.shards.length;
    const catalogCode = await rpc.request('eth_getCode', [roots[id], blockTag]);
    catalogHashes.push({ address: roots[id], codeHash: keccak256(catalogCode) }); catalogs++;
    let shardAddresses;
    if (shardCount > 767) {
      const pages = addressTable(catalogCode, Math.ceil(shardCount / 767));
      shardAddresses = [];
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        requireThat(!equal(pages[pageIndex], ZeroAddress), 'CATALOG_PAGE_ABSENT');
        const pageCode = await rpc.request('eth_getCode', [pages[pageIndex], blockTag]);
        shardAddresses.push(...addressTable(pageCode, Math.min(767, shardCount - pageIndex * 767)));
        catalogHashes.push({ address: pages[pageIndex], codeHash: keccak256(pageCode) }); catalogs++;
      }
    } else shardAddresses = addressTable(catalogCode, shardCount);
    requireThat(shardAddresses.every(address => !equal(address, ZeroAddress)), 'WEIGHT_SHARD_ADDRESS_ABSENT');
    const tensorFile = path.resolve(dataDirectory, tensor.file);
    requireThat(tensorFile.startsWith(path.resolve(dataDirectory) + path.sep), 'TENSOR_PATH_ESCAPE');
    const payload = fs.readFileSync(tensorFile), deployedHash = createHash('sha256');
    requireThat(hash(payload) === tensor.sha256, 'TENSOR_FILE_CHANGED');
    const shardCommitments = [];
    // Limit live RPC fanout. Each batch is incorporated in canonical shard order.
    for (let start = 0; start < shardCount; start += 8) {
      const batch = shardAddresses.slice(start, start + 8);
      const codes = await parallelMap(batch, 8, address => rpc.request('eth_getCode', [address, blockTag]));
      for (let offset = 0; offset < codes.length; offset++) {
        const index = start + offset, descriptor = tensor.shards[index], actual = codeBytes(codes[offset]);
        const expectedPayload = payload.subarray(descriptor.offset, descriptor.offset + descriptor.length);
        requireThat(actual.length === expectedPayload.length + 1 && actual[0] === 0
          && actual.subarray(1).equals(expectedPayload), 'WEIGHT_RUNTIME_MISMATCH');
        requireThat(hash(actual) === descriptor.runtime_sha256, 'WEIGHT_RUNTIME_HASH_MISMATCH');
        deployedHash.update(actual.subarray(1));
        shardCommitments.push({ index, address: shardAddresses[index], codeHash: keccak256(codes[offset]) });
        weightShards++; payloadBytes += expectedPayload.length;
      }
      if (weightShards % 128 < 8) progress?.({ stage: stagePlan.stage, phase: 'VERIFYING_WEIGHTS', verifiedShards: weightShards });
    }
    const actualTensorHash = deployedHash.digest('hex');
    requireThat(actualTensorHash === tensor.sha256, 'DEPLOYED_TENSOR_HASH_MISMATCH');
    tensors.push({ id, sha256: actualTensorHash, shards: shardCount,
      deployedShardCommitment: hash(canonicalJson(shardCommitments)) });
  }
  requireThat(weightShards === stagePlan.weightContracts && payloadBytes === stagePlan.payloadBytes
    && catalogs === stagePlan.catalogContracts, 'WEIGHT_COVERAGE_TOTALS');
  return { verifiedWeightShards: weightShards, verifiedCatalogs: catalogs, verifiedPayloadBytes: payloadBytes,
    tensorCoverage: tensors, deployedCatalogCommitment: hash(canonicalJson(catalogHashes)),
    fullWeightCoverageHash: hash(canonicalJson(tensors)) };
}

export async function verifyDeployment({ config, dataDirectory, progress = () => {} }) {
  let plan, manifest, built, selection;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'manifest.json')));
    verifyManifestLayout(manifest);
    selection = resolveProductionSelection(config);
    plan = makePlan(dataDirectory, { verify: true, configuration: selection.configuration });
    validateRuntimeConfig(config, plan);
    built = compile();
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError('LOCAL_MODEL_OR_BUILD_INVALID');
  }
  const endpointInterface = new Interface(['function eid() view returns (uint32)']);
  const report = { schemaVersion: 1, status: 'VERIFYING', startedAt: new Date().toISOString(),
    modelId: config.modelId, routeId: config.routeId, sessionId: config.sessionId,
    engineContract: selection.engineContract, routeConfiguration: selection.routeConfiguration,
    routeConfigurationSha256: selection.routeConfigurationSha256,
    compilerSourcesHash: built.compiler.sources_commitment_sha256,
    compilerVersion: built.compiler.version, manifestSha256: plan.manifestSha256,
    checkpointSha256: plan.checkpointSha256, messagingReady: false,
    transportScope: 'contract and weight provenance only; no DVN, executor, pathway readiness, fees, or finality attested',
    transactionBroadcasts: 0, readOnly: true,
    rpcTrust: 'Configured RPC snapshots are trusted; this is not a light-client or consensus proof.', chains: [] };
  let commonDeadline;
  for (let stage = 0; stage < config.chains.length; stage++) {
    const chain = config.chains[stage], stagePlan = plan.stages[stage];
    try {
      const url = process.env[chain.rpcEnv];
      requireThat(typeof url === 'string' && url.length > 0, 'RPC_ENV_MISSING');
      const rpc = rpcClient(url, stage);
      requireThat(BigInt(await rpc.request('eth_chainId')) === BigInt(chain.chainId), 'RPC_CHAIN_ID_MISMATCH');
      const block = await rpc.request('eth_getBlockByNumber', ['latest', false]);
      requireThat(block && validHash(block.hash) && typeof block.number === 'string', 'SNAPSHOT_BLOCK_INVALID');
      const blockTag = block.number;
      const routerInterface = new Interface(built.artifacts.GPT2InferenceOApp.abi);
      const engineArtifact = built.artifacts[selection.engineContract];
      requireThat(Boolean(engineArtifact?.evm.bytecode.object), 'ENGINE_ARTIFACT_MISSING');
      const engineInterface = new Interface(engineArtifact.abi);
      async function call(address, iface, method, args = []) {
        const result = await rpc.request('eth_call', [{ to: address, data: iface.encodeFunctionData(method, args) }, blockTag]);
        try { return iface.decodeFunctionResult(method, result)[0]; }
        catch { throw new VerificationError('CONTRACT_READ_INVALID'); }
      }
      const routerCall = (method, args) => call(chain.router, routerInterface, method, args);
      const engineCall = (method, args) => call(chain.engine, engineInterface, method, args);
      const rootCode = await rpc.request('eth_getCode', [chain.root, blockTag]);
      addressTable(rootCode, 77);
      const rootCodeHash = keccak256(rootCode);
      const endpointAddress = await routerCall('endpoint');
      requireThat(equal(endpointAddress, stagePlan.endpointV2), 'LAYERZERO_ENDPOINT_ADDRESS');
      const endpointCode = await rpc.request('eth_getCode', [endpointAddress, blockTag]); codeBytes(endpointCode);
      requireThat(Number(await call(endpointAddress, endpointInterface, 'eid')) === chain.eid, 'LAYERZERO_ENDPOINT_ID');
      const next = config.chains[(stage + 1) % config.chains.length];
      const previous = config.chains[(stage + config.chains.length - 1) % config.chains.length];
      requireThat(await routerCall('routeSealed') === true && equal(await routerCall('engine'), chain.engine), 'ROUTER_BINDING');
      for (const field of ['modelId', 'routeId', 'sessionId']) requireThat(equal(await routerCall(field), config[field]), 'ROUTER_IDENTITY');
      requireThat(Number(await routerCall('stage')) === stage
        && Number(await routerCall('routeLength')) === config.chains.length, 'ROUTER_STAGE');
      for (let index = 0; index < config.chains.length; index++) {
        requireThat(Number(await routerCall('eids', [index])) === config.chains[index].eid, 'ROUTER_ORDERED_EIDS');
      }
      requireThat(Number(await routerCall('nextEid')) === next.eid
        && Number(await routerCall('previousEid')) === previous.eid, 'ROUTER_RING');
      for (const peer of [previous, next]) {
        requireThat(equal(await routerCall('peers', [peer.eid]), '0x' + '0'.repeat(24) + peer.router.slice(2)), 'ROUTER_PEER');
      }
      requireThat(equal(await engineCall('controller'), chain.router) && equal(await engineCall('modelId'), config.modelId)
        && equal(await engineCall('manifest'), chain.root) && equal(await engineCall('manifestCodeHash'), rootCodeHash), 'ENGINE_BINDING');
      requireThat(Number(await engineCall('firstLayer')) === stagePlan.layerRange[0]
        && Number(await engineCall('endLayer')) === stagePlan.layerRange[1]
        && await engineCall('doesEmbedding') === stagePlan.doesEmbedding
        && await engineCall('doesOutput') === stagePlan.doesOutput, 'ENGINE_PARTITION');
      const requester = await routerCall('requester'), owner = await routerCall('owner'), deadline = await routerCall('deadline');
      requireThat(validAddress(requester) && validAddress(owner) && BigInt(deadline) >= BigInt(block.timestamp), 'ROUTER_AUTHORITY_OR_DEADLINE');
      requireThat(config.requester === undefined || equal(requester, config.requester), 'ROUTER_REQUESTER');
      requireThat(config.deadline === undefined || BigInt(deadline) === BigInt(config.deadline), 'ROUTER_DEADLINE');
      commonDeadline ??= BigInt(deadline);
      requireThat(BigInt(deadline) === commonDeadline, 'ROUTE_DEADLINES_DIFFER');
      const routerCreation = await verifyCreation({ rpc, chain, address: chain.router, transactionHash: chain.routerDeploymentTx,
        artifact: built.artifacts.GPT2InferenceOApp, blockTag, expectedArgs: args => {
          requireThat(equal(args[0], endpointAddress) && validAddress(args[1]) && equal(args[2], requester)
            && equal(args[3], config.modelId) && equal(args[4], config.routeId) && equal(args[5], config.sessionId)
            && Number(args[6]) === stage && args[7].length === config.chains.length
            && args[7].every((eid, index) => Number(eid) === config.chains[index].eid)
            && BigInt(args[8]) === BigInt(deadline), 'ROUTER_CREATION_ARGUMENTS');
          requireThat(config.admin === undefined || equal(args[1], config.admin), 'ROUTER_DEPLOYMENT_ADMIN');
        } });
      const engineCreation = await verifyCreation({ rpc, chain, address: chain.engine, transactionHash: chain.engineDeploymentTx,
        artifact: engineArtifact, blockTag, expectedArgs: args => {
          requireThat(equal(args[0], chain.root) && equal(args[1], rootCodeHash) && equal(args[2], config.modelId)
            && BigInt(args[3]) === BigInt(chain.chainId) && Number(args[4]) === stagePlan.layerRange[0]
            && Number(args[5]) === stagePlan.layerRange[1] && args[6] === stagePlan.doesEmbedding
            && args[7] === stagePlan.doesOutput && equal(args[8], chain.router), 'ENGINE_CREATION_ARGUMENTS');
        } });
      const nextPosition = Number(await routerCall('nextPosition')), phase = Number(await engineCall('phase'));
      const enginePosition = Number(await engineCall('position'));
      requireThat(nextPosition >= 0 && nextPosition <= 1024 && enginePosition >= 0 && enginePosition < 1024
        && phase >= 0 && phase <= 13, 'SESSION_STATE_BOUNDS');
      const active = await routerCall('active'), awaitingActivation = await routerCall('awaitingActivation');
      const dispatched = await routerCall('dispatched'), pendingInputToken = Number(await routerCall('pendingInputToken'));
      requireThat(!(active && awaitingActivation) && pendingInputToken < 50257, 'SESSION_PENDING_STATE');
      const terminalPhase = stagePlan.doesOutput ? 12 : 13;
      if (active) {
        requireThat(enginePosition === nextPosition && phase > 0
          && Number(await engineCall('pendingToken')) === pendingInputToken, 'SESSION_ACTIVE_ENGINE');
        if (dispatched) requireThat(stage === 0 && phase === 13, 'SESSION_DISPATCH_STATE');
      } else if (nextPosition === 0) {
        requireThat(phase === 0 && enginePosition === 0, 'SESSION_INITIAL_ENGINE');
      } else {
        requireThat(enginePosition + 1 === nextPosition && phase === terminalPhase, 'SESSION_COMPLETED_ENGINE');
      }
      if (stage === 0) {
        requireThat(!awaitingActivation && Number(await routerCall('finalizedCount')) === nextPosition, 'SESSION_HOME_SEQUENCE');
      }
      progress({ stage, phase: 'VERIFYING_WEIGHTS', verifiedShards: 0, totalShards: stagePlan.weightContracts });
      const weights = await verifyWeights({ rpc, root: chain.root, rootCode, stagePlan, manifest, dataDirectory, blockTag, progress });
      const endBlock = await rpc.request('eth_getBlockByNumber', [blockTag, false]);
      requireThat(endBlock && equal(endBlock.hash, block.hash), 'SNAPSHOT_REORG');
      requireThat(BigInt(await rpc.request('eth_chainId')) === BigInt(chain.chainId), 'RPC_CHAIN_ID_CHANGED');
      report.chains.push({ key: chain.key, stage, chainId: chain.chainId, eid: chain.eid,
        engineContract: selection.engineContract,
        router: getAddress(chain.router), engine: getAddress(chain.engine), root: getAddress(chain.root),
        routerCodeHash: routerCreation.codeHash, engineCodeHash: engineCreation.codeHash, rootCodeHash,
        verifiedBlock: Number(BigInt(blockTag)), verifiedBlockHash: block.hash,
        endpoint: getAddress(endpointAddress), endpointCodeHash: keccak256(endpointCode),
        layerRange: stagePlan.layerRange, doesEmbedding: stagePlan.doesEmbedding, doesOutput: stagePlan.doesOutput,
        requester, owner, deploymentAdmin: routerCreation.args[1], deadline: deadline.toString(),
        routerDeploymentTx: routerCreation.deploymentTx, engineDeploymentTx: engineCreation.deploymentTx,
        routerDeploymentBlock: routerCreation.deploymentBlock, engineDeploymentBlock: engineCreation.deploymentBlock,
        routerDeploymentBlockHash: routerCreation.deploymentBlockHash, engineDeploymentBlockHash: engineCreation.deploymentBlockHash,
        runtimeVerification: routerCreation.runtimeVerification,
        sessionSnapshot: { nextPosition, enginePosition, phase, active, awaitingActivation, dispatched },
        ...weights, rpcReads: rpc.requestCount() });
      progress({ stage, phase: 'VERIFIED_STAGE', verifiedShards: weights.verifiedWeightShards });
    } catch (error) {
      if (error instanceof VerificationError) { error.stage ??= stage; throw error; }
      throw new VerificationError('STAGE_VERIFICATION_FAILED', stage);
    }
  }
  assertSourcesUnchanged(built);
  requireThat(resolveProductionSelection(config).routeConfigurationSha256 === selection.routeConfigurationSha256, 'CONFIG_ROUTE_CHANGED_DURING_VERIFICATION');
  report.status = 'PASS_VERIFIED_DEPLOYMENT';
  report.completedAt = new Date().toISOString();
  report.totals = { verifiedWeightShards: report.chains.reduce((n, c) => n + c.verifiedWeightShards, 0),
    verifiedPayloadBytes: report.chains.reduce((n, c) => n + c.verifiedPayloadBytes, 0),
    uniqueModelPayloadBytes: plan.totals.uniquePayloadBytes, duplicatedPayloadBytes: plan.totals.duplicatedPayloadBytes };
  return report;
}

function atomicReport(output, report) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = output + '.tmp-' + process.pid;
  try { fs.writeFileSync(temporary, json(report), { mode: 0o600 }); fs.renameSync(temporary, output); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export async function run(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('verify-deployment --config=deployments/runtime.json --data=data');
    console.log('Read-only: verifies audited CREATE transactions, exact deployed runtime, peers, and every model byte. Saves config.verificationFile; does not attest messaging readiness.');
    return;
  }
  requireThat(args.every(arg => /^--(?:config|data)=.+/.test(arg))
    && args.filter(arg => arg.startsWith('--config=')).length === 1
    && args.filter(arg => arg.startsWith('--data=')).length <= 1, 'CLI_ARGUMENTS');
  const configFile = path.resolve(args.find(arg => arg.startsWith('--config=')).slice(9));
  const config = JSON.parse(fs.readFileSync(configFile));
  const dataDirectory = path.resolve(args.find(arg => arg.startsWith('--data='))?.slice(7) ?? path.join(HERE, 'data'));
  requireThat(typeof config.verificationFile === 'string' && config.verificationFile.length > 0, 'CONFIG_VERIFICATION_FILE');
  const output = path.resolve(path.dirname(configFile), config.verificationFile);
  requireThat(output !== configFile && output.endsWith('.json'), 'VERIFICATION_OUTPUT_PATH');
  // Invalidate a previous PASS while reverifying. A failed new audit must never
  // leave a stale success file that a concurrently started worker can accept.
  atomicReport(output, { schemaVersion: 1, status: 'VERIFYING', messagingReady: false });
  let report;
  try {
    report = await verifyDeployment({ config, dataDirectory, progress: value => console.log(json(value).trim()) });
    atomicReport(output, report);
  } catch (error) {
    atomicReport(output, { schemaVersion: 1, status: 'VERIFICATION_FAILED', messagingReady: false,
      reason: error instanceof VerificationError ? error.code : 'LOCAL_CONFIGURATION_OR_IO_FAILED',
      ...(error instanceof VerificationError && error.stage !== null ? { stage: error.stage } : {}) });
    throw error;
  }
  console.log(json({ status: report.status, modelId: report.modelId, routeId: report.routeId,
    chains: report.chains.length, verifiedWeightShards: report.totals.verifiedWeightShards,
    messagingReady: false, transactionBroadcasts: 0 }).trim());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch(error => {
    // Never echo provider bodies, endpoints, environment values, or arbitrary error messages.
    console.error(json({ status: 'VERIFICATION_FAILED', reason: error instanceof VerificationError ? error.code : 'LOCAL_CONFIGURATION_OR_IO_FAILED',
      ...(error instanceof VerificationError && error.stage !== null ? { stage: error.stage } : {}), messagingReady: false }).trim());
    process.exitCode = 1;
  });
}
