import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { keccak256, toUtf8Bytes } from "ethers";
import { planPublication as realPlanPublication } from "../worker/x-publisher.mjs";
import { swapSourceId } from "../worker/swaps.mjs";
import { BUY_POOL, createBuyQueue, enqueuePonsBuys, reserveNextBuy } from "../worker/buy-queue.mjs";

// Run the real worker entry point with import-level fakes. No RPC or identity
// material is used, and the important polling order is exercised end to end.
function runManualRelay({ onchainStatus, confirmed, pilot = false, discover = false }) {
  const workerUrl = new URL("../worker/main.mjs", import.meta.url).href;
  const targetHash = "0x" + "ab".repeat(32);
  const script = `
    import { registerHooks } from "node:module";
    const item = { id: "request-id", kind: "swap", state: ${JSON.stringify(discover ? "queued" : "signed")}, blockNumber: 80, txHash: ${JSON.stringify(targetHash)}, logIndex: 7 };
    const decoys = [
      { ...item, id: "other-transaction", txHash: "0x" + "cd".repeat(32) },
      { ...item, id: "sibling-swap-log", logIndex: 6 },
    ];
    const job = { phase: { Complete: null }, answer: "A thought already recorded on RH.", voice: [{}] };
    const counts = { getJob: 0, requests: 0, find: 0, acknowledge: 0, publication: 0, advance: 0, submissions: [] };
    const state = { nextBlock: ${discover ? 80 : 101}, requests: ${discover ? "[]" : pilot ? "[...decoys, item]" : "[item]"} };
    const address = "0x1111111111111111111111111111111111111111";
    const config = { gateway: address, chain_id: 4663n, model_id: "model", artifact_hash: "artifact", confirmations: 12n };
    const fixture = globalThis.fixture = {
      fs: { readFileSync: (file) => String(file).endsWith("identity.json") ? "[]" : JSON.stringify({ abi: [] }), mkdirSync() {}, openSync: () => 1, writeFileSync() {}, closeSync() {}, unlinkSync() {} },
      identity: { getPrincipal: () => ({ toText: () => "test-worker" }) },
      provider: { send: async () => "0x1237", getBlockNumber: async () => 112 },
      coordinator: {
        get_config: async () => config,
        signer_address: async () => address,
        get_job: async () => { counts.getJob++; return ${discover ? "[]" : "[job]"}; },
        submit_swap: async (hash, index) => { counts.submissions.push([hash, index.toString()]); return { phase: { Failed: null }, error: "stop after tested submission" }; },
        advance: async () => { counts.advance++; throw Error("must not regenerate"); },
      },
      gateway: {
        modelId: async () => "model", artifactHash: async () => "artifact", icpSigner: async () => address,
        authorizedSwapPool: async () => true,
        filters: { InferenceRequested: () => ({}) }, queryFilter: async () => [],
        requests: async () => { counts.requests++; return { status: ${onchainStatus}, answerHash: "answer-hash" }; },
      },
      state,
      scanned: [...decoys, item],
      find: async () => { counts.find++; return ${confirmed} ? { confirmed: true, answer: job.answer, answerHash: "answer-hash", transactionHash: "manual-callback", logIndex: 1, gasUsed: "45678", feeWei: "1096272000000" } : null; },
      acknowledge: async (item) => { counts.acknowledge++; item.memoryAcknowledged = true; },
      plan: (delivery) => { counts.publication++; return { planId: "plan", textHash: delivery.answerHash, text: delivery.answer, proofUrl: "proof" }; },
    };
    const sources = {
      "node:fs": "export default globalThis.fixture.fs;",
      "@icp-sdk/core/agent": "export const HttpAgent = { create: async () => ({}) }; export const Actor = { createActor: () => globalThis.fixture.coordinator };",
      "@icp-sdk/core/identity": "export const Ed25519KeyIdentity = { fromJSON: () => globalThis.fixture.identity };",
      "ethers": "export class Contract { constructor() { return globalThis.fixture.gateway; } } export class JsonRpcProvider { constructor() { return globalThis.fixture.provider; } } export class Wallet { constructor() { throw Error('no transaction key permitted'); } } export const keccak256 = () => 'hash', parseUnits = () => 0n, AbiCoder = { defaultAbiCoder: () => ({ encode: () => 'encoded' }) }, toUtf8Bytes = () => [];",
      "./candid.mjs": "export const idlFactory = {};",
      "./protocol.mjs": "export const json = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x); export const validateJob = () => { throw Error('must not relay'); };",
      "./journal.mjs": "export const readJournal = () => globalThis.fixture.state, writeJournal = () => {}, unwrap = v => v;",
      "./swaps.mjs": "export const loadSources = () => [{}], scanSwaps = async () => globalThis.fixture.scanned;",
      "./routing.mjs": "export const callbackFor = () => { throw Error('must not construct a callback'); };",
      "./delivery.mjs": "export const findFulfillment = (...args) => globalThis.fixture.find(...args);",
      "./voice.mjs": "export const acknowledgeVoice = (...args) => globalThis.fixture.acknowledge(...args);",
      "./x-publisher.mjs": "export const RH_EXPLORER_PREFIX='https://robin.etherscan.io/tx/',afterimageCaption=answer=>answer;export const planPublication = (...args) => globalThis.fixture.plan(...args), publishPlanned = async () => ({ status: 'disabled' }), verifyPublishingAccount = async () => { throw Error('X must stay disabled'); };",
    };
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (context.parentURL === ${JSON.stringify(workerUrl)} && sources[specifier]) {
        return { url: 'data:text/javascript,' + encodeURIComponent(sources[specifier]), shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }});
    await import(${JSON.stringify(workerUrl)});
    console.log('RESULT ' + JSON.stringify({ item, state, counts }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: script,
    encoding: "utf8",
    timeout: 10000,
    env: {
      RH_GATEWAY: "0x1111111111111111111111111111111111111111",
      ICP_COORDINATOR: "test-coordinator",
      RH_RPC_URL: "http://unused.invalid",
      START_BLOCK: "80",
      ICP_IDENTITY_FILE: "/unused/identity.json",
      WATCH_SWAPS: discover ? "1" : "0",
      ...(pilot ? { TARGET_SWAP_TX_HASH: targetHash, TARGET_SWAP_LOG_INDEX: "7" } : {}),
      X_ENABLED: "0",
      ONCE: "1",
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find((line) => line.startsWith("RESULT "));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice("RESULT ".length));
}

test("signed jobs without a relayer key still recognize a confirmed manual callback", () => {
  const { item, counts } = runManualRelay({ onchainStatus: 2, confirmed: true });
  assert.equal(item.state, "fulfilled");
  assert.equal(item.delivery.transactionHash, "manual-callback");
  assert.equal(item.memoryAcknowledged, true);
  assert.equal(item.publicationPlan.text, "A thought already recorded on RH.");
  assert.equal(item.publication.status, "disabled");
  assert.equal(item.gasUsed, "45678");
  assert.equal(item.feeWei, "1096272000000");
  assert.deepEqual(counts, { getJob: 1, requests: 1, find: 1, acknowledge: 1, publication: 1, advance: 0, submissions: [] });
});

test("a manual callback is not acknowledged before canonical confirmation", () => {
  const { item, counts } = runManualRelay({ onchainStatus: 2, confirmed: false });
  assert.equal(item.state, "awaiting_confirmation");
  assert.equal(item.delivery, undefined);
  assert.equal(counts.find, 1);
  assert.equal(counts.acknowledge, 0);
  assert.equal(counts.publication, 0);
});

test("an undelivered signed job without a relayer key stays signed without regenerating", () => {
  const { item, counts } = runManualRelay({ onchainStatus: 0, confirmed: false });
  assert.equal(item.state, "signed");
  assert.equal(counts.requests, 1);
  assert.equal(counts.find, 0);
  assert.equal(counts.advance, 0);
});

test("the pilot filter ignores non-target jobs already saved in a journal", () => {
  const { state, counts } = runManualRelay({ onchainStatus: 2, confirmed: true, pilot: true });
  assert.equal(state.requests[0].state, "signed");
  assert.equal(state.requests[1].state, "signed");
  assert.equal(state.requests[2].state, "fulfilled");
  assert.equal(counts.getJob, 1);
  assert.equal(counts.requests, 1);
  assert.equal(counts.acknowledge, 1);
});

test("the pilot submits only the selected swap log from a multi-swap scan", () => {
  const { state, counts } = runManualRelay({ onchainStatus: 0, confirmed: false, pilot: true, discover: true });
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].id, "request-id");
  assert.deepEqual(counts.submissions, [["0x" + "ab".repeat(32), "7"]]);
  assert.equal(counts.getJob, 1);
});

const buyBlockHash = "0x" + "44".repeat(32);
function buyEvent(blockNumber, logIndex, byte, sell = false) {
  const txHash = "0x" + byte.repeat(32);
  const source = { manager: BUY_POOL.manager, pool_id: BUY_POOL.pool_id, transaction_hash: txHash, log_index: String(logIndex) };
  return { kind: "swap", id: swapSourceId(4663, source), source, txHash, logIndex, blockNumber, blockHash: buyBlockHash,
    context: { amount0: sell ? "10" : "-10", amount1: sell ? "-100" : "100" }, state: "queued" };
}
const firstBuy = buyEvent(80, 7, "aa"), sellEvent = buyEvent(81, 2, "bb", true), secondBuy = buyEvent(82, 4, "cc");
function activeBuyState() {
  const verification = { headBlockNumber: 112, canonicalBlockHashes: { 80: buyBlockHash, 82: buyBlockHash } };
  const queue = enqueuePonsBuys(createBuyQueue({ startBlock: 80, minimumRemainingCycles: "3000000000000" }), [firstBuy, secondBuy], verification).state;
  const nowMs = Date.now();
  return { nextBlock: 101, buyQueue: reserveNextBuy(queue, { nowMs, verification,
    balance: { cycles: "10000000000000", observedAtMs: nowMs } }).state,
    requests: [{ ...firstBuy, state: "signed", modelCycles: "1400000000000" }, secondBuy] };
}

function runBuyWorker(options = {}) {
  const workerUrl = new URL("../worker/main.mjs", import.meta.url).href;
  const payload = { ...options, existingQueue: !!options.state, workerUrl, firstBuy, buyBlockHash, pool: BUY_POOL,
    scanned: [secondBuy, sellEvent, firstBuy], state: options.state ?? { nextBlock: 80, requests: [] } };
  const script = `
    import { registerHooks } from 'node:module';
    const p=JSON.parse(process.argv[2]),address='0x1111111111111111111111111111111111111111';
    const counts={getJobs:[],submissions:[],advance:0,abort:0,deferrals:0,order:[],uniqueness:0,acknowledge:0,publish:0,funding:0,scannedPools:[],formats:[],binding:null,
      render:0,upload:0,mediaRequests:0,mediaScopes:[],mediaIntents:[],assetSavedBeforeUpload:false};
    const job={phase:{[p.jobPhase??'Complete']:null},answer:p.answer??'The spoon has filed another complaint against gravity.',
      voice:[{attempt:p.attempt??1,quality_error:p.qualityError??''}],model_cycles:1400000000000n,
      busy:!!p.busy,request:{id:p.firstBuy.id,tx_hash:p.firstBuy.txHash,log_index:p.firstBuy.logIndex,
      block_number:p.firstBuy.blockNumber,block_hash:p.firstBuy.blockHash},source:[p.firstBuy.source]};
    const f=globalThis.fixture={
      counts,state:p.state,freshState:p.freshState,
      fs:{existsSync:()=>!!p.finisherActive,readFileSync:file=>String(file).endsWith('identity.json')?'[]':JSON.stringify({abi:[]}),mkdirSync(){},openSync:()=>1,writeFileSync(){},closeSync(){},unlinkSync(){}},
      identity:{getPrincipal:()=>({toText:()=> 'worker'})},
      provider:{send:async()=> '0x1237',getBlockNumber:async()=>{counts.headReads=(counts.headReads??0)+1;if(p.readFailure)throw Error('temporary read failure');return 112;},getBlock:async()=>({hash:p.buyBlockHash}),
        getBalance:async()=>BigInt(p.relayerBalance??'25000000000000')},
      pools:[p.pool,{...p.pool,pool_id:'0x'+'dd'.repeat(32)}],
      config:{gateway:address,chain_id:4663n,model_id:'model',artifact_hash:'artifact',confirmations:12n,swap_sources:[[]],
        model_canister:{toText:()=>p.wrongModel?'wrong-model':'6obed-qaaaa-aaaaj-a65ja-cai'},model_wasm_hash:'model-hash'},
      relayer:p.noRelayer?null:{address},
      coordinator:{get_config:async()=>f.config,signer_address:async()=>{counts.signerCalls=(counts.signerCalls??0)+1;return address;},list_jobs:async()=>Array(p.capacity?256:0).fill({}),
        retention_status:async()=>{counts.retentionReads=(counts.retentionReads??0)+1;if(p.retentionThrows)throw Error('retention query unavailable');return{retained:BigInt(p.retainedJobs??(p.capacity?256:0)),completed:BigInt(p.retainedJobs??0),failed:0n,open:BigInt(p.capacity?256:0),busy:0n,paused:false,verifying:false,active:[],blocked_failed:false,admission_allowed:!p.capacity};},
        get_job:async id=>{counts.getJobs.push(id);return !p.missingJob&&p.existingQueue&&id===p.firstBuy.id?[job]:[];},
        submit_swap:async(hash,index)=>{counts.order.push('submit');counts.submissions.push([hash,index.toString()]);if(p.submitThrows)throw Error('uncertain submit');
          const event=p.scanned.find(e=>e.txHash===hash&&e.logIndex===Number(index));
          return{...job,phase:{Failed:null},error:'stop after checked submission',model_cycles:0n,busy:false,
            request:{id:event.id,tx_hash:event.txHash,log_index:event.logIndex,block_number:event.blockNumber,block_hash:event.blockHash},source:[event.source]};},
        abort:async()=>{counts.abort++;job.phase={Failed:null};job.error='stopped by operator; request retained';return null;},
        cleanup:async()=>null,
        advance:async()=>{counts.advance++;throw Error('must not regenerate');}},
      gateway:{modelId:async()=> 'model',artifactHash:async()=> 'artifact',icpSigner:async()=>address,authorizedSwapPool:async()=>true,
        filters:{InferenceRequested:()=>({})},queryFilter:async()=>{throw Error('must not scan manual requests');},
        requests:async()=>({status:p.confirmed?2:0,answerHash:'0x'+'66'.repeat(32)})},
      scan:async(_,pools)=>{counts.scannedPools=pools;return p.scanned;},
      find:async()=>p.confirmed?{confirmed:true,answer:job.answer,answerHash:'0x'+'66'.repeat(32),transactionHash:'0x'+'55'.repeat(32),
        blockHash:p.buyBlockHash,blockNumber:90,logIndex:1,gasUsed:'100000',feeWei:'2000000000000'}:null,
      acknowledge:async item=>{counts.acknowledge++;if(p.memory!==false)item.memoryAcknowledged=true;},
      account:async()=>{if(p.noAccount)throw Error('account unavailable');return{username:'llmgh0st'};},
      feeAdmission:async()=>{if(p.feeCheckThrows)throw Error('unavailable ledger');return p.feeAdmission??{allowed:true};},
      plan:(delivery,options)=>{counts.formats.push(options.format);if(options.existingPublication?.planId==='wrong')throw Error('wrong posted plan');
        const id=options.existingPublication?.planId??options.existingPlan?.planId??'plan';
        const format=id==='proofs-plan'?'proofs-v2':id==='legacy-plan'?'legacy':id==='thought-plan'?'thought-only':options.format;
        if(format==='afterimage'&&(!options.asset||!options.mediaId))throw Error('missing media binding');
        return{format,schema:format,proofConfig:{icpCanisterId:'test'},icpProofKind:'deployment',
        proofUrls:{github:'repo',rh:'receipt',icp:'canister'},planId:id,textHash:delivery.answerHash,
        text:['thought-only','afterimage'].includes(format)?delivery.answer:delivery.answer+' old proof links',proofUrl:'receipt',
        delivery,weightedLength:delivery.answer.length,asset:options.asset,
        media:format==='afterimage'?{id:options.mediaId,expiresAt:options.mediaExpiresAt}:undefined};},
      publish:async()=>{counts.publish++;return{status:p.publication??'posted',planId:'plan',postId:'2114700034747076865',httpStatus:201};},
      funding:async()=>{counts.funding++;return{allowed:p.funding!==false,halt:p.funding===false,reason:p.funding===false?'funding_floor':null,
        balances:{model:{cycles:'10000000000000',moduleHash:'model-hash'}},snapshot:{canisters:{model:{observedAtMs:Date.now()}}}};}
    };
    f.token=async options=>{counts.mediaScopes.push(options.media===true);if(p.noMediaScope)throw Error('missing media scope');return 'test-token';};
    f.render=async options=>{counts.render++;return{bytes:new Uint8Array([1,2,3]),mimeType:'image/png',sha256:'aa'.repeat(32),
      pngSha256:'aa'.repeat(32),answerHash:options.answerHash,width:1200,height:1200,altText:options.answer,
      rendererVersion:'afterimage-v1',fontSha256:'bb'.repeat(32),path:options.outputPath,metadataPath:options.outputPath+'.json'};};
    f.mediaMetadata=asset=>{const {bytes,...meta}=asset;return meta;};
    f.upload=async options=>{
      counts.upload++;counts.assetSavedBeforeUpload=!!f.state.requests[0].afterimageAsset;
      if(options.existing?.status==='uploaded')return options.existing;
      if(options.existing&&options.existing.status!=='disabled')return{...options.existing,status:'needs_reconciliation'};
      const intent={status:'uploading',pngSha256:options.asset.pngSha256,answerHash:options.asset.answerHash};
      await options.persist(intent);counts.mediaIntents.push(f.state.requests[0].media.status);counts.mediaRequests++;
      if(p.uploadThrows)throw Error('ambiguous upload');
      const result={...intent,status:p.mediaStatus??'uploaded',mediaId:'123456',expiresAt:Date.now()+86400000};
      await options.persist(result);return result;
    };
    const sources={
      'node:fs':'export default globalThis.fixture.fs;',
      '@icp-sdk/core/agent':'export const HttpAgent={create:async()=>({})};export const Actor={createActor:()=>globalThis.fixture.coordinator};',
      '@icp-sdk/core/identity':'export const Ed25519KeyIdentity={fromJSON:()=>globalThis.fixture.identity};',
      'ethers':"export class Contract{constructor(){return globalThis.fixture.gateway;}}export class JsonRpcProvider{constructor(){return globalThis.fixture.provider;}}export class Wallet{constructor(){throw Error('no raw wallet');}}export const keccak256=()=> '0x'+'66'.repeat(32),parseUnits=value=>BigInt(Math.round(Number(value)*1e9)),AbiCoder={defaultAbiCoder:()=>({encode:()=> 'encoded'})},toUtf8Bytes=()=>[];",
      './candid.mjs':'export const idlFactory={};',
      './protocol.mjs':"export const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);export const validateJob=()=>{if(!globalThis.fixture.allowRelay)throw Error('must not rebuild callback');return{answer:globalThis.fixture.job.answer,result:{answerHash:'0x'+'66'.repeat(32)},signature:'signed'};};",
      './journal.mjs':'export const readJournal=(_,binding)=>{const f=globalThis.fixture;f.counts.binding=binding;f.counts.reads=(f.counts.reads??0)+1;if(f.counts.reads===2&&f.freshState)f.state=f.freshState;return f.state;},writeJournal=()=>{},unwrap=v=>v;',
      './swaps.mjs':'export const loadSources=()=>globalThis.fixture.pools,scanSwaps=(...a)=>globalThis.fixture.scan(...a);',
      './routing.mjs':"export const callbackFor=()=>{if(!globalThis.fixture.allowRelay)throw Error('must not construct callback');return{method:'fulfill',args:[]};};",
      './delivery.mjs':'export const findFulfillment=(...a)=>globalThis.fixture.find(...a);',
      './voice.mjs':'export const acknowledgeVoice=(...a)=>globalThis.fixture.acknowledge(...a);',
      './x-auth.mjs':'export const getXAccessToken=(...a)=>globalThis.fixture.token(...a);',
      './afterimage.mjs':'export const renderAfterimage=(...a)=>globalThis.fixture.render(...a);',
      './x-media.mjs':'export const afterimageAltText=answer=>answer;export const uploadAfterimage=(...a)=>globalThis.fixture.upload(...a),afterimageMetadata=(...a)=>globalThis.fixture.mediaMetadata(...a);',
      './x-publisher.mjs':'export const RH_EXPLORER_PREFIX="https://robin.etherscan.io/tx/",afterimageCaption=answer=>answer;export const planPublication=(...a)=>globalThis.fixture.plan(...a),publishPlanned=(...a)=>globalThis.fixture.publish(...a),verifyPublishingAccount=()=>globalThis.fixture.account();',
      './local-relayer.mjs':'export const getInjectedRelayer=()=>globalThis.fixture.relayer,checkInjectedRelayerAdmission=()=>globalThis.fixture.feeAdmission();',
      './cycle-budget.mjs':'export const assertFundingAdmission=(...a)=>globalThis.fixture.funding(...a);',
      './failure-deferral.mjs':"export const deferFailedGeneration=async options=>{const f=globalThis.fixture;f.counts.deferrals++;f.counts.order.push('defer');const result={status:f.deferralBlocked?'waiting':'deferred'};await options.persist(result);return result;};",
      './thought-history.mjs':"export const DEFAULT_THOUGHT_HISTORY_JOURNALS=[];export const openThoughtHistory=()=>({record(){},reserve(){const f=globalThis.fixture;f.counts.uniqueness++;if(f.duplicate){const e=Error('duplicate');e.code='DUPLICATE_THOUGHT';e.duplicateSourceId='0x'+'bb'.repeat(32);throw e;}}});"
    };
    Object.assign(f,{job,allowRelay:!!p.allowRelay,duplicate:!!p.duplicate,deferralBlocked:!!p.deferralBlocked});
    registerHooks({resolve(specifier,context,next){if(context.parentURL===p.workerUrl&&sources[specifier])
      return{url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};return next(specifier,context);}});
    try{await import(p.workerUrl);}catch(error){if(!p.captureFailure)throw error;f.error=error.message;}
    console.log('RESULT '+JSON.stringify({state:f.state,counts,error:f.error}));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-", JSON.stringify(payload)], { input: script, encoding: "utf8", timeout: 10000,
    env: { RH_GATEWAY: "0x1111111111111111111111111111111111111111", ICP_COORDINATOR: "6jacx-5yaaa-aaaaj-a65jq-cai",
      RH_RPC_URL: "http://unused.invalid", START_BLOCK: "80", ICP_IDENTITY_FILE: "/unused/identity.json",
      WATCH_SWAPS: "1", BUY_ONLY: "1", X_ENABLED: "1", X_OAUTH_TOKEN_FILE: "/unused/token.json",
      RELAY_MAX_FEE_GWEI: "0.05", ONCE: "1", ...options.env } });
  if (options.expectFailure) { assert.notEqual(result.status, 0); return result; }
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split(String.fromCharCode(10)).find(value => value.startsWith("RESULT "));
  assert.ok(line, result.stdout); return JSON.parse(line.slice(7));
}

