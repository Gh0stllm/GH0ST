// Trusted cache for both Watch frontends. Only the server-side scanner can publish evidence.
// Each address is independently durable. A small CAS manifest contains leases and recent
// summaries. A dead invocation's matching committed report repairs its index on lease expiry.
import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { isPlatformToken } from './platform-token.js';

const INDEX='recent-v1', RECENTS=24, TTL=120_000, WINDOW=600_000;
const MAX_RUNNING=2, MAX_STARTS=10, MAX_ENTRY=800_000;
const ICP_ORIGIN='https://ggcey-baaaa-aaaao-bbsgq-cai.icp0.io';
const empty=()=>({recent:[],active:[],starts:[]});
const rowKey=key=>'reports/'+key;
const summary=e=>({network:e.network,address:e.address,name:e.name,scannedAt:e.scannedAt,block:e.report?.block??null});
const entryKey=e=>e.network+'/'+e.address.toLowerCase();
const addRecent=(list,e)=>[...list.filter(x=>entryKey(x)!==entryKey(e)),summary(e)].sort((a,b)=>b.scannedAt-a.scannedAt||entryKey(a).localeCompare(entryKey(b))).slice(0,RECENTS);
const get=(s,key)=>s.getWithMetadata(key,{type:'json',consistency:'strong'});
async function cas(s,key,prior,data) {
  if(prior&&!prior.etag)throw new Error('Conditional read returned no revision');
  const result=await s.setJSON(key,data,prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true});
  if(!result.modified||result.etag)return result;
  // Some gateways omit the PUT ETag. Verify the write before using its revision.
  const saved=await get(s,key);
  if(!saved?.etag||JSON.stringify(saved.data)!==JSON.stringify(data))return {modified:false};
  return {modified:true,etag:saved.etag};
}
class HttpError extends Error{
  constructor(status,message,retry){super(message);this.status=status;this.retry=retry;}
}
function response(code,data,origin,retry){
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(origin) Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Expose-Headers':'Retry-After'});
  if(retry) headers['Retry-After']=String(retry);
  return {statusCode:code,headers,body:code===204?'':JSON.stringify(data)};
}

// Every update recomputes from the last strongly read document. There is no
// unconditioned write on retry. A failed index write leaves the lease recoverable.
async function updateIndex(store,clock,change){
  for(let attempt=0;attempt<8;attempt++){
    const current=await get(store,INDEX),state=current?.data??empty(),now=clock();
    let dirty=false;
    for(const expired of state.active.filter(l=>l.until<=now)){
      const row=await get(store,rowKey(expired.key));
      if(row?.data.completed===expired.id && row.data.entry)state.recent=addRecent(state.recent,row.data.entry);
      state.active=state.active.filter(l=>l.id!==expired.id);dirty=true;
    }
    const op=change(state,now);
    if(!dirty && !op.changed)return op.value;
    if((await cas(store,INDEX,current,state)).modified)return op.value;
  }
  throw new HttpError(503,'Shared scans are busy. Retry shortly.',3);
}
function reserve(store,clock,key,special,id){
  return updateIndex(store,clock,(s,now)=>{
    if(s.active.some(l=>l.key===key))return {value:'pending'};
    if(!special){
      const running=s.active.filter(l=>!l.special);
      if(running.length>=MAX_RUNNING)throw new HttpError(429,'Two fresh scans are running. Retry shortly.',3);
      s.starts=s.starts.filter(t=>t>now-WINDOW);
      if(s.starts.length>=MAX_STARTS)throw new HttpError(429,'The fresh-scan burst allowance is in use. Cached reports remain available.',Math.max(1,Math.ceil((s.starts[0]+WINDOW-now)/1000)));
      s.starts.push(now);
    }
    s.active.push({key,id,until:now+TTL,special});return {changed:true,value:'reserved'};
  });
}
function finish(store,clock,key,id,entry){
  return updateIndex(store,clock,s=>{
    if(!s.active.some(l=>l.key===key&&l.id===id))return {value:false};
    s.active=s.active.filter(l=>l.id!==id);
    if(entry)s.recent=addRecent(s.recent,entry);
    return {changed:true,value:true};
  });
}
function validResult(e,network,address) {
  return e && e.network===network && e.address?.toLowerCase()===address.toLowerCase() &&
    typeof e.name==='string' && e.name.length<=90 && Number.isSafeInteger(e.scannedAt) && e.scannedAt>0 &&
    (e.report===null ? isPlatformToken(network,address) : Number.isSafeInteger(e.report?.block) && e.report.block>=0) &&
    Buffer.byteLength(JSON.stringify(e))<=MAX_ENTRY;
}
async function retrieve(store,clock,generate,network,address,refresh,origin) {
  const key=network+'/'+address.toLowerCase(), path=rowKey(key);
  const cached=await get(store,path);
  const reuse=e=>response(200,{entry:e,reused:true},origin);
  const pending=()=>response(202,{pending:true,retryAfter:3},origin,3);
  if(cached?.data.entry && (!refresh || clock()-cached.data.entry.scannedAt<WINDOW))return reuse(cached.data.entry);
  const id=randomUUID();
  if(await reserve(store,clock,key,isPlatformToken(network,address),id)==='pending')return pending();
  let published=false;
  try{
    // Re-read after admission: another invocation may have completed while we waited.
    const base=await get(store,path);
    if(base?.data.entry&&(!refresh||clock()-base.data.entry.scannedAt<WINDOW)){
      await finish(store,clock,key,id,base.data.entry);return reuse(base.data.entry);
    }
    const held=await cas(store,path,base,{...base?.data,owner:id});
    if(!held.modified || !held.etag){await finish(store,clock,key,id);return pending();}
    const entry=await generate(network,address);
    if(!validResult(entry,network,address))throw new Error('Invalid server scan result');
    // Both the live lease and the address ETag must still match. A worker
    // that finishes late cannot overwrite the next worker or advance recents.
    const owner=await get(store,INDEX);
    if(!owner?.data.active.some(l=>l.key===key&&l.id===id&&l.until>clock()))return pending();
    const committed=await cas(store,path,held,{entry,completed:id});
    if(!committed.modified)return pending();
    published=true;
    await finish(store,clock,key,id,entry);
    return response(200,{entry,reused:false},origin);
  } catch(error){
    // If storing the report succeeded but index publication failed, preserve
    // the lease. Recovery can discover its completion ID and rebuild the index.
    if(!published) {
      const row=await get(store,path);
      if(row?.data.completed!==id)await finish(store,clock,key,id);
    }
    throw error;
  }
}
function readInputs(event){
  const params=event.queryStringParameters||{};
  if(Object.keys(params).some(k=>!['network','address','refresh'].includes(k)) ||
      Object.values(event.multiValueQueryStringParameters||{}).some(v=>v.length>1))
    throw new HttpError(400,'Unsupported or repeated parameter.');
  if(!Object.keys(params).length && event.httpMethod==='GET')return {};
  if(!['mainnet','testnet'].includes(params.network)||typeof params.address!=='string'||!/^0x[0-9a-f]{40}$/i.test(params.address))
    throw new HttpError(400,'Provide a Robinhood network and a complete 0x contract address.');
  if(params.refresh!==undefined&&(params.refresh!=='1'||event.httpMethod!=='POST'))throw new HttpError(400,'Refresh requires POST and refresh=1.');
  return {network:params.network,address:params.address.toLowerCase(),refresh:params.refresh==='1'};
}

