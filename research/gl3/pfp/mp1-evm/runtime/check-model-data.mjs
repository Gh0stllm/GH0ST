import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(new URL('../../../../chess/package.json',import.meta.url));
const { ContractFactory, JsonRpcProvider, getAddress, id, keccak256, concat } = require('ethers');
const solc = require('solc');
const manifest=JSON.parse(await readFile(new URL('model-manifest.json',import.meta.url),'utf8'));
const packDir=resolve(process.argv[2] ?? '');
const parts=await Promise.all(manifest.files.map(async ({name,bytes})=>{
  const body=await readFile(resolve(packDir,name));
  assert.equal(body.length,bytes);
  return body;
}));
const packageBytes=Buffer.concat(parts);
assert.equal(createHash('sha256').update(packageBytes).digest('hex'),manifest.modelSHA256);
assert.equal(packageBytes.length,manifest.payloadBytes);
const testShards=[];
for(let start=0;start<packageBytes.length;start+=manifest.shardPayloadLimit){
  const blob=Buffer.concat([Buffer.alloc(1),packageBytes.subarray(start,start+manifest.shardPayloadLimit)]);
  testShards.push({
    address:getAddress('0x'+id('mp1-local-test-shard-'+testShards.length).slice(-40)),
    code:'0x'+blob.toString('hex'),
  });
}
assert.deepEqual(testShards.map(s=>keccak256(s.code)),manifest.codeHashes);
assert.equal(keccak256(concat(manifest.codeHashes)),manifest.commitment);

const source=await readFile(new URL('Mp1ModelData.sol',import.meta.url),'utf8');
const compiled=JSON.parse(solc.compile(JSON.stringify({
  language:'Solidity',sources:{'Mp1ModelData.sol':{content:source}},
  settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',
    outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}},
})));
assert(!(compiled.errors??[]).some(e=>e.severity==='error'),JSON.stringify(compiled.errors));
const artifact=compiled.contracts['Mp1ModelData.sol'].Mp1ModelData;
const server=spawn(process.env.ANVIL_BIN??'anvil',['--host','127.0.0.1','--port','0','--chain-id','4663'],{
  stdio:['ignore','pipe','ignore'],
});
let provider;
try {
  const port=await new Promise((res,rej)=>{
    let output='';
    const deadline=setTimeout(()=>rej(Error('Anvil did not start')),8000);
    server.once('error',error=>{clearTimeout(deadline);rej(error);});
    server.once('exit',()=>{clearTimeout(deadline);rej(Error('Anvil exited'));});
    server.stdout.on('data',bytes=>{
      output+=bytes.toString('utf8');
      const port=output.match(/Listening on 127\.0\.0\.1:(\d+)/)?.[1];
      if(port){ clearTimeout(deadline); res(port); }
    });
  });
  provider=new JsonRpcProvider('http://127.0.0.1:'+port,{name:'isolated-robinhood-test',chainId:4663},{pollingInterval:50,cacheTimeout:-1});
  for(const {address,code} of testShards)await provider.send('anvil_setCode',[address,code]);
  const account=await provider.getSigner(0);
  const factory=new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,account);
  const addresses=testShards.map(shard=>shard.address);
  const incorrect=[addresses[1],addresses[0],...addresses.slice(2)];
  await assert.rejects(provider.call(await factory.getDeployTransaction(incorrect)),{code:'CALL_EXCEPTION'});
  const contract=await factory.deploy(addresses);
  const receipt=await contract.deploymentTransaction().wait();
  assert.equal(receipt.status,1);
  assert.equal((await contract.MODEL_SHA256()).slice(2),manifest.modelSHA256);
  assert.equal(await contract.SHARD_CODE_ROOT(),manifest.commitment);
  const ranges=[[0,77],[98303-19,102],[98303*2-10,33],[2858456-8,24],[2869978-17,40],[2882269-10,26],[packageBytes.length-93,93],[packageBytes.length,0]];
  for(const [offset,length] of ranges){
    const out=await contract.read(offset,length);
    assert.equal(out,'0x'+packageBytes.subarray(offset,offset+length).toString('hex'));
  }
  await assert.rejects(contract.read(packageBytes.length-1,2),{code:'CALL_EXCEPTION'});
  console.log(JSON.stringify({scope:'isolated EVM registry test with all 31 weights shards',chainId:4663,
    testedRanges:ranges.length,incorrectShardOrderRejected:true,invalidRangeRejected:true,constructorGas:receipt.gasUsed.toString(),
    payloadBytes:packageBytes.length,modelSHA256:manifest.modelSHA256},null,2));
} finally {
  provider?.destroy();
  server.kill('SIGTERM');
}
