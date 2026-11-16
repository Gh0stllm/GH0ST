import { Interface } from 'ethers';
import { writeFileSync } from 'node:fs';
const abi=[
 'function kernelVersion() view returns (uint32)',
 'function dotProduct(int16[] weights,int16[] activations) view returns (int64)',
 'function linearRelu(int16[] weights,int16[] activations,int64 bias) view returns (int64)',
 'function argmax(int64[] logits) view returns (uint32)',
];
const iface=new Interface(abi);
const cases=[];
function add(name,fn,args,value){cases.push({name,calldata:iface.encodeFunctionData(fn,args),expected:iface.encodeFunctionResult(fn,[value]),revert:false});}
function reject(name,fn,args){cases.push({name,calldata:iface.encodeFunctionData(fn,args),revert:true});}
add('kernel version','kernelVersion',[],1);
add('signed dot','dotProduct',[[-7,3,2],[4,-5,6]],-31);
add('largest signed lanes','dotProduct',[Array(256).fill(-32768),Array(256).fill(-32768)],274877906944n);
add('linear positive','linearRelu',[[-7,3,2],[4,-5,6],40],9);
add('relu clamps negative','linearRelu',[[-7,3,2],[4,-5,6],30],0);
add('argmax negative ties','argmax',[[-9,-3,-3,-8]],1);
reject('dimension mismatch','dotProduct',[[1],[1,2]]);
reject('empty vectors','dotProduct',[[],[]]);
reject('oversized input','dotProduct',[Array(257).fill(1),Array(257).fill(1)]);
reject('linear overflow','linearRelu',[[1],[1],9223372036854775807n]);
reject('empty logits','argmax',[[]]);
cases.push({name:'unknown selector',calldata:'0xffffffff',revert:true});
writeFileSync(new URL('../evidence/abi-cases.json',import.meta.url),JSON.stringify(cases,null,2)+'\n');
writeFileSync(new URL('../evidence/abi.json',import.meta.url),JSON.stringify(iface.formatJson()?JSON.parse(iface.formatJson()):abi,null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,selectors:Object.fromEntries(abi.map(s=>{const f=iface.getFunction(s.replace('function ','').split('(')[0]);return[f.name,f.selector]}))}));
