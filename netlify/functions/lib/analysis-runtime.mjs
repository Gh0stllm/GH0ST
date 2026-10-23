import { randomUUID } from 'node:crypto';
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { FetchRequest, JsonRpcProvider, Wallet, keccak256 } from 'ethers';
import fixedDeployment from '../../s0ul-analysis-config.mjs';
import { ANALYSIS_RPC_URLS, normalizeWorkerDeployment, verifyWorkerDeployment, workerGasContext,
  runAnalysisWorker } from '../../../s0ul-1m/scripts/analysis-worker.mjs';

const environment=name=>globalThis.Netlify?.env?.get(name);
const encoded=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const equal=(a,b)=>encoded(a)===encoded(b);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export const publicError=()=>({error:'Worker unavailable; the funded job remains on-chain and can be resumed.'});
export const logOperationalError=error=>console.error('S0UL worker: '+String(error?.shortMessage??error?.message??'Failure')
  .replace(/0x[0-9a-f]{64,}/gi,'[hex redacted]').slice(0,250));
export const strictJobId=value=>{
  if(typeof value!=='string'||! /^[1-9]\d{0,77}$/.test(value)||BigInt(value)>=(1n<<256n))throw Error('Invalid jobId');
  return BigInt(value).toString();
};
export function requireProduction(context,{enabled=true}={}) {
  if((context?.deploy?.context??environment('CONTEXT'))!=='production'||context?.deploy?.published===false)throw Error('Worker is production-only');
  if(enabled&&environment('S0UL_ANALYSIS_WORKER_ENABLED')!=='true')throw Error('Worker is disabled');
}
function requireSeparateDeployer(deployment) {
  if(!/^0x[0-9a-fA-F]{40}$/.test(deployment.deployer??'')||/^0x0{40}$/i.test(deployment.deployer))throw Error('Reviewed nonzero deployer must be pinned');
  if(same(deployment.deployer,deployment.workerAddress))throw Error('Deployer cannot be the service worker');
}
const RPC_METHODS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash',
  'eth_getCode','eth_getBalance','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas',
  'eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_sendRawTransaction']);
