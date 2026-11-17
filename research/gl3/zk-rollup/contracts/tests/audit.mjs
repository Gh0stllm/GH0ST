import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const E=createRequire('/root/dispute/package.json')('ethers');
assert.equal(process.platform,'linux');
const R=process.env.GL3_COORDINATOR_TEST_ROOT;
assert(R&&R.startsWith('/workspace/gl3/zk-rollup/coordinator'));
const O=R+'/evidence',read=n=>JSON.parse(fs.readFileSync(O+'/'+n));
const result=read('result.json'),actual=read('actual-exit.json'),controller=read('controller-result.json');
assert.equal(result.passed,true);assert.equal(controller.passed,true);assert.equal(actual.exitCode,0);assert.equal(actual.terminationReason,null);
assert.equal(result.checkCount,result.checks.length);assert(result.checks.every(x=>x.passed===true));
const sourceManifest=read('source-manifest.json');
for(const [name,expected] of Object.entries(sourceManifest)) assert.equal(createHash('sha256').update(fs.readFileSync(R+'/'+name)).digest('hex'),expected,name);
const seen=new Set(),index=read('receipt-index.json');let failed=0;
for(const item of index){
    assert(!seen.has(item.hash));seen.add(item.hash);
    const receipt=read('receipts/'+item.hash+'.json'),raw=read('transactions/'+item.hash+'.json');
    assert.equal(receipt.transactionHash,item.hash);assert.equal(raw.hash,item.hash);
    assert.equal(Number(BigInt(receipt.status)),item.status);assert.equal(BigInt(receipt.gasUsed),BigInt(item.gas));
    if(item.status===0){failed++;assert(BigInt(receipt.gasUsed)<1000000n);}
    const type=Number(BigInt(raw.type));assert([0,1,2].includes(type));
    const tx={type,chainId:BigInt(raw.chainId),nonce:Number(BigInt(raw.nonce)),gasLimit:BigInt(raw.gas),to:raw.to,data:raw.input,value:BigInt(raw.value),signature:{r:raw.r,s:raw.s,v:BigInt(raw.v)}};
    if(type===2){tx.maxPriorityFeePerGas=BigInt(raw.maxPriorityFeePerGas);tx.maxFeePerGas=BigInt(raw.maxFeePerGas);}
    else tx.gasPrice=BigInt(raw.gasPrice);
    if(type!==0)tx.accessList=raw.accessList;
    const recovered=E.Transaction.from(tx);assert.equal(recovered.hash,item.hash);assert.equal(recovered.from.toLowerCase(),raw.from.toLowerCase());
}
assert.equal(failed,R.endsWith('-v2')?17:16);
const pid=result.ownedGeth.pid;
let ownedStillRunning=false;
try{ownedStillRunning=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').includes(R+'/runtime/geth');}catch(e){assert.equal(e.code,'ENOENT');}
assert.equal(ownedStillRunning,false);
const audit={passed:true,scope:'Independent saved-unit source, signed-transaction hash, receipt/status/gas and process cleanup audit; no real proof acceptance',sourceFiles:Object.keys(sourceManifest).length,transactions:index.length,minedReverts:failed,groupedCases:result.checkCount,ownedChainProcesses:0,asOfUTC:new Date().toISOString()};
fs.writeFileSync(O+'/independent-audit.json',JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));
