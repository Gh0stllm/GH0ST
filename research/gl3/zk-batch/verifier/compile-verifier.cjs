// Runpod-only compilation of the unchanged pinned Succinct verifier.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
assert(__dirname.startsWith('/workspace/gl3/zk-tests/'));
const solc=require('/root/dispute/node_modules/solc'),E=require('/root/dispute/node_modules/ethers');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),lock=JSON.parse(fs.readFileSync(__dirname+'/source-lock.json'));
const sources={};for(const f of lock.files){const raw=fs.readFileSync(__dirname+'/'+f.path);assert.equal(sha(raw),f.SHA256);sources[f.path.slice('contracts/'.length)]={content:raw.toString('utf8')};}
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'london',metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const start=process.hrtime.bigint(),output=JSON.parse(solc.compile(JSON.stringify(input)));assert.deepEqual((output.errors||[]).filter(x=>x.severity==='error'),[]);
const a=output.contracts['v5.0.0/SP1VerifierGroth16.sol'].SP1Verifier;
const artifact={contractName:'SP1Verifier',upstreamCommit:lock.commit,circuitVersion:lock.SP1CircuitVersion,expectedVerifierHash:lock.verifierHash,compiler:solc.version(),compilerModuleSHA256:sha(fs.readFileSync(require.resolve('/root/dispute/node_modules/solc/soljson.js'))),settings:input.settings,sourceLockSHA256:sha(fs.readFileSync(__dirname+'/source-lock.json')),abi:a.abi,bytecode:'0x'+a.evm.bytecode.object,runtime:'0x'+a.evm.deployedBytecode.object,compileSeconds:Number(process.hrtime.bigint()-start)/1e9};
artifact.runtimeKeccak256=E.keccak256(artifact.runtime);artifact.creationBytes=(artifact.bytecode.length-2)/2;artifact.runtimeBytes=(artifact.runtime.length-2)/2;
fs.writeFileSync(__dirname+'/verifier-artifact.json',JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({compiled:true,compiler:artifact.compiler,compileSeconds:artifact.compileSeconds,creationBytes:artifact.creationBytes,runtimeBytes:artifact.runtimeBytes,runtimeKeccak256:artifact.runtimeKeccak256,actualProofVerified:false}));
