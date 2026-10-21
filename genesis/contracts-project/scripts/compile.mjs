import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = path.resolve(import.meta.dirname, '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.sol') ? [path.join(dir, e.name)] : []);
}
const sources = Object.fromEntries(walk(path.join(root, 'contracts')).map(file =>
  [path.relative(root, file).replaceAll('\\', '/'), { content: fs.readFileSync(file, 'utf8') }]));
const input = {
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata', 'storageLayout'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input), {
  import(file) {
    try {
      const contents = fs.readFileSync(path.join(root, 'node_modules', file), 'utf8');
      // Keep the exported standard JSON self-contained for explorer verification.
      input.sources[file] = { content: contents };
      return { contents };
    }
    catch { return { error: 'Unresolved import: ' + file }; }
  }
}));
for (const error of output.errors ?? []) console[error.severity === 'error' ? 'error' : 'warn'](error.formattedMessage);
if ((output.errors ?? []).some(e => e.severity === 'error')) process.exit(1);
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'standard-input.json'), JSON.stringify(input, null, 2));
const summary = [];
for (const [sourceName, contracts] of Object.entries(output.contracts)) {
  if (!sourceName.startsWith('contracts/')) continue;
  for (const [name, c] of Object.entries(contracts)) {
    if (!c.evm.bytecode.object) continue;
    const artifact = { contractName: name, sourceName, compiler: solc.version(),
      settings: { optimizer: input.settings.optimizer, evmVersion: input.settings.evmVersion },
      abi: c.abi, bytecode: '0x' + c.evm.bytecode.object,
      deployedBytecode: '0x' + c.evm.deployedBytecode.object, storageLayout: c.storageLayout,
      metadata: JSON.parse(c.metadata) };
    fs.writeFileSync(path.join(root, 'artifacts', name + '.json'), JSON.stringify(artifact, null, 2));
    summary.push({ name, creationBytes: c.evm.bytecode.object.length / 2, runtimeBytes: c.evm.deployedBytecode.object.length / 2 });
  }
}
fs.writeFileSync(path.join(root, 'build', 'compile-summary.json'), JSON.stringify({ compiler: solc.version(), contracts: summary }, null, 2));
console.log(JSON.stringify(summary, null, 2));