test("BUY_ONLY scans Pons, excludes sells and submits only the oldest queued buy", () => {
  const { state, counts } = runBuyWorker();
  assert.equal(counts.scannedPools.length, 1); assert.equal(counts.scannedPools[0].pool_id, BUY_POOL.pool_id);
  assert.deepEqual(state.requests.map(item => item.id), [firstBuy.id, secondBuy.id]);
  assert.deepEqual(counts.submissions, [[firstBuy.txHash, "7"]]);
  assert.equal(counts.funding, 1); assert.equal(state.buyQueue.activeSourceId, null);
  assert.equal(state.buyQueue.entries[0].status, "failed_final");
  assert.equal(state.buyQueue.entries[0].actualCycles, "0");
  assert.equal(counts.binding.buyOnly.poolId, BUY_POOL.pool_id);
});

test("WATCH_ONLY queues new Pons buys without any ICP update, wallet or X call", () => {
  const result = runBuyWorker({ noRelayer: true, env: { WATCH_ONLY: "1", X_ENABLED: "0", X_OAUTH_TOKEN_FILE: "" } });
  assert.deepEqual(result.state.requests.map(item => item.id), [firstBuy.id, secondBuy.id]);
  assert.ok(result.state.buyQueue.entries.every(entry => entry.status === "queued"));
  assert.equal(result.state.buyQueue.activeSourceId, null);
  assert.equal(result.counts.signerCalls ?? 0, 0);
  assert.deepEqual(result.counts.getJobs, []); assert.deepEqual(result.counts.submissions, []);
  assert.equal(result.counts.advance, 0); assert.equal(result.counts.funding, 0);
  assert.equal(result.counts.render, 0); assert.equal(result.counts.upload, 0); assert.equal(result.counts.publish, 0);
  assert.deepEqual(result.counts.mediaScopes, []);
});

