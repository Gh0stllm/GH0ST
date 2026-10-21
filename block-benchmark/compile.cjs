const fs = require('fs');
const path = require('path');
const solc = require('../contract-benchmark/node_modules/solc');
const sources = Object.fromEntries(fs.readdirSync(__dirname).filter(name=>/^LfmBlock.*\.sol$/.test(name)).map(name=>[name,{content:fs.readFileSync(path.join(__dirname,name),'utf8')}]));
const settings = {optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'paris',
 outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','storageLayout']}}};
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));
for(const e of out.errors||[])process.stderr.write(e.formattedMessage+'\n');
if((out.errors||[]).some(e=>e.severity==='error'))process.exit(1);
const result={compiler:solc.version(),settings,contracts:Object.assign({},...Object.values(out.contracts))};
fs.writeFileSync(path.join(__dirname,'compiled.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({compiler:result.compiler,runtimeBytes:Object.fromEntries(Object.entries(result.contracts).map(([name,c])=>[name,c.evm.deployedBytecode.object.length/2]))}));
