import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
export const solc = require('solc');
export const ethers = require('ethers');
export const versions = Object.fromEntries(['solc', 'ethers', 'ganache'].map(name => {
  let directory = dirname(require.resolve(name));
  while (directory !== dirname(directory)) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (pkg.name === name) return [name, pkg.version];
    } catch {}
    directory = dirname(directory);
  }
  throw new Error(`Missing package version: ${name}`);
}));
assert.deepEqual(versions, { solc: '0.8.30', ethers: '6.13.5', ganache: '7.9.2' });

export const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
export function save(path, value) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), json(value));
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function packI16(values) {
  return '0x' + values.map(value => {
    assert.ok(Number.isInteger(value) && value >= -32768 && value <= 32767);
    return ((value + 65536) % 65536).toString(16).padStart(4, '0');
  }).join('');
}

export function compile(includeTests = false) {
  const mainSource = readFileSync(join(ROOT, 'contracts/ForgeModel.sol'), 'utf8');
  const sources = { 'contracts/ForgeModel.sol': { content: mainSource } };
  if (includeTests) sources['tests/fixtures.sol'] = { content: readFileSync(join(ROOT, 'tests/fixtures.sol'), 'utf8') };
  const settings = {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    metadata: { bytecodeHash: 'none' },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
  const errors = (output.errors ?? []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  const artifacts = {};
  for (const [source, contracts] of Object.entries(output.contracts)) {
    for (const [name, contract] of Object.entries(contracts)) artifacts[name] = {
      source, name, abi: contract.abi,
      bytecode: '0x' + contract.evm.bytecode.object,
      deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
      immutableReferences: contract.evm.deployedBytecode.immutableReferences,
      creationBytes: contract.evm.bytecode.object.length / 2,
      runtimeBytes: contract.evm.deployedBytecode.object.length / 2,
    };
  }
  const publicArtifacts = Object.fromEntries(Object.entries(artifacts).filter(([, value]) => value.source === 'contracts/ForgeModel.sol'));
  save('runtime/artifacts.json', {
    format: 'GH0ST_FORGE_NUMERIC_MLP_Q8_V1', compiler: solc.version(), versions,
    settings, sourceSha256: sha256(mainSource), contracts: publicArtifacts,
  });
  return artifacts;
}

export async function localChain() {
  const ganache = require('ganache');
  const eip1193 = ganache.provider({
    logging: { quiet: true },
    wallet: { mnemonic: 'test test test test test test test test test test test junk', totalAccounts: 8, defaultBalance: 1000 },
    chain: { chainId: 31337, hardfork: 'shanghai', time: new Date('2026-01-01T00:00:00Z') },
    miner: { blockGasLimit: 30_000_000, timestampIncrement: 1 },
  });
  const provider = new ethers.BrowserProvider(eip1193, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const signers = await Promise.all(Array.from({ length: 8 }, (_, index) => provider.getSigner(index)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  return { eip1193, provider, signers, addresses, close: () => eip1193.disconnect() };
}

export const normalizeTrace = trace => ({ hidden: Array.from(trace.hidden, Number), logits: Array.from(trace.logits, Number), classId: Number(trace.classId) });
export const traceType = 'tuple(int256[] hidden,int256[] logits,uint16 classId)';
export const formatId = ethers.keccak256(ethers.toUtf8Bytes('GH0ST_FORGE_NUMERIC_MLP_Q8_V1'));
export function modelHash(config) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'uint8', 'uint8', 'uint8', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
    [formatId, config.inputCount, config.hiddenWidth, config.classCount, config.featureSchemaHash, config.labelsHash, config.datasetHash, ethers.keccak256(config.packedWeights)],
  ));
}
export function deploymentModelId(chainId, address, token, beneficiary, fee, hash) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'address', 'address', 'uint96', 'bytes32'],
    [chainId, address, token, beneficiary, fee, hash],
  ));
}
export function constructorArgs(token, beneficiary, fee, config) {
  return [token, beneficiary, fee, config.inputCount, config.hiddenWidth, config.classCount,
    config.featureSchemaHash, config.labelsHash, config.datasetHash, config.packedWeights];
}
