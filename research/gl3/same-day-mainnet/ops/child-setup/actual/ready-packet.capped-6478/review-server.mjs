// Run only on the owner's Mac after source/bundle review. No wallet password ever enters this server.
import * as fs from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {JsonRpcProvider,getAddress} from 'ethers';
import {OWNER,check,validatePlan,validateReceiptEvidence} from './policy.mjs';
import {Journal} from './journal.mjs';
import {SetupEngine} from './engine.mjs';
check(process.platform==='darwin','Cold-wallet review is Mac-local only. Never upload the cold keystore to Runpod.');
const hash=b=>createHash('sha256').update(b).digest('hex');
function priv(p,dir=false){check(p?.startsWith('/')&&resolve(p)===p);const s=fs.lstatSync(p);check(!s.isSymbolicLink()&&fs.realpathSync(p)===p&&s.uid===process.getuid()&&(s.mode&0o077)===0&&(dir?s.isDirectory():s.isFile()),'Private review path permissions/ownership differ.');}
const root=process.env.GL3_CHILD_REVIEW_DIR;priv(root,true);const planBytes=fs.readFileSync(join(root,'plan.json')),plan=JSON.parse(planBytes),planSHA256=hash(planBytes);validatePlan(plan);
const policyBytes=fs.readFileSync(join(root,'fee-policy.json'));check(hash(policyBytes)===plan.feePolicySHA256);
const receiptBytes=fs.readFileSync(join(root,'receipt-packet.json')),auditBytes=fs.readFileSync(join(root,'deployment-verified.json')),packet=JSON.parse(receiptBytes),audit=JSON.parse(auditBytes);
validateReceiptEvidence(plan,packet,audit,hash(receiptBytes),hash(auditBytes));
const prior=process.env.GL3_PRIOR_CONSENT_FILE;priv(prior);check(hash(fs.readFileSync(prior))===plan.priorUserConsentSHA256,'Prior reviewed launch consent differs.');
const build=JSON.parse(fs.readFileSync(join(root,'build-result.json'))),bundle=fs.readFileSync(join(root,'app.bundle.js')),html=fs.readFileSync(join(root,'index.html'));
check(build.planSHA256===planSHA256&&build.bundleSHA256===hash(bundle)&&build.indexSHA256===hash(html),'Review bundle differs from exact built plan.');
for(const n of ['review-server.mjs','policy.mjs','engine.mjs','journal.mjs'])check(hash(fs.readFileSync(new URL(n,import.meta.url)))===build.sourceSHA256[n],'Execution source changed after review build.');
const key=process.env.GL3_COLD_KEYSTORE;priv(key);const encrypted=fs.readFileSync(key,'utf8'),meta=JSON.parse(encrypted);check(meta.version===3&&getAddress('0x'+meta.address.replace(/^0x/,''))===OWNER&&!['password','privateKey','private_key','mnemonic'].some(k=>Object.hasOwn(meta,k)),'Unexpected encrypted cold wallet.');
check(/^[a-fA-F0-9]{64}$/.test((meta.crypto??meta.Crypto)?.ciphertext));
const parent=new JsonRpcProvider(process.env.ROBINHOOD_MAINNET_RPC_URL||'https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});
check(process.env.GL3_CHILD_PRIVATE_RPC_URL,'Set verified child RPC explicitly.');const child=new JsonRpcProvider(process.env.GL3_CHILD_PRIVATE_RPC_URL,4663001,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});
const journal=new Journal(root,planSHA256),engine=new SetupEngine({plan,planSHA256,policy:JSON.parse(policyBytes),journal,parent,child});
await engine.bindings();const priorState=await engine.reconcile();check(priorState.state!=='reconciliation-required','An earlier send needs read-only reconciliation.');
const prefix='/'+randomBytes(24).toString('hex')+'/',expiresAt=Date.now()+2*60*60*1000;let origin,host,consented=journal.value.consent?.planSHA256===planSHA256;
const server=createServer(async(req,res)=>{
 const reply=(code,type,body)=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(body);};
 const json=(code,x)=>reply(code,'application/json',JSON.stringify(x));
 try{
  if(req.headers.host!==host||!req.url?.startsWith(prefix))return json(404,{message:'Unknown local review.'});const route=req.url.slice(prefix.length);
  check(hash(fs.readFileSync(join(root,'plan.json')))===planSHA256,'Plan changed.');
  if(req.method==='GET'&&route==='')return reply(200,'text/html; charset=utf-8',html);
  if(req.method==='GET'&&route==='app.bundle.js')return reply(200,'application/javascript',bundle);
  if(req.method==='GET'&&route==='plan')return reply(200,'application/json',planBytes);
  if(req.method==='GET'&&route==='status')return json(200,{...await engine.reconcile(),planSHA256,expiresAt});
  check(Date.now()<expiresAt,'Local review expired. Preserve its journal.');
  if(req.method==='GET'&&route==='keystore'){check(req.headers['sec-fetch-site']==='same-origin'&&req.headers['sec-fetch-dest']==='empty');return reply(200,'application/json',encrypted);}
  check(req.method==='POST'&&req.headers.origin===origin&&req.headers['content-type']==='application/json','Use the local review page.');let text='';for await(const chunk of req){text+=chunk;check(text.length<=32768,'Request too large.');}const body=JSON.parse(text);check(body.planSHA256===planSHA256);
  if(route==='consent'){check(body.accepted===true);journal.value.consent={planSHA256,acceptedUTC:new Date().toISOString(),exactNineActionsAccepted:true};journal.save();consented=true;return json(200,{accepted:true});}
  check(consented,'Review the exact funding and calls first.');
  if(route==='quote'){try{return json(200,await engine.quote());}catch(e){if(/^Wait for/.test(e.message))return json(200,{waiting:true,message:e.message});throw e;}}
  if(route==='submit'){check(typeof body.raw==='string'&&body.raw.length<16384);return json(200,await engine.submit(body.raw));}
  return json(404,{message:'Unknown review action.'});
 }catch(e){return json(409,{message:e.message.includes('http')?'Local verification failed. Preserve the journal.':e.message});}
});
await new Promise(done=>server.listen(0,'127.0.0.1',()=>{host='127.0.0.1:'+server.address().port;origin='http://'+host;done();}));
console.log(JSON.stringify({url:origin+prefix,planSHA256,actions:9,broadcasts:0,expiresAt}));
const close=()=>{server.close(()=>{journal.close();parent.destroy();child.destroy();});};process.once('SIGINT',close);process.once('SIGTERM',close);
setTimeout(close,2*60*60*1000).unref();
