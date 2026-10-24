import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import hre from 'hardhat';
import solc from 'solc';
import * as ethers from 'ethers';
const dir=path.dirname(fileURLToPath(import.meta.url)), exportDir=path.resolve(dir,'../../voice-v8/exports/grammar4m');
let source=fs.readFileSync(path.join(exportDir,'GRU2SIMDModel.sol'),'utf8');
source=source.replace('contract GRU2SIMDModel {','contract ProfileGRU2 {');
source=source.replace('string memory text,bool terminal){','string memory text,bool terminal,uint256[10] memory snapshots){snapshots[0]=gasleft();');
source=source.replace('  (bytes memory old1','  snapshots[1]=gasleft();(bytes memory old1');
source=source.replace('  for(uint256 i;i<384;++i){int256 xr=(_input','  snapshots[2]=gasleft();for(uint256 i;i<384;++i){int256 xr=(_input');
source=source.replace('  (bytes memory new1','  snapshots[3]=gasleft();(bytes memory new1');
source=source.replace('  for(uint256 i;i<384;++i){int256 xr=(_dot','  snapshots[4]=gasleft();for(uint256 i;i<384;++i){int256 xr=(_dot');
source=source.replace('  (bytes memory out','  snapshots[5]=gasleft();(bytes memory out');
source=source.replace('  for(uint256 i;i<128;++i)','  snapshots[6]=gasleft();for(uint256 i;i<128;++i)');
source=source.replace('  uint256 group=_sample','  snapshots[7]=gasleft();uint256 group=_sample');
source=source.replace('  punct=uint8(_sample','  snapshots[8]=gasleft();punct=uint8(_sample');
source=source.replace('return(token,punct,next,scores,string(output),punct>=2);','snapshots[9]=gasleft();return(token,punct,next,scores,string(output),punct>=2,snapshots);');
fs.writeFileSync(path.join(dir,'ProfileGRU2.sol'),source);
const cfg={language:'Solidity',sources:{'ProfileGRU2.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(cfg)));assert(!(output.errors||[]).some(e=>e.severity==='error'),JSON.stringify(output.errors));
const a=output.contracts['ProfileGRU2.sol'].ProfileGRU2;
hre.config.networks.hardhat.blockGasLimit=32000000;await hre.network.provider.request({method:'hardhat_reset'});
const rpc=(method,params=[])=>hre.network.provider.request({method,params});assert.equal(await rpc('eth_chainId'),'0x7a69');assert(!hre.config.networks.hardhat.forking);
let index=0,catalogIndex=0,catalogs=[];
for(const group of ['core','groups','words','vocabulary','fused','punctuation']){
 const payload=fs.readFileSync(path.join(exportDir,group+'.bin')),addresses=[];
 for(let off=0;off<payload.length;off+=24000){const address=ethers.toBeHex(0x100000n+BigInt(index++),20);await rpc('hardhat_setCode',[address,'0x00'+payload.subarray(off,off+24000).toString('hex')]);addresses.push(address);}
 const pages=[];
 for(let off=0;off<addresses.length;off+=1024){const p=ethers.toBeHex(0x500000n+BigInt(catalogIndex++),20);await rpc('hardhat_setCode',[p,'0x00'+addresses.slice(off,off+1024).map(x=>x.slice(2)).join('')]);pages.push(p);}
 const r=ethers.toBeHex(0x700000n+BigInt(catalogIndex++),20);await rpc('hardhat_setCode',[r,'0x00'+pages.map(x=>x.slice(2)).join('')]);catalogs.push(r);
}
const [account]=await rpc('eth_accounts');const deploy=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(...catalogs);
const tx=await rpc('eth_sendTransaction',[{from:account,data:deploy.data,gas:'0x1e84800'}]);const receipt=await rpc('eth_getTransactionReceipt',[tx]);assert.equal(receipt.status,'0x1');
const iface=new ethers.Interface(a.abi),seed=ethers.zeroPadValue('0x2a',32),input=[8192,0,Array(768).fill(0),[0,0,0,0,1024,1024],seed,0,512];
const req={to:receipt.contractAddress,data:iface.encodeFunctionData('stepSampled',input),gas:'0x1e84800'};
const r=iface.decodeFunctionResult('stepSampled',await rpc('eth_call',[req,'latest']));const s=Array.from(r[6]).map(Number),names=['validation_reads','old_state_prepare','first_GRU_layer','new_state_prepare','second_GRU_layer','out_state_prepare','group_head','word_and_punctuation_heads','punctuation_sampling_text'];
const phases=Object.fromEntries(names.map((n,i)=>[n,s[i]-s[i+1]]));
const result={mode:'UNFORKED_LOCAL_ONLY',note:'Instrumentation changes compiler layout; directional profiling, not production gas proof.',phases,instrumented_body_gas:s[0]-s[9],snapshots:s,word:r[4],public_transactions:0,source_parameters:8175493};fs.writeFileSync(path.join(dir,'phase-profile.json'),JSON.stringify(result,null,2)+'\n');console.log(result);
