import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {OWNER,DEMO,GENESIS,VALUE,validatePlan,unsigned,validateSigned} from './policy.mjs';
const {Transaction,keccak256}=createRequire(process.env.ETHERS_ROOT+'/package.json')('ethers');
const [dir,keystore]=process.argv.slice(2),root=path.resolve(dir),rpcUrl='https://rpc.gh0st.fyi/';
const check=(v,m)=>{if(!v)throw Error(m);},sha=b=>createHash('sha256').update(b).digest('hex');
process.umask(0o077);check(fs.realpathSync(root)===root&&(fs.statSync(root).mode&0o077)===0,'Private review directory required');
const bytes=fs.readFileSync(root+'/plan.json'),plan=validatePlan(JSON.parse(bytes)),planSHA=sha(bytes),encrypted=fs.readFileSync(keystore);check(JSON.parse(encrypted).address.toLowerCase()===OWNER.slice(2).toLowerCase(),'Wrong encrypted wallet');
const lock=fs.openSync(root+'/review.lock','wx',0o600);fs.writeSync(lock,String(process.pid));fs.closeSync(lock);
const journalPath=root+'/transfer.private.json';check(!fs.existsSync(journalPath),'Existing transfer journal requires reconciliation');
let journal={schema:'gh0st.gl3.demo-funding-journal.v1',planSHA,state:'ready'},quote=null,consented=false,busy=false;
function persist(){const tmp=journalPath+'.tmp',fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(journal,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,journalPath);const d=fs.openSync(root,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
async function rpc(method,params=[]){const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json','user-agent':'GH0ST-GL3/1.0'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',signal:AbortSignal.timeout(20000)});const j=await r.json();check(r.ok&&!j.error,'Network request needs reconciliation');return j.result;}
async function bound(){const [chain,g]=await Promise.all([rpc('eth_chainId'),rpc('eth_getBlockByNumber',['0x0',false])]);check(chain==='0x4726d9'&&g?.hash===GENESIS,'Chain binding failed');}
async function reconcile(){if(journal.state!=='submitted')return;const r=await rpc('eth_getTransactionReceipt',[journal.hash]);if(!r)return;const b=await rpc('eth_getBlockByNumber',[r.blockNumber,false]);if(b?.hash!==r.blockHash){journal.state='reconciliation-required';persist();return;}journal.receipt=r;journal.state=BigInt(r.status)===1n?'confirmed':'failed';if(journal.state==='confirmed'){const balance=BigInt(await rpc('eth_getBalance',[DEMO,'latest']));check(balance>=VALUE,'Funding receipt exists but destination balance needs reconciliation');journal.creditedBalanceWei=balance.toString();}persist();}
const token=randomBytes(24).toString('hex'),prefix='/'+token+'/';let origin;
const server=http.createServer(async(req,res)=>{
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
 const answer=(code,data,type='application/json')=>{res.writeHead(code,{...headers,'content-type':type});res.end(type==='application/json'?JSON.stringify(data):data);};
 try{
  check(Date.now()<plan.expiresAt,'Review expired');check(req.headers.host===new URL(origin).host&&(!req.headers.origin||req.headers.origin===origin),'Local origin required');check(req.url?.startsWith(prefix),'Unknown route');const route=req.url.slice(prefix.length);check(!route.includes('?')&&!route.includes('/')&&!route.includes('%'),'Unknown route');
  if(req.method==='GET'){
   if(route==='')return answer(200,fs.readFileSync(root+'/index.html'),'text/html; charset=utf-8');
   if(route==='app.bundle.js')return answer(200,fs.readFileSync(root+'/app.bundle.js'),'text/javascript; charset=utf-8');
   if(route==='plan')return answer(200,bytes,'application/octet-stream');
   if(route==='keystore')return answer(200,JSON.parse(encrypted));
   if(route==='status'){await reconcile();return answer(200,{state:journal.state,hash:journal.hash});}
   throw Error('Unknown route');
  }
  check(req.method==='POST'&&req.headers.origin===origin&&String(req.headers['content-type']).startsWith('application/json'),'Local JSON request required');let body='';for await(const part of req){body+=part;check(Buffer.byteLength(body)<=131072,'Request too large');}const input=JSON.parse(body);check(input.planSHA===planSHA,'Plan changed');
  if(route==='consent'){check(input.accepted===true&&journal.state==='ready','Exact approval required');consented=true;return answer(200,{accepted:true});}
  if(route==='quote'){
   check(consented&&!busy&&journal.state==='ready','Review before quote');await bound();const [latest,pending,code,balance,price,estimate]=await Promise.all([rpc('eth_getTransactionCount',[OWNER,'latest']),rpc('eth_getTransactionCount',[OWNER,'pending']),rpc('eth_getCode',[DEMO,'latest']),rpc('eth_getBalance',[OWNER,'latest']),rpc('eth_gasPrice'),rpc('eth_estimateGas',[{from:OWNER,to:DEMO,value:'0x'+VALUE.toString(16),data:'0x'}])]);
   check(BigInt(latest)===BigInt(plan.nonce)&&latest===pending&&code==='0x','Nonce or destination changed');const gasLimit=BigInt(estimate)*125n/100n+21000n,gasPrice=(BigInt(price)*120n+99n)/100n;quote={planSHA,nonce:plan.nonce,gasLimit:gasLimit.toString(),gasPrice:gasPrice.toString(),observedPrice:BigInt(price).toString(),estimatedFee:(BigInt(estimate)*BigInt(price)).toString(),expiresAt:Date.now()+60000};unsigned(plan,quote,planSHA);check(BigInt(balance)>=VALUE+gasLimit*gasPrice,'Insufficient funding wallet balance');return answer(200,quote);
  }
  if(route==='submit'){
   check(consented&&!busy&&journal.state==='ready'&&quote,'Saved transfer or concurrent request requires reconciliation');check(typeof input.raw==='string'&&input.raw.length<4096,'Invalid signed transfer');busy=true;const tx=Transaction.from(input.raw);validateSigned(tx,plan,quote,planSHA);await bound();const pending=await rpc('eth_getTransactionCount',[OWNER,'pending']);check(BigInt(pending)===BigInt(plan.nonce),'Nonce changed');busy=true;
   journal={...journal,state:'submitted',hash:keccak256(input.raw),raw:input.raw,quote,intentUTC:new Date().toISOString()};persist();
   try{const hash=await rpc('eth_sendRawTransaction',[input.raw]);check(hash===journal.hash,'Broadcast hash changed');journal.broadcastAcknowledged=true;persist();}catch{journal.broadcastAcknowledged=false;persist();return answer(202,{state:'submitted',hash:journal.hash,reconcileOnly:true});}finally{busy=false;}
   return answer(200,{state:'submitted',hash:journal.hash});
  }
  throw Error('Unknown route');
 }catch(e){if(journal.state==='ready')busy=false;answer(400,{message:['Review expired','Nonce changed','Nonce or destination changed','Insufficient funding wallet balance','Exact approval required','Saved transfer or concurrent request requires reconciliation'].includes(e.message)?e.message:'Local validation failed; preserve this review and reconcile before signing again.'});}
});
server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=8;
await bound();server.listen(0,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;console.log(JSON.stringify({url:origin+prefix,planSHA,amountGH0ST:'250000',to:DEMO,expiresAt:plan.expiresAt}));});
