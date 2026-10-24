import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const d=path.dirname(fileURLToPath(import.meta.url)),mask256=(1n<<256n)-1n,sign256=1n<<255n,mask12=4095n;
const signed256=x=>x>=sign256?x-(1n<<256n):x;
// Evaluate the EVM's fixed-width SHL/SHR/SAR independently over every accepted integer,
// every lane and hostile neighbor bits. This supplements, rather than replaces, deployed EVM tests.
let comparisons=0;
for(let value=-1024;value<=1024;value++)for(let lane=0;lane<21;lane++){
 const shift=BigInt(lane*12),field=mask12<<shift,encoded=(BigInt(value)&mask12)<<shift;
 for(const neighbors of [0n,mask256,0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaan]){
  const packed=(neighbors&(~field&mask256))|encoded;
  const shr=packed>>shift,shl=(shr<<244n)&mask256,decoded=signed256(shl)>>244n;
  assert.equal(decoded,BigInt(value));comparisons++;
 }
}
const r={status:'PASS',scope:'OFFCHAIN_EXHAUSTIVE_BIT_PROOF',allowedMin:-1024,allowedMax:1024,integerValues:2049,lanes:21,neighborPatterns:3,comparisons,doesNotReplaceEvmIntegration:true};
fs.writeFileSync(path.join(d,'exhaustive-state-codec.json'),JSON.stringify(r,null,2)+'\n');console.log(r);
