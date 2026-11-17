'use strict';
// Runpod-only source build for the separate bridge unit profile.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.equal(process.platform,'linux');
const R='/workspace/gl3/zk-rollup/bridge',req=require('node:module').createRequire('/root/dispute/package.json'),E=req('ethers');
const solc=req('solc/wrapper')(require(R+'/deps/soljson-0.8.17.js'));
assert(solc.version().startsWith('0.8.17+commit.8df45f5f'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),loaded={};
const sources={
 'src/bridge/GL3ExactERC20Bridge.sol':{content:fs.readFileSync(R+'/source/contracts/GL3ExactERC20Bridge.sol','utf8')},
 'src/bridge/ERC20Bridge.sol':{content:fs.readFileSync(R+'/upstream/src/bridge/ERC20Bridge.sol','utf8')},
 'unit/UnitFixtures.sol':{content:fs.readFileSync(R+'/source/tests/UnitFixtures.sol','utf8')},
};
const roots=[['src/',R+'/upstream/src/'],['@openzeppelin/contracts/',R+'/deps/openzeppelin-contracts/'],['@openzeppelin/contracts-upgradeable/',R+'/deps/openzeppelin-upgradeable/']];
function imports(name){const found=roots.find(([prefix])=>name.startsWith(prefix));assert(found,'Unexpected import '+name);const f=path.resolve(found[1],name.slice(found[0].length));assert(f.startsWith(path.resolve(found[1])+'/'));const text=fs.readFileSync(f,'utf8');loaded[name]=sha(text);return {contents:text};}
const input={language:'Solidity',sources,settings:{metadata:{bytecodeHash:'none'},optimizer:{enabled:true,runs:2000},evmVersion:'london',outputSelection:{'src/bridge/GL3ExactERC20Bridge.sol':{'GL3ExactERC20Bridge':['abi','evm.bytecode','evm.deployedBytecode','storageLayout']},'src/bridge/ERC20Bridge.sol':{'ERC20Bridge':['abi','storageLayout']},'unit/UnitFixtures.sol':{'*':['abi','evm.bytecode','evm.deployedBytecode']}}}};
const at=Date.now(),output=JSON.parse(solc.compile(JSON.stringify(input),{import:imports})),errors=(output.errors||[]).filter(e=>e.severity==='error');
fs.writeFileSync(R+'/evidence/compile-diagnostics.json',JSON.stringify(output.errors||[],null,2)+'\n');assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join('\n'));
const fork=output.contracts['src/bridge/GL3ExactERC20Bridge.sol'].GL3ExactERC20Bridge,canonical=output.contracts['src/bridge/ERC20Bridge.sol'].ERC20Bridge;
const signatures=abi=>new E.Interface(abi).fragments.filter(f=>f.type==='function'||f.type==='event').map(f=>f.type+':'+f.format('sighash')).sort();assert.deepEqual(signatures(fork.abi),signatures(canonical.abi));
function layout(x){return x.storage.map(v=>({label:v.label,slot:v.slot,offset:v.offset,type:x.types[v.type].label,encoding:x.types[v.type].encoding,bytes:x.types[v.type].numberOfBytes}));}assert.deepEqual(layout(fork.storageLayout),layout(canonical.storageLayout));
const artifacts={};for(const [source,contracts]of Object.entries(output.contracts))for(const [name,c]of Object.entries(contracts)){if(!c.evm?.bytecode?.object)continue;assert(!c.evm.bytecode.object.includes('__'));const a={contractName:name,sourceName:source,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object};assert(E.dataLength(a.deployedBytecode)<=24576);artifacts[name]=a;}
fs.writeFileSync(R+'/evidence/unit-artifacts.json',JSON.stringify(artifacts,null,2)+'\n');
const result={passed:true,scope:'Compilation and ABI/storage-layout comparison only; no proof or chain execution',compiler:solc.version(),compilerModuleSHA256:sha(fs.readFileSync(R+'/deps/soljson-0.8.17.js')),sourceCommit:'4341b132cfbdcc980ead03765ca5224ff6cb5d97',evmVersion:'london',optimizerRuns:2000,inputSHA256:sha(JSON.stringify(input)),ownSourceSHA256:Object.fromEntries(Object.entries(sources).map(([n,s])=>[n,sha(s.content)])),importSHA256:loaded,storageLayoutMatchesCanonical:true,functionAndEventSignaturesMatchCanonical:true,canonicalStorage:layout(canonical.storageLayout),forkRuntimeBytes:E.dataLength(artifacts.GL3ExactERC20Bridge.deployedBytecode),artifactsSHA256:sha(fs.readFileSync(R+'/evidence/unit-artifacts.json')),seconds:(Date.now()-at)/1000};fs.writeFileSync(R+'/evidence/compile-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,compiler:result.compiler,seconds:result.seconds,forkRuntimeBytes:result.forkRuntimeBytes,storageLayoutMatchesCanonical:true,functionAndEventSignaturesMatchCanonical:true}));
