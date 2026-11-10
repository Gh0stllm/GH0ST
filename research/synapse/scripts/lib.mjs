import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RESULTS = join(ROOT, 'results');
const localRequire = createRequire(join(ROOT, 'package.json'));
const sharedPackage = resolve(ROOT, '../../../recovered-model/research/v4-hook-1m/package.json');
const dependencyRequire = existsSync(join(ROOT, 'node_modules/solc'))
  ? localRequire : createRequire(sharedPackage);
export const solc = dependencyRequire('solc');
export const ethers = dependencyRequire('ethers');
export const ganache = dependencyRequire('ganache');

function packageVersion(name) {
  let directory = dirname(dependencyRequire.resolve(name));
  while (directory !== dirname(directory)) {
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
      if (pkg.name === name) return pkg.version;
    }
    directory = dirname(directory);
  }
  throw new Error(`Cannot locate package metadata: ${name}`);
}

export const versions = {
  node: process.version,
  solc: packageVersion('solc'),
  ethers: packageVersion('ethers'),
  ganache: packageVersion('ganache'),
};
assert.equal(versions.solc, '0.8.30', 'solc version must match the pinned toolchain');
assert.equal(versions.ethers, '6.13.5', 'ethers version must match the pinned toolchain');
assert.equal(versions.ganache, '7.9.2', 'Ganache version must match the pinned toolchain');

export function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
export function json(value) {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
}
export function saveJson(name, value) {
  const path = join(RESULTS, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json(value));
}
export function readJson(path) { return JSON.parse(readFileSync(join(ROOT, path), 'utf8')); }

function solidityFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? solidityFiles(path) : path.endsWith('.sol') ? [path] : [];
  });
}

export function compile() {
  const files = [...solidityFiles(join(ROOT, 'contracts')), ...solidityFiles(join(ROOT, 'scripts'))].sort();
  assert.ok(files.length, 'No Solidity sources found');
  const sources = Object.fromEntries(files.map(path => [relative(ROOT, path), { content: readFileSync(path, 'utf8') }]));
  const settings = {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'shanghai',
    metadata: { bytecodeHash: 'none' },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  };
  const input = { language: 'Solidity', sources, settings };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (output.errors ?? []).filter(error => error.severity === 'error');
  if (fatal.length) throw new Error(fatal.map(error => error.formattedMessage).join('\n'));
  const artifacts = {};
  for (const [file, contracts] of Object.entries(output.contracts)) {
    for (const [name, contract] of Object.entries(contracts)) {
      artifacts[name] = {
        source: file, name, abi: contract.abi,
        bytecode: '0x' + contract.evm.bytecode.object,
        runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
      };
    }
  }
  const manifest = {
    versions,
    compiler: solc.version(),
    settings,
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, sha256(source.content)])),
    warnings: (output.errors ?? []).filter(error => error.severity !== 'error').map(error => error.formattedMessage),
    contracts: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, {
      source: artifact.source, runtimeBytes: artifact.runtimeBytes, creationBytes: (artifact.bytecode.length - 2) / 2,
    }])),
  };
  saveJson('build/compile-input.json', input);
  saveJson('build/artifacts.json', artifacts);
  saveJson('compile-report.json', manifest);
  return { artifacts, manifest };
}

export async function localChain() {
  const eip1193 = ganache.provider({
    logging: { quiet: true },
    wallet: {
      mnemonic: 'test test test test test test test test test test test junk',
      totalAccounts: 12,
      defaultBalance: 1000,
    },
    chain: { chainId: 31337, hardfork: 'shanghai', time: new Date('2026-01-01T00:00:00Z') },
    miner: { blockGasLimit: 60_000_000, timestampIncrement: 1 },
  });
  const provider = new ethers.BrowserProvider(eip1193, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const signers = await Promise.all(Array.from({ length: 12 }, (_, index) => provider.getSigner(index)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  return { eip1193, provider, signers, addresses, close: () => eip1193.disconnect() };
}

export function receiptEvidence(label, receipt) {
  return {
    label,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    from: receipt.from,
    to: receipt.to,
    contractAddress: receipt.contractAddress,
    gasUsed: receipt.gasUsed,
    gasPrice: receipt.gasPrice,
    fee: receipt.fee,
    logs: receipt.logs.map(log => ({ address: log.address, topics: log.topics, data: log.data, index: log.index })),
  };
}

export async function transact(label, pending, receipts) {
  const transaction = await pending;
  const receipt = await transaction.wait();
  assert.equal(receipt.status, 1, `${label}: transaction failed`);
  receipts.push(receiptEvidence(label, receipt));
  return receipt;
}

export async function deploy(name, args, signer, artifacts, receipts, label = name) {
  const artifact = artifacts[name];
  assert.ok(artifact?.bytecode.length > 2, `Missing deployable artifact ${name}`);
  assert.ok(artifact.runtimeBytes <= 24_576, `${name} exceeds the EIP-170 runtime size limit`);
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
  const receipt = await contract.deploymentTransaction().wait();
  assert.equal(receipt.status, 1);
  receipts.push(receiptEvidence(`deploy:${label}`, receipt));
  await contract.waitForDeployment();
  return contract;
}

export async function expectRevert(label, action, evidence, expectedName) {
  let error;
  try {
    const result = await action();
    if (result?.wait) await result.wait();
  } catch (caught) { error = caught; }
  assert.ok(error, `${label}: expected a revert`);
  const text = [error.shortMessage, error.message, error.reason, JSON.stringify(error.info ?? {})].filter(Boolean).join(' ');
  if (expectedName) assert.ok(text.includes(expectedName), `${label}: expected ${expectedName}; got ${text}`);
  evidence.push({
    label, passed: true, expectedName: expectedName ?? null,
    message: error.shortMessage ?? error.message,
    receipt: error.receipt ? receiptEvidence(label, error.receipt) : null,
  });
  return error;
}
