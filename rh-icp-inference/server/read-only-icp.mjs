import fs from 'node:fs';
import path from 'node:path';
import {Actor,HttpAgent} from '@icp-sdk/core/agent';
import {Ed25519KeyIdentity} from '@icp-sdk/core/identity';
import {Principal} from '@icp-sdk/core/principal';

export const WORKER_PRINCIPAL='yrjgz-5ek75-p6kyd-zncgu-m64ko-7xbda-abzkh-d7bvj-4p3ut-kqrph-aqe';
export const CANISTERS={model:'6obed-qaaaa-aaaaj-a65ja-cai',coordinator:'6jacx-5yaaa-aaaaj-a65jq-cai'};
const ARCHIVE='.canister_cache/'+CANISTERS.coordinator+'/db_chats';

export function privateFile(file,{maxBytes=1024*1024}={}){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('An absolute private file path is required');
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size>maxBytes||st.uid!==process.getuid())throw Error('Private input must be a bounded owned regular file with mode 0600');
 return fs.readFileSync(file);
}
export function loadWorkerIdentity(file=process.env.ICP_IDENTITY_FILE){
 let identity;
 try{identity=Ed25519KeyIdentity.fromJSON(privateFile(file,{maxBytes:16384}).toString('utf8'));}
 catch{throw Error('The private ICP worker identity is unavailable or invalid');}
 if(identity.getPrincipal().toText()!==WORKER_PRINCIPAL)throw Error('Server must use the existing limited worker identity; administrator identities are forbidden');
 return identity;
}
let agentPromise;
async function agent(){return agentPromise??=HttpAgent.create({host:process.env.ICP_HOST??'https://icp-api.io',identity:loadWorkerIdentity()});}
export function managementIdl({IDL}){
 const status=IDL.Record({status:IDL.Variant({running:IDL.Null,stopping:IDL.Null,stopped:IDL.Null}),settings:IDL.Record({controllers:IDL.Vec(IDL.Principal)}),module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),memory_size:IDL.Nat,cycles:IDL.Nat,reserved_cycles:IDL.Nat,idle_cycles_burned_per_day:IDL.Nat});
 const request=IDL.Record({canister_id:IDL.Principal});
 return IDL.Service({canister_status:IDL.Func([request],[status],['query']),fetch_canister_logs:IDL.Func([request],[IDL.Record({canister_log_records:IDL.Vec(IDL.Record({idx:IDL.Nat64,timestamp_nanos:IDL.Nat64,content:IDL.Vec(IDL.Nat8)}))})],['query'])});
}
async function management(target){
 if(!Object.values(CANISTERS).includes(target))throw Error('Read target outside the production pair');
 return Actor.createActor(managementIdl,{agent:await agent(),canisterId:'aaaaa-aa',effectiveCanisterId:Principal.fromText(target)});
}
export function normalizeStatus(target,status){
 if(!Object.values(CANISTERS).includes(target)||!status?.module_hash?.[0]||!Array.isArray(status.settings?.controllers))throw Error('Missing complete management status; no public fallback is allowed');
 const phases={running:'Running',stopping:'Stopping',stopped:'Stopped'};
 return{id:target,status:phases[Object.keys(status.status)[0]],settings:{controllers:status.settings.controllers.map(p=>p.toText())},module_hash:'0x'+Buffer.from(status.module_hash[0]).toString('hex'),cycles:String(status.cycles),reserved_cycles:String(status.reserved_cycles),memory_size:String(status.memory_size),idle_cycles_burned_per_day:String(status.idle_cycles_burned_per_day)};
}
export async function readStatus(target){const c=await management(target);return normalizeStatus(target,await c.canister_status({canister_id:Principal.fromText(target)}));}
export async function readModelLogs(){const c=await management(CANISTERS.model),r=await c.fetch_canister_logs({canister_id:Principal.fromText(CANISTERS.model)});return{log_records:r.canister_log_records.map(x=>({index:String(x.idx),timestamp:String(x.timestamp_nanos),content:Buffer.from(x.content).toString('utf8')}))};}
function archiveIdl({IDL}){
 const err=IDL.Variant({Other:IDL.Text,StatusCode:IDL.Nat16});
 return IDL.Service({
  get_chats:IDL.Func([],[IDL.Variant({Err:err,Ok:IDL.Record({chats:IDL.Vec(IDL.Record({timestamp:IDL.Text,chat:IDL.Text}))})})],['query']),
  recursive_dir_content_query:IDL.Func([IDL.Record({dir:IDL.Text,max_entries:IDL.Nat64})],[IDL.Variant({Err:err,Ok:IDL.Vec(IDL.Record({filename:IDL.Text,filetype:IDL.Text}))})],['query']),
  file_download_chunk:IDL.Func([IDL.Record({filename:IDL.Text,chunksize:IDL.Nat64,offset:IDL.Nat64})],[IDL.Variant({Err:err,Ok:IDL.Record({chunk:IDL.Vec(IDL.Nat8),chunksize:IDL.Nat64,filesize:IDL.Nat64,offset:IDL.Nat64,done:IDL.Bool})})],['query'])
 });
}
export function parseArchiveRequest(method,arg){
 if(method==='get_chats'&&arg==='()')return[];
 if(method==='recursive_dir_content_query'&&arg===`(record {dir="${ARCHIVE}";max_entries=12:nat64})`)return[{dir:ARCHIVE,max_entries:12n}];
 if(method==='file_download_chunk'){
  const m=/^\(record \{filename="([^"\n]+)";chunksize=65536:nat64;offset=0:nat64\}\)$/.exec(arg);
  if(m&&m[1].startsWith(ARCHIVE+'/')&&/^[0-9_-]+$/.test(m[1].slice(ARCHIVE.length+1)))return[{filename:m[1],chunksize:65536n,offset:0n}];
 }
 throw Error('Server recorder permits fixed read-only archive queries only; archive enablement requires the administrator separately');
}
export async function archiveQuery(method,arg){const args=parseArchiveRequest(method,arg);const c=Actor.createActor(archiveIdl,{agent:await agent(),canisterId:CANISTERS.model});return c[method](...args);}
