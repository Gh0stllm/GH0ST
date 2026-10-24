// Local ABI-memory-layout proof only; no chain endpoints or keys.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';import hre from 'hardhat';import solc from 'solc';import * as ethers from 'ethers';
const dir=path.dirname(fileURLToPath(import.meta.url)),hook=path.join(dir,'NovaBatchTextHook-validated-buffers.sol');
const text=fs.readFileSync(hook,'utf8'),start=text.indexOf('        assembly ("memory-safe") {',text.indexOf('// The bounded validator above'));
const end=text.indexOf('\n        if (generated.count > maximum)',start),assembly=text.slice(start,end);
assert(assembly.includes('generated := mload(0x40)')&&assembly.includes('73920'));
const source=`// SPDX-License-Identifier: MIT\npragma solidity 0.8.30;\ncontract LayoutProof {\nstruct BatchGeneration {uint16[3] tokens;uint8[3] puncts;int16[768][3] states;int256[197][3] scores;string[3] texts;uint8 count;bool terminal;}\nfunction probe(bytes memory raw)external pure returns(bytes32){BatchGeneration memory generated;${assembly}\nreturn keccak256(abi.encode(generated.tokens,generated.puncts,generated.states,generated.scores,generated.texts,generated.count,generated.terminal));}}`;
fs.writeFileSync(path.join(dir,'BatchPointerLayoutProof.sol'),source);
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Proof.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
assert.equal(out.errors?.filter(x=>x.severity==='error').length??0,0,JSON.stringify(out.errors));
assert.equal(hre.network.name,'hardhat');assert(!hre.config.networks.hardhat.forking);await hre.network.provider.request({method:'hardhat_reset',params:[]});
const rpc=(method,params=[])=>hre.network.provider.request({method,params});const [from]=await rpc('eth_accounts');assert.equal(await rpc('eth_chainId'),'0x7a69');
const art=out.contracts['Proof.sol'].LayoutProof,iface=new ethers.Interface(art.abi),deployment=await new ethers.ContractFactory(art.abi,art.evm.bytecode.object).getDeployTransaction();
const hash=await rpc('eth_sendTransaction',[{from,data:deployment.data,gas:'0x1c9c380'}]),receipt=await rpc('eth_getTransactionReceipt',[hash]);assert.equal(receipt.status,'0x1');
const types=['uint16[3]','uint8[3]','int16[768][3]','int256[197][3]','string[3]','uint8','bool'];const coder=ethers.AbiCoder.defaultAbiCoder();let random=0x5170a31;
const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random;};const cases=[];
for(let n=0;n<40;n++){
 const tokens=Array.from({length:3},()=>next()%8192),puncts=Array.from({length:3},()=>next()%5);
 const states=Array.from({length:3},()=>Array.from({length:768},()=>n===0?-1024:n===1?1024:next()%2049-1024));
 const scores=Array.from({length:3},()=>Array.from({length:197},()=>n===0?-2147483648:n===1?2147483647:(next()|0)));
 const texts=Array.from({length:3},(_,i)=>String.fromCharCode(97+i).repeat(n===0?0:n===1?33:next()%34));
 const data=coder.encode(types,[tokens,puncts,states,scores,texts,n%4,n%2===0]);
 const returned=await rpc('eth_call',[{from,to:receipt.contractAddress,data:iface.encodeFunctionData('probe',[data]),gas:'0x1c9c380'},'latest']);
 const actual=iface.decodeFunctionResult('probe',returned)[0],expected=ethers.keccak256(data);assert.equal(actual,expected,'canonical ABI pointer parity '+n);
 cases.push({index:n,bytes:(data.length-2)/2,text_lengths:texts.map(x=>x.length),hash:expected});
}
const sha=x=>createHash('sha256').update(x).digest('hex');const report={status:'PASS',scope:'Exact pointer assembly extracted from candidate; compared with independent ethers standard ABI encoding.',public_transactions_submitted:0,chain_id:31337,cases:cases.length,state_values_checked:40*3*768,score_values_checked:40*3*197,hook_sha256:sha(text),assembly_sha256:sha(assembly),harness_sha256:sha(source),compiler:solc.version(),vectors:cases};
fs.writeFileSync(path.join(dir,'batch-pointer-layout.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,vectors:undefined},null,2));
