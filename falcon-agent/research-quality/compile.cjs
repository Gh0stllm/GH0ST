const fs=require('fs'),path=require('path');
const solc=require('../../contract-benchmark/node_modules/solc');
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'QualityExperiments.sol':{content:fs.readFileSync(path.join(__dirname,'QualityExperiments.sol'),'utf8')}},settings})));
for(const error of result.errors||[]) process.stderr.write(error.formattedMessage+'\n');
if((result.errors||[]).some(e=>e.severity==='error'))process.exit(1);
const contracts=result.contracts['QualityExperiments.sol'];
fs.writeFileSync(path.join(__dirname,'compiled.json'),JSON.stringify({compiler:solc.version(),settings,contracts},null,2)+'\n');
console.log(JSON.stringify({compiler:solc.version(),bytes:Object.fromEntries(Object.entries(contracts).map(([k,v])=>[k,v.evm.deployedBytecode.object.length/2]))}));
