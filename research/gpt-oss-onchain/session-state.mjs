import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,hexlify,keccak256} from 'ethers';
import {compile} from './session-optimize.mjs';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const source=fs.readFileSync(ROOT+'VectorState.sol','utf8');
async function main(){
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
const builds=['VectorStateControl','PackedVectorState'].map(name=>compile(source,10000,true,name));
const deploy=async(build,n)=>{const c=await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy(n);await c.waitForDeployment();return c;};
const report={status:'RUNNING',synthetic_only:true,source_sha256:crypto.createHash('sha256').update(source).digest('hex'),
environment:{chain_id:31337,hardfork:'shanghai',compiler_runs:10000,viaIR:true},benchmarks:[],validation:{roundtrips:0,invalid_rejections:0},
limits:['Only storage of existing 16-bit payloads; no conversion from arbitrary int256/Q32 values.',
'Raw BF16 bit patterns can be stored exactly, but no model arithmetic or quality test is performed.',
'Baseline uses int256 slots for sign-extended int16 values; this is not a claim against Solidity automatic uint16[] packing.',
'All storage measurements are local receipts, with refund rules applied for resets.']};
const save=()=>fs.writeFileSync(ROOT+'evidence/state-experiments.json',JSON.stringify(report,null,2)+'\n');
const gas=async(contract,method,args=[])=>{const tx=await contract[method].populateTransaction(...args);const sent=await signer.sendTransaction({...tx,gasLimit:95_000_000});const receipt=await sent.wait();assert.equal(receipt.status,1);return Number(receipt.gasUsed);};
for(const count of [0,1,15,16,17,255,256,2880]){
const contracts=await Promise.all(builds.map(b=>deploy(b,count)));
const stages=[];
for(const [stage,offset] of [['cold_random',0],['overwrite_random',193],['reset_zero',-1]]){
 const data=Buffer.alloc(count*2);for(let i=0;i<count;i++)data.writeUInt16BE(offset<0?0:((i*4051+32881+offset)&65535),i*2);
 const expected=keccak256(data),used=[];
 for(const c of contracts){used.push(await gas(c,'set',[hexlify(data)]));assert.equal(await c.digest(),expected);report.validation.roundtrips++;}
 const read=[];for(const c of contracts)read.push(await gas(c,'digest'));
 stages.push({stage,control_write_gas:used[0],packed_write_gas:used[1],write_reduction_percent:100*(used[0]-used[1])/used[0],control_read_digest_gas:read[0],packed_read_digest_gas:read[1]});
}
for(const c of contracts){await assert.rejects(c.set('0x01'));report.validation.invalid_rejections++;}
report.benchmarks.push({values:count,control_data_slots:count,packed_data_slots:Math.ceil(count/16),stages});save();console.log(JSON.stringify({stage:'state',values:count,results:stages}));
}
// Exercise every possible 16-bit payload without assigning float semantics.
const count=256,contracts=await Promise.all(builds.map(b=>deploy(b,count)));
for(let page=0;page<256;page++){
const bytes=Buffer.alloc(count*2);for(let i=0;i<count;i++)bytes.writeUInt16BE(page*256+i,i*2);
const want=keccak256(bytes);for(const c of contracts){await(await c.set(hexlify(bytes),{gasLimit:20_000_000})).wait();assert.equal(await c.digest(),want);report.validation.roundtrips++;}
if(page%32===31){save();console.log(JSON.stringify({stage:'state_all_bits',pages:page+1,patterns:(page+1)*256}));}
}
report.validation.distinct_16bit_patterns=65536;report.status='PASS_16BIT_STORAGE_FORMAT';report.finished_at=new Date().toISOString();save();await local.disconnect();console.log(JSON.stringify({stage:'state_complete',validation:report.validation}));
}
main().catch(e=>{fs.writeFileSync(ROOT+'evidence/state-failure.json',JSON.stringify({error:String(e),stack:e.stack},null,2)+'\n');console.error(e);process.exitCode=1;});