test("BUY_ONLY signed-without-relayer blocks the next buy", () => {
  const { state, counts } = runBuyWorker({ state: activeBuyState(), noRelayer: true });
  assert.deepEqual(counts.getJobs, [firstBuy.id]); assert.deepEqual(counts.submissions, []);
  assert.equal(state.buyQueue.entries[0].status, "signed");
  assert.equal(state.requests[1].state, "queued");
});

test("BUY_ONLY waits for memory and X completion, posts an Afterimage with exact caption, then advances FIFO", () => {
  const held = runBuyWorker({ state: activeBuyState(), confirmed: true, memory: false });
  assert.equal(held.state.buyQueue.activeSourceId, firstBuy.id);
  assert.deepEqual(held.counts.formats, ["afterimage"]);
  const done = runBuyWorker({ state: activeBuyState(), confirmed: true });
  assert.equal(done.state.buyQueue.activeSourceId, null);
  assert.equal(done.state.buyQueue.entries[0].status, "completed");
  assert.equal(done.state.requests[0].publicationPlan.format, "afterimage");
  assert.equal(done.state.requests[0].publicationPlan.text, done.state.requests[0].delivery.answer);
  assert.equal(done.state.requests[0].publicationPlan.proofUrls.rh, "receipt");
  assert.deepEqual(done.counts.submissions, []);
  const restarted = runBuyWorker({ state: done.state });
  assert.deepEqual(restarted.counts.submissions, [[secondBuy.txHash, "4"]]);
  assert.equal(restarted.counts.publish, 0);
});

