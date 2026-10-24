// Offline reproducible uint256 draws, exactly matching the Solidity ABI domain.
import { AbiCoder, keccak256, toBeHex, zeroPadValue } from 'ethers';
import { openSync, closeSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const count=Number(process.argv[2]||65536);
const steps=Number(process.argv[3]||4);
if(!Number.isInteger(count)||count<1||count>1048576||!Number.isInteger(steps)||steps<1||steps>16)throw Error('Invalid count or steps');
const output=path.join(directory,`seed-draws-${count}${steps===4?'':'x'+steps}.bin`),fd=openSync(output,'w');
const coder=AbiCoder.defaultAbiCoder();
try{
  for(let i=0;i<count;i++){
    const seed=zeroPadValue(toBeHex(i),32);
    const words=[];
    for(let step=0;step<steps;step++)words.push(Buffer.from(keccak256(coder.encode(
      ['string','bytes32','uint256'],['GH0ST_SAMPLE_STEP_V1',seed,step])).slice(2),'hex'));
    writeSync(fd,Buffer.concat(words));
  }
}finally{closeSync(fd);}
console.log(JSON.stringify({count,steps,bytes:count*steps*32,path:output,seedEncoding:'uint256 index, zero-padded bytes32'}));
