// Offline, unsigned deployment preparation. No RPC client, signer, key or broadcast path exists here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ContractFactory, Interface, ZeroAddress, getAddress, getBytes, getCreateAddress, keccak256, zeroPadValue} from 'ethers';
import {makeJobPlan, JOB_KIND, JOB_ROUTER} from './job-plan.mjs';
import {compile, assertSourcesUnchanged, HERE, json, sha256} from './build.mjs';
import {resolveJobSelection, nativeJobGasCeiling} from './verify-job-deployment.mjs';

const STATUS = 'UNSIGNED_NEEDS_SECURITY_AND_GAS_REVIEW';
const MAX_NONCE = (1n << 64n) - 1n;
const MAX_RUNTIME = 24576;
const PER_PAGE = 767;
const requiredKeys = ['admin', 'requester', 'session-id', 'deadline', 'nonces', 'data', 'out'];
const cliKeys = new Set([...requiredKeys, 'engine', 'compute', 'executor-mode']);
const equal = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function usage() {
  return 'prepare-job-deployment.mjs --admin=0xEOA --requester=0xEOA --session-id=0xBYTES32 --deadline=UNIX_SECONDS --nonces=nonces.json --data=export-directory --out=deployments/new-directory [--summary-only]\n'
    + 'Optional: --compute=monad|opbnb (default Monad), --executor-mode=managed|self-relay (default managed), --engine=GPT2ShardOptimized.\n'
    + 'Offline only. Nonces JSON must contain one nonnegative integer per configured chain key.\n'
    + '--summary-only still verifies model bytes, addresses and hashes, but writes no raw transaction bodies.\n'
    + 'EOA status, live nonces, gas, fees and all LayerZero security settings require separate live review. No sealRoute transaction is generated.';
}

function parseArgs(args) {
  const result = {summaryOnly: false};
  for (const argument of args) {
    if (argument === '--summary-only') {
      assert(!result.summaryOnly, 'Duplicate --summary-only');
      result.summaryOnly = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    assert(match && cliKeys.has(match[1]), 'Unknown or malformed option: ' + argument.split('=')[0]);
    assert(result[match[1]] === undefined, 'Duplicate option: --' + match[1]);
    result[match[1]] = match[2];
  }
  for (const key of requiredKeys) assert(result[key], 'Missing --' + key);
  return result;
}

function integer(value, label, maximum = MAX_NONCE) {
  assert((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)), label + ' must be a nonnegative integer');
  const parsed = BigInt(value);
  assert(parsed <= maximum, label + ' exceeds its supported range');
  return parsed;
}

function checkedAddress(value, label) {
  const result = getAddress(value);
  assert(!equal(result, ZeroAddress), label + ' must be nonzero');
  return result;
}

function destination(input) {
  const target = path.resolve(HERE, input);
  const relative = path.relative(HERE, target);
  const first = relative.split(path.sep)[0];
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Output must remain inside multichain-gpt2');
  assert(['deployments', 'reports'].includes(first), 'Output must be under the ignored deployments/ or reports/ directory');
  const ignore = fs.readFileSync(path.join(HERE, '.gitignore'), 'utf8').split(/\r?\n/).map(line => line.trim());
  assert(ignore.includes(first + '/'), 'Output parent must be explicitly ignored by this project');
  assert(!fs.existsSync(target), 'Refusing to overwrite an existing output directory');
  let existing = path.dirname(target);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const realRoot = fs.realpathSync(HERE);
  const realParent = fs.realpathSync(existing);
  assert(realParent === realRoot || realParent.startsWith(realRoot + path.sep), 'Output symlink escapes the project');
  return target;
}

function creationCode(runtime) {
  assert(runtime.length > 0 && runtime.length <= MAX_RUNTIME, 'Data runtime must fit EIP-170');
  const size = runtime.length.toString(16).padStart(4, '0');
  // PUSH2 size; PUSH1 14; PUSH1 0; CODECOPY; PUSH2 size; PUSH1 0; RETURN.
  return '0x61' + size + '600e60003961' + size + '6000f3' + runtime.toString('hex');
}