function trustedStore(event){
  // Native Functions context carries the uncached edge URL needed by strong reads.
  // Older Lambda invocations expose a platform-provided blobs envelope instead.
  let options={};
  const encoded=globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT;
  const runtime=encoded?JSON.parse(Buffer.from(encoded,'base64').toString('utf8')):{};
  if(event.blobs && (!runtime.token || (runtime.edgeURL&&!runtime.uncachedEdgeURL))){
    const legacy=JSON.parse(Buffer.from(event.blobs,'base64').toString('utf8'));
    // Do not call connectLambda here: SDK 11.1.6 would put only a cached edge
    // URL into invocation-global state. Explicit credentials take its API-backed
    // direct object path on every legacy invocation, including warm invocations.
    options={siteID:process.env.SITE_ID||event.headers['x-nf-site-id'],token:legacy.token};
    if(!options.siteID||!options.token)throw new Error('Missing platform storage credentials');
  }
  const ctx=process.env.CONTEXT;
  const suffix=ctx&&ctx!=='production'?'preview-'+(process.env.DEPLOY_ID||ctx).replace(/[^a-z\d-]/gi,'').slice(0,50):'live';
  return getStore({...options,name:'watcher-scans-v1-'+suffix,consistency:'strong'});
}

export function createHandler({storeFor=trustedStore,generate=async(n,a)=>(await import('./shared-worker.mjs')).generateReport(n,a),clock=Date.now}={}){
  return async event=>{
    let origin;
    try{
      const requested=event.headers?.origin??event.headers?.Origin;
      if(requested){
        if(requested===ICP_ORIGIN)origin=requested;
        else if(requested!==new URL(event.rawUrl||'https://invalid.local').origin)throw new HttpError(403,'This origin cannot call the shared scanner.');
      }
      const method=event.httpMethod;
      if(method==='OPTIONS')return response(204,null,origin);
      if(!['GET','POST'].includes(method))throw new HttpError(405,'Use GET or POST.');
      if(event.body)throw new HttpError(400,'Submit only a network and address. Scan evidence is generated here.');
      const {network,address,refresh}=readInputs(event),store=await storeFor(event);
      if(!network){
        const recent=await updateIndex(store,clock,s=>({value:s.recent}));
        return response(200,{entries:recent},origin);
      }
      if(method==='GET'){
        const row=await get(store,rowKey(network+'/'+address));
        if(row?.data.entry)return response(200,{entry:row.data.entry},origin);
        if(row?.data.owner){
          const state=await get(store,INDEX);
          if(state?.data.active.some(l=>l.key===network+'/'+address&&l.id===row.data.owner&&l.until>clock()))return response(202,{pending:true,retryAfter:3},origin,3);
        }
        throw new HttpError(404,'No completed shared scan for this address.');
      }
      return await retrieve(store,clock,generate,network,address,refresh,origin);
    }catch(err){
      if(err instanceof HttpError)return response(err.status,{error:err.message,...(err.retry?{retryAfter:err.retry}:{})},origin,err.retry);
      console.error('watcher-scans request failed',err?.name??'Error');
      return response(503,{error:'Shared scan could not finish. Any previous result remains available.'},origin);
    }
  };
}
export const handler=createHandler();
