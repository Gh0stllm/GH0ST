import fs from 'node:fs';
import {listCoordinatorJobs} from '../worker/job-history.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {Actor,HttpAgent} from '@icp-sdk/core/agent';
import {IDL} from '@icp-sdk/core/candid';
import {idlFactory} from '../worker/candid.mjs';
import {createSkippedCapture,captureLogBatch,captureJobSnapshot,skippedCaptureReport} from '../worker/skipped-capture.mjs';

const MODEL='6obed-qaaaa-aaaaj-a65ja-cai', COORD='6jacx-5yaaa-aaaaj-a65jq-cai';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const serverMode=process.env.GH0ST_SERVER_RUNTIME==='1';
if(serverMode&&(!process.env.GH0ST_STATE_DIR||!path.isAbsolute(process.env.GH0ST_STATE_DIR)))throw Error('Server recorder requires the existing persistent state directory');
const DIR=serverMode?path.join(process.env.GH0ST_STATE_DIR,'skipped-thoughts'):path.join(ROOT,'.state/skipped-thoughts');
const MAIN=serverMode?path.resolve(process.env.JOURNAL??path.join(process.env.GH0ST_STATE_DIR,'buy-worker-unlimited.json')):path.join(ROOT,'.state/buy-worker-unlimited.json');
const REMOTE='.canister_cache/'+COORD+'/db_chats';
const CLI='/Users/abhijith/.cargo/bin/icp', execFile=promisify(execFileCb);
const apiError=IDL.Variant({Other:IDL.Text,StatusCode:IDL.Nat16});
const chatsType=IDL.Variant({Err:apiError,Ok:IDL.Record({chats:IDL.Vec(IDL.Record({timestamp:IDL.Text,chat:IDL.Text}))})});
const dirType=IDL.Variant({Err:apiError,Ok:IDL.Vec(IDL.Record({filename:IDL.Text,filetype:IDL.Text}))});
const fileType=IDL.Variant({Err:apiError,Ok:IDL.Record({chunk:IDL.Vec(IDL.Nat8),chunksize:IDL.Nat64,filesize:IDL.Nat64,offset:IDL.Nat64,done:IDL.Bool})});
const statusType=IDL.Variant({Err:apiError,Ok:IDL.Record({status_code:IDL.Nat16})});
const stringify=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x,2)+'\n';
function write(file,value){const t=file+'.tmp',fd=fs.openSync(t,'w',0o600);try{fs.writeFileSync(fd,typeof value==='string'?value:stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(t,file);}
function append(file,value){const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(value,(_,x)=>typeof x==='bigint'?String(x):x)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function decode(reply,type){if(typeof reply.response_bytes!=='string')throw Error('Missing Candid reply');return IDL.decode([type],Uint8Array.from(Buffer.from(reply.response_bytes,'hex')))[0];}
async function call(method,arg,type){
 if(!['get_chats','chats_resume','recursive_dir_content_query','file_download_chunk'].includes(method))throw Error('Recorder method outside allowlist');
 if(process.env.GH0ST_SERVER_RUNTIME==='1'){
  const {archiveQuery}=await import('../server/read-only-icp.mjs');
  return archiveQuery(method,arg);
 }
 const r=await execFile(CLI,['canister','call',MODEL,method,arg,'-e','production','--identity','gh0st-deployer','--json'],{cwd:ROOT,timeout:15000,maxBuffer:1024*1024});
 return decode(JSON.parse(r.stdout),type);
}
async function getFlag(){const r=await call('get_chats','()',chatsType);if(r.Ok)return true;if(r.Err?.Other?.includes('DB_CHATS_ACTIVE is false'))return false;throw Error('Archive state unavailable');}
function versionKey(job){return job.request.id+'::'+String(job.voice?.[0]?.generation?.[0]??job.voice?.[0]?.attempt??1);}
async function parseSavedChat(raw,filename,state){
 if(!fs.existsSync(path.join(ROOT,'worker/chat-capture.mjs')))return {complete:false,status:'parser_pending'};
 try{const parserUrl=new URL('../worker/chat-capture.mjs',import.meta.url);parserUrl.searchParams.set('revision',String(fs.statSync(parserUrl.pathname).mtimeMs));const {parseChatArchive}=await import(parserUrl.href);return parseChatArchive({raw,jobs:Object.values(state.jobVersions),coordinatorId:COORD,filename,observedAt:Date.now(),terminalRecords:Object.values(state.capture.sources).flatMap(s=>Object.values(s.generations))});}
 catch{return {complete:false,status:'parser_error',rawPreserved:true};}
}
function renderReport(state){
 const lines=['# Skipped thoughts','', 'Full text is shown only when the saved model conversation supplies a complete, uniquely matched candidate. Partial captures are labelled.',''];
 for(const source of Object.values(state.capture.sources))for(const g of Object.values(source.generations))if(g.skipped){
  const matches=Object.values(state.chatFiles).flatMap(f=>f.versions).filter(v=>v.parsed?.sourceId===g.sourceId&&String(v.parsed?.generation)===String(g.generation));
  const full=matches.filter(v=>v.parsed?.complete===true).at(-1);
  lines.push('## '+g.sourceId+' / attempt '+g.generation,'',g.skipReason??'Skipped','');
  if(full)lines.push(full.parsed.text??full.parsed.answer??full.parsed.candidate??'', '', 'Status: full archived result.','');
  else lines.push(g.text||'(No text was captured before the rejection.)','', 'Status: partial observed prefix; do not treat it as the full result.','');
 }
 write(path.join(DIR,'skipped-thoughts.md'),lines.join('\n'));
}

fs.mkdirSync(path.join(DIR,'chats'),{recursive:true,mode:0o700});
const LOCK=path.join(DIR,'recorder.lock'),STATE=path.join(DIR,'recorder.json');
const lock=fs.openSync(LOCK,'wx',0o600);fs.writeFileSync(lock,String(process.pid));fs.fsyncSync(lock);
let state=fs.existsSync(STATE)?JSON.parse(fs.readFileSync(STATE)): {schema:'gh0st-full-chat-recorder-v1',createdAt:new Date().toISOString(),capture:createSkippedCapture(),jobVersions:{},chatFiles:{},archiveEnabled:false};
const c=Actor.createActor(idlFactory,{agent:await HttpAgent.create({host:'https://icp-api.io'}),canisterId:COORD});
let stopped=false,lastFlagCheck=0;
const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 while(!stopped){
  try{
   const started=Date.now(),jobs=await listCoordinatorJobs(c);const main=JSON.parse(fs.readFileSync(MAIN));
   for(const job of jobs){captureJobSnapshot(state.capture,job);const key=versionKey(job),old=state.jobVersions[key];
    if(!old||job.answer.length>=old.job.answer.length||Object.hasOwn(job.phase,'Failed'))state.jobVersions[key]={job:JSON.parse(stringify(job)),observedAt:Date.now(),evidenceRef:'coordinator get_job/list_jobs_page'};
   }
   if(Date.now()-lastFlagCheck>60000){state.archiveEnabled=await getFlag();lastFlagCheck=Date.now();}
   if(!state.archiveEnabled&&process.env.GH0ST_SERVER_RUNTIME==='1')throw Error('Archive is disabled; administrator enablement is required at a safe generation boundary');
   if(!state.archiveEnabled){
    const active=jobs.find(j=>j.request.id===main.buyQueue.activeSourceId);
    const ready=active&&!active.busy&&Object.keys(active.phase)[0]==='ReadyToSign'&&Date.now()-started<4000&&jobs.every(j=>!j.busy&&!['Verified','Running'].includes(Object.keys(j.phase)[0]));
    if(ready){
     const fresh=(await c.get_job(active.request.id))[0];
     if(fresh&&!fresh.busy&&Object.hasOwn(fresh.phase,'ReadyToSign')){
      state.enableIntent={sourceId:fresh.request.id,at:new Date().toISOString(),method:'chats_resume',doesNotStopOrRestart:true};write(STATE,state);
      const result=await call('chats_resume','()',statusType);
      if(result.Ok?.status_code!==200)throw Error('Archive switch not acknowledged');
      state.archiveEnabled=await getFlag();state.enabledAt=new Date().toISOString();lastFlagCheck=Date.now();
      console.log(stringify({archiveEnabled:state.archiveEnabled,at:state.enabledAt,mainWorkerPid:fs.readFileSync(MAIN+'.lock','utf8').trim(),stoppedOrRestarted:false}));
     }
    }
   }
   if(state.archiveEnabled){
    const listing=await call('recursive_dir_content_query',`(record {dir="${REMOTE}";max_entries=12:nat64})`,dirType);
    if(listing.Ok)for(const row of listing.Ok){
     if(row.filetype!=='file')continue;const filename=row.filename.startsWith(REMOTE+'/')?row.filename:REMOTE+'/'+row.filename;
     if(!new RegExp('^'+REMOTE.replaceAll('.','\\.')+'/[0-9_-]+$').test(filename))continue;
     const r=await call('file_download_chunk',`(record {filename="${filename}";chunksize=65536:nat64;offset=0:nat64})`,fileType);
     if(!r.Ok)continue;if(!r.Ok.done||r.Ok.offset!==0n||r.Ok.filesize>65536n)throw Error('Chat archive exceeds bounded capture');
     const raw=Buffer.from(r.Ok.chunk).toString('utf8'),hash=createHash('sha256').update(raw).digest('hex');
     const entry=state.chatFiles[filename]??={filename,versions:[]};
     const existing=entry.versions.find(v=>v.sha256===hash);
     if(existing){existing.parsed=await parseSavedChat(raw,filename,state);continue;}
     const local=path.join(DIR,'chats',hash+'.txt');write(local,raw);
     const parsed=await parseSavedChat(raw,filename,state);
     entry.versions.push({sha256:hash,path:local,observedAt:new Date().toISOString(),parsed});
    }
   }
   // Raw logs are supplementary evidence, never treated as a full result.
   const logs=process.env.GH0ST_SERVER_RUNTIME==='1'
    ?{stdout:stringify(await(await import('../server/read-only-icp.mjs')).readModelLogs())}
    :await execFile(CLI,['canister','logs',MODEL,'-e','production','--identity','gh0st-deployer','--json'],{cwd:ROOT,timeout:15000,maxBuffer:1024*1024});
   const exactLogs=logs.stdout.replace(/("(?:timestamp|index)"\s*:\s*)(\d+)/g,'$1"$2"');
   const delta=captureLogBatch(state.capture,JSON.parse(exactLogs));
   for(const record of delta.records)append(path.join(DIR,'raw-model-logs.jsonl'),record);
   for(const gap of delta.gaps)append(path.join(DIR,'log-gaps.jsonl'),gap);
   state.lastPassAt=new Date().toISOString();delete state.lastError;write(STATE,state);write(path.join(DIR,'observations.json'),skippedCaptureReport(state.capture));renderReport(state);
  }catch(error){state.lastError={at:new Date().toISOString(),message:'Recorder read or archive verification failed; main generation is unchanged',detail:String(error?.message??error).slice(0,600)};write(STATE,state);}
  if(!stopped)await delay(state.archiveEnabled?5000:1000);
 }
}finally{write(STATE,state);fs.closeSync(lock);fs.unlinkSync(LOCK);}
