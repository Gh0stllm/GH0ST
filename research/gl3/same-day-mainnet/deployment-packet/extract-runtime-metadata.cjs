// Recompile exact pinned sources only to recover compiler immutable offsets.
// Every emitted creation/template runtime must equal the previously pinned artifact.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const D='/workspace/gl3/same-day-mainnet/deployment-packet',R=D+'/runtime-source',PIN='4341b132cfbdcc980ead03765ca5224ff6cb5d97',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(!fs.existsSync(R+'/SOURCES_READY'))throw Error('Exact source archives not ready');
const recordPath='/root/dispute/repo/research/chess/l3/nitro/evidence/contract-source-compilation.json',record=JSON.parse(fs.readFileSync(recordPath)),sourceRoot=R+'/upstream/nitro-contracts-'+PIN,preRoot=R+'/precompiles/nitro-precompile-interfaces-f49a4889b486fd804a7901203f5f663cfd1581c8';
if(record.main.sourceCommit!==PIN)throw Error('Wrong source pin');
const solc=require('/root/dispute/node_modules/solc/wrapper')(require(R+'/deps-ready/solc/package/soljson.js'));
if(solc.version()!=='0.8.17+commit.8df45f5f.Emscripten.clang')throw Error('Compiler drift');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith('.sol')?[path.join(d,e.name)]:[]);}
const sources={},hashes={};
for(const f of walk(sourceRoot+'/src')){const name=path.relative(sourceRoot,f),b=fs.readFileSync(f);if(sha(b)!==record.main.sourceFileHashes[name])throw Error('Source mismatch '+name);sources[name]={content:b.toString()};hashes[name]=sha(b);}
for(const f of walk(preRoot))if(!path.relative(preRoot,f).includes('/')){const name='src/precompiles/'+path.basename(f),b=fs.readFileSync(f);sources[name]={content:b.toString()};hashes[name]=sha(b);}
const deps=JSON.parse(fs.readFileSync(R+'/build-deps.json')).sort((a,b)=>b.package.length-a.package.length);
function imports(name){const dep=deps.find(d=>name.startsWith(d.package+'/'));if(!dep)return {error:'Unknown import '+name};const f=R+'/deps-ready/'+dep.package.replace('/','__')+'/package/'+name.slice(dep.package.length+1),b=fs.readFileSync(f);if(sha(b)!==record.main.importedDependencySourceHashes[name])return {error:'Dependency source mismatch '+name};hashes[name]=sha(b);return {contents:b.toString()};}
const artifactRoot='/root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance/compiled-main/build/contracts',all={};
const plan=JSON.parse(fs.readFileSync(D+'/candidate-configured-owner/unsigned-deployment-plan.json'));
for(const a of plan.actions)if(a.artifact.path){const rel=a.artifact.path.split('/compiled-main/build/contracts/')[1];if(!rel)continue;const file=artifactRoot+'/'+rel,b=fs.readFileSync(file);if(sha(b)!==a.artifact.sha256)throw Error('Artifact drift');const x=JSON.parse(b);all[x.sourceName+':'+x.contractName]={artifact:x,artifactSHA256:sha(b)};}
for(const name of ['RollupProxy','TransparentUpgradeableProxy','ProxyAdmin','ValidatorWallet']){
 let hits=[];function find(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())find(p);else if(e.name===name+'.json')hits.push(p);}}find(artifactRoot);if(hits.length!==1)throw Error('Missing auxiliary artifact '+name);const b=fs.readFileSync(hits[0]),x=JSON.parse(b);const rec=record.main.artifacts.find(a=>a.path===path.relative(artifactRoot,hits[0]));if(!rec||sha(b)!==rec.sha256)throw Error('Aux artifact mismatch');all[x.sourceName+':'+x.contractName]={artifact:x,artifactSHA256:sha(b)};
}
const out={schema:'gh0st.gl3.exact-runtime-metadata.v1',compiler:solc.version(),sourceCommit:PIN,compilationRecordSHA256:sha(fs.readFileSync(recordPath)),contracts:{},runs:[],sourceHashes:hashes};
function run(runs,filter){const selection={'*':{'':['ast']}};for(const [key,v] of Object.entries(all))if(filter(v.artifact.sourceName)){selection[v.artifact.sourceName]??={};selection[v.artifact.sourceName]['*']=['evm.bytecode','evm.deployedBytecode'];}
 const input={language:'Solidity',sources,settings:{metadata:{bytecodeHash:'none'},optimizer:{enabled:true,runs},evmVersion:'london',outputSelection:selection}},t=Date.now(),o=JSON.parse(solc.compile(JSON.stringify(input),{import:imports}));if((o.errors||[]).some(x=>x.severity==='error'))throw Error(JSON.stringify(o.errors.filter(x=>x.severity==='error')));
 const vars={};function visit(v){if(!v||typeof v!=='object')return;if(v.nodeType==='VariableDeclaration'&&v.mutability==='immutable')vars[v.id]={name:v.name,type:v.typeDescriptions.typeString};for(const x of Object.values(v))if(typeof x==='object')if(Array.isArray(x))x.forEach(visit);else visit(x);}
 for(const s of Object.values(o.sources||{}))visit(s.ast);
 let n=0;for(const [key,v] of Object.entries(all)){const a=v.artifact;if(!filter(a.sourceName))continue;const c=o.contracts[a.sourceName][a.contractName];if('0x'+c.evm.bytecode.object!==a.bytecode||'0x'+c.evm.deployedBytecode.object!==a.deployedBytecode)throw Error('Exact bytecode mismatch '+key);const immutables=Object.entries(c.evm.deployedBytecode.immutableReferences||{}).map(([id,locations])=>{if(!vars[id])throw Error('Unknown immutable AST id');return {...vars[id],locations};});out.contracts[a.contractName]={source:a.sourceName,artifactSHA256:v.artifactSHA256,templateRuntime:a.deployedBytecode,templateRuntimeSHA256:sha(Buffer.from(a.deployedBytecode.slice(2),'hex')),immutables};n++;}
 out.runs.push({optimizerRuns:runs,contracts:n,seconds:(Date.now()-t)/1000,inputSHA256:sha(JSON.stringify(input))});
}
const overrides=new Set(['src/rollup/RollupUserLogic.sol','src/rollup/RollupAdminLogic.sol','src/challengeV2/EdgeChallengeManager.sol']);run(2000,s=>!overrides.has(s));run(20,s=>s==='src/rollup/RollupUserLogic.sol'||s==='src/rollup/RollupAdminLogic.sol');run(200,s=>s==='src/challengeV2/EdgeChallengeManager.sol');
fs.writeFileSync(D+'/runtime-metadata.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({passed:true,contracts:Object.keys(out.contracts).length,runs:out.runs,immutables:Object.fromEntries(Object.entries(out.contracts).map(([k,v])=>[k,v.immutables.map(x=>x.name)]))}));
