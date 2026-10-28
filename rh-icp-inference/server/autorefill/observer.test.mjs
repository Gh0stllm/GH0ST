import test from 'node:test';
import assert from 'node:assert/strict';
import {PINS,makeReadOnlyFetch,checkStatus,identityFromBytes,loadDependencies,createObserver,readObserverJobsAndVoice,requireFinalizedDeploymentPins} from './observer.mjs';
import {listCoordinatorJobs} from '../../worker/job-history.mjs';
test('observer refuses every ingress update and foreign endpoint before network',async()=>{
 let calls=0;const read=makeReadOnlyFetch(async()=>{calls++;return{};});
 for(const url of ['https://icp-api.io/api/v2/canister/aaaaa-aa/call','https://icp-api.io/api/v3/canister/aaaaa-aa/call','https://elsewhere.invalid/api/v2/canister/aaaaa-aa/query'])await assert.rejects(read(url,{method:'POST'}));
 assert.equal(calls,0);await read('https://icp-api.io/api/v2/canister/aaaaa-aa/query',{method:'POST'});assert.equal(calls,1);
});
test('SDK URL objects and Request inputs are allowed only for clean read endpoints',async()=>{
 let calls=0;const read=makeReadOnlyFetch(async()=>{calls++;return{};});
 await read(new URL('https://icp-api.io/api/v3/canister/aaaaa-aa/query'),{method:'POST'});
 await read(new Request('https://icp-api.io/api/v2/status'));
 assert.equal(calls,2);
 for(const u of ['https://user:secret@icp-api.io/api/v2/status','https://icp-api.io/api/v2/status?unexpected=1','https://icp-api.io/api/v2/status#fragment'])await assert.rejects(read(new URL(u)));
 assert.equal(calls,2);
});
test('deployment drift fails before financial planning',()=>{
 const status={id:PINS.model,status:'Running',module_hash:PINS.modelHash,settings:{controllers:[PINS.owner,PINS.coordinator]}};
 assert.equal(checkStatus('model',status),status);
 const certified=new Map([['module_hash',PINS.modelHash.slice(2)],['controllers',[{toText:()=>PINS.owner},{toText:()=>PINS.coordinator}]]]);
 assert.equal(checkStatus('model',status,certified),status);
 for(const changed of [{...status,module_hash:PINS.coordinatorHash},{...status,settings:{controllers:[PINS.owner]}},{...status,status:'Stopped'}])assert.throws(()=>checkStatus('model',changed));
});
test('owner identities cannot be loaded into refiller roles',()=>{
 assert.throws(()=>identityFromBytes(Buffer.from('[]'),PINS.owner,{}));
});
test('unfinalized deployment pins fail closed before creating an agent',async()=>{
 for(const key of ['coordinatorHash','artifactHash','gateway'])assert.throws(()=>requireFinalizedDeploymentPins({...PINS,[key]:'UNKNOWN'}),/not finalized/);
 let agents=0;
 if(Object.values(PINS).includes('UNKNOWN'))await assert.rejects(createObserver({runtime:'/unused',workerIdentity:{getPrincipal:()=>({toText:()=>PINS.worker})},dependencies:{core:{HttpAgent:{create:()=>{agents++;}}}}}),/not finalized/);
 assert.equal(agents,0);
});
test('observer preserves more than 256 terminal jobs through the same bounded runtime reader',async()=>{
 const jobs=Array.from({length:401},(_,i)=>({request:{id:'0x'+i.toString(16).padStart(64,'0')},phase:{Complete:null},busy:false,recovery:[],model_cycles:BigInt(i)}));
 const status={retained:401n,completed:401n,failed:0n,open:0n,busy:0n,paused:false,verifying:false,active:[],blocked_failed:false,admission_allowed:true};
 let pages=0;
 const actor={retention_status:async()=>status,list_jobs_page:async(after,limit)=>{pages++;const start=after.length?jobs.findIndex(j=>j.request.id===after[0])+1:0;const part=jobs.slice(start,start+limit);return {jobs:part,next:start+part.length<jobs.length?[part.at(-1).request.id]:[],total:401n};},get_voice_state:async()=>({remembering:[]}),list_jobs:async()=>{throw Error('unbounded query forbidden');}};
 const result=await readObserverJobsAndVoice(actor,listCoordinatorJobs);
 assert.deepEqual(result,{jobs,voice:{remembering:[]}});assert.equal(pages,13);
 actor.list_jobs_page=async()=>{throw Error('unsupported query');};
 await assert.rejects(readObserverJobsAndVoice(actor,listCoordinatorJobs),/unsupported query/);
});
