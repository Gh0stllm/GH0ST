import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, ethers, json, receiptEvidence, sha256, solc, versions } from '../lib.mjs';
export { ROOT, ethers, sha256, versions };
export const RESULTS = join(ROOT, 'results/v2');

export function saveJson(name, value) {
  const path = join(RESULTS, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, json(value));
}

function solidityFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? solidityFiles(path) : path.endsWith('.sol') ? [path] : [];
  });
}

export function compile() {
  const files = [...solidityFiles(join(ROOT, 'contracts')), ...solidityFiles(join(ROOT, 'scripts'))].sort();
  const sources = Object.fromEntries(files.map(path => [relative(ROOT, path), { content: readFileSync(path, 'utf8') }]));
  const settings = {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    metadata: { bytecodeHash: 'none' },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  };
  const input = { language: 'Solidity', sources, settings };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (output.errors ?? []).filter(error => error.severity === 'error');
  if (fatal.length) throw new Error(fatal.map(error => error.formattedMessage).join('\n'));
  const artifacts = {};
  for (const [file, contracts] of Object.entries(output.contracts)) {
    for (const [name, contract] of Object.entries(contracts)) artifacts[name] = {
      source: file, name, abi: contract.abi,
      bytecode: '0x' + contract.evm.bytecode.object,
      runtimeBytecode: '0x' + contract.evm.deployedBytecode.object,
      runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
    };
  }
  const manifest = {
    versions, compiler: solc.version(), settings,
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

export const deploymentBounds = [];
export async function deploy(name, args, signer, artifacts, receipts, label = name) {
  const artifact = artifacts[name];
  assert.ok(artifact?.bytecode.length > 2, `Missing deployable artifact ${name}`);
  assert.ok(artifact.runtimeBytes <= 24_576, `${name} exceeds EIP-170`);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const request = await factory.getDeployTransaction(...args);
  const initcodeBytes = (request.data.length - 2) / 2;
  assert.ok(initcodeBytes <= 49_152, `${name} exceeds EIP-3860 initcode limit: ${initcodeBytes}`);
  const estimate = await signer.estimateGas(request);
  const gasLimit = (estimate * 120n + 99n) / 100n;
  const contract = await factory.deploy(...args, { gasLimit });
  const receipt = await contract.deploymentTransaction().wait();
  assert.equal(receipt.status, 1);
  receipts.push(receiptEvidence(`deploy:${label}`, receipt));
  deploymentBounds.push({ label, contract: name, initcodeBytes, runtimeBytes: artifact.runtimeBytes, estimate, gasLimit, gasUsed: receipt.gasUsed, transactionHash: receipt.hash });
  console.log(`deployed ${label}: ${receipt.gasUsed} gas, ${initcodeBytes}B initcode`);
  saveJson('deployment-bounds.json', deploymentBounds);
  await contract.waitForDeployment();
  return contract;
}