function addressRuntime(addresses) {
  assert(addresses.length > 0 && addresses.length <= PER_PAGE, 'Address catalog must fit one runtime');
  return Buffer.concat([Buffer.from([0]), ...addresses.map(address => Buffer.from(zeroPadValue(address, 32).slice(2), 'hex'))]);
}

function expectedRuntime(runtime) {
  return {bytes: runtime.length, sha256: sha256(runtime), keccak256: keccak256(runtime), status: 'EXACT_DATA_RUNTIME'};
}

function readTensor(dataDirectory, tensor) {
  const filename = path.resolve(dataDirectory, tensor.file);
  const realData = fs.realpathSync(dataDirectory);
  assert(filename.startsWith(path.resolve(dataDirectory) + path.sep), 'Tensor path escapes export directory');
  const realFile = fs.realpathSync(filename);
  assert(realFile.startsWith(realData + path.sep), 'Tensor symlink escapes export directory');
  const payload = fs.readFileSync(realFile);
  assert.equal(payload.length, tensor.bytes, 'Tensor size mismatch: ' + tensor.name);
  assert.equal(sha256(payload), tensor.sha256, 'Tensor bytes changed: ' + tensor.name);
  return payload;
}

export async function prepareJobDeployment(args) {
  const options = parseArgs(args);
  const selection = resolveJobSelection({engineContract: options.engine, computeChain: options.compute, executorMode: options['executor-mode']});
  const admin = checkedAddress(options.admin, 'Admin');
  const requester = checkedAddress(options.requester, 'Requester');
  assert(/^0x[0-9a-fA-F]{64}$/.test(options['session-id']) && !/^0x0{64}$/.test(options['session-id']), 'Session ID must be nonzero bytes32');
  const sessionId = options['session-id'].toLowerCase();
  const deadline = integer(options.deadline, 'Deadline', BigInt(Number.MAX_SAFE_INTEGER));
  assert(deadline > BigInt(Math.floor(Date.now() / 1000)), 'Deadline has already passed on the preparation host');
  const out = destination(options.out);
  const dataDirectory = path.resolve(options.data);
  const nonceInputs = JSON.parse(fs.readFileSync(path.resolve(options.nonces), 'utf8'));
  assert(nonceInputs && typeof nonceInputs === 'object' && !Array.isArray(nonceInputs), 'Nonces must be a chain-key object');
  const partition = makeJobPlan(dataDirectory, {computeChain: selection.computeChain});
  assert.deepEqual(Object.keys(nonceInputs).sort(), partition.stages.map(stage => stage.key).sort(), 'Nonce keys must exactly match configured chains');
  const modelManifestPath = path.join(dataDirectory, 'manifest.json');
  const modelManifest = JSON.parse(fs.readFileSync(modelManifestPath, 'utf8'));
  const built = compile();
  const routerArtifact = built.artifacts[JOB_ROUTER];
  const engineArtifact = built.artifacts[selection.engineContract];
  assert(routerArtifact && engineArtifact, 'Production artifacts are missing');
  const routerFactory = new ContractFactory(routerArtifact.abi, routerArtifact.evm.bytecode.object);
  const engineFactory = new ContractFactory(engineArtifact.abi, engineArtifact.evm.bytecode.object);
  const routerInterface = new Interface(routerArtifact.abi);
  const eids = partition.stages.map(stage => stage.eid);
  const template = JSON.parse(fs.readFileSync(path.join(HERE, 'config/job.runtime.example.json'), 'utf8'));
  const states = partition.stages.map(stage => {
    const startNonce = integer(nonceInputs[stage.key], 'Nonce for ' + stage.key);
    assert(startNonce < MAX_NONCE, 'Starting nonce is exhausted');
    const expectedCount = (stage.role === 'home' ? 2 : stage.weightContracts + stage.catalogContracts + 4) + (selection.executorMode === 'self-relay' ? 1 : 0);
    assert(startNonce + BigInt(expectedCount) <= MAX_NONCE, 'Planned nonce range is exhausted for ' + stage.key);
    const router = getCreateAddress({from: admin, nonce: startNonce});
    return {stage, startNonce, nonce: startNonce, router, engine: null, root: null, rootCodeHash: null,
      expectedCount, count: 0, bytes: 0, creations: [], wiring: [], tensors: [], hash: createHash('sha256'), fd: null,
      filename: stage.key + (options.summaryOnly ? '.transactions.summary.jsonl' : '.transactions.jsonl')};
  });
  fs.mkdirSync(out, {recursive: true});
  assert(fs.realpathSync(out).startsWith(fs.realpathSync(HERE) + path.sep), 'Created output escaped project');
  fs.writeFileSync(path.join(out, 'INCOMPLETE'), 'Preparation is incomplete until manifest.json reports ' + STATUS + '.\n', {flag: 'wx'});
  let completed = false;
  try {
    for (const state of states) state.fd = fs.openSync(path.join(out, state.filename), 'wx');
    const append = (state, {data, to = null, kind, label, runtime = null, details = null}) => {
      assert(state.nonce < MAX_NONCE, 'Account nonce range is exhausted');
      const index = state.count++;
      const nonce = state.nonce++;
      const address = to === null ? getCreateAddress({from: admin, nonce}) : null;
      const bytes = getBytes(data);
      const dataHashes = {bytes: bytes.length, sha256: sha256(bytes), keccak256: keccak256(bytes)};
      state.bytes += bytes.length;
      const record = {schemaVersion: 2, routeKind: JOB_KIND, status: STATUS, index, id: state.stage.key + ':' + nonce,
        chainId: state.stage.chainId, from: admin, nonce: String(nonce), to, value: '0', kind, label,
        gas: null, gasPrice: null, maxFeePerGas: null, maxPriorityFeePerGas: null,
        data: options.summaryOnly ? null : data, dataOmitted: options.summaryOnly, dataHashes,
        expectedAddress: address, expectedRuntime: runtime, details};
      const line = JSON.stringify(record) + '\n';
      fs.writeSync(state.fd, line);
      state.hash.update(line);
      const descriptor = {index, nonce: String(nonce), address, kind, label, dataHashes, expectedRuntime: runtime, ...(details ?? {})};
      if (address) state.creations.push(descriptor); else state.wiring.push(descriptor);
      return descriptor;
    };

    for (const state of states) {
      const stage = state.stage;
      const routerArgs = [stage.endpointV2, admin, requester, stage.role === 'home', eids[0], eids[1], partition.routeId, sessionId, deadline];
      const routerTx = await routerFactory.getDeployTransaction(...routerArgs);
      const routerCreation = append(state, {data: routerTx.data, kind: 'router', label: 'CREATE GPT2JobOApp',
        runtime: {bytes: routerArtifact.runtimeBytes, sha256: null, keccak256: null, status: 'REQUIRES_POST_DEPLOYMENT_IMMUTABLE_VERIFICATION'},
        details: {constructorArgs: routerArgs.map(item => typeof item === 'bigint' ? String(item) : item)}});
      assert(equal(routerCreation.address, state.router), 'Router prediction changed');
      state.routerCreationIndex = routerCreation.index;
      if (selection.executorMode === 'self-relay') {
        const artifact = built.artifacts.GH0STSelfRelayExecutor;
        assert(artifact, 'Self-relay executor artifact missing');
        const args = [stage.sendLibrary, state.router, eids[1-stage.stage], stage.chainId];
        const tx = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object).getDeployTransaction(...args);
        const created = append(state, {data: tx.data, kind: 'self-relay-executor', label: 'CREATE GH0STSelfRelayExecutor',
          runtime: {bytes: artifact.runtimeBytes, sha256: null, keccak256: null, status: 'REQUIRES_POST_DEPLOYMENT_IMMUTABLE_VERIFICATION'},
          details: {constructorArgs: args}});
        state.selfRelayExecutor = created.address;
        state.selfRelayExecutorCreationIndex = created.index;
      }
      if (stage.role === 'home') continue;
      const rootEntries = new Array(77).fill(ZeroAddress);

      for (const tensorId of stage.tensorIds) {
        const tensor = modelManifest.tensors[tensorId];
        assert.equal(tensor.id, tensorId, 'Tensor ID changed');
        const payload = readTensor(dataDirectory, tensor);
        const shards = [];
        const shardIndexes = [];
        for (let shardIndex = 0; shardIndex < tensor.shards.length; ++shardIndex) {
          const shard = tensor.shards[shardIndex];
          assert(Number.isSafeInteger(shard.offset) && shard.offset >= 0 && Number.isSafeInteger(shard.length)
            && shard.length > 0 && shard.offset + shard.length <= payload.length, 'Invalid tensor shard bounds');
          const runtime = Buffer.concat([Buffer.from([0]), payload.subarray(shard.offset, shard.offset + shard.length)]);
          assert.equal(runtime.length, shard.runtime_bytes, 'Shard runtime length changed');
          assert.equal(sha256(runtime), shard.runtime_sha256, 'Shard runtime hash changed');
          const creation = append(state, {data: creationCode(runtime), kind: 'weight-shard', label: tensor.name + ' shard ' + shardIndex,
            runtime: expectedRuntime(runtime), details: {tensorId, shardIndex, offset: shard.offset, payloadBytes: shard.length}});
          shards.push(creation.address);
          shardIndexes.push(creation.index);
        }
        const pageAddresses = [];
        const pageIndexes = [];
        if (shards.length > PER_PAGE) {
          for (let offset = 0; offset < shards.length; offset += PER_PAGE) {
            const runtime = addressRuntime(shards.slice(offset, offset + PER_PAGE));
            const creation = append(state, {data: creationCode(runtime), kind: 'catalog-page', label: tensor.name + ' catalog page ' + pageAddresses.length,
              runtime: expectedRuntime(runtime), details: {tensorId, pageIndex: pageAddresses.length}});
            pageAddresses.push(creation.address);
            pageIndexes.push(creation.index);
          }
        }
        const runtime = addressRuntime(shards.length > PER_PAGE ? pageAddresses : shards);
        const catalog = append(state, {data: creationCode(runtime), kind: 'tensor-catalog', label: tensor.name + ' catalog',
          runtime: expectedRuntime(runtime), details: {tensorId, paged: shards.length > PER_PAGE}});
        rootEntries[tensorId] = catalog.address;
        state.tensors.push({id: tensorId, name: tensor.name, sha256: tensor.sha256, payloadBytes: tensor.bytes,
          shardCreationIndexes: shardIndexes, pageCreationIndexes: pageIndexes, catalogCreationIndex: catalog.index, catalog: catalog.address});
      }
      const rootRuntime = addressRuntime(rootEntries);
      const rootCreation = append(state, {data: creationCode(rootRuntime), kind: 'root', label: 'CREATE 77-slot model root', runtime: expectedRuntime(rootRuntime)});
      state.root = rootCreation.address;
      state.rootCodeHash = rootCreation.expectedRuntime.keccak256;
      state.rootCreationIndex = rootCreation.index;
      const engineArgs = [state.root, state.rootCodeHash, partition.modelId, stage.chainId,
        ...stage.layerRange, stage.doesEmbedding, stage.doesOutput, state.router];
      const engineTx = await engineFactory.getDeployTransaction(...engineArgs);
      const engineCreation = append(state, {data: engineTx.data, kind: 'engine', label: 'CREATE ' + selection.engineContract,
        runtime: {bytes: engineArtifact.runtimeBytes, sha256: null, keccak256: null, status: 'REQUIRES_POST_DEPLOYMENT_IMMUTABLE_VERIFICATION'},
        details: {constructorArgs: engineArgs}});
      state.engine = engineCreation.address;
      state.engineCreationIndex = engineCreation.index;
      assert.equal(state.creations.filter(item => item.kind === 'weight-shard').length, stage.weightContracts, 'Weight deployment count differs from validated partition');
      assert.equal(state.creations.filter(item => ['root', 'catalog-page', 'tensor-catalog'].includes(item.kind)).length, stage.catalogContracts, 'Catalog deployment count differs from validated partition');
    }

    // All router addresses are now fixed. Wiring never authorizes receipt execution by sealing.
    for (const state of states) {
      if (state.stage.role === 'compute') append(state, {to: state.router, data: routerInterface.encodeFunctionData('bindEngine', [state.engine]),
        kind: 'bind-engine', label: 'Bind the predicted ' + selection.engineContract});
      const neighbors = [...new Set([(state.stage.stage + states.length - 1) % states.length, (state.stage.stage + 1) % states.length])];
      for (const neighborIndex of neighbors) {
        const neighbor = states[neighborIndex];
        append(state, {to: state.router, data: routerInterface.encodeFunctionData('setPeer', [neighbor.stage.eid, zeroPadValue(neighbor.router, 32)]),
          kind: 'set-peer', label: 'Set fixed neighbor ' + neighbor.stage.key, details: {neighbor: neighbor.stage.key, eid: neighbor.stage.eid, peer: neighbor.router}});
      }
    }
    assertSourcesUnchanged(built);
    assert.equal(makeJobPlan(dataDirectory, {verify:false,computeChain:selection.computeChain}).routeId, partition.routeId, 'Job route changed during preparation');
    assert.equal(sha256(fs.readFileSync(modelManifestPath)), partition.manifestSha256, 'Model manifest changed during preparation');
    const chains = states.map(state => {
      assert.equal(state.count, state.expectedCount, 'Final transaction count differs from the validated partition');
      const defaults = template.chains.find(chain => chain.key === state.stage.key) ?? state.stage;
      assert(defaults?.rpcEnv, 'Missing named RPC configuration for ' + state.stage.key);
      return {key: state.stage.key, stage: state.stage.stage, role: state.stage.role, chainId: state.stage.chainId, eid: state.stage.eid, profile: state.stage.profile,
        engineContract: selection.engineContract,
        ...(selection.executorMode === 'self-relay' ? {selfRelayExecutor: state.selfRelayExecutor, selfRelayExecutorDeploymentTx: null,
          sendLibrary: state.stage.sendLibrary, receiveLibrary: state.stage.receiveLibrary, requiredDVNs: state.stage.requiredDVNs, dvnConfirmations: null} : {}),
        rpcEnv: defaults.rpcEnv, endpoint: state.stage.endpointV2, router: state.router, engine: state.engine, root: state.root,
        rootCodeHash: state.rootCodeHash, layerRange: state.stage.layerRange, doesEmbedding: state.stage.doesEmbedding, doesOutput: state.stage.doesOutput,
        routerDeploymentTx: null, engineDeploymentTx: null, deploymentBlock: 0,
        maxTransactionGas: null, maxMessageFeeWei: null, maxFeePerGasWei: null, confirmations: null,
        maximumPermittedTransactionGas: String(nativeJobGasCeiling(state.stage)),
        nonceStart: String(state.startNonce), nonceEndExclusive: String(state.nonce), transactionCount: state.count,
        transactionInputBytes: state.bytes, transactionsFile: state.filename, transactionsSha256: state.hash.digest('hex'),
        creationTxIndexes: {router: state.routerCreationIndex, selfRelayExecutor: state.selfRelayExecutorCreationIndex, root: state.rootCreationIndex, engine: state.engineCreationIndex},
        tensors: state.tensors, creations: state.creations, wiring: state.wiring};
    });
    const manifest = {schemaVersion: 2, routeKind: JOB_KIND, routerContract: JOB_ROUTER, messagingReviewed: false, status: STATUS, enabled: false, createdAt: new Date().toISOString(),
      managedExecutorStatus: partition.managedExecutorStatus,
      offline: true, publicTransactions: 0, signedTransactions: 0, rawTransactionBodiesIncluded: !options.summaryOnly,
      admin, requester, modelId: partition.modelId, routeId: partition.routeId, sessionId, deadline: Number(deadline),
      executorMode: selection.executorMode, computeChain: selection.computeChain, engineContract: selection.engineContract,
      verificationFile: 'verified.json', keyEnv: 'GH0ST_WORKER_KEY',
      ...(selection.executorMode === 'self-relay' ? {relayKeyEnv:'GH0ST_RELAYER_KEY'} : {}), compilerSourcesHash: built.compiler.sources_commitment_sha256,
      modelManifestSha256: partition.manifestSha256, checkpointSha256: partition.checkpointSha256,
      sourceCommitment: built.compiler, chains, totals: {...partition.totals,
        transactions: states.reduce((sum, state) => sum + state.count, 0), transactionInputBytes: states.reduce((sum, state) => sum + state.bytes, 0)},
      sealRouteTransactionsIncluded: false,
      pendingReview: [
        'Read-only checks must confirm every chain ID, both EOAs, the admin nonce on every network and the deployed LayerZero endpoint identity.',
        'If any admin nonce changes, discard this unsigned plan and prepare a new one. Do not reorder CREATE or wiring transactions.',
        'Estimate every transaction against its target network and set reviewed gas limits and fee caps; all gas and fee fields intentionally remain null.',
        'Independently validate send and receive message libraries, required DVNs, executor, confirmations, message limits and full-pathway fee quotes for each directed application pathway.',
        'Do not inherit DeadDVN or unsupported defaults. Endpoint security settings cannot be inferred or guessed from listed deployment addresses.',
        'Verify every deployed data runtime against its exact expected hashes and verify router/engine constructor immutables through the read-only deployment verifier.',
        'Self-relay mode additionally requires explicit source executor configuration and both official required DVNs on each send and receive library; relay service fee zero does not eliminate destination gas.',
        'Only after actual pathway security and gas review may a separately reviewed sealRoute transaction be prepared. No sealRoute transaction is present here.',
        'Fill deployment receipt hashes, block numbers, per-hop budgets and confirmation counts before enabling the worker. This file is intentionally disabled and incomplete for execution.'
      ]};
    fs.writeFileSync(path.join(out, 'manifest.json'), json(manifest), {flag: 'wx'});
    fs.writeFileSync(path.join(out, 'partition.json'), json(partition), {flag: 'wx'});
    fs.writeFileSync(path.join(out, 'compiler.json'), json(built.compiler), {flag: 'wx'});
    const readme = [STATUS, '', 'This package contains unsigned transaction requests only. Nothing was signed, broadcast or deployed.',
      options.summaryOnly ? 'SUMMARY ONLY: raw transaction bodies were intentionally omitted; re-run into a new directory without --summary-only for a full package.' : 'Per-chain transaction JSONL files contain exact input bytes. Keep their order and bind every transaction to its reviewed chain and nonce.',
      '', 'No sealRoute transaction is included. The endpoint security stack cannot be guessed.', ...manifest.pendingReview.map((item, index) => `${index + 1}. ${item}`), ''].join('\n');
    fs.writeFileSync(path.join(out, 'README.txt'), readme, {flag: 'wx'});
    fs.unlinkSync(path.join(out, 'INCOMPLETE'));
    completed = true;
    const summary = {status: STATUS, summaryOnly: options.summaryOnly, modelId: partition.modelId, routeId: partition.routeId,
      executorMode: selection.executorMode, computeChain: selection.computeChain, engineContract: selection.engineContract, routerContract: JOB_ROUTER, routeKind: JOB_KIND,
      sessionId, publicTransactions: 0, sealRouteTransactionsIncluded: false,
      chains: chains.map(chain => ({key: chain.key, nonceStart: chain.nonceStart, nonceEndExclusive: chain.nonceEndExclusive,
        router: chain.router, engine: chain.engine, root: chain.root, transactions: chain.transactionCount})), totals: manifest.totals, output: out};
    return summary;
  } finally {
    for (const state of states) if (state.fd !== null) fs.closeSync(state.fd);
    if (!completed) fs.writeFileSync(path.join(out, 'FAILED'), 'Preparation failed. Do not sign or use this directory. Prepare again in a new directory.\n', {flag: 'wx'});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log(usage());
  else prepareJobDeployment(args).then(summary => console.log(json(summary))).catch(error => {
    console.error(json({status: 'PREPARATION_FAILED', reason: error.message}));
    process.exitCode = 1;
  });
}
