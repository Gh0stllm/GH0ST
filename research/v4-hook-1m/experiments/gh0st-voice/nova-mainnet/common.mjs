import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import solc from 'solc';
import * as ethers from 'ethers';

export const HERE=path.dirname(fileURLToPath(import.meta.url));
export const ROOT=path.resolve(HERE,'../../..');
export const VOICE=path.dirname(HERE);
export const EXPORT=path.join(VOICE,'voice-v10/exports/broad-language-1000');
export const CHAIN=4663;
export const GAS=32_000_000n;
export const SENDER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
export const FACTORY='0x4e59b44847b379578588920cA78FbF26c0B4956C';
export const MANAGER='0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const CHECKPOINT='460697a80b25c0dc6e2242be84a9f6ec26f280f07335246bd99f32ef747e2000';
export const GROUPS=['core','groups','words','vocabulary','fused','punctuation'];
export const SEED=ethers.zeroPadValue('0x2a',32);
export const PREFIX='experiments/gh0st-voice/nova-pool/contracts/';
export const MODEL='experiments/gh0st-voice/voice-v8/exports/grammar4m/GRU2SIMDModel.sol';
export const sha=x=>createHash('sha256').update(x).digest('hex');
export const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
export function save(name,value){fs.mkdirSync(path.dirname(path.join(HERE,name)),{recursive:true});fs.writeFileSync(path.join(HERE,name),json(value));}
export function read(name){return JSON.parse(fs.readFileSync(path.join(HERE,name),'utf8'));}
export function restoreArtifact(name,expected){
 const target=path.resolve(HERE,name);assert(target.startsWith(HERE+path.sep),'Artifact path escapes package');
 if(fs.existsSync(target)){assert.equal(sha(fs.readFileSync(target)),expected,'Existing artifact hash mismatch');return target;}
 const index=read('bundle/parts.json'),entry=index.artifacts[name];assert(entry&&entry.sha256===expected,'Missing or mismatched artifact index');
 const blocks=entry.parts.map(part=>{const file=path.resolve(HERE,part.path);assert(file.startsWith(path.join(HERE,'bundle/parts')+path.sep));const bytes=fs.readFileSync(file);assert.equal(sha(bytes),part.sha256,'Part hash mismatch');return bytes;});
 const bytes=Buffer.concat(blocks);assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),expected);fs.writeFileSync(target,bytes,{flag:'wx'});return target;
}
export function dataInit(runtime){const size=ethers.getBytes(runtime).length;assert(size>0&&size<=24576);return '0x61'+size.toString(16).padStart(4,'0')+'80600a3d393df3'+runtime.slice(2);}
export function deterministic(init,kind){const initHash=ethers.keccak256(init);const salt=ethers.keccak256(ethers.toUtf8Bytes('GH0ST_N0VA_RH_V1:'+kind+':'+initHash));return{salt,address:ethers.getCreate2Address(FACTORY,salt,initHash),data:salt+init.slice(2),init_code_hash:initHash};}
export function compileProduction(){
 const originals={
  [MODEL]:fs.readFileSync(path.join(VOICE,'nova-fast-market/evm32-round2/model/GRU2PackedModel.sol'),'utf8'),
  [PREFIX+'NovaPoolHook.sol']:fs.readFileSync(path.join(VOICE,'nova-fast-market/evm32-round2/decoder/NovaPackedBatchTextHookTuned.sol'),'utf8'),
  [PREFIX+'NovaSwapRouter.sol']:fs.readFileSync(path.join(ROOT,PREFIX+'NovaSwapRouter.sol'),'utf8'),
 };
 const sources={},adaptations=[];
 for(const [name,text]of Object.entries(originals)){
  assert.equal((text.match(/block\.chainid\s*!=\s*31337/g)||[]).length,1);
  const next=text.replace(/block\.chainid\s*!=\s*31337/,'block.chainid != 4663');
  sources[name]={content:next};adaptations.push({name,original_sha256:sha(text),production_sha256:sha(next),change:'Constructor network guard only: 31337 to 4663'});
 }
 for(const name of ['NovaToken.sol','NovaLiquidityVault.sol'])sources[PREFIX+name]={content:fs.readFileSync(path.join(ROOT,PREFIX+name),'utf8')};
 const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}}};
 const imports={import:name=>{for(const f of [path.join(ROOT,name),path.join(ROOT,'node_modules',name),path.join(ROOT,'node_modules/@uniswap/v4-core/lib',name)])if(fs.existsSync(f)){const content=fs.readFileSync(f,'utf8');sources[name]={content};return{contents:content};}return{error:'Missing import '+name};}};
 const output=JSON.parse(solc.compile(JSON.stringify(input),imports));
 const errors=(output.errors||[]).filter(e=>e.severity==='error');assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join('\n'));
 const artifacts={model:output.contracts[MODEL].GRU2SIMDModel,hook:output.contracts[PREFIX+'NovaPoolHook.sol'].NovaPoolHook,vault:output.contracts[PREFIX+'NovaLiquidityVault.sol'].NovaLiquidityVault,router:output.contracts[PREFIX+'NovaSwapRouter.sol'].NovaSwapRouter,token:output.contracts[PREFIX+'NovaToken.sol'].NovaToken};
 for(const [name,a]of Object.entries(artifacts)){assert(a.evm.bytecode.object.length/2<=49152,name+' init code limit');assert(a.evm.deployedBytecode.object.length/2<=24576,name+' runtime code limit');}
 save('build/standard-input.json',input);save('build/artifacts.json',artifacts);save('build/source-manifest.json',{compiler:solc.version(),adaptations,sources:Object.fromEntries(Object.entries(sources).map(([n,x])=>[n,sha(x.content)])),settings:input.settings});
 return artifacts;
}
