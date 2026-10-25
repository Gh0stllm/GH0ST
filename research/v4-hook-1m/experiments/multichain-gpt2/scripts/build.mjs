// Offline Solidity build. Every compiler input (including package imports) is hashed and saved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RESEARCH = path.resolve(HERE, '../..');
export const BRIDGE_MODULES = path.resolve(RESEARCH, '../../../bridge/node_modules');
const require = createRequire(path.join(HERE, 'package.json'));
const solc = require('solc');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
export function confinedOutput(input = 'reports/local') {
  const target = path.resolve(HERE, input);
  assert(target.startsWith(HERE + path.sep), 'Output must remain inside multichain-gpt2');
  return target;
}

function solidityFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? solidityFiles(path.join(directory, entry.name)) : entry.name.endsWith('.sol') ? [path.join(directory, entry.name)] : []);
}

export function compile({ includeTests = false, outputDirectory = null } = {}) {
  assert.match(solc.version(), /^0\.8\.30\+/, 'Use the pinned installed Solidity 0.8.30 compiler');
  const files = [...solidityFiles(path.join(HERE, 'contracts')), ...(includeTests ? solidityFiles(path.join(HERE, 'tests/contracts')) : [])];
  assert(files.length > 0, 'Solidity sources are missing');
  const sources = Object.fromEntries(files.map(file => [path.relative(HERE, file).split(path.sep).join('/'), { content: fs.readFileSync(file, 'utf8') }]));
  const resolvedPaths = Object.fromEntries(files.map(file => [path.relative(HERE, file).split(path.sep).join('/'), file]));
  const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'storageLayout', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings }), { import: name => {
    const roots = [HERE, path.join(HERE, 'node_modules'), BRIDGE_MODULES, path.join(RESEARCH, 'node_modules')];
    for (const root of roots) {
      const candidate = path.resolve(root, name);
      if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate)) continue;
      const content = fs.readFileSync(candidate, 'utf8');
      sources[name] = { content }; resolvedPaths[name] = candidate;
      return { contents: content };
    }
    return { error: 'Missing offline import: ' + name };
  } }));
  const errors = (output.errors ?? []).filter(item => item.severity === 'error');
  assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join('\n'));
  const artifacts = {};
  const ambiguousNames = new Set();
  for (const [file, contracts] of Object.entries(output.contracts ?? {})) for (const [name, artifact] of Object.entries(contracts)) {
    const runtimeBytes = artifact.evm.deployedBytecode.object.length / 2;
    if (artifact.evm.bytecode.object) assert(runtimeBytes <= 24_576, `${name} exceeds EIP-170 (${runtimeBytes} bytes)`);
    const entry = { ...artifact, sourceFile: file, runtimeBytes };
    if (artifacts[name] && artifacts[name].sourceFile !== file) {
      // Third-party packages can contain distinct libraries with the same name.
      // An ambiguous short name must never silently select either implementation.
      artifacts[artifacts[name].sourceFile + ':' + name] = artifacts[name];
      delete artifacts[name];
      ambiguousNames.add(name);
    }
    if (ambiguousNames.has(name)) artifacts[file + ':' + name] = entry;
    else artifacts[name] = entry;
  }
  const source_sha256 = Object.fromEntries(Object.keys(sources).sort().map(file => [file, sha256(sources[file].content)]));
  const compiler = { version: solc.version(), settings, source_sha256,
    sources_commitment_sha256: sha256(json(source_sha256)),
    input_sha256: sha256(json({ language: 'Solidity', sources, settings })) };
  const result = { artifacts, compiler, sources, resolvedPaths,
    warnings: (output.errors ?? []).filter(item => item.severity !== 'error').map(item => item.formattedMessage) };
  if (outputDirectory) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'artifacts.json'), json(artifacts));
    fs.writeFileSync(path.join(outputDirectory, 'compiler.json'), json(compiler));
    fs.writeFileSync(path.join(outputDirectory, 'compiler-input.json'), json({ language: 'Solidity', sources, settings }));
  }
  return result;
}

export function assertSourcesUnchanged(compiled) {
  for (const [name, file] of Object.entries(compiled.resolvedPaths)) {
    assert.equal(sha256(fs.readFileSync(file)), compiled.compiler.source_sha256[name], 'Source changed after compilation: ' + name);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === '--tests' || arg.startsWith('--out=')), 'Only --tests and --out= are accepted; no network options');
  const outputDirectory = confinedOutput(args.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'reports/build');
  const result = compile({ includeTests: args.includes('--tests'), outputDirectory });
  assertSourcesUnchanged(result);
  console.log(json({ status: 'PASS_OFFLINE_BUILD', compiler: result.compiler.version,
    source_count: Object.keys(result.sources).length,
    artifacts: Object.fromEntries(Object.entries(result.artifacts).filter(([, a]) => a.evm.bytecode.object).map(([name, a]) => [name, { runtime_bytes: a.runtimeBytes }])), outputDirectory }));
}
