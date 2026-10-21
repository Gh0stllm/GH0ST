const fs=require('fs'),path=require('path');
const solc=require('../../../contract-benchmark/node_modules/solc');
const file=path.join(__dirname,'PaymentProbe.sol');
const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',
  sources:{'PaymentProbe.sol':{content:fs.readFileSync(file,'utf8')}},
  settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',
    outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
if((result.errors||[]).some(e=>e.severity==='error'))throw new Error(JSON.stringify(result.errors));
fs.writeFileSync(path.join(__dirname,'compiled.json'),JSON.stringify(result.contracts['PaymentProbe.sol'].PaymentProbe,null,2)+'\n');
