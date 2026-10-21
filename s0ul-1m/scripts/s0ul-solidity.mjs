#!/usr/bin/env node
// Explicit CLI transactions only. This module never loads .env files.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import solc from 'solc';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, keccak256 } from 'ethers';

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
  writeFileSync(path, JSON.stringify(value, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n');
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

async function connection(expectedChain) {
  if (!options.rpc) throw Error('--rpc is required');
  const provider = new JsonRpcProvider(options.rpc);
  provider.pollingInterval = number('poll-ms', 1000, 60000);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(expectedChain)) { await provider.destroy(); throw Error('RPC chain ID does not match the requested deployment'); }
  let signer;
  if (options['private-key-env']) {
    const key = process.env[options['private-key-env']];
    if (!key) throw Error('Selected private-key environment variable is empty');
    signer = new Wallet(key, provider);
  } else {
    const account = options.account ?? '0';
    signer = await provider.getSigner(/^\d+$/.test(account) ? Number(account) : account);
  }
  return { provider, signer, chainId: network.chainId };
}

async function deploy(build) {
  if (!options.model || !options['chain-id']) throw Error('deploy requires --model model.json and --chain-id');
  const modelPath = resolve(options.model);
  if (modelPath !== resolve(dirname(modelPath), 'model.json')) throw Error('--model must identify the verified model.json file');
  // Verify every payload and shard before any transaction or signer is opened.
  const verification = spawnSync(options.python ?? 'python', ['-m', 's0ul.solidity_export', '--verify', dirname(modelPath)],
    { cwd: root, encoding: 'utf8' });
  if (verification.status !== 0) throw Error('Model export integrity verification failed: ' + verification.stderr);
  const manifest = json(modelPath);
  const { provider, signer, chainId } = await connection(number('chain-id', 0));
  const gasLimit = BigInt(number('deploy-gas', 12_000_000));
  const destination = resolve(options.output ?? resolve(root, 'deployments/s0ul.json'));
  const result = { format: 'gh0st-s0ul-deployment-v1', chainId: String(chainId),
    sourceCheckpoint: manifest.constructor.sourceCheckpoint, modelManifestHash: manifest.manifestHash,
    modelManifestPath: modelPath, compiler: build.compiler, sourceSha256: build.sourceSha256,
    sender: await signer.getAddress(), shards: [], transactions: [], complete: false };
  const record = receipt => {
    result.transactions.push({ hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber });
    write(destination, result);
  };
  const deployContract = async (file, name, args = []) => {
    const a = build.contracts[file][name];
    const contract = await new ContractFactory(a.abi, a.evm.bytecode.object, signer).deploy(...args, { gasLimit });
    const receipt = await contract.deploymentTransaction().wait();
    record(receipt);
    return contract;
  };
  try {
    for (const shard of manifest.shards) {
      if (keccak256(shard.initCodeHex) !== shard.initCodeKeccak256) throw Error('Shard init-code hash mismatch');
      const receipt = await (await signer.sendTransaction({ data: shard.initCodeHex, gasLimit })).wait();
      const address = receipt.contractAddress;
      if (keccak256(await provider.getCode(address)) !== shard.runtimeKeccak256) throw Error('Deployed shard hash mismatch');
      result.shards.push(address); record(receipt);
      log({ event: 'shard_deployed', index: shard.index, address, gas: receipt.gasUsed });
    }
    const args = manifest.constructor;
    const model = await deployContract('S0ULModel.sol', 'S0ULModel', [args.config, args.sourceCheckpoint,
      args.manifestHash, result.shards, manifest.shards.map(x => x.runtimeKeccak256), args.shardBytes]);
    result.model = await model.getAddress();
    result.modelId = await model.modelId();
    const tokenizer = await deployContract('S0ULTokenizer.sol', 'S0ULTokenizer');
    result.tokenizer = await tokenizer.getAddress();
    const engine = await deployContract('S0ULInference.sol', 'S0ULInference', [result.model, result.tokenizer]);
    result.engine = await engine.getAddress();
    result.engineCodeHash = keccak256(await provider.getCode(result.engine));
    result.modelCodeHash = keccak256(await provider.getCode(result.model));
    result.tokenizerCodeHash = keccak256(await provider.getCode(result.tokenizer));
    if ((await model.sourceCheckpoint()).toLowerCase() !== args.sourceCheckpoint.toLowerCase()) throw Error('Source checkpoint pin mismatch');
    result.complete = true;
    result.totalDeploymentGas = result.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n).toString();
    write(destination, result); log({ event: 'deployment_completed', ...result });
  } finally { await provider.destroy(); }
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
    stepGasLimit: gasLimit.toString(), transactions: [], complete: false };
  const record = receipt => result.transactions.push({ hash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
  try {
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
    if (requestId === null) {
      if (options.prompt === undefined) throw Error('Use --prompt text or --session existing-id');
      const budget = number('max-new-tokens', 16, 32);
      await engine.beginText.staticCall(options.prompt, budget);
      const receipt = await (await engine.beginText(options.prompt, budget, { gasLimit })).wait();
      const event = receipt.logs.map(x => { try { return engine.interface.parseLog(x); } catch { return null; } }).find(x => x?.name === 'Begun');
      if (!event) throw Error('Missing request event');
      requestId = event.args.requestId; result.requestId = requestId; record(receipt); write(output, result);
      log({ event: 'request_started', requestId });
    }
    for (let i = 0; i < number('max-transactions', 20_000); i++) {
      const state = await engine.status(requestId);
      if (state.cancelled) throw Error('Request was cancelled');
      if (state.done) { result.complete = true; break; }
      const receipt = await (await engine.advance(requestId, rows, { gasLimit })).wait(); record(receipt);
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

if (!['compile', 'deploy', 'infer'].includes(command)) {
  process.stdout.write('Usage: node scripts/s0ul-solidity.mjs compile|deploy|infer --name value ...\n');
  process.stdout.write('deploy: --rpc URL --chain-id ID --model model.json --output deployment.json [--account 0 | --private-key-env NAME]\n');
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
