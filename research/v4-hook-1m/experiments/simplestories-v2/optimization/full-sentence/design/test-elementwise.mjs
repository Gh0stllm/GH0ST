import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import solc from 'solc';
import {JsonRpcProvider,ContractFactory} from 'ethers';
const base=path.resolve('experiments/simplestories-v2'),out=path.join(base,'optimization/full-sentence/design');
const old=fs.readFileSync(path.join(base,'contracts/SimpleStoriesV2Model.sol'),'utf8');
const newer=fs.readFileSync(path.join(out,'math-helpers.sol.inc'),'utf8');
function section(s,key){const start=s.indexOf(key);if(start<0)throw Error(key);let depth=0,seen=false;for(let i=start;i<s.length;i++){if(s[i]==='{'){depth++;seen=true;}if(s[i]==='}'&&--depth===0&&seen)return s.slice(start,i+1);}throw Error(key);}
const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract ElementwiseProbe {
int256 constant Q=4096;error ArithmeticRange();
${section(old,'function _checked(')}
${section(old,'function _u32(')}
${section(old,'function _i16(')}
${section(old,'function _table(')}
${section(old,'function _silu(')}
${section(old,'function _rope(').replace('function _rope(','function _ropeOld(')}
${section(newer,'function _rope(').replace('function _rope(','function _ropeNew(')}
${section(newer,'function _siluMultiply(')}
${section(newer,'function _addResidual(')}
function rope(bool opt,int32[] memory x,uint256 heads,uint256 pos,bytes memory tables)external view returns(int32[] memory y,uint256 gas){require(x.length==heads*32&&pos<16);y=new int32[](x.length+3);uint256 beforeGas=gasleft();if(opt)_ropeNew(x,y,3,heads,pos,tables);else _ropeOld(x,y,3,heads,pos,tables);gas=beforeGas-gasleft();}
function silu(bool opt,int32[] memory g,int32[] memory u,bytes memory tables)external view returns(int32[] memory,uint256 gas){require(g.length==u.length);uint256 beforeGas=gasleft();if(opt)_siluMultiply(g,u,tables);else for(uint256 j;j<g.length;j++)g[j]=_checked(_silu(g[j],tables)*int256(u[j])/Q);gas=beforeGas-gasleft();return(g,gas);}
function residual(bool opt,int32[] memory h,int32[] memory p)external view returns(int32[] memory,uint256 gas){require(h.length==131&&p.length==128);uint256 beforeGas=gasleft();if(opt)_addResidual(h,3,p);else for(uint256 j;j<128;j++)h[j+3]=_checked(int256(h[j+3])+p[j]);gas=beforeGas-gasleft();return(h,gas);}
}`;
fs.writeFileSync(path.join(out,'ElementwiseProbe.sol'),source);
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'P.sol':{content:source}},settings:{viaIR:true,optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
const errors=compiled.errors?.filter(x=>x.severity==='error')??[];if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
const artifact=compiled.contracts['P.sol'].ElementwiseProbe;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gh0st-elementwise-'));
const child=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port','18563','--chain-id','31337','--gas-limit','32000000','--quiet','--no-cors','--disable-console-log'],{cwd:temp,env:{PATH:process.env.PATH},stdio:'ignore'});
const provider=new JsonRpcProvider('http://127.0.0.1:18563',undefined,{staticNetwork:true});
const result=[];
try{
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Anvil exited');try{if(await provider.send('eth_chainId',[])==='0x7a69'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}if(!ready)throw Error('Anvil not ready');
 const c=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,await provider.getSigner(0)).deploy();await c.waitForDeployment();
 const tables='0x'+fs.readFileSync(path.join(base,'model/tables.bin')).toString('hex');
 let seed=742103;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed|0;};
 async function compare(name,method,args){let a,b,ea,eb;try{a=await c[method](false,...args);}catch(e){ea=e.data;}try{b=await c[method](true,...args);}catch(e){eb=e.data;}if(ea||eb){if(ea!==eb||ea!=='0x6b6b0562')throw Error(name+' wrong revert');result.push({name,matchedRevert:ea});return;}if(a[0].length!==b[0].length||a[0].some((v,i)=>v!==b[0][i]))throw Error(name+' mismatch');result.push({name,outputs:a[0].length,originalGas:Number(a[1]),optimizedGas:Number(b[1])});}
 for(const pos of [0,1,9,15])for(const heads of [2,4]){await compare(`rope-random-${heads}-${pos}`,'rope',[Array.from({length:heads*32},()=>rand()%200000),heads,pos,tables]);await compare(`rope-extreme-${heads}-${pos}`,'rope',[Array.from({length:heads*32},(_,i)=>i%2?2147483647:-2147483648),heads,pos,tables]);}
 await compare('silu-random','silu',[Array.from({length:341},()=>rand()%200000),Array.from({length:341},()=>rand()%200000),tables]);
 await compare('silu-table-boundaries','silu',[Array.from({length:341},(_,i)=>(i%2?-1:1)*(Math.floor(i/2)*256+(i%3))),Array(341).fill(4096),tables]);
 await compare('silu-extreme-valid','silu',[Array.from({length:341},(_,i)=>i%2?2147483647:-2147483648),Array(341).fill(1),tables]);
 await compare('silu-overflow','silu',[Array(341).fill(2147483647),Array(341).fill(2147483647),tables]);
 await compare('residual-random','residual',[Array.from({length:131},()=>rand()%100000),Array.from({length:128},()=>rand()%100000)]);
 await compare('residual-overflow','residual',[Array(131).fill(2147483647),Array(128).fill(1)]);
 fs.writeFileSync(path.join(out,'elementwise-parity.json'),JSON.stringify({localOnly:true,chainId:31337,port:18563,allMatched:true,cases:result},null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{provider.destroy();child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(temp,{recursive:true,force:true});}
