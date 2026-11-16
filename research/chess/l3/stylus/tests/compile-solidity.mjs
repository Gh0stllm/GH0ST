import solc from 'solc';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Interface } from 'ethers';
const source=readFileSync(new URL('../IGh0stTensorKernel.sol',import.meta.url),'utf8');
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'IGh0stTensorKernel.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
if(output.errors?.some(e=>e.severity==='error')) throw Error(JSON.stringify(output.errors));
const abi=output.contracts['IGh0stTensorKernel.sol'].IGh0stTensorKernel.abi;
const reference=new Interface(JSON.parse(readFileSync(new URL('../evidence/abi.json',import.meta.url))));
const actual=new Interface(abi);
for(const name of ['kernelVersion','dotProduct','linearRelu','argmax']) {
 if(actual.getFunction(name).selector!==reference.getFunction(name).selector)throw Error(`selector mismatch: ${name}`);
}
const caller=output.contracts['IGh0stTensorKernel.sol'].Gh0stTensorCaller;
const report={scope:'Solidity interface and caller compile; selectors checked against ABI inputs executed in compiled Stylus Wasm; not a Solidity-to-Stylus transaction',solc:solc.version(),selectorsMatched:4,callerBytecodeBytes:caller.evm.bytecode.object.length/2,callerBytecodeSHA256:createHash('sha256').update(Buffer.from(caller.evm.bytecode.object,'hex')).digest('hex'),deployments:0};
writeFileSync(new URL('../evidence/solidity-compile.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
