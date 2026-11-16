// Compile an unchanged official example locally. This is not an audited or
// production-ready pricer and this file contains no deployment operation.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { keccak256 } from 'ethers';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const wrap = require('solc/wrapper');
const cache = new URL('../../nitro/.cache/contracts-provenance/', import.meta.url);
const contracts = new URL('git/nitro-contracts-4341b132cfbdcc980ead03765ca5224ff6cb5d97/', cache);
const soljsonURL = new URL('deps/solc/package/soljson.js', cache);
const solc = wrap(require(soljsonURL.pathname));
if (solc.version() !== '0.8.17+commit.8df45f5f.Emscripten.clang') throw Error('Pinned solc version mismatch');
const entry = 'test/foundry/fee-token-pricers/OwnerAdjustableExchangeRatePricer.sol';
const loaded = {};
const sha = value => createHash('sha256').update(value).digest('hex');
function content(path) {
  if (path.includes('..') || path.startsWith('/')) throw Error('Unexpected source path');
  const url = path.startsWith('@openzeppelin/contracts/')
    ? new URL('deps/@openzeppelin__contracts/package/' + path.slice('@openzeppelin/contracts/'.length), cache)
    : new URL(path, contracts);
  const text = readFileSync(url, 'utf8');
  loaded[path] = sha(text);
  return text;
}
const settings = { optimizer: { enabled: true, runs: 2000 }, evmVersion: 'london',
  metadata: { bytecodeHash: 'none' }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity',
  sources: { [entry]: { content: content(entry) } }, settings }), {
  import: path => { try { return { contents: content(path) }; } catch { return { error: 'Pinned import unavailable' }; } },
}));
if ((output.errors ?? []).some(x => x.severity === 'error')) {
  console.error(JSON.stringify(output.errors.filter(x => x.severity === 'error').map(x => x.formattedMessage)));
  process.exit(1);
}
const contract = output.contracts[entry].OwnerAdjustableExchangeRatePricer;
const artifact = {
  scope: 'Unchanged official unaudited manual-pricer example; reference build only',
  productionReady: false, sourceCommit: '4341b132cfbdcc980ead03765ca5224ff6cb5d97',
  sourcePath: entry, compiler: solc.version(), settings,
  abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object,
  deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
  runtimeKeccak256: keccak256('0x' + contract.evm.deployedBytecode.object),
};
copyFileSync(new URL(entry, contracts), new URL('./reference/OwnerAdjustableExchangeRatePricer.sol', import.meta.url));
writeFileSync(new URL('./reference/manual-pricer-artifact.json', import.meta.url), JSON.stringify(artifact, null, 2) + '\n');
const evidence = { scope: artifact.scope, compiled: true, productionReady: false,
  compiler: solc.version(), soljsonSHA256: sha(readFileSync(soljsonURL)),
  sourceCommit: artifact.sourceCommit, sourceSHA256: loaded,
  creationBytecodeBytes: contract.evm.bytecode.object.length / 2,
  runtimeBytecodeBytes: contract.evm.deployedBytecode.object.length / 2,
  runtimeKeccak256: artifact.runtimeKeccak256,
  transactionsSubmitted: 0, warnings: (output.errors ?? []).map(x => x.formattedMessage),
};
writeFileSync(new URL('./evidence/reference-compile.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
