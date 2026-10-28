import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
export const PINS=Object.freeze({hostId:'CONFIGURE_HOST_ID',worker:'yrjgz-5ek75-p6kyd-zncgu-m64ko-7xbda-abzkh-d7bvj-4p3ut-kqrph-aqe',funder:'mibcl-u53qx-ggxg6-p4oxg-s2h2e-l4wgu-s3xbk-pzvwe-m4xvo-izptn-2ae',owner:'uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe',model:'6obed-qaaaa-aaaaj-a65ja-cai',coordinator:'6jacx-5yaaa-aaaaj-a65jq-cai',modelHash:'0x964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5',coordinatorHash:'0x3fb60905f6008a13c6b170f784558a722651cda9289bf13f04103c70ff4a1a59',gateway:'0x0a99a5f180ab7990877df73f63686958298330ce',artifactHash:'0x65d045ec2ab262372834065fb7d59453e7047ecac2a346d55d5eb14f4b123b53',host:'https://icp-api.io'});
export function requireFinalizedDeploymentPins(pins=PINS){
 if(!/^0x[0-9a-f]{64}$/.test(pins.coordinatorHash)||!/^0x[0-9a-f]{64}$/.test(pins.artifactHash)||!/^0x[0-9a-f]{40}$/.test(pins.gateway))throw Error('Observer deployment pins are not finalized');
}
export async function readObserverJobsAndVoice(coordinator,listCoordinatorJobs){
 const jobs=await listCoordinatorJobs(coordinator);const voice=await coordinator.get_voice_state();return{jobs,voice};
}
export async function loadDependencies(runtime){
 const require=createRequire(path.join(runtime,'package.json'));
 // Sequential imports avoid the Node24 mixed CJS/ESM loader race.
 const core=await import(pathToFileURL(require.resolve('@icp-sdk/core/agent')).href);
 const identities=await import(pathToFileURL(require.resolve('@icp-sdk/core/identity')).href);
 const {Principal}=await import(pathToFileURL(require.resolve('@icp-sdk/core/principal')).href);
 const {IDL}=await import(pathToFileURL(require.resolve('@icp-sdk/core/candid')).href);
 return{core,...identities,Principal,IDL};
}
export function identityFromBytes(bytes,expected,Ed25519KeyIdentity){
 if(![PINS.worker,PINS.funder].includes(expected))throw Error('Identity role is not permitted');
 const parsed=JSON.parse(bytes.toString('utf8'));
 if(!Array.isArray(parsed)||typeof parsed[1]!=='string'||!/^[0-9a-f]{64}$/i.test(parsed[1]))throw Error('Invalid private identity');
 const identity=Ed25519KeyIdentity.fromJSON(JSON.stringify(parsed));
 const derived=Ed25519KeyIdentity.generate(Buffer.from(parsed[1],'hex'));
 if(identity.getPrincipal().toText()!==expected||derived.getPrincipal().toText()!==expected)throw Error('Private key does not match approved principal');
 return identity;
}
export function readCredential(file){
 const st=fs.lstatSync(file),dir=fs.lstatSync(path.dirname(file));
 if(!st.isFile()||st.isSymbolicLink()||st.size>16384||st.uid!==process.getuid()||(st.mode&0o027)||(st.mode&0o040&&st.gid!==0)||!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid()||(dir.mode&0o077))throw Error('Private credential is not isolated');
 return fs.readFileSync(file);
}
export function makeReadOnlyFetch(fetchImpl=fetch){
 return async(input,options={})=>{
  let u;try{u=new URL(typeof input==='string'||input instanceof URL?input:input.url);}catch{throw Error('observer_transport_blocked');}
  const method=String(options.method??(typeof input==='object'?input.method:undefined)??'GET').toUpperCase();
  const safe=u.origin===PINS.host&&!u.username&&!u.password&&!u.search&&!u.hash&&((method==='GET'&&u.pathname==='/api/v2/status')||(method==='POST'&&/^\/api\/v[23]\/(?:canister|subnet)\/[a-z0-9-]+\/(?:query|read_state)$/.test(u.pathname)));
  if(!safe)throw Error('Observer attempted a non-read request');
  return fetchImpl(input,{...options,redirect:'error',signal:options.signal??AbortSignal.timeout(20000)});
 };
}
export function checkStatus(name,status,certified){
 const id=PINS[name],controllers=name==='model'?[PINS.owner,PINS.coordinator]:[PINS.owner];
 if(!id||status.id!==id||status.status!=='Running'||status.module_hash!==PINS[name+'Hash']||JSON.stringify([...status.settings.controllers].sort())!==JSON.stringify(controllers.sort()))throw Error('Canister deployment binding changed');
 if(certified&&('0x'+certified.get('module_hash')!==PINS[name+'Hash']||JSON.stringify([...certified.get('controllers')].map(p=>typeof p==='string'?p:p.toText()).sort())!==JSON.stringify(controllers.sort())))throw Error('Certified deployment binding changed');
 return status;
}
export async function createObserver({runtime,workerIdentity,dependencies}){
 const {core,Principal}=dependencies;
 if(workerIdentity.getPrincipal().toText()!==PINS.worker)throw Error('Observer requires limited existing worker');
 requireFinalizedDeploymentPins();
 const read=await import(pathToFileURL(path.join(runtime,'server/read-only-icp.mjs')).href);
 const {idlFactory}=await import(pathToFileURL(path.join(runtime,'worker/candid.mjs')).href);
 const {listCoordinatorJobs}=await import(pathToFileURL(path.join(runtime,'worker/job-history.mjs')).href);
 const agent=await core.HttpAgent.create({host:PINS.host,identity:workerIdentity,retryTimes:0,verifyQuerySignatures:true,shouldFetchRootKey:false,shouldSyncTime:false,logToConsole:false,fetch:makeReadOnlyFetch()});
 const coordinator=core.Actor.createActor(({IDL})=>IDL.Service(Object.fromEntries(idlFactory({IDL})._fields.filter(([n])=>['list_jobs_page','retention_status','get_voice_state','get_config'].includes(n)))),{agent,canisterId:PINS.coordinator});
 return{
  async statuses(){
   const out={};
   for(const name of ['model','coordinator']){
    const p=Principal.fromText(PINS[name]);const actor=core.Actor.createActor(read.managementIdl,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:p});
    const raw=await actor.canister_status({canister_id:p});const cert=await core.CanisterStatus.request({agent,canisterId:p,paths:['module_hash','controllers']});
    out[name]=checkStatus(name,read.normalizeStatus(PINS[name],raw),cert);
   }
   return out;
  },
  async jobsAndVoice(){return readObserverJobsAndVoice(coordinator,listCoordinatorJobs);},
  async config(){const c=await coordinator.get_config();if(c.worker.toText()!==PINS.worker||c.model_canister.toText()!==PINS.model||c.chain_id!==4663n||c.model_cycle_budget!==0n||c.gateway.toLowerCase()!==PINS.gateway||c.artifact_hash.toLowerCase()!==PINS.artifactHash)throw Error('Coordinator binding changed');return c;},
 };
}