class FixedProvider extends JsonRpcProvider {
  async send(method,params) {if(!RPC_METHODS.has(method))throw Error('Unsupported worker RPC method');return super.send(method,params);}
}
function providerFor(url) {
  if(!ANALYSIS_RPC_URLS.includes(url))throw Error('Unapproved public RPC');
  const request=new FetchRequest(url);request.timeout=20_000;
  request.setThrottleParams({maxAttempts:1});request.retryFunc=()=>false;
  return new FixedProvider(request,4663,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
}
export async function createRuntime(context,{signing=true}={}) {
  requireProduction(context);
  const deployment=normalizeWorkerDeployment(fixedDeployment);
  if(deployment.localOnly||deployment.worker?.serviceVerified!==true)throw Error('Production worker release is not verified');
  const shortfallBps=deployment.worker?.maxReimbursementShortfallBps??0;
  if(!Number.isSafeInteger(shortfallBps)||shortfallBps<0||shortfallBps>5)throw Error('Invalid reviewed reimbursement policy');
  requireSeparateDeployer(deployment);
  const provider=providerFor(deployment.publicRpc);let db;
  try {
    db=getDatabase();
    const verified=await verifyWorkerDeployment({provider,deployment});
    const scope=`4663:${deployment.contracts.executor.address.toLowerCase()}:${deployment.workerAddress.toLowerCase()}`;
    const blobs=getStore({name:'s0ul-analysis-worker-production',consistency:'strong'});
    let signer;
    if(signing) {
      const secret=environment('S0UL_ANALYSIS_WORKER_KEY');
      if(!/^0x[0-9a-fA-F]{64}$/.test(secret??''))throw Error('Dedicated worker key unavailable');
      signer=new Wallet(secret,provider);
      if(!same(signer.address,deployment.workerAddress))throw Error('Dedicated worker address mismatch');
    }
    // This read fails closed if the committed migration has not been applied.
    await db.sql`SELECT scope FROM s0ul_analysis_worker_signers WHERE scope = ${scope}`;
    return {deployment,provider,db,blobs,scope,signer,contracts:verified.contracts};
  } catch(error) {await provider.destroy();await db?.pool?.end();throw error;}
}

async function immutableObject(blobs,key,value) {
  const result=await blobs.setJSON(key,value,{onlyIfNew:true});
  if(result.modified&&(typeof result.etag!=='string'||!result.etag))throw Error('Immutable journal write lacked an ETag');
  const stored=await blobs.getWithMetadata(key,{type:'json',consistency:'strong'});
  if(!stored||typeof stored.etag!=='string'||!stored.etag||!equal(stored.data,value))throw Error('Immutable journal strong readback mismatch');
  return stored.etag;
}

export function createDatabaseWorkerStore({db,blobs,scope}) {
  const holder=randomUUID();let fence;
  const fenced=async()=>{
    if(fence===undefined)throw Error('Worker lease not held');
    const rows=await db.sql`UPDATE s0ul_analysis_worker_signers SET lease_until = NOW() + INTERVAL '120 seconds'
      WHERE scope = ${scope} AND lease_holder = ${holder} AND fence = ${fence}
        AND lease_until > NOW() RETURNING fence`;
    if(rows.length!==1)throw Error('Worker lease lost');
  };
  return {
    localOnly:false,
    async acquire() {
      const rows=await db.sql`INSERT INTO s0ul_analysis_worker_signers (scope,lease_holder,lease_until,fence)
        VALUES (${scope},${holder},NOW() + INTERVAL '120 seconds',1)
        ON CONFLICT (scope) DO UPDATE SET lease_holder=EXCLUDED.lease_holder,
          lease_until=EXCLUDED.lease_until,fence=s0ul_analysis_worker_signers.fence+1
        WHERE s0ul_analysis_worker_signers.lease_until < NOW() RETURNING fence`;
      if(rows.length!==1)return false;fence=String(rows[0].fence);return true;
    },
    assertLease:fenced,
    async release(){if(fence===undefined)return;await db.sql`UPDATE s0ul_analysis_worker_signers
      SET lease_holder=NULL,lease_until='-infinity' WHERE scope=${scope} AND lease_holder=${holder} AND fence=${fence}`;fence=undefined;},
    async getPending(){await fenced();const rows=await db.sql`SELECT pending FROM s0ul_analysis_worker_signers WHERE scope=${scope}`;return rows[0]?.pending??null;},
    async savePending(record) {
      await fenced();
      if(keccak256(record.rawTransaction)!==record.hash)throw Error('Signed journal hash mismatch');
      const key=`transactions/${scope}/${record.hash}.json`;
      await immutableObject(blobs,key,record);
      await fenced();
      const {rawTransaction,...summary}=record;
      const rows=await db.sql`UPDATE s0ul_analysis_worker_signers SET pending=${encoded({...summary,blobKey:key})}::jsonb
        WHERE scope=${scope} AND lease_holder=${holder} AND fence=${fence} AND lease_until>NOW()
          AND pending IS NULL RETURNING fence`;
      if(rows.length!==1)throw Error('Pending transaction or lease conflict');
    },
    async markBroadcasting(hash) {
      await fenced();
      const rows=await db.sql`UPDATE s0ul_analysis_worker_signers
        SET pending=jsonb_set(jsonb_set(pending,'{state}','"broadcasting"'::jsonb),'{broadcastAttempts}','1'::jsonb)
        WHERE scope=${scope} AND lease_holder=${holder} AND fence=${fence} AND lease_until>NOW()
          AND pending->>'hash'=${hash} AND pending->>'state'='prepared' RETURNING fence`;
      if(rows.length!==1)throw Error('Pending broadcast fence changed');
    },
    async loadPendingRaw(hash) {
      await fenced();const rows=await db.sql`SELECT pending FROM s0ul_analysis_worker_signers WHERE scope=${scope}`;
      const pending=rows[0]?.pending;
      if(!same(pending?.hash,hash)||typeof pending.blobKey!=='string')throw Error('Pending raw journal identity mismatch');
      const stored=await blobs.getWithMetadata(pending.blobKey,{type:'json',consistency:'strong'});
      if(!stored?.etag||!same(stored.data?.hash,hash)||!same(keccak256(stored.data.rawTransaction),hash))throw Error('Saved signed journal readback failed');
      return stored.data.rawTransaction;
    },
    async claimRebroadcast(hash) {
      await fenced();
      const rows=await db.sql`UPDATE s0ul_analysis_worker_signers
        SET pending=jsonb_set(jsonb_set(pending,'{state}','"broadcasting"'::jsonb),'{broadcastAttempts}',
          to_jsonb(COALESCE((pending->>'broadcastAttempts')::integer,0)+1))
        WHERE scope=${scope} AND lease_holder=${holder} AND fence=${fence} AND lease_until>NOW()
          AND pending->>'hash'=${hash} AND COALESCE((pending->>'broadcastAttempts')::integer,0)<2 RETURNING fence`;
      return rows.length===1;
    },
    async markAmbiguous(hash,error) {
      await fenced();
      const rows=await db.sql`UPDATE s0ul_analysis_worker_signers
        SET pending=jsonb_set(jsonb_set(pending,'{state}','"ambiguous"'::jsonb),'{error}',${encoded(error)}::jsonb)
        WHERE scope=${scope} AND lease_holder=${holder} AND fence=${fence} AND lease_until>NOW()
          AND pending->>'hash'=${hash} RETURNING fence`;
      if(rows.length!==1)throw Error('Pending ambiguity fence changed');
    },
    async settle(record) {
      await fenced();await immutableObject(blobs,`receipts/${scope}/${record.hash}.json`,record);await fenced();
      const rows=await db.sql`UPDATE s0ul_analysis_worker_signers SET pending=NULL,spent_wei=spent_wei+${record.feeWei}::numeric
        WHERE scope=${scope} AND lease_holder=${holder} AND fence=${fence} AND lease_until>NOW()
          AND pending->>'hash'=${record.hash} RETURNING fence`;
      if(rows.length!==1)throw Error('Canonical receipt settlement fence changed');
    },
    async spentWei(){await fenced();const rows=await db.sql`SELECT spent_wei FROM s0ul_analysis_worker_signers WHERE scope=${scope}`;return BigInt(rows[0].spent_wei);},
  };
}

export async function queueJob(runtime,jobId) {
  const id=strictJobId(jobId),{contracts,provider,deployment,db,scope}=runtime;
  let job;try{job=await contracts.executor.getJob(id);}catch{return {accepted:false,status:'unknown'};}
  if(Number(job.state)!==1)return {accepted:false,status:'terminal'};
  const context=await workerGasContext(provider,deployment);
  if(!same(job.modelId,deployment.modelId)||job.remaining<job.maxRewardPerBatchWei||context.timestamp>job.deadline
    ||context.gasPrice>job.feeCeilingWeiPerGas)return {accepted:false,status:'not_runnable'};
  await db.sql`INSERT INTO s0ul_analysis_worker_jobs (scope,job_id,status) VALUES (${scope},${id}::numeric,'queued')
    ON CONFLICT (scope,job_id) DO UPDATE SET status='queued',updated_at=NOW()
    WHERE s0ul_analysis_worker_jobs.status NOT IN ('completed','rejected','terminal')`;
  return {accepted:true,jobId:id};
}

export async function serviceHealth(runtime) {
  const {provider,deployment,db,scope}=runtime;
  const context=await workerGasContext(provider,deployment),balance=await provider.getBalance(deployment.workerAddress);
  const rows=await db.sql`SELECT pending,lease_until,spent_wei FROM s0ul_analysis_worker_signers WHERE scope=${scope}`;
  const minimumBalance=context.cap*context.gasPrice*2n;
  const totalCap=BigInt(deployment.worker?.maxTotalFeeWei??'1000000000000000');
  const txCap=BigInt(deployment.worker?.maxTransactionFeeWei??'100000000000000');
  const exhausted=totalCap<=0n||txCap<=0n||BigInt(rows[0]?.spent_wei??0)>=totalCap;
  const ready=balance>=minimumBalance&&!rows[0]?.pending&&!exhausted;
  return {ready,available:ready,chainId:4663,executor:deployment.contracts.executor.address,
    modelId:deployment.modelId,workerAddress:deployment.workerAddress,
    reason:rows[0]?.pending?'reconciling_pending':exhausted?'worker_spend_cap':balance<minimumBalance?'worker_needs_gas':null};
}

// A disabled release can be checked without loading any signing key, acquiring a
// lease, writing a Blob/database row, or submitting a blockchain transaction.
export async function readOnlySetupStatus(context) {
  requireProduction(context,{enabled:false});
  const result={ready:false,available:false,chainId:4663,setup:{deployment:false,database:false,migrations:false,blobs:false},
    signedTransactions:0,submittedTransactions:0,executionEnabled:false};
  let provider,db;
  try {
    const deployment=normalizeWorkerDeployment(fixedDeployment);requireSeparateDeployer(deployment);
    result.executor=deployment.contracts.executor.address;result.modelId=deployment.modelId;
    provider=providerFor(deployment.publicRpc);
    await verifyWorkerDeployment({provider,deployment});result.setup.deployment=true;
    db=getDatabase();await db.sql`SELECT 1 AS connection_ok`;result.setup.database=true;
    await db.sql`SELECT scope FROM s0ul_analysis_worker_signers WHERE FALSE`;
    await db.sql`SELECT scope FROM s0ul_analysis_worker_jobs WHERE FALSE`;result.setup.migrations=true;
    const blobs=getStore({name:'s0ul-analysis-worker-production',consistency:'strong'});
    await blobs.getMetadata('health/nonexistent-read-only-probe',{consistency:'strong'});result.setup.blobs=true;
    return result;
  } catch(error) {logOperationalError(error);return {...result,setupError:'Release setup check did not complete; inspect function logs.'};}
  finally {await provider?.destroy();await db?.pool?.end();}
}

export async function dispatchBackground(context) {
  const secret=environment('S0UL_ANALYSIS_DISPATCH_TOKEN');
  if(typeof secret!=='string'||secret.length<32)throw Error('Internal worker trigger secret unavailable');
  const url=new URL('/api/s0ul/worker-run',context.site.url);
  if(url.protocol!=='https:')throw Error('Production background origin must be HTTPS');
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-s0ul-worker-trigger':secret},body:'{}',redirect:'error'});
  if(response.status!==202&&!response.ok)throw Error('Background dispatcher rejected invocation');
}
export function internalTrigger(request) {
  const secret=environment('S0UL_ANALYSIS_DISPATCH_TOKEN');
  return typeof secret==='string'&&secret.length>=32&&request.headers.get('x-s0ul-worker-trigger')===secret;
}

export async function drainJobs(context) {
  const runtime=await createRuntime(context),controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),840_000);
  try {
    const jobs=await runtime.db.sql`SELECT job_id FROM s0ul_analysis_worker_jobs
      WHERE scope=${runtime.scope} AND status IN ('queued','paused','transaction_limit','fee_ceiling','worker_needs_gas','pending')
      ORDER BY updated_at LIMIT 20`;
    for(const row of jobs) {
      if(controller.signal.aborted)break;
      const jobId=String(row.job_id),store=createDatabaseWorkerStore(runtime);
      const result=await runAnalysisWorker({...runtime,jobId,store,signal:controller.signal,maxTransactions:1200,
        maxSpendWei:runtime.deployment.worker?.maxTotalFeeWei,maxTransactionFeeWei:runtime.deployment.worker?.maxTransactionFeeWei,
        maxReimbursementShortfallBps:runtime.deployment.worker?.maxReimbursementShortfallBps??0});
      // Another invocation holds the global signer lease; it owns the active
      // job's status. Never strand that row as an unscheduled "busy" status.
      if(result.status!=='busy')await runtime.db.sql`UPDATE s0ul_analysis_worker_jobs SET status=${result.status},updated_at=NOW()
        WHERE scope=${runtime.scope} AND job_id=${jobId}::numeric`;
      if(['pending','busy','worker_needs_gas','worker_spend_cap','unprofitable'].includes(result.status))break;
    }
  } finally {clearTimeout(timeout);await runtime.provider.destroy();await runtime.db.pool.end();}
}
