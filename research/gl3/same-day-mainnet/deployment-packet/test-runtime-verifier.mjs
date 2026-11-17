// Independent constructor execution, not a Nitro chain/bridge/finality test.
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {Interface,keccak256,toBeHex,Transaction} from '/root/dispute/node_modules/ethers/lib.esm/index.js';
import {assertRuntime,expectedRuntime,verifyStep} from './verify-deployment-step.mjs';
const require=createRequire('/root/dispute/package.json'),ganache=require('ganache'),D='/workspace/gl3/same-day-mainnet/deployment-packet',meta=JSON.parse(fs.readFileSync(D+'/runtime-metadata.json')),draft=JSON.parse(fs.readFileSync(D+'/candidate-configured-owner/unsigned-deployment-plan.json'));
assert.equal(process.platform,'linux');
const provider=ganache.provider({chain:{chainId:4663,hardfork:'shanghai'},wallet:{deterministic:true},miner:{blockGasLimit:200000000},logging:{quiet:true}}),read=(method,params)=>provider.request({method,params});
const result={scope:'Private in-process EVM constructor unit with chain4663 and explicitly mocked constructor-only ArbSys detection; NOTgenuineNitro/bridge/finality',passed:false,publicWrites:0,realKeysRead:false,cases:[]};
try{
 const from=(await read('eth_accounts',[]))[0],proxy='0x4e59b44847b379578588920cA78FbF26c0B4956C';
 const helper=fs.readFileSync('/root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance/git/nitro-contracts-4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/rollup/DeployHelper.sol','utf8'),raw='0x'+helper.match(/NICK_CREATE2_PAYLOAD\s*=\s*hex"([0-9a-f]+)"/)[1].slice(2),tx=Transaction.from(raw),code='0x'+tx.data.slice(-138);
 assert.equal(keccak256(code),'0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989');
 await read('evm_setAccountCode',[proxy,code]);await read('evm_setAccountCode',['0x0000000000000000000000000000000000000064','0x607460005260206000f3']);
 for(const a of draft.actions){
  const hash=await read('eth_sendTransaction',[{from,to:proxy,data:a.data,gas:'0xbebc200',gasPrice:'0x77359400'}]),r=await read('eth_getTransactionReceipt',[hash]);assert.equal(BigInt(r.status),1n);
  const actual=await read('eth_getCode',[a.predictedAddress,'latest']);let runtimeHash;
  if(meta.contracts[a.contract])runtimeHash=assertRuntime(meta,a,a.predictedAddress,actual);
  else{const artifact=JSON.parse(fs.readFileSync(a.contract==='UpgradeExecutor'?'/workspace/gl3/testnet/withdrawal-recovery/UpgradeExecutor.json':D+'/pricer-artifact.json'));assert.equal(actual,artifact.deployedBytecode);runtimeHash=keccak256(actual);}
  result.cases.push({name:'actual-constructor-runtime-'+a.label,passed:true,runtimeHash,gasUsed:String(BigInt(r.gasUsed))});
 }
 // Constructor state is checked independently through exact public getters.
 const creator=draft.actions.find(a=>a.label==='rollupCreator'),cabi=new Interface(['function owner() view returns(address)','function bridgeCreator() view returns(address)','function osp() view returns(address)','function challengeManagerTemplate() view returns(address)','function rollupAdminLogic() view returns(address)','function rollupUserLogic() view returns(address)','function upgradeExecutorLogic() view returns(address)','function validatorWalletCreator() view returns(address)','function l2FactoriesDeployer() view returns(address)']);
 for(const [i,name] of ['owner','bridgeCreator','osp','challengeManagerTemplate','rollupAdminLogic','rollupUserLogic','upgradeExecutorLogic','validatorWalletCreator','l2FactoriesDeployer'].entries()){const b=await read('eth_call',[{to:creator.predictedAddress,data:cabi.encodeFunctionData(name,[])},'latest']);assert.equal(cabi.decodeFunctionResult(name,b)[0].toLowerCase(),creator.constructorArgs[i].toLowerCase());result.cases.push({name:'actual-creator-getter-'+name,passed:true});}
 const a=draft.actions.find(a=>a.label==='erc20SequencerInboxDelayBufferable'),actual=await read('eth_getCode',[a.predictedAddress,'latest']),bytes=Buffer.from(actual.slice(2),'hex');bytes[0]^=1;assert.throws(()=>assertRuntime(meta,a,a.predictedAddress,'0x'+bytes.toString('hex')),/mismatch/);result.cases.push({name:'opcode-tampering-rejected',passed:true});
 for(const name of ['deployTimeChainId','hostChainIsArbitrum','maxDataSize','__self','isUsingFeeToken','isDelayBufferable','gasPerBlob']){const b=Buffer.from(actual.slice(2),'hex'),v=meta.contracts.SequencerInbox.immutables.find(x=>x.name===name);assert(v);b[v.locations[0].start+31]^=1;assert.throws(()=>assertRuntime(meta,a,a.predictedAddress,'0x'+b.toString('hex')),/mismatch/);result.cases.push({name:'immutable-tampering-rejected-'+name,passed:true});}
 let calls=0;await assert.rejects(()=>verifyStep({planSHA256:'00'.repeat(32),actionIndex:0,receiptHashes:[]},()=>{calls++;throw Error('unexpectedRPC');}),/plan_hash_mismatch/);assert.equal(calls,0);result.cases.push({name:'wrong-plan-hash-rejected-before-RPC',passed:true});
 result.passed=true;
}catch(e){result.error=String(e.stack||e);}finally{await provider.disconnect();fs.writeFileSync(D+'/runtime-verifier-unit-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,cases:result.cases.length,error:result.error}));}
if(!result.passed)process.exitCode=1;
