import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function compileHybrid(write=true){
 const sources={};
 for(const name of ['HybridChessRules.sol','HybridChessGame.sol']) sources[`contracts/${name}`]={content:fs.readFileSync(path.join(root,'contracts',name),'utf8')};
 sources['evm-tests/fixtures.sol']={content:fs.readFileSync(path.join(root,'evm-tests/fixtures.sol'),'utf8')};
 const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}};
 const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));
 for(const e of out.errors??[])if(e.severity==='error')throw Error(e.formattedMessage);
 const artifacts={};
 for(const [file,contracts]of Object.entries(out.contracts))for(const[name,c]of Object.entries(contracts)){
  if(!c.evm.bytecode.object)continue;
  artifacts[name]={contractName:name,sourceName:file,compiler:solc.version(),settings,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences,runtimeBytes:c.evm.deployedBytecode.object.length/2};
 }
 if(write){fs.mkdirSync(path.join(root,'evm/hybrid-artifacts'),{recursive:true});for(const[n,a]of Object.entries(artifacts))fs.writeFileSync(path.join(root,'evm/hybrid-artifacts',n.toLowerCase()+'.json'),JSON.stringify(a,null,2)+'\n');}
 return artifacts;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const a=compileHybrid();console.log(Object.fromEntries(Object.entries(a).map(([n,v])=>[n,v.runtimeBytes])));}
