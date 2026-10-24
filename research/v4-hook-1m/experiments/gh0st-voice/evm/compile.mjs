import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import solcV4 from 'solc-v4';

export const DIR=path.dirname(fileURLToPath(import.meta.url));
export const BASE=path.resolve(DIR,'../../..');
export const relative=file=>path.relative(BASE,file).split(path.sep).join('/');
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
export const HOOK=relative(path.join(DIR,'RelativeContinuityHook.sol'));
export const HARNESS=relative(path.join(DIR,'ContinuityHarness.sol'));
export const MANAGER='@uniswap/v4-core/src/PoolManager.sol';
export const CORE_HARNESS='tests/evm/SentenceV4IntegrationHarness.sol';
export const SETTINGS={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};

function sourcePath(file){
  for(const root of [BASE,path.join(BASE,'node_modules'),path.join(BASE,'node_modules/@uniswap/v4-core/lib')]){
    const p=path.join(root,file);if(existsSync(p))return p;
  }
  throw Error('Missing compiler import '+file);
}

// An unchanged compilation is reused only after checking every original and imported source.
export function compileGroup(label,entrypoints,compiler=solc){
  const cacheFile=path.join(DIR,'compiled-'+label+'.json');
  const version=compiler.version();
  if(existsSync(cacheFile)){
    const cache=JSON.parse(readFileSync(cacheFile));
    const identical=cache.compiler===version&&json(cache.settings)===json(SETTINGS)&&json(cache.entrypoints)===json(entrypoints)
      &&Object.entries(cache.sourceSha256).every(([file,hash])=>sha(readFileSync(sourcePath(file)))===hash);
    if(identical)return{...cache,reused:true};
  }
  const sourceSha256={};
  const sources=Object.fromEntries(entrypoints.map(file=>{const content=readFileSync(sourcePath(file),'utf8');sourceSha256[file]=sha(content);return[file,{content}];}));
  const output=JSON.parse(compiler.compile(json({language:'Solidity',sources,settings:SETTINGS}),{
    import:file=>{try{const contents=readFileSync(sourcePath(file),'utf8');sourceSha256[file]=sha(contents);return{contents};}catch(error){return{error:error.message};}}
  }));
  const errors=(output.errors??[]).filter(e=>e.severity==='error');
  assert.deepEqual(errors,[],errors.map(e=>e.formattedMessage).join('\n'));
  const cache={compiler:version,settings:SETTINGS,entrypoints,sourceSha256,artifacts:output.contracts};
  writeFileSync(cacheFile,json(cache));return{...cache,reused:false};
}

export function compileHook(){return compileGroup('hook',[HOOK,HARNESS]);}
export function compileManager(){return compileGroup('manager',[MANAGER],solcV4);}
export function compileModel(source){return compileGroup('model',[source]);}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  for(const [label,group]of[['hook',compileHook()],['manager',compileManager()]]){
    console.log(label+': '+(group.reused?'verified cached compilation':'fresh compilation')+'; '+Object.keys(group.sourceSha256).length+' source files');
  }
}
