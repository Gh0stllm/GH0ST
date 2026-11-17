'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
assert.equal(process.platform, 'linux');
const R = process.env.GL3_COORDINATOR_TEST_ROOT || '/workspace/gl3/zk-rollup/coordinator';
const requirePod = require('node:module').createRequire('/root/dispute/package.json');
const solc = requirePod('solc/wrapper')(require('/workspace/gl3/zk-rollup/bridge/deps/soljson-0.8.17.js'));
assert(solc.version().startsWith('0.8.17+commit.8df45f5f'));
const files = ['GL3ZkTypes.sol','GL3DataRegistry.sol','GL3ZkCoordinator.sol','tests/UnitFixtures.sol'];
const sources = Object.fromEntries(files.map(name => [name,{content:fs.readFileSync(path.join(R,'source',name),'utf8')}]));
const input = {language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:2000},evmVersion:'london',metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode','evm.deployedBytecode']}}}};
const began = Date.now(), output = JSON.parse(solc.compile(JSON.stringify(input)));
fs.writeFileSync(R+'/evidence/compile-diagnostics.json', JSON.stringify(output.errors||[],null,2)+'\n');
const errors = (output.errors||[]).filter(x=>x.severity==='error');
assert.equal(errors.length,0,errors.map(x=>x.formattedMessage).join('\n'));
const artifacts = {};
for(const [source,contracts] of Object.entries(output.contracts)) for(const [name,c] of Object.entries(contracts)) {
    if(!c.evm.bytecode.object) continue;
    assert(c.evm.deployedBytecode.object.length/2<=24576,'EIP170 '+name);
    artifacts[name]={source,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtimeBytes:c.evm.deployedBytecode.object.length/2};
}
fs.writeFileSync(R+'/evidence/unit-artifacts.json',JSON.stringify(artifacts,null,2)+'\n');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const report={passed:true,compiler:solc.version(),inputSHA256:sha(JSON.stringify(input)),seconds:(Date.now()-began)/1000,runtimeBytes:Object.fromEntries(Object.entries(artifacts).map(([k,v])=>[k,v.runtimeBytes])),scope:'Compilation only; no canonical STF proof or production acceptance'};
fs.writeFileSync(R+'/evidence/compile-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