test("BUY_ONLY X rejection or uncertainty holds every later buy", () => {
  for (const publication of ["blocked", "needs_reconciliation", "sending", "retry_after"]) {
    const { state, counts } = runBuyWorker({ state: activeBuyState(), confirmed: true, publication });
    assert.equal(state.buyQueue.activeSourceId, firstBuy.id);
    assert.deepEqual(counts.submissions, []); assert.equal(state.requests[1].state, "queued");
  }
});

test("BUY_ONLY funding failure preserves the queued buys without submitting", () => {
  const { state, counts } = runBuyWorker({ funding: false });
  assert.deepEqual(counts.submissions, []); assert.equal(state.buyQueue.activeSourceId, null);
  assert.equal(state.buyQueue.entries.length, 2);
  assert.equal(state.buyQueue.entries[0].status, "queued"); assert.equal(state.buyFunding.reason, "funding_floor");
});

test("BUY_ONLY rejects raw relayer env keys and mixing with the one-swap filter", () => {
  assert.match(runBuyWorker({ env: { RH_RELAYER_PRIVATE_KEY: "invalid-test-key" }, expectFailure: true }).stderr, /raw environment keys/);
  assert.match(runBuyWorker({ env: { TARGET_SWAP_TX_HASH: firstBuy.txHash, TARGET_SWAP_LOG_INDEX: "7" }, expectFailure: true }).stderr, /no one-swap pilot/);
  assert.match(runBuyWorker({ env: { X_USER_ACCESS_TOKEN: "invalid-test-token" }, expectFailure: true }).stderr, /private OAuth token file/);
});

