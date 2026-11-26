'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const solc = require('solc');

function compile() {
  const file = 'contracts/GH0STEcho.sol';
  const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
  if (!solc.version().startsWith('0.8.30+commit.73712a01.')) {
    throw new Error('Install solc 0.8.30 to reproduce this build.');
  }
  const settings = {
    evmVersion: 'shanghai',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  };
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { [file]: { content } }, settings
  })));
  const errors = (output.errors || []).filter(problem => problem.severity === 'error');
  if (errors.length) throw new Error(errors.map(problem => problem.formattedMessage).join('\n'));
  const product = output.contracts[file].GH0STEcho;
  return {
    abi: product.abi, bytecode: '0x' + product.evm.bytecode.object,
    deployedBytecode: '0x' + product.evm.deployedBytecode.object,
    compiler: solc.version(), sourceSha256: createHash('sha256').update(content).digest('hex')
  };
}

module.exports = { compile };
if (require.main === module) process.stdout.write(JSON.stringify(compile(), null, 2) + '\n');
