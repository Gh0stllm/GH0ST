// Uses the repository's existing locked Solidity/ethers dependencies.
// This is an ABI-only compile check: no wallet, RPC or transaction is used.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import solc from '../../../node_modules/solc/index.js';
import { id } from '../../../node_modules/ethers/lib.esm/index.js';

const sourceName = 'GhostLLM.sol';
const source = fs.readFileSync(new URL(`./${sourceName}`, import.meta.url), 'utf8');
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { [sourceName]: { content: source } },
  settings: { outputSelection: { '*': { '*': ['abi', 'evm.methodIdentifiers'] } } },
})));
const errors = (output.errors ?? []).filter(item => item.severity === 'error');
assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join('\n'));
const contract = output.contracts[sourceName].GhostLLM;
const goSource = fs.readFileSync(new URL('./ArbGhostLLM.go', import.meta.url), 'utf8');
const match = goSource.match(/const GhostLLMABI = `([\s\S]*?)`/);
assert(match, 'embedded Go ABI constant missing');
const embedded = JSON.parse(match[1]);
const normalize = abi => abi.filter(item => item.type === 'function').map(item => ({
  name: item.name,
  stateMutability: item.stateMutability,
  inputs: item.inputs.map(input => input.type),
  outputs: item.outputs.map(output => output.type),
})).sort((a, b) => a.name.localeCompare(b.name));
const compiledFunctions = normalize(contract.abi);
const embeddedFunctions = normalize(embedded);
assert.equal(compiledFunctions.length, 5, 'expected exactly five bounded public methods');
assert.deepEqual(compiledFunctions, embeddedFunctions);

const embeddedSelectors = Object.fromEntries(embeddedFunctions.map(fn => {
  const signature = `${fn.name}(${fn.inputs.join(',')})`;
  return [signature, id(signature).slice(2, 10)];
}));
assert.deepEqual(contract.evm.methodIdentifiers, embeddedSelectors);
const functions = embeddedFunctions.map(fn => {
  const signature = `${fn.name}(${fn.inputs.join(',')})`;
  return { ...fn, signature, selector: `0x${embeddedSelectors[signature]}` };
});
const report = {
  compiler: solc.version(),
  source: sourceName,
  contract: 'GhostLLM',
  compiled: true,
  functions,
  functionCount: functions.length,
  inputOutputMutabilityMatch: true,
  allSignaturesAndSelectorsMatchEmbeddedGoABI: true,
  abiOnlyCheck: true,
  evmCallExecutedByThisCheck: false,
  financialActions: false,
};
fs.mkdirSync(new URL('./evidence/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./evidence/abi.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ compiler: report.compiler, functions: functions.map(fn => ({ signature: fn.signature, selector: fn.selector })), passed: true }));