test("BUY_ONLY checks delivery capability and unfinished work before reserving", () => {
  for (const [options, reason] of [[{ noRelayer: true }, "relayer_unavailable"],
    [{ env: { X_ENABLED: "0" } }, "media_authorization_unavailable"], [{ noAccount: true }, "publishing_account_unavailable"],
    [{ capacity: true }, "coordinator_unfinished_work"]]) {
    const { state, counts } = runBuyWorker(options);
    assert.equal(state.buyAdmission.reason, reason); assert.equal(state.buyQueue.activeSourceId, null);
    assert.deepEqual(counts.submissions, []); assert.equal(counts.funding, 0);
  }
});

test("BUY_ONLY reserves the full maximum RH callback fee before any model admission", () => {
  const blocked = runBuyWorker({ relayerBalance: "24999999999999" });
  assert.equal(blocked.state.buyAdmission.reason, "relayer_funding_floor");
  assert.equal(blocked.state.buyAdmission.requiredWei, "25000000000000");
  assert.equal(blocked.state.buyQueue.activeSourceId, null);
  assert.equal(blocked.counts.funding, 0); assert.deepEqual(blocked.counts.submissions, []);
  assert.equal(blocked.counts.advance, 0);
  const exact = runBuyWorker({ relayerBalance: "25000000000000" });
  assert.equal(exact.counts.funding, 1);
  assert.deepEqual(exact.counts.submissions, [[firstBuy.txHash, "7"]]);
});

