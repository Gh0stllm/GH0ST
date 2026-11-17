// Root-only execution of two reviewed hot-wallet actions. Never loads the cold key.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {executePlan,validatePrepared,validateConsent} from './actions.mjs';
const {Wallet,JsonRpcProvider,Interface}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
const base='/workspace/gl3/same-day-mainnet/ops/operator-actions';
const main='/workspace/gl3/mainnet';
const bindings={
 'validator-approve':{sha:'6cd96acbebdfe4ab4183a1ce9c9a27383eb899440b53dbb1d99094ac5f971fee',owner:'0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad',nonce:0,fee:'2225262504000'},
 'deployer-refund':{sha:'7706167d06cb0ab11d55cf390192fe04b0a804d8be6aa73b77642f55c69ad927',owner:'0x1E0a95665dc872899eb89018455ef44B27108FCd',nonce:27,fee:'1011326400000'}
};
const sha=b=>createHash('sha256').update(b).digest('hex');
const encode=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
function privateFile(p){const s=fs.lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink()&&fs.realpathSync(p)===p&&s.uid===process.getuid()&&(s.mode&0o077)===0);}
try{
 assert.equal(process.platform,'linux');process.umask(0o077);
 const [kind,mode]=process.argv.slice(2);assert(Object.hasOwn(bindings,kind)&&['check','execute'].includes(mode));
 assert.equal(sha(fs.readFileSync(base+'/actions.mjs')),'79f09301a830cb2d75bdfddb24de0f5266ff4e973a3ed06e61e71e3be80aebd4');
 const planPath=base+'/plans/'+kind+'.json',authorizationPath=main+'/review/'+kind+'.authorization.json';
 privateFile(planPath);privateFile(authorizationPath);const bytes=fs.readFileSync(planPath);assert.equal(sha(bytes),bindings[kind].sha);
 const p=validatePrepared(JSON.parse(bytes)),a=p.action.transaction,authorization=JSON.parse(fs.readFileSync(authorizationPath));validateConsent(authorization,sha(bytes),p);
 assert.equal(p.owner,bindings[kind].owner);assert.equal(a.nonce,bindings[kind].nonce);assert.equal(p.action.maxCostWei,bindings[kind].fee);
 assert.equal(p.rollup,'0xeE811A8ee20C03E684ECB5BFd6f7721f85451b01');
 assert.equal(authorization.originalUserConsentSHA256,'0df2afcd7ce8ea778d5a7e8c8972c4f184640621693130223bc30832dbf810dc');
 if(kind==='validator-approve'){
  assert.equal(a.to,'0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559');assert.equal(a.value,'0');
  const parsed=new Interface(['function approve(address,uint256)returns(bool)']).parseTransaction({data:a.data});
  assert.equal(parsed.args[0],p.rollup);assert.equal(parsed.args[1],100000n*10n**18n);
 }else{assert.equal(a.to,'0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6');assert.equal(a.data,'0x');assert.equal(a.value,'3371295247024000');}
 if(mode==='check'){console.log(encode({passed:true,kind,exactPlanSHA256:sha(bytes),maximumFeeWei:p.action.maxCostWei,privateKeysRead:false,transactionsSubmitted:0}));}
 else{
  const provider=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});
  try{
   const result=await executePlan({planPath,authorizationPath,provider,getSigner:async()=>{
    const file=main+'/private/'+(kind==='validator-approve'?'operators.json':'deployment-signer.json');privateFile(file);
    const raw=fs.readFileSync(file),record=JSON.parse(raw),identity=kind==='validator-approve'?record.roles.validator:record;
    const wallet=new Wallet(identity.privateKey,provider);assert.equal(wallet.address,bindings[kind].owner);assert.equal(identity.address,wallet.address);raw.fill(0);identity.privateKey=undefined;return wallet;
   }});
   const out={schema:'gh0st.gl3.operator-action-result.v1',createdUTC:new Date().toISOString(),...result};
   fs.writeFileSync(main+'/identities/'+kind+'.result.json',encode(out),{mode:0o600,flag:'wx'});console.log(encode(out));
  }finally{provider.destroy();}
 }
}catch{
 console.error('Reviewed operator action stopped. Preserve all plans and journals; reconcile any saved hash before another action. No automatic retry.');process.exitCode=1;
}
