import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DEFAULT_MANIFEST,loadRuntimeFixtures} from './runtime-fixtures.mjs';

const good=loadRuntimeFixtures();
assert.equal(Object.keys(good.runtimes).length,544);
const temp=mkdtempSync(path.join(os.tmpdir(),'gh0st-fixture-negative-'));
const original=JSON.parse(readFileSync(DEFAULT_MANIFEST));
let rejected=0;
try{
  for(const mutate of [
    m=>{m.runtimes[0].runtime_code_hash='0x'+'00'.repeat(32);},
    m=>{m.sources[0].sha256='00'.repeat(32);},
    m=>{m.runtimes[1].address=m.runtimes[0].address;},
    m=>{m.runtimes[0].length=Number.MAX_SAFE_INTEGER;},
    m=>{m.runtimes[262].prefix_hex='00';},
    m=>{m.sources[0].path=DEFAULT_MANIFEST;},
    m=>{m.constructor_groups.weights.reverse();},
  ]){
    const changed=structuredClone(original);mutate(changed);
    const manifestPath=path.join(temp,'bad.json');writeFileSync(manifestPath,JSON.stringify(changed));
    assert.throws(()=>loadRuntimeFixtures({manifestPath}));rejected++;
  }
}finally{rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify({status:'PASS',verifiedRuntimes:544,rejectedTamperingCases:rejected}));
