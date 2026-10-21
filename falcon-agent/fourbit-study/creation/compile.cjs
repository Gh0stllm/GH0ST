const fs = require('fs'), path = require('path');
const solc = require('../../../contract-benchmark/node_modules/solc');
const input = {language: 'Yul', sources: {'decoder.yul': {content: fs.readFileSync(path.join(__dirname,'decoder.yul'),'utf8')}},
  settings: {optimizer: {enabled: true, details: {yul: true}}, evmVersion: 'cancun', outputSelection: {'*': {'*': ['evm.bytecode.object']}}}};
const result = JSON.parse(solc.compile(JSON.stringify(input)));
for(const e of result.errors || []) process.stderr.write(e.formattedMessage + '\n');
if((result.errors || []).some(e => e.severity === 'error')) process.exit(1);
const bytecode = result.contracts['decoder.yul'].GH0STCreate.evm.bytecode.object;
fs.writeFileSync(path.join(__dirname,'decoder.json'), JSON.stringify({compiler: solc.version(), input, bytecode},null,2)+'\n');
console.log(JSON.stringify({creation_decoder_bytes:bytecode.length/2}));