test("BUY_ONLY holds on exhausted or uncertain relayer fee budgets before cycle admission", () => {
  for (const options of [{ feeAdmission: { allowed: false, reason: "daily_fee_cap" } },
    { feeAdmission: { reason: "ledger_unknown" } }, { feeCheckThrows: true }]) {
    const { state, counts } = runBuyWorker(options);
    assert.equal(state.buyAdmission.allowed, false);
    assert.equal(state.buyQueue.activeSourceId, null);
    assert.equal(state.buyQueue.entries[0].status, "queued");
    assert.equal(counts.funding, 0);
    assert.deepEqual(counts.submissions, []);
    assert.equal(counts.advance, 0);
  }
  const admitted = runBuyWorker({ feeAdmission: { allowed: true } });
  assert.equal(admitted.counts.funding, 1);
  assert.deepEqual(admitted.counts.submissions, [[firstBuy.txHash, "7"]]);
});

test("BUY_ONLY rejects callback reserve parameters exceeding the launcher safety bounds", () => {
  for (const env of [{ RELAY_GAS_LIMIT_CAP: "500001" }, { RELAY_GAS_LIMIT_CAP: "0" },
    { RELAY_MAX_FEE_GWEI: "0.051" }, { RELAY_MAX_FEE_GWEI: "0" }])
    assert.match(runBuyWorker({ env, expectFailure: true }).stderr, /callback limits/);
});

test("BUY_ONLY never spends against a different coordinator or model", () => {
  assert.match(runBuyWorker({ wrongModel: true, expectFailure: true }).stderr, /funded production pair/);
  assert.match(runBuyWorker({ env: { ICP_COORDINATOR: "another-coordinator" }, expectFailure: true }).stderr, /funded production pair/);
});

test("BUY_ONLY reloads state after taking the lock and preserves an intervening reservation", () => {
  const fresh = activeBuyState();
  const { state, counts } = runBuyWorker({ state: { nextBlock: 101, requests: [] }, freshState: fresh, noRelayer: true });
  assert.equal(counts.reads, 2); assert.equal(state.buyQueue.activeSourceId, firstBuy.id);
  assert.deepEqual(counts.submissions, []);
});

test("BUY_ONLY ambiguous submit is journaled once and does not retry on restart", () => {
  const failed = runBuyWorker({ submitThrows: true, captureFailure: true });
  assert.match(failed.error, /uncertain submit/); assert.equal(failed.counts.submissions.length, 1);
  assert.equal(failed.state.buyQueue.entries[0].status, "ambiguous");
  const restarted = runBuyWorker({ state: failed.state, submitThrows: true, missingJob: true, captureFailure: true });
  assert.deepEqual(restarted.counts.submissions, []); assert.equal(restarted.counts.advance, 0);
  assert.equal(restarted.state.buyQueue.activeSourceId, firstBuy.id);
});

test("BUY_ONLY reconciles an accepted ambiguous update by reading the same job, never re-submitting", () => {
  const input = activeBuyState();
  input.buyQueue.entries[0].status = "ambiguous";
  input.requests[0].pendingUpdate = { operation: "submit", sourceId: firstBuy.id, startedAt: Date.now(), beforeFingerprint: null };
  input.requests[0].buyHalt = { operation: "submit", reason: "uncertain" };
  const result = runBuyWorker({ state: input, confirmed: true });
  assert.deepEqual(result.counts.submissions, []); assert.equal(result.counts.advance, 0);
  assert.equal(result.state.requests[0].pendingUpdate, undefined);
  assert.equal(result.state.requests[0].updateReconciliation.status, "observed");
  assert.equal(result.state.buyQueue.entries[0].status, "completed");
});

test("BUY_ONLY pending updates keep waiting while the known canister job is busy", () => {
  const input = activeBuyState();
  input.requests[0].pendingUpdate = { operation: "advance", sourceId: firstBuy.id, startedAt: Date.now(), beforeFingerprint: "00".repeat(32) };
  const result = runBuyWorker({ state: input, busy: true });
  assert.equal(result.state.requests[0].updateReconciliation.reason, "job_busy");
  assert.equal(result.state.requests[0].pendingUpdate.operation, "advance");
  assert.deepEqual(result.counts.submissions, []); assert.equal(result.counts.advance, 0); assert.equal(result.counts.publish, 0);
});

test("BUY_ONLY transient reads back off without discarding a buy or retrying mutations", () => {
  const failed = runBuyWorker({ state: activeBuyState(), readFailure: true, captureFailure: true });
  assert.match(failed.error, /temporary read failure/);
  assert.equal(failed.state.readBackoff.attempts, 1);
  assert.equal(failed.state.buyQueue.activeSourceId, firstBuy.id);
  const resumed = runBuyWorker({ state: failed.state, readFailure: true, captureFailure: true });
  assert.equal(resumed.counts.headReads ?? 0, 0);
  assert.deepEqual(resumed.counts.submissions, []); assert.equal(resumed.counts.advance, 0);
});

test("BUY_ONLY stale posted metadata cannot release a newer delivered thought", () => {
  const input = activeBuyState(), item = input.requests[0];
  item.state = "fulfilled"; item.memoryAcknowledged = true;
  item.delivery = { confirmed: true, answer: "The spoon has filed another complaint against gravity.",
    answerHash: "0x" + "66".repeat(32), transactionHash: "0x" + "55".repeat(32), blockHash: buyBlockHash,
    blockNumber: 90, logIndex: 1 };
  item.publication = { status: "posted", planId: "wrong", postId: "2114700034747076865" };
  const { state, counts } = runBuyWorker({ state: input });
  assert.equal(state.buyQueue.activeSourceId, firstBuy.id); assert.equal(state.buyQueue.entries[0].status, "ambiguous");
  assert.deepEqual(counts.submissions, []); assert.equal(counts.publish, 0);
});

test("BUY_ONLY preserves and validates old posted formats without posting again", () => {
  for (const planId of ["proofs-plan", "legacy-plan", "thought-plan"]) {
    const input = activeBuyState(), item = input.requests[0];
    item.state = "fulfilled"; item.memoryAcknowledged = true;
    item.delivery = { confirmed: true, answer: "The spoon has filed another complaint against gravity.",
      answerHash: "0x" + "66".repeat(32), transactionHash: "0x" + "55".repeat(32), blockHash: buyBlockHash,
      blockNumber: 90, logIndex: 1 };
    item.publication = { status: "posted", planId, postId: "2114700034747076865" };
    item.publicationPlan = { planId, format: planId === "proofs-plan" ? "proofs-v2" : planId === "thought-plan" ? "thought-only" : "legacy", text: "Preserved old post" };
    const result = runBuyWorker({ state: input });
    assert.equal(result.state.buyQueue.entries[0].status, "completed");
    assert.equal(result.state.requests[0].publicationPlan.text, "Preserved old post");
    assert.equal(result.counts.publish, 0);
    assert.equal(result.counts.render, 0); assert.equal(result.counts.upload, 0);
    assert.deepEqual(result.counts.submissions, []);
  }
});

