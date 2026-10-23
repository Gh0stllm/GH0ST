// Read-only public RPC inspection and local EVM simulation. Never broadcasts to a public network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import hre from 'hardhat';
import { AbiCoder, BrowserProvider, Contract, ContractFactory, JsonRpcProvider, concat,
  formatEther, getAddress, getCreate2Address, keccak256, toBeHex, zeroPadValue } from 'ethers';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback) { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; }
const configPath = path.resolve(base, option('--config', 'deployment/robinhood-mainnet.json'));
const outputPath = path.resolve(base, option('--out', 'deployment/robinhood-mainnet-plan.json'));
const config = JSON.parse(readFileSync(configPath));
const rpcURL = option('--rpc', config.rpc_url);
const modelDirectory = path.resolve(base, option('--model', config.model_directory));
const from = option('--from', config.deployer_address);
const selectedSender = from ? getAddress(from) : null;
const sha = data => createHash('sha256').update(data).digest('hex');
const read = file => readFileSync(path.join(base, file));
const readModel = file => readFileSync(path.join(modelDirectory, file));
const abi = AbiCoder.defaultAbiCoder();
const modelFile = 'swap-speaker-535k/contracts/SentenceSpeakerModel.sol';
const hookFile = 'swap-speaker-535k/contracts/SentenceSpeakerV4Hook.sol';
const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
const standardInput = { language: 'Solidity', sources: Object.fromEntries([modelFile, hookFile]
  .map(file => [file, { content: read(file).toString() }])), settings };
const compiled = JSON.parse(solc.compile(JSON.stringify(standardInput), { import: file => {
  const filePath = path.join(base, 'node_modules', file);
  if (!existsSync(filePath)) return { error: `Missing import ${file}` };
  const content = readFileSync(filePath, 'utf8');
  standardInput.sources[file] = { content };
  return { contents: content };
} }));
assert.deepEqual((compiled.errors ?? []).filter(item => item.severity === 'error'), []);
const manifest = JSON.parse(readModel('manifest.json'));
const groups = [['core', 'core.bin', 4544], ['embeddings', 'embeddings.bin', 24000],
  ['nodes', 'nodes.bin', 23760], ['vocabulary', 'vocabulary.bin', 24000]];
for (const [, file] of groups) assert.equal(sha(readModel(file)), manifest.artifacts[file].sha256, file);

