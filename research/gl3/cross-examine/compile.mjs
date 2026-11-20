import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sourceName = 'contracts/CrossExamine.sol';
const sourcePath = new URL(sourceName, import.meta.url);
const vendoredCompiler = new URL('../../gh0st-synapse/research/synapse/node_modules/solc', import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function getCompiler() {
  try {
    return require('solc');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return require(fileURLToPath(vendoredCompiler));
  }
}

export function compile() {
  const solc = getCompiler();
  const compilerVersion = solc.version();
  if (!compilerVersion.startsWith('0.8.30+')) throw new Error('Install solc 0.8.30 to reproduce this release.');
  const source = readFileSync(sourcePath, 'utf8');
  const optimizer = { enabled: true, runs: 200 };
  const evmVersion = 'paris';
  const input = {
    language: 'Solidity',
    sources: { [sourceName]: { content: source } },
    settings: {
      optimizer,
      evmVersion,
      outputSelection: { [sourceName]: { CrossExamine: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage ?? error.message).join('\n'));
  const { abi, evm } = output.contracts[sourceName].CrossExamine;
  return {
    contract: 'CrossExamine',
    compilerVersion,
    optimizer,
    evmVersion,
    sourceSHA256: sha256(source),
    abi,
    bytecode: '0x' + evm.bytecode.object,
    deployedBytecode: '0x' + evm.deployedBytecode.object,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const artifactPath = new URL('artifact.json', import.meta.url);
  const artifact = compile();
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
  console.log(JSON.stringify({
    artifact: fileURLToPath(artifactPath),
    compilerVersion: artifact.compilerVersion,
    deploymentBytes: (artifact.bytecode.length - 2) / 2,
    runtimeBytes: (artifact.deployedBytecode.length - 2) / 2,
    sourceSHA256: artifact.sourceSHA256,
  }));
}