test("BUY_ONLY safely replaces only never-attempted old-format plans", () => {
  const input = activeBuyState();
  input.requests[0].publicationPlan = { format: "proofs-v2", planId: "proofs-plan", text: "Old unsent links" };
  input.requests[0].publication = { status: "ready", attempt: 0, planId: "proofs-plan" };
  const result = runBuyWorker({ state: input, confirmed: true });
  assert.equal(result.counts.publish, 1);
  assert.equal(result.state.requests[0].publicationPlan.format, "afterimage");
  assert.equal(result.state.requests[0].publicationPlan.text, result.state.requests[0].delivery.answer);
});

test("BUY_ONLY publishes short and Premium-length thoughts without changing the exact caption", () => {
  for (const answer of ["hi.", "The cupboard keeps another receipt. ".repeat(10).trim()]) {
    const result = runBuyWorker({ state: activeBuyState(), answer, confirmed: true });
    assert.equal(result.counts.publish, 1);
    assert.equal(result.state.requests[0].publicationPlan.text, answer);
    assert.equal(result.state.requests[0].afterimageAsset.altText, answer);
    assert.equal(result.state.buyQueue.entries[0].status, "completed");
  }
});

test("BUY_ONLY attempted old-format records are held instead of changed or sent", () => {
  for (const status of ["sending", "retry_after"]) {
    const input = activeBuyState();
    input.requests[0].publicationPlan = { format: "proofs-v2", planId: "proofs-plan", text: "Old attempted links" };
    input.requests[0].publication = { status, attempt: 1, startedAt: Date.now(), planId: "proofs-plan" };
    const result = runBuyWorker({ state: input, confirmed: true });
    assert.equal(result.counts.publish, 0);
    assert.equal(result.state.requests[0].publicationPlan.text, "Old attempted links");
    assert.equal(result.state.buyQueue.activeSourceId, firstBuy.id);
  }
});

test("BUY_ONLY accepts an explicit Afterimage setting and rejects other new-post formats", () => {
  const result = runBuyWorker({ state: activeBuyState(), confirmed: true, env: { X_POST_FORMAT: "afterimage" } });
  assert.equal(result.state.requests[0].publicationPlan.text, result.state.requests[0].delivery.answer);
  assert.match(runBuyWorker({ env: { X_POST_FORMAT: "thought-only" }, expectFailure: true }).stderr, /afterimage/);
});

test("Afterimage asset and media intents are persisted before upload and exact-caption publication", () => {
  const { state, counts } = runBuyWorker({ state: activeBuyState(), confirmed: true });
  assert.equal(counts.assetSavedBeforeUpload, true);
  assert.deepEqual(counts.mediaIntents, ["uploading"]);
  assert.equal(counts.mediaRequests, 1); assert.equal(counts.publish, 1);
  assert.equal(state.requests[0].afterimageAsset.pngSha256, "aa".repeat(32));
  assert.equal(state.requests[0].afterimageAsset.altText, state.requests[0].delivery.answer);
  assert.equal(state.requests[0].publicationPlan.media.id, state.requests[0].media.mediaId);
  assert.deepEqual(state.requests[0].publicationPlan.delivery.answer, state.requests[0].delivery.answer);
  assert.equal(state.requests[0].publicationPlan.text, state.requests[0].delivery.answer);
  assert.ok(counts.mediaScopes.length > 0 && counts.mediaScopes.every(Boolean));
});

test("Afterimage ambiguous upload is held without uploading or posting again after restart", () => {
  const first = runBuyWorker({ state: activeBuyState(), confirmed: true, uploadThrows: true });
  assert.equal(first.state.requests[0].media.status, "uploading");
  assert.equal(first.state.buyQueue.entries[0].status, "ambiguous");
  assert.equal(first.counts.publish, 0); assert.equal(first.counts.mediaRequests, 1);
  const resumed = runBuyWorker({ state: first.state, confirmed: true });
  assert.equal(resumed.state.requests[0].media.status, "needs_reconciliation");
  assert.equal(resumed.state.buyQueue.activeSourceId, firstBuy.id);
  assert.equal(resumed.counts.mediaRequests, 0); assert.equal(resumed.counts.publish, 0);
});

test("Afterimage rejected media never releases the queue or sends a text-only fallback", () => {
  const result = runBuyWorker({ state: activeBuyState(), confirmed: true, mediaStatus: "blocked" });
  assert.equal(result.state.buyQueue.activeSourceId, firstBuy.id);
  assert.equal(result.state.buyQueue.entries[0].status, "failed");
  assert.equal(result.counts.publish, 0);
  assert.equal(result.state.requests[1].state, "queued");
});

test("Afterimage requires media scope before new or resumed inference and respects the finisher lock", () => {
  for (const state of [undefined, activeBuyState()]) {
    const result = runBuyWorker({ state, noMediaScope: true });
    assert.equal(result.state.buyAdmission.reason, "media_authorization_unavailable");
    assert.deepEqual(result.counts.submissions, []); assert.equal(result.counts.advance, 0);
    assert.equal(result.counts.render, 0); assert.equal(result.counts.publish, 0);
  }
  assert.match(runBuyWorker({ finisherActive: true, expectFailure: true }).stderr, /being finalized/);
});

