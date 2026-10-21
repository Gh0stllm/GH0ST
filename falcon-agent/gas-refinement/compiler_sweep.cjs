const fs=require('fs'),path=require('path'),solc=require('../../contract-benchmark/node_modules/solc');
const source=fs.readFileSync(path.join(__dirname,'SixBitBranch.sol'),'utf8');
const contracts={};for(const runs of [1,200,10000,1000000]){
 const name=`SignedRuns${runs}`,settings={optimizer:{enabled:true,runs},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
 const r=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{[name+'.sol']:{content:source.replace('SixBitBranch',name)}},settings})));
 if((r.errors||[]).some(e=>e.severity==='error'))throw Error(JSON.stringify(r.errors));contracts[name]=r.contracts[name+'.sol'][name];console.log(name,contracts[name].evm.deployedBytecode.object.length/2);
}
const p=path.join(__dirname,'compiled.json'),a=JSON.parse(fs.readFileSync(p));Object.assign(a.contracts,contracts);fs.writeFileSync(p,JSON.stringify(a,null,2)+'\n');
