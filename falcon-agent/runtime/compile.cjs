const fs=require('fs'),path=require('path');
const solc=require('../../contract-benchmark/node_modules/solc');
const sources={};
for(const name of ['runtime/GH0STRuntime.sol','runtime/PrepaidBudget.sol','runtime/FixedMath.sol','fourbit-study/WeightReader.sol'])
  sources[name]={content:fs.readFileSync(path.join(__dirname,'..',name),'utf8')};
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.bytecode.linkReferences','evm.deployedBytecode.object']}}};
const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));
for(const e of result.errors||[])process.stderr.write(e.formattedMessage+'\n');
if((result.errors||[]).some(e=>e.severity==='error'))process.exit(1);
const artifact=result.contracts['runtime/GH0STRuntime.sol'].GH0STRuntime;
fs.writeFileSync(path.join(__dirname,'compiled.json'),JSON.stringify({compiler:solc.version(),settings,
  contract:'GH0STRuntime',...artifact},null,2)+'\n');
console.log(JSON.stringify({compiler:solc.version(),runtime_bytes:artifact.evm.deployedBytecode.object.length/2,
  creation_bytes:artifact.evm.bytecode.object.length/2,linked_libraries:artifact.evm.bytecode.linkReferences}));
