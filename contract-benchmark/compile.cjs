const fs = require('fs');
const path = require('path');
const solc = require('solc');
const root = __dirname;
const source = fs.readFileSync(path.join(root, 'Int4Kernel.sol'), 'utf8');
const settings = {
  optimizer: {enabled: true, runs: 200},
  viaIR: true,
  evmVersion: 'paris',
  outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}
};
const output = JSON.parse(solc.compile(JSON.stringify({language: 'Solidity',
  sources: {'Int4Kernel.sol': {content: source}}, settings})));
for (const issue of output.errors || []) {
  process.stderr.write(issue.formattedMessage + '\n');
}
if ((output.errors || []).some(x => x.severity === 'error')) process.exit(1);
const report = {compiler: solc.version(), settings, contracts: output.contracts['Int4Kernel.sol']};
fs.writeFileSync(path.join(root, 'compiled.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({compiler: report.compiler,
  kernelRuntimeBytes: report.contracts.Int4Kernel.evm.deployedBytecode.object.length / 2}));
