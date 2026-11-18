// Compile the native GL3 game and write deployment bytecode and its ABI.
// This command only builds artifacts. It takes no wallet or RPC settings.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [artifactPath, dependencyManifest = fileURLToPath(new URL('../../../chess/package.json', import.meta.url))] = process.argv.slice(2);
if (!artifactPath || process.argv.length > 4) {
  throw new Error('Pass NEW_ARTIFACT_JSON [CHESS_PACKAGE_JSON]');
}

const solc = createRequire(path.resolve(dependencyManifest))('solc');
const compiler = solc.version();
if (!compiler.startsWith('0.8.30+')) {
  throw new Error(`Solidity 0.8.30 is required. Found ${compiler}`);
}

const root = new URL('../../../../', import.meta.url);
const game = 'research/gl3/chess/game/GL3StockfishChess.sol';
const files = [
  game,
  'research/gl3/chess/game/StockfishMoveCodec.sol',
  'research/chess/contracts/HybridChessRules.sol',
];
const sources = Object.fromEntries(files.map(file => [file, { content: fs.readFileSync(new URL(file, root), 'utf8') }]));
const settings = {
  optimizer: { enabled: true, runs: 200 },
  viaIR: true,
  evmVersion: 'shanghai',
  outputSelection: {
    [game]: { GL3StockfishChess: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
const errors = (output.errors ?? []).filter(diagnostic => diagnostic.severity === 'error');
if (errors.length) throw new Error(errors.map(diagnostic => diagnostic.formattedMessage).join('\n'));

const contract = output.contracts[game].GL3StockfishChess;
const runtimeBytes = contract.evm.deployedBytecode.object.length / 2;
const initBytes = contract.evm.bytecode.object.length / 2;
if (runtimeBytes > 24_576 || initBytes > 48_896) {
  // Leave space in the initcode envelope for the constructor arguments.
  throw new Error(`Game bytecode exceeds its deployment envelope (${runtimeBytes} runtime, ${initBytes} init)`);
}

const artifact = {
  contractName: 'GL3StockfishChess',
  compiler,
  settings,
  sourceSHA256: Object.fromEntries(files.map(file => [file, createHash('sha256').update(sources[file].content).digest('hex')])),
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
  immutableReferences: contract.evm.deployedBytecode.immutableReferences,
  initBytes,
  runtimeBytes,
};
fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(`${artifact.contractName} compiled to ${runtimeBytes} runtime bytes\n`);
