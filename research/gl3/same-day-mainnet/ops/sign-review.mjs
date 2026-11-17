import assert from 'node:assert/strict';
import {randomBytes, createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {Transaction, JsonRpcProvider, getAddress, keccak256, formatEther, Interface} from 'ethers';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const OWNER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
const TOKEN='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const ROOT=resolve(process.env.GL3_REVIEW_DIR || '.');
const planPath=resolve(ROOT,'plan.json');
const planBytes=readFileSync(planPath), planHash=hash(planBytes), plan=JSON.parse(planBytes);
const journal=planPath+'.signed-journal.json';
const executionPath=process.env.GL3_EXECUTION_MODULE;
assert(executionPath && executionPath.startsWith('/'),'Set the reviewed execution module path.');
const {executeActions,validateSigned,unsignedForAction}=await import(pathToFileURL(executionPath));
const {validateReviewPlan,validateSponsorPlan}=await import('./review-core.mjs');
const sponsorMode=plan.schema==='gh0st.gl3.cold-sponsor-plan.v1';
const DEPLOYER='0x1E0a95665dc872899eb89018455ef44B27108FCd';
const {actions,totalFee,totalValue}=sponsorMode?validateSponsorPlan(plan,DEPLOYER):validateReviewPlan(plan);
if(sponsorMode)assert.equal(hash(Buffer.from(plan.delegatedPlanJSON)),plan.delegatedPlanSHA256);
for(const action of actions)unsignedForAction(action);
const approval=JSON.parse(readFileSync(resolve(ROOT,'technical-gates.json')));
assert.equal(approval.planSHA256,planHash,'Technical acceptance must bind this exact plan.');
assert.equal(approval.exactProfileBridgeRehearsalPassed,true,'The bridge rehearsal is incomplete.');
assert.equal(approval.genuineAssertionAndFastConfirmPassed,true);
assert.equal(approval.payoutAndReplayRejectionPassed,true);
assert.equal(approval.minimumAssertionPeriod,0);
assert.equal(approval.runtimeVerifierReady,true);
const termsPath=resolve(ROOT,'aep-terms.pdf'),terms=readFileSync(termsPath),termsHash=hash(terms);
assert.equal(approval.termsSHA256,termsHash);
const verifier=resolve(ROOT,'verify-previous.py');if(!sponsorMode)assert(existsSync(verifier));
const provider=new JsonRpcProvider(process.env.ROBINHOOD_MAINNET_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,cacheTimeout:-1});
const privateFile=p=>{const s=lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o077)===0&&s.uid===process.getuid());};
const keystorePath=process.env.GL3_COLD_KEYSTORE;
assert(keystorePath?.startsWith('/'));privateFile(keystorePath);
const encrypted=readFileSync(keystorePath,'utf8'),meta=JSON.parse(encrypted);
assert.equal(meta.version,3);assert.equal(getAddress('0x'+meta.address.replace(/^0x/,'')),OWNER);
assert(!['password','privateKey','private_key','mnemonic'].some(k=>Object.hasOwn(meta,k)));
assert(/^[a-fA-F0-9]{64}$/.test((meta.crypto??meta.Crypto).ciphertext));
const prior=()=>[journal,journal+'.lock',resolve(ROOT,'consent.json')].some(existsSync);
assert(!prior(),'An earlier signing intent needs reconciliation.');
const verifyPrior=async index=>{
 if(sponsorMode){
  assert.equal(keccak256(await provider.getCode(TOKEN)),'0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164');
  assert.equal(keccak256(await provider.getCode('0x4e59b44847b379578588920cA78FbF26c0B4956C')),'0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989');
  const roles=[[DEPLOYER,5000000000000000n],['0x52cc715ef517CE1933142d2168B43F8fdc54b7c5',10000000000000000n],['0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad',5000000000000000n]];
  for(let i=0;i<roles.length;i++){
   const [address,value]=roles[i];assert.equal(await provider.getCode(address),'0x');
   assert.equal(await provider.getTransactionCount(address,'pending'),0,'An operator wallet was already used.');
   assert.equal(await provider.getBalance(address),index>i?value:0n,'Unexpected operator funding balance.');
  }
  const result=await provider.call({to:TOKEN,data:new Interface(['function balanceOf(address) view returns(uint256)']).encodeFunctionData('balanceOf',['0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad'])});
  assert.equal(BigInt(result),index===4?100000000000000000000000n:0n,'Unexpected validator token balance.');
  return;
 }
 const r=await new Promise((done,reject)=>{
  const c=spawn('python3',[verifier,String(index),planHash],{stdio:['ignore','pipe','pipe']});
  let out='',err='';c.stdout.on('data',x=>{out+=x;if(out.length>65536)c.kill();});
  c.stderr.on('data',x=>{err+=x;if(err.length>65536)c.kill();});c.on('error',reject);
  c.on('close',code=>code===0?done(out):reject(new Error('Deployment verification stopped. Preserve the journal.')));
  setTimeout(()=>c.kill(),90000).unref();
 });
 const result=JSON.parse(r);assert(result.passed===true && result.planSHA256===planHash && result.beforeAction===index);
};
async function fresh(rpc,action){
 assert.equal(hash(readFileSync(planPath)),planHash,'The plan changed.');
 assert.equal(BigInt(await rpc.send('eth_chainId',[])),4663n);
 const [latest,pending,block,fees,balance]=await Promise.all([
 rpc.getTransactionCount(OWNER,'latest'),rpc.getTransactionCount(OWNER,'pending'),rpc.getBlock('latest'),rpc.getFeeData(),rpc.getBalance(OWNER)]);
 assert.equal(latest,action.nonce,'The wallet nonce changed. Reconcile before continuing.');
 assert.equal(pending,action.nonce,'Another transaction is pending.');
 const tx=action.transaction,cap=BigInt(tx.maxFeePerGas),tip=BigInt(tx.maxPriorityFeePerGas);
 assert(block?.baseFeePerGas!=null && block.baseFeePerGas+tip<=cap,'Current fees exceed this review.');
 assert(fees.maxPriorityFeePerGas!=null && fees.maxPriorityFeePerGas<=tip,'Current priority fee exceeds this review.');
 assert(balance>=BigInt(tx.value)+action.maxCostWei,'Funding wallet balance is too low.');
 await verifyPrior(action.id);
 const estimate=await rpc.estimateGas({from:OWNER,to:tx.to,data:tx.data,value:BigInt(tx.value)});
 assert(estimate<=BigInt(tx.gas),'Actual gas estimate exceeds the reviewed limit.');
}
await fresh(provider,actions[0]);
assert(await provider.getBalance(OWNER)>=totalFee+totalValue);
const html=readFileSync(resolve(ROOT,'index.html')),bundle=readFileSync(resolve(ROOT,'app.bundle.js'));
const prefix='/'+randomBytes(24).toString('hex')+'/',expires=Date.now()+2*60*60*1000;
let state={state:'ready',message:'Review the terms, trust assumptions and exact funding below.',expiresAt:expires};
let host,origin,server;
async function submit(raws,signed,consent){
 try{
  const consentPath=resolve(ROOT,'consent.json');
  const fd=await import('node:fs').then(fs=>fs.openSync(consentPath,'wx',0o600));
  const fs=await import('node:fs');try{fs.writeFileSync(fd,encode({...consent,planSHA256:planHash,termsSHA256:termsHash,acceptedUTC:new Date().toISOString(),transactionHashes:signed.map(t=>t.hash)})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const byHash=new Map(signed.map((t,i)=>[t.unsignedHash,raws[i]]));
  await executeActions({planPath,planHash,owner:OWNER,actions,provider,freshCheck:fresh,
   getSigner:async()=>({getAddress:async()=>OWNER,signTransaction:async request=>{const raw=byHash.get(Transaction.from(request).unsignedHash);assert(raw);return raw;}}),
   log:message=>{if(typeof message==='string'&&!message.includes('http'))console.log(message);}});
  await verifyPrior(actions.length);
  state={state:'confirmed',message:sponsorMode?'The exact funding is confirmed. The separate deployment wallet may now execute only the reviewed 27 deployment transactions.':'The reviewed deployment and bounded operator funding are confirmed. Public bridge activation remains subject to live readback and payment setup.',hashes:signed.map(t=>t.hash)};
 }catch{
  state={state:existsSync(journal)?'uncertain':'failed',message:'Execution stopped. Keep the signed journal and reconcile the saved hashes before another attempt.',hashes:signed.map(t=>t.hash)};
 }
}
server=createServer(async(req,res)=>{
 const reply=(code,type,body)=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(body);};
 const json=(code,data)=>reply(code,'application/json',encode(data));
 if(req.headers.host!==host || !req.url?.startsWith(prefix))return json(404,{message:'Unknown local review.'});
 const route=req.url.slice(prefix.length);
 if(req.method==='GET'&&route==='')return reply(200,'text/html; charset=utf-8',html);
 if(req.method==='GET'&&route==='app.bundle.js')return reply(200,'application/javascript',bundle);
 if(req.method==='GET'&&route==='plan')return reply(200,'application/json',planBytes);
 if(req.method==='GET'&&route==='terms')return reply(200,'application/pdf',terms);
 if(req.method==='GET'&&route==='status')return json(200,{...state,planSHA256:planHash,termsSHA256:termsHash});
 if(Date.now()>=expires||state.state!=='ready')return json(409,{message:'This review is closed. Reconcile its status before restarting.'});
 if(req.method==='GET'&&route==='keystore'&&req.headers['sec-fetch-site']==='same-origin'&&req.headers['sec-fetch-dest']==='empty'){
  try{assert(!prior());await fresh(provider,actions[0]);return reply(200,'application/json',encrypted);}catch{return json(409,{message:'Fresh network or deployment checks failed. No signature requested.'});}
 }
 if(req.method!=='POST'||route!=='submit'||req.headers.origin!==origin||req.headers['content-type']!=='application/json')return json(403,{message:'Use the local review page.'});
 try{
  let body='';for await(const b of req){body+=b;if(body.length>8*1024*1024){req.destroy();return;}}
  const p=JSON.parse(body);assert(Array.isArray(p.raws)&&p.raws.length===actions.length);
  assert(p.planSHA256===planHash&&p.termsSHA256===termsHash);
  const c=p.consent;assert(c?.termsAccepted===true&&c.securityAccepted===true&&c.budgetAccepted===true);
  assert(typeof c.operator==='string'&&c.operator.trim().length>=2&&c.operator.length<=300);
  assert(!prior());const signed=actions.map((a,i)=>validateSigned(a,p.raws[i],OWNER));
  assert(state.state==='ready'&&Date.now()<expires);state={state:'submitted',message:'Exact signatures received. Checking and sending reviewed transactions in order.',hashes:signed.map(t=>t.hash)};
  json(202,state);void submit(p.raws,signed,c);
 }catch{return json(400,{message:'The submission does not match this exact deployment and terms review.'});}
});
await new Promise(done=>server.listen(0,'127.0.0.1',()=>{host='127.0.0.1:'+server.address().port;origin='http://'+host;done();}));
console.log(encode({url:origin+prefix,planSHA256:planHash,termsSHA256:termsHash,maximumETHDebit:formatEther(totalFee+totalValue),actions:actions.length,broadcasts:0}));
setTimeout(()=>{if(state.state==='ready')state={state:'expired',message:'The review expired. No new signatures will be accepted.'};if(state.state!=='submitted')server.close();},2*60*60*1000).unref();
server.on('close',()=>{if(state.state!=='submitted')provider.destroy();});