const remote = new JsonRpcProvider(rpcURL, undefined, { batchMaxCount: 1 });
let local;
try {
  const managerAddress = getAddress(config.pool_manager), factoryAddress = getAddress(config.create2_deployer);
  const [network, block, managerCode, factoryCode, gasPriceHex] = await Promise.all([
    remote.getNetwork(), remote.getBlock('latest'), remote.getCode(managerAddress),
    remote.getCode(factoryAddress), remote.send('eth_gasPrice', []),
  ]);
  assert.equal(network.chainId, BigInt(config.chain_id), 'RPC chain mismatch');
  assert.equal(keccak256(managerCode), config.pool_manager_code_hash, 'PoolManager runtime changed');
  assert.equal(keccak256(factoryCode), config.create2_deployer_code_hash, 'CREATE2 deployer runtime changed');
  const quoteGasPrice = BigInt(gasPriceHex);
  const senderState = selectedSender ? {
    address: selectedSender, pending_nonce: await remote.getTransactionCount(selectedSender, 'pending'),
    balance_wei: (await remote.getBalance(selectedSender)).toString(),
  } : null;

  // Chain ID and dependency code match the selected chain, but all writes below target only in-process Hardhat.
  await hre.network.provider.request({ method: 'hardhat_reset', params: [] });
  await hre.network.provider.request({ method: 'hardhat_setCode', params: [managerAddress, managerCode] });
  await hre.network.provider.request({ method: 'hardhat_setCode', params: [factoryAddress, factoryCode] });
  local = new BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
  local.pollingInterval = 10;
  const signer = await local.getSigner(0);
  const transactions = [], addresses = {}, commitments = {};
  const parts = [];
  for (const [group, file, chunk] of groups) {
    const bytes = readModel(file);
    let commitment = zeroPadValue('0x00', 32);
    for (let offset = 0, index = 0; offset < bytes.length; offset += chunk, index++) {
      const payload = '0x' + bytes.subarray(offset, offset + chunk).toString('hex');
      const codeHash = keccak256(concat(['0x00', payload]));
      commitment = keccak256(abi.encode(['bytes32', 'bytes32'], [commitment, codeHash]));
      parts.push({ group, index, payload, codeHash });
    }
    commitments[group] = commitment;
  }
  const coreCodeHash = parts.find(part => part.group === 'core').codeHash;
  const modelHash = keccak256(abi.encode(['string', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
    ['GH0ST_SENTENCE_SPEAKER_535K_SAMPLED_T256_V2', coreCodeHash, commitments.embeddings, commitments.nodes, commitments.vocabulary]));
  if (config.expected_model_hash) assert.equal(modelHash, config.expected_model_hash, 'Selected model hash mismatch');
  const namespace = keccak256(abi.encode(['string', 'uint256', 'bytes32'],
    ['GH0ST_SENTENCE_DEPLOY_V1', config.chain_id, modelHash]));
  const saltFor = (kind, index = 0) => keccak256(abi.encode(['bytes32', 'string', 'uint256'], [namespace, kind, index]));

  async function create(kind, file, name, constructorArguments, salt, expectedCodeHash) {
    const artifact = compiled.contracts[file][name];
    const deploy = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object).getDeployTransaction(...constructorArguments);
    const initCode = deploy.data, predicted = getCreate2Address(factoryAddress, salt, keccak256(initCode));
    const data = concat([salt, initCode]);
    const tx = await signer.sendTransaction({ to: factoryAddress, data, value: 0, gasLimit: 10_000_000 });
    const receipt = await tx.wait(), code = await local.getCode(predicted);
    assert.notEqual(code, '0x', `${kind} deployed locally`);
    const runtimeHash = keccak256(code);
    if (expectedCodeHash) assert.equal(runtimeHash, expectedCodeHash, `${kind} local runtime verified`);
    const remoteCode = await remote.getCode(predicted, block.number);
    assert.ok(remoteCode === '0x' || keccak256(remoteCode) === runtimeHash, `${kind} address has conflicting public code`);
    const entry = {
      order: transactions.length, kind, contract_name: name, predicted_address: predicted, salt,
      init_code_hash: keccak256(initCode), runtime_code_hash: runtimeHash,
      constructor_arguments: constructorArguments,
      unsigned_transaction: { chainId: config.chain_id, ...(selectedSender ? { from: selectedSender } : {}),
        to: factoryAddress, data, value: '0' },
      local_execution_gas: receipt.gasUsed.toString(), already_deployed: remoteCode !== '0x',
      public_gas_estimate: null, gas_limit_policy: 'Estimate immediately before signing, after predecessor receipts are confirmed.',
    };
    if (kind.startsWith('data:') && remoteCode === '0x') {
      const publicEstimate = await remote.estimateGas({ to: factoryAddress, data, value: 0,
        ...(selectedSender ? { from: selectedSender } : {}) });
      entry.public_gas_estimate = publicEstimate.toString();
    }
    transactions.push(entry);
    return new Contract(predicted, artifact.abi, signer);
  }

  for (const part of parts) {
    const contract = await create(`data:${part.group}:${part.index}`, modelFile, 'SentenceModelData',
      [part.payload], saltFor(part.group, part.index), part.codeHash);
    (addresses[part.group] ??= []).push(contract.target);
  }
  assert.equal(transactions.length, 57);
  const model = await create('model', modelFile, 'SentenceSpeakerModel',
    [addresses.core[0], addresses.embeddings, addresses.nodes, addresses.vocabulary], saltFor('model'));
  assert.equal(await model.modelHash(), modelHash);
  const hookArguments = [managerAddress, model.target, config.maximum_words, config.inference_gas_limit, config.initial_dynamic_lp_fee];
  const hookArtifact = compiled.contracts[hookFile].SentenceSpeakerV4Hook;
  const hookDeploy = await new ContractFactory(hookArtifact.abi, hookArtifact.evm.bytecode.object).getDeployTransaction(...hookArguments);
  let hookSalt, hookAddress, attempts = 0;
  for (; attempts < 2_000_000; attempts++) {
    hookSalt = saltFor('hook', attempts);
    hookAddress = getCreate2Address(factoryAddress, hookSalt, keccak256(hookDeploy.data));
    if ((BigInt(hookAddress) & 0x3fffn) === 0x1040n) break;
  }
  assert.ok(attempts < 2_000_000, 'valid permission salt found');
  const hook = await create('hook', hookFile, 'SentenceSpeakerV4Hook', hookArguments, hookSalt);
  assert.equal(hook.target, hookAddress);
  assert.equal(await hook.modelHash(), modelHash);
  assert.equal(await hook.poolManager(), managerAddress);

  const executionGas = transactions.reduce((sum, tx) => sum + BigInt(tx.local_execution_gas), 0n);
  const quotedShardGas = transactions.filter(tx => tx.public_gas_estimate)
    .reduce((sum, tx) => sum + BigInt(tx.public_gas_estimate), 0n);
  const plan = {
    schema_version: 1, status: 'PREPARED_UNSIGNED_NOT_BROADCAST', generated_at: new Date().toISOString(),
    network: config.network, chain_id: config.chain_id, public_rpc: rpcURL,
    observed_block: { number: block.number, hash: block.hash, timestamp: block.timestamp },
    dependencies: { pool_manager: managerAddress, pool_manager_code_hash: keccak256(managerCode),
      create2_deployer: factoryAddress, create2_deployer_code_hash: keccak256(factoryCode) },
    sender: senderState, selected_model: { directory: path.relative(base, modelDirectory), model_hash: modelHash,
      artifacts: Object.fromEntries(groups.map(([, file]) => [file, manifest.artifacts[file]])) },
    model_address: model.target, hook_address: hook.target, hook_permission_mask: '0x1040',
    hook_salt_attempts: attempts + 1, require_speech_hook_data: '0x53504b31',
    constructor: { maximum_words: config.maximum_words, inference_gas_limit: config.inference_gas_limit,
      initial_dynamic_lp_fee: config.initial_dynamic_lp_fee },
    compiler: { version: solc.version(), settings },
    source_sha256: Object.fromEntries([modelFile, hookFile, 'scripts/prepare-v4-deployment.mjs']
      .map(file => [file, sha(read(file))])),
    costs: { local_execution_gas: executionGas.toString(), observed_gas_price_wei: quoteGasPrice.toString(),
      local_execution_cost_eth_at_observed_gas_price: formatEther(executionGas * quoteGasPrice),
      public_estimated_shard_gas: quotedShardGas.toString(),
      public_estimated_shard_cost_eth: formatEther(quotedShardGas * quoteGasPrice),
      note: 'Local execution is not an all-in funding quote. Shard RPC estimates include current chain overhead. Model and hook must be estimated after dependencies exist; gas prices and data fees may change.' },
    checks: ['57 data-shard deployments locally executed and exact runtime hashes verified',
      'model constructor and model hash locally verified', 'hook constructor and permission bits locally verified',
      'public RPC chain and dependency runtime hashes verified', 'predicted public addresses checked for conflicting code'],
    transactions,
    next_steps: ['Confirm the signing wallet; rerun with --from to record its balance and pending nonce.',
      'Recheck dependency code, chain ID and expected runtime hashes before signing.',
      'Submit in listed order, estimate gas just before each transaction, and verify each receipt and runtime hash.',
      'Pool initialization and liquidity need an explicitly chosen pair, initial price and budget; they are not included.'],
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(plan, null, 2) + '\n');
  writeFileSync(path.join(path.dirname(outputPath), 'standard-input.json'), JSON.stringify(standardInput, null, 2) + '\n');
  console.log(JSON.stringify({ status: plan.status, path: outputPath, transactions: transactions.length,
    model_address: model.target, hook_address: hook.target, model_hash: modelHash, costs: plan.costs }, null, 2));
} finally {
  if (local) await local.destroy();
  await remote.destroy();
}