test("BUY_ONLY the explicit skip policy permits a later buy while preserving an earlier failed cost", () => {
  const input = activeBuyState(), now = Date.now();
  Object.assign(input.buyQueue.entries[0], { status: "failed_final", actualCycles: "1900000000000",
    settledAtMs: now, proofRef: "retained-failed-job.json" });
  Object.assign(input.buyQueue.entries[1], { status: "reserved", reserveCycles: "2000000000000",
    reservedAtMs: now, reservedDay: new Date(now).toISOString().slice(0, 10) });
  input.buyQueue.activeSourceId = secondBuy.id; input.buyQueue.lastStarted = secondBuy.id;
  input.requests[0].state = "failed";
  const result = runBuyWorker({ state: input });
  assert.equal(result.state.buyQueue.policy.skipFailedBuys, true);
  assert.equal(result.state.buyQueue.activeSourceId, null);
  assert.equal(result.state.buyQueue.entries[0].actualCycles, "1900000000000");
  assert.deepEqual(result.counts.getJobs, [secondBuy.id]);
  assert.deepEqual(result.counts.submissions, [[secondBuy.txHash, String(secondBuy.logIndex)]]);
  assert.equal(result.counts.advance, 0); assert.equal(result.counts.publish, 0);
  assert.equal(result.counts.funding, 0); assert.equal(result.counts.render, 0);
});

test("BUY_ONLY stops a requested second generation before any additional advance", () => {
  const result = runBuyWorker({ state: activeBuyState(), jobPhase: "Verified", attempt: 2,
    qualityError: "thought repeats a recent output" });
  assert.equal(result.counts.abort, 1);
  assert.equal(result.counts.advance, 0);
  assert.equal(result.counts.publish, 0);
  assert.equal(result.state.buyQueue.entries[0].status, "failed_final");
  assert.equal(result.state.buyQueue.entries[0].actualCycles, "1400000000000");
  assert.equal(result.state.buyQueue.activeSourceId, null);
});

test("BUY_ONLY duplicate output is skipped before RH relay or X publication", () => {
  const result = runBuyWorker({ state: activeBuyState(), allowRelay: true, duplicate: true });
  assert.equal(result.counts.advance, 0);
  assert.equal(result.counts.publish, 0);
  assert.equal(result.counts.render, 0);
  assert.equal(result.state.requests[0].state, "skipped");
  assert.equal(result.state.buyQueue.entries[0].rejectedResult.reason, "exact_duplicate_thought");
  assert.equal(result.state.buyQueue.activeSourceId, null);
});

test("BUY_ONLY an already confirmed duplicate preserves its receipt and never posts again", () => {
  const result = runBuyWorker({ state: activeBuyState(), confirmed: true, duplicate: true });
  assert.equal(result.counts.publish, 0);
  assert.equal(result.counts.render, 0);
  assert.equal(result.state.buyQueue.entries[0].delivery.confirmed, true);
  assert.equal(result.state.buyQueue.entries[0].status, "failed_final");
  assert.equal(result.state.requests[0].delivery.confirmed, true);
});

function settledFailureState() {
  const input = activeBuyState();
  Object.assign(input.buyQueue.entries[0], { status: "failed_final", actualCycles: "1400000000000",
    cumulativeActualCycles: "1400000000000", settledAtMs: Date.now(), proofRef: "confirmed-failure.json" });
  input.buyQueue.activeSourceId = null;
  input.requests[0].state = "failed";
  return input;
}

test("BUY_ONLY synchronizes the failed source with the coordinator before starting the next buy", () => {
  const result = runBuyWorker({ state: settledFailureState(), jobPhase: "Failed" });
  assert.equal(result.counts.deferrals, 1);
  assert.deepEqual(result.counts.order, ["defer", "submit"]);
  assert.equal(result.state.requests[0].coordinatorDeferral.status, "deferred");
  assert.deepEqual(result.counts.submissions, [[secondBuy.txHash, String(secondBuy.logIndex)]]);
});

test("BUY_ONLY unresolved coordinator deferral prevents both reservation and submission", () => {
  const result = runBuyWorker({ state: settledFailureState(), jobPhase: "Failed", deferralBlocked: true });
  assert.equal(result.counts.deferrals, 1);
  assert.deepEqual(result.counts.submissions, []);
  assert.equal(result.counts.funding, 0);
  assert.equal(result.state.buyQueue.activeSourceId, null);
  assert.equal(result.state.buyAdmission.reason, "failed_canister_job_deferral_pending");
});

test("full serialized Afterimage plans revalidate after restart using the real publisher", async () => {
  const { renderAfterimage } = await import("../worker/afterimage.mjs");
  const answer = "The spoon has filed another complaint against gravity.";
  const asset = await renderAfterimage({ answer });
  const delivery = { confirmed: true, answer, answerHash: keccak256(toUtf8Bytes(answer)),
    requestId: firstBuy.id, transactionHash: "0x" + "55".repeat(32), blockHash: buyBlockHash,
    blockNumber: 90, logIndex: 1 };
  const options = { format: "afterimage", icpCanisterId: "6jacx-5yaaa-aaaaj-a65jq-cai",
    asset, mediaId: "123456", mediaExpiresAt: Date.now() + 86400000 };
  const plan = realPlanPublication(delivery, options), stored = JSON.parse(JSON.stringify({ ...plan }));
  const resumed = realPlanPublication(delivery, { format: "afterimage", icpCanisterId: options.icpCanisterId,
    existingPlan: stored, existingPublication: { schema: plan.schema, planId: plan.planId,
      textHash: plan.textHash, status: "posted", postId: "2114700034747076865" } });
  assert.equal(resumed.planId, plan.planId);
  assert.equal(resumed.text, answer);
  assert.deepEqual(resumed.media, plan.media);
  assert.deepEqual(resumed.delivery, plan.delivery);
});


test("BUY_ONLY admits a new job after more than 256 completed historical jobs", () => {
  const {state,counts}=runBuyWorker({retainedJobs:700});
  assert.equal(counts.retentionReads,1);assert.deepEqual(counts.submissions,[[firstBuy.txHash,"7"]]);assert.equal(counts.funding,1);
});
test("BUY_ONLY unavailable retention query fails closed before funding or submission", () => {
  const {state,counts,error}=runBuyWorker({retentionThrows:true,captureFailure:true});
  assert.match(error,/retention query unavailable/);assert.deepEqual(counts.submissions,[]);assert.equal(counts.funding,0);assert.equal(state.buyQueue.activeSourceId,null);
});
