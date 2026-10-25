// Read-only production identity/provenance audit. This file never creates a signer,
// reads a signing key, sends a transaction, or changes LayerZero configuration.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AbiCoder, Interface, getAddress, getCreateAddress, keccak256, ZeroAddress, ZeroHash } from 'ethers';
import { compile, assertSourcesUnchanged, HERE, json } from './build.mjs';
import { MODEL_ID, canonicalJson, tensorLayout } from './plan.mjs';
import {makeJobPlan, jobChains, JOB_KIND, JOB_ROUTER, JOB_ROUTE_IDS, TRUSTED_JOB_TRANSPORT} from './job-plan.mjs';

const coder = AbiCoder.defaultAbiCoder();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const hex = n => '0x' + BigInt(n).toString(16);
const digestPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt']);

class VerificationError extends Error {
  constructor(code, stage = null) { super(code); this.code = code; this.stage = stage; }
}
const requireThat = (condition, code) => { if (!condition) throw new VerificationError(code); };
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const validAddress = value => typeof value === 'string' && addressPattern.test(value) && !equal(value, ZeroAddress);
const validHash = value => typeof value === 'string' && digestPattern.test(value) && !equal(value, ZeroHash);

export const SUPPORTED_JOB_ENGINES = Object.freeze(['GPT2ShardOptimized']);
export function resolveJobSelection(config={}) {
  const engineContract=config.engineContract??'GPT2ShardOptimized';
  requireThat(SUPPORTED_JOB_ENGINES.includes(engineContract),'CONFIG_ENGINE_NOT_ALLOWED');
  requireThat(config.routerContract===undefined||config.routerContract===JOB_ROUTER,'CONFIG_ROUTER_NOT_ALLOWED');
  requireThat(config.routeKind===undefined||config.routeKind===JOB_KIND,'CONFIG_ROUTE_KIND');
  requireThat(config.routeConfiguration===undefined,'CONFIG_ARBITRARY_ROUTE_FORBIDDEN');
  const executorMode=config.executorMode??'managed';
  requireThat(['managed','self-relay'].includes(executorMode),'CONFIG_EXECUTOR_MODE');
  const computeChain=config.computeChain??'monad';
  let chains;try{chains=jobChains(computeChain);}catch{throw new VerificationError('CONFIG_COMPUTE_NOT_ALLOWED');}
  return {engineContract,routerContract:JOB_ROUTER,routeKind:JOB_KIND,computeChain,executorMode,chains};
}
export function nativeJobGasCeiling(chain) {return chain.key==='monad'&&chain.chainId===143?30000000n:16777216n;}
const unsignedDecimal=value=>(typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value))||(Number.isSafeInteger(value)&&value>=0);
export function validateJobRuntimeConfig(config,plan=null) {
  const selection=resolveJobSelection(config);
  requireThat(config.engineContract===selection.engineContract,'CONFIG_ENGINE_REQUIRED');
  requireThat(config?.schemaVersion===2&&config.routeKind===JOB_KIND&&config.routerContract===JOB_ROUTER,'CONFIG_JOB_SCHEMA');
  requireThat(typeof config.enabled==='boolean','CONFIG_ENABLED');
  requireThat(equal(config.modelId,MODEL_ID)&&equal(config.routeId,JOB_ROUTE_IDS[selection.computeChain]),'CONFIG_CANONICAL_IDENTITY');
  requireThat(!plan||(equal(plan.routeId,config.routeId)&&equal(plan.modelId,config.modelId)),'CONFIG_PLAN_IDENTITY');
  requireThat(validHash(config.sessionId),'CONFIG_SESSION_ID');
  requireThat(validAddress(config.admin)&&validAddress(config.requester),'CONFIG_AUTHORITY');
  requireThat(safeInteger(config.deadline)&&config.deadline>0,'CONFIG_DEADLINE');
  requireThat(typeof config.verificationFile==='string'&&config.verificationFile.endsWith('.json'),'CONFIG_VERIFICATION_FILE');
  requireThat(typeof config.keyEnv==='string'&&/^[A-Z][A-Z0-9_]*$/.test(config.keyEnv),'CONFIG_KEY_ENV');
  requireThat(config.relayKeyEnv===undefined||(typeof config.relayKeyEnv==='string'&&/^[A-Z][A-Z0-9_]*$/.test(config.relayKeyEnv)),'CONFIG_RELAY_KEY_ENV');
  requireThat(config.messagingReviewed===undefined||typeof config.messagingReviewed==='boolean','CONFIG_MESSAGING_REVIEW');
  requireThat(Array.isArray(config.chains)&&config.chains.length===2,'CONFIG_ROUTE_LENGTH');
  const addresses=[];
  config.chains.forEach((chain,index)=>{
    const expected=selection.chains[index];
    requireThat(chain.key===expected.key&&chain.stage===index&&chain.role===expected.role&&chain.chainId===expected.chainId&&chain.eid===expected.eid,'CONFIG_STAGE_IDENTITY');
    requireThat(chain.endpoint===undefined||equal(chain.endpoint,expected.endpointV2),'CONFIG_ENDPOINT');
    requireThat(chain.profile===undefined||chain.profile===expected.profile,'CONFIG_EXECUTION_PROFILE');
    if(selection.executorMode==='self-relay') {
      const transport=TRUSTED_JOB_TRANSPORT[chain.key];
      requireThat(validAddress(chain.selfRelayExecutor)&&validHash(chain.selfRelayExecutorDeploymentTx),'CONFIG_SELF_RELAY_DEPLOYMENT');
      requireThat(equal(chain.sendLibrary,transport.sendLibrary)&&equal(chain.receiveLibrary,transport.receiveLibrary),'CONFIG_MESSAGE_LIBRARIES');
      requireThat(Array.isArray(chain.requiredDVNs)&&canonicalJson(chain.requiredDVNs.map(x=>x.toLowerCase()))===canonicalJson(transport.requiredDVNs),'CONFIG_REQUIRED_DVNS');
      requireThat(Number.isSafeInteger(chain.dvnConfirmations)&&chain.dvnConfirmations>=1&&chain.dvnConfirmations<=100000,'CONFIG_DVN_CONFIRMATIONS');
    }
    if(chain.gasPriceWei!==undefined&&chain.gasPriceWei!==null) {
      requireThat(chain.key==='opbnb'&&chain.chainId===204,'CONFIG_CUSTOM_BID_CHAIN');
      requireThat(unsignedDecimal(chain.gasPriceWei)&&BigInt(chain.gasPriceWei)>=1n&&unsignedDecimal(chain.maxFeePerGasWei)
        &&BigInt(chain.gasPriceWei)<=BigInt(chain.maxFeePerGasWei),'CONFIG_CUSTOM_BID_CAP');
    }
    requireThat(typeof chain.rpcEnv==='string'&&/^[A-Z][A-Z0-9_]*$/.test(chain.rpcEnv),'CONFIG_RPC_ENV');
    requireThat(validAddress(chain.router)&&validHash(chain.routerDeploymentTx),'CONFIG_ROUTER_DEPLOYMENT');
    addresses.push(chain.router.toLowerCase());
    if(index===0)requireThat(chain.engine===null&&chain.root===null&&chain.engineDeploymentTx===null,'CONFIG_HOME_MUST_NOT_COMPUTE');
    else {
      requireThat(validAddress(chain.engine)&&validAddress(chain.root)&&validHash(chain.engineDeploymentTx),'CONFIG_ENGINE_DEPLOYMENT');
      requireThat(chain.engineContract===undefined||chain.engineContract===selection.engineContract,'CONFIG_CHAIN_ENGINE');
      requireThat(new Set([chain.router,chain.engine,chain.root].map(x=>x.toLowerCase())).size===3,'CONFIG_ADDRESS_COLLISION');
    }
    requireThat(safeInteger(chain.deploymentBlock),'CONFIG_DEPLOYMENT_BLOCK');
    requireThat(Number.isSafeInteger(chain.confirmations)&&chain.confirmations>=1&&chain.confirmations<=100000,'CONFIG_CONFIRMATIONS');
    requireThat(unsignedDecimal(chain.maxTransactionGas)&&BigInt(chain.maxTransactionGas)>100000n&&BigInt(chain.maxTransactionGas)<=nativeJobGasCeiling(chain),'CONFIG_TRANSACTION_GAS');
    requireThat(unsignedDecimal(chain.maxMessageFeeWei)&&unsignedDecimal(chain.maxFeePerGasWei),'CONFIG_FEE_BUDGET');
    if(chain.layerRange!==undefined)requireThat(canonicalJson(chain.layerRange)===canonicalJson(expected.layerRange),'CONFIG_LAYER_RANGE');
  });
  return config;
}

// Model identity commits tensor bytes, so independently bind their packing/order
// to the exact addressing scheme implemented by GPT2Shard._row/_nextRow.
export function verifyManifestLayout(manifest) {
  requireThat(Array.isArray(manifest.tensors) && manifest.tensors.length === 77, 'MANIFEST_TENSOR_COUNT');
  for (let id = 0; id < 77; id++) {
    const tensor = manifest.tensors[id], layout = tensorLayout(id);
    const rowsPerShard = Math.floor(24575 / layout.row_bytes);
    requireThat(tensor.id === id && tensor.rows === layout.rows && tensor.width === layout.width
      && tensor.row_bytes === layout.row_bytes && tensor.rows_per_shard === rowsPerShard
      && tensor.bytes === layout.rows * layout.row_bytes, 'MANIFEST_TENSOR_LAYOUT');
    requireThat(Array.isArray(tensor.shards) && tensor.shards.length === Math.ceil(layout.rows / rowsPerShard), 'MANIFEST_SHARD_COUNT');
    tensor.shards.forEach((shard, index) => {
      const firstRow = index * rowsPerShard;
      const rows = Math.min(rowsPerShard, layout.rows - firstRow);
      requireThat(shard.file === undefined || shard.file === tensor.file, 'MANIFEST_SHARD_FILE');
      requireThat(shard.first_row === firstRow && shard.rows === rows
        && shard.offset === firstRow * layout.row_bytes && shard.length === rows * layout.row_bytes
        && shard.runtime_bytes === 1 + rows * layout.row_bytes, 'MANIFEST_SHARD_LAYOUT');
    });
  }
}

function rpcClient(url, stage) {
  let id = 0, requests = 0;
  // URL and transport error details remain private, including embedded RPC tokens.
  let parsed;
  try { parsed = new URL(url); } catch { throw new VerificationError('RPC_URL_INVALID', stage); }
  requireThat(['http:', 'https:'].includes(parsed.protocol), 'RPC_URL_PROTOCOL');
  async function request(method, params = []) {
    requireThat(READ_METHODS.has(method), 'NON_READ_RPC_FORBIDDEN');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        requests++;
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(30000), redirect: 'error' });
        if (!response.ok) throw new Error('transport');
        const body = await response.json();
        if (body.error || !Object.hasOwn(body, 'result')) throw new Error('rpc');
        return body.result;
      } catch {
        if (attempt === 2) throw new VerificationError('RPC_READ_FAILED_' + method, stage);
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }
  return { request, requestCount: () => requests };
}

function codeBytes(code) {
  requireThat(typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code), 'DEPLOYED_CODE_ABSENT');
  return Buffer.from(code.slice(2), 'hex');
}

function addressTable(code, count) {
  const bytes = codeBytes(code);
  requireThat(bytes.length === 1 + 32 * count && bytes[0] === 0, 'CATALOG_FORMAT');
  return Array.from({ length: count }, (_, i) => {
    const word = bytes.subarray(1 + i * 32, 1 + (i + 1) * 32);
    requireThat(word.subarray(0, 12).equals(Buffer.alloc(12)), 'CATALOG_ADDRESS_PADDING');
    return getAddress('0x' + word.subarray(12).toString('hex'));
  });
}

async function parallelMap(items, concurrency, fn) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await fn(items[index], index);
    }
  }));
  return output;
}

async function verifyCreation({ rpc, chain, address, transactionHash, artifact, blockTag, expectedArgs }) {
  const [transaction, receipt] = await Promise.all([
    rpc.request('eth_getTransactionByHash', [transactionHash]), rpc.request('eth_getTransactionReceipt', [transactionHash]),
  ]);
  requireThat(transaction && receipt && equal(transaction.hash, transactionHash)
    && equal(receipt.transactionHash, transactionHash), 'CREATION_TRANSACTION_ABSENT');
  requireThat(transaction.to === null && receipt.status === '0x1' && equal(receipt.contractAddress, address), 'CREATION_TRANSACTION_KIND');
  requireThat(validAddress(transaction.from) && equal(getCreateAddress({ from: transaction.from, nonce: transaction.nonce }), address), 'CREATION_ADDRESS_DERIVATION');
  requireThat(transaction.blockNumber !== null && BigInt(transaction.blockNumber) <= BigInt(blockTag)
    && equal(transaction.blockNumber, receipt.blockNumber) && equal(transaction.blockHash, receipt.blockHash), 'CREATION_TRANSACTION_BLOCK');
  const deployedBlock = await rpc.request('eth_getBlockByNumber', [transaction.blockNumber, false]);
  requireThat(deployedBlock && equal(deployedBlock.hash, receipt.blockHash), 'CREATION_TRANSACTION_REORG');
  requireThat(BigInt(chain.deploymentBlock) <= BigInt(transaction.blockNumber), 'CONFIG_LOG_START_AFTER_DEPLOYMENT');
  requireThat(BigInt(blockTag) - BigInt(transaction.blockNumber) + 1n >= BigInt(chain.confirmations ?? 1), 'CREATION_CONFIRMATIONS');
  const prefix = '0x' + artifact.evm.bytecode.object;
  const input = transaction.input ?? transaction.data;
  requireThat(typeof input === 'string' && input.toLowerCase().startsWith(prefix.toLowerCase()), 'CREATION_BYTECODE_MISMATCH');
  const iface = new Interface(artifact.abi);
  const types = iface.deploy.inputs.map(item => item.format('sighash'));
  let args;
  try { args = coder.decode(types, '0x' + input.slice(prefix.length)); }
  catch { throw new VerificationError('CREATION_ARGUMENTS_INVALID'); }
  requireThat(equal(input, prefix + iface.encodeDeploy(args).slice(2)), 'CREATION_ARGUMENTS_NONCANONICAL');
  expectedArgs(args);
  requireThat(BigInt(transaction.value ?? 0) === 0n, 'CREATION_VALUE_UNEXPECTED');
  const actualCode = await rpc.request('eth_getCode', [address, blockTag]);
  codeBytes(actualCode);
  // eth_call runs the audited constructor in a discarded state overlay. This
  // derives every immutable patch; it sends no transaction and changes no state.
  const replayedCode = await rpc.request('eth_call', [{ from: transaction.from, data: input,
    value: transaction.value ?? '0x0', gas: transaction.gas }, blockTag]);
  requireThat(equal(actualCode, replayedCode), 'IMMUTABLE_PATCHED_RUNTIME_MISMATCH');
  return { args, code: actualCode, codeHash: keccak256(actualCode), deploymentTx: transactionHash,
    deploymentBlock: Number(BigInt(transaction.blockNumber)), deploymentBlockHash: transaction.blockHash,
    deployer: getAddress(transaction.from), runtimeVerification: 'exact audited creation input and discarded constructor replay' };
}

async function verifyWeights({ rpc, root, rootCode, stagePlan, manifest, dataDirectory, blockTag, progress }) {
  const roots = addressTable(rootCode, 77), needed = new Set(stagePlan.tensorIds);
  roots.forEach((address, id) => requireThat(needed.has(id) ? !equal(address, ZeroAddress) : equal(address, ZeroAddress), 'ROOT_TENSOR_COVERAGE'));
  let weightShards = 0, catalogs = 1, payloadBytes = 0;
  const tensors = [], catalogHashes = [{ address: root, codeHash: keccak256(rootCode) }];
  for (const id of stagePlan.tensorIds) {
    const tensor = manifest.tensors[id], shardCount = tensor.shards.length;
    const catalogCode = await rpc.request('eth_getCode', [roots[id], blockTag]);
    catalogHashes.push({ address: roots[id], codeHash: keccak256(catalogCode) }); catalogs++;
    let shardAddresses;
    if (shardCount > 767) {
      const pages = addressTable(catalogCode, Math.ceil(shardCount / 767));
      shardAddresses = [];
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        requireThat(!equal(pages[pageIndex], ZeroAddress), 'CATALOG_PAGE_ABSENT');
        const pageCode = await rpc.request('eth_getCode', [pages[pageIndex], blockTag]);
        shardAddresses.push(...addressTable(pageCode, Math.min(767, shardCount - pageIndex * 767)));
        catalogHashes.push({ address: pages[pageIndex], codeHash: keccak256(pageCode) }); catalogs++;
      }
    } else shardAddresses = addressTable(catalogCode, shardCount);
    requireThat(shardAddresses.every(address => !equal(address, ZeroAddress)), 'WEIGHT_SHARD_ADDRESS_ABSENT');
    const tensorFile = path.resolve(dataDirectory, tensor.file);
    requireThat(tensorFile.startsWith(path.resolve(dataDirectory) + path.sep), 'TENSOR_PATH_ESCAPE');
    const payload = fs.readFileSync(tensorFile), deployedHash = createHash('sha256');
    requireThat(hash(payload) === tensor.sha256, 'TENSOR_FILE_CHANGED');
    const shardCommitments = [];
    // Limit live RPC fanout. Each batch is incorporated in canonical shard order.
    for (let start = 0; start < shardCount; start += 8) {
      const batch = shardAddresses.slice(start, start + 8);
      const codes = await parallelMap(batch, 8, address => rpc.request('eth_getCode', [address, blockTag]));
      for (let offset = 0; offset < codes.length; offset++) {
        const index = start + offset, descriptor = tensor.shards[index], actual = codeBytes(codes[offset]);
        const expectedPayload = payload.subarray(descriptor.offset, descriptor.offset + descriptor.length);
        requireThat(actual.length === expectedPayload.length + 1 && actual[0] === 0
          && actual.subarray(1).equals(expectedPayload), 'WEIGHT_RUNTIME_MISMATCH');
        requireThat(hash(actual) === descriptor.runtime_sha256, 'WEIGHT_RUNTIME_HASH_MISMATCH');
        deployedHash.update(actual.subarray(1));
        shardCommitments.push({ index, address: shardAddresses[index], codeHash: keccak256(codes[offset]) });
        weightShards++; payloadBytes += expectedPayload.length;
      }
      if (weightShards % 128 < 8) progress?.({ stage: stagePlan.stage, phase: 'VERIFYING_WEIGHTS', verifiedShards: weightShards });
    }
    const actualTensorHash = deployedHash.digest('hex');
    requireThat(actualTensorHash === tensor.sha256, 'DEPLOYED_TENSOR_HASH_MISMATCH');
    tensors.push({ id, sha256: actualTensorHash, shards: shardCount,
      deployedShardCommitment: hash(canonicalJson(shardCommitments)) });
  }
  requireThat(weightShards === stagePlan.weightContracts && payloadBytes === stagePlan.payloadBytes
    && catalogs === stagePlan.catalogContracts, 'WEIGHT_COVERAGE_TOTALS');
  return { verifiedWeightShards: weightShards, verifiedCatalogs: catalogs, verifiedPayloadBytes: payloadBytes,
    tensorCoverage: tensors, deployedCatalogCommitment: hash(canonicalJson(catalogHashes)),
    fullWeightCoverageHash: hash(canonicalJson(tensors)) };
}

export async function verifyJobDeployment({config,dataDirectory,progress=()=>{}}) {
  let plan,manifest,built,selection;
  try {
    selection=resolveJobSelection(config);plan=makeJobPlan(dataDirectory,{computeChain:selection.computeChain});
    validateJobRuntimeConfig(config,plan);manifest=JSON.parse(fs.readFileSync(path.join(dataDirectory,'manifest.json')));
    verifyManifestLayout(manifest);built=compile();
  } catch(error) {if(error instanceof VerificationError)throw error;throw new VerificationError('LOCAL_MODEL_OR_BUILD_INVALID');}
  const endpointInterface=new Interface(['function eid() view returns(uint32)']);
  const routerArtifact=built.artifacts[JOB_ROUTER],engineArtifact=built.artifacts[selection.engineContract];
  requireThat(routerArtifact&&engineArtifact,'AUDITED_ARTIFACT_MISSING');
  const routerInterface=new Interface(routerArtifact.abi),engineInterface=new Interface(engineArtifact.abi);
  const report={schemaVersion:2,status:'VERIFYING',routeKind:JOB_KIND,routerContract:JOB_ROUTER,engineContract:selection.engineContract,
    executorMode:selection.executorMode,computeChain:selection.computeChain,modelId:config.modelId,routeId:config.routeId,sessionId:config.sessionId,admin:config.admin,requester:config.requester,deadline:config.deadline,
    compilerSourcesHash:built.compiler.sources_commitment_sha256,compilerVersion:built.compiler.version,
    manifestSha256:plan.manifestSha256,checkpointSha256:plan.checkpointSha256,startedAt:new Date().toISOString(),
    messagingReady:false,transportScope:'Exact contracts and full weights only; DVN/executor/pathway configuration and finality require separate review.',
    transactionBroadcasts:0,readOnly:true,rpcTrust:'Configured RPC snapshots are trusted; this is not a consensus proof.',chains:[]};
  for(let stage=0;stage<2;stage++) {
    const chain=config.chains[stage],stagePlan=plan.stages[stage],home=stage===0;
    try {
      const url=process.env[chain.rpcEnv];requireThat(typeof url==='string'&&url.length>0,'RPC_ENV_MISSING');
      const rpc=rpcClient(url,stage);requireThat(BigInt(await rpc.request('eth_chainId'))===BigInt(chain.chainId),'RPC_CHAIN_ID_MISMATCH');
      const block=await rpc.request('eth_getBlockByNumber',['latest',false]);requireThat(block&&validHash(block.hash),'SNAPSHOT_BLOCK_INVALID');
      const blockTag=block.number;
      async function call(address,iface,method,args=[]) {
        const raw=await rpc.request('eth_call',[{to:address,data:iface.encodeFunctionData(method,args)},blockTag]);
        try{return iface.decodeFunctionResult(method,raw)[0];}catch{throw new VerificationError('CONTRACT_READ_INVALID');}
      }
      const r=(method,args)=>call(chain.router,routerInterface,method,args);
      const endpointAddress=await r('endpoint');requireThat(equal(endpointAddress,stagePlan.endpointV2),'LAYERZERO_ENDPOINT_ADDRESS');
      const endpointCode=await rpc.request('eth_getCode',[endpointAddress,blockTag]);codeBytes(endpointCode);
      requireThat(Number(await call(endpointAddress,endpointInterface,'eid'))===chain.eid,'LAYERZERO_ENDPOINT_ID');
      requireThat(await r('routeSealed')===true,'ROUTE_NOT_SEALED');
      requireThat(await r('isHome')===home&&Number(await r('homeEid'))===plan.stages[0].eid&&Number(await r('computeEid'))===plan.stages[1].eid,'ROUTER_ROLE');
      requireThat(Number(await r('VERSION'))===2&&equal(await r('MODEL_ID'),MODEL_ID),'ROUTER_PROTOCOL');
      for(const key of ['routeId','sessionId','requester','owner'])requireThat(equal(await r(key),key==='owner'?config.admin:config[key]),'ROUTER_IDENTITY');
      requireThat(BigInt(await r('deadline'))===BigInt(config.deadline)&&BigInt(block.timestamp)<=BigInt(config.deadline),'ROUTER_DEADLINE');
      const other=config.chains[1-stage];requireThat(Number(await r('remoteEid'))===other.eid,'ROUTER_REMOTE_EID');
      requireThat(equal(await r('peers',[other.eid]),'0x'+'0'.repeat(24)+other.router.slice(2)),'ROUTER_PEER');
      requireThat(equal(await r('engine'),home?ZeroAddress:chain.engine),'ROUTER_ENGINE_BINDING');
      const routerCreation=await verifyCreation({rpc,chain,address:chain.router,transactionHash:chain.routerDeploymentTx,artifact:routerArtifact,blockTag,expectedArgs:args=>{
        requireThat(equal(args[0],endpointAddress)&&equal(args[1],config.admin)&&equal(args[2],config.requester)&&args[3]===home
          &&Number(args[4])===plan.stages[0].eid&&Number(args[5])===plan.stages[1].eid&&equal(args[6],config.routeId)
          &&equal(args[7],config.sessionId)&&BigInt(args[8])===BigInt(config.deadline),'ROUTER_CREATION_ARGUMENTS');
      }});
      requireThat(equal(routerCreation.deployer,config.admin),'ROUTER_DEPLOYER');
      for(const authority of [config.admin,config.requester])requireThat(await rpc.request('eth_getCode',[authority,blockTag])==='0x','AUTHORITY_MUST_BE_EOA');
      const requested=await r('requested'),completed=await r('completed'),running=await r('running'),awaitingActivation=await r('awaitingActivation');
      const resultFinalized=await r('resultFinalized'),resultDispatched=await r('resultDispatched');
      const promptLength=Number(await r('promptLength')),maxNewTokens=Number(await r('maxNewTokens')),processedPositions=Number(await r('processedPositions'));
      requireThat(!requested||(promptLength>=1&&maxNewTokens>=1&&promptLength+maxNewTokens-1<=1024),'JOB_CONTEXT');
      requireThat(processedPositions>=0&&processedPositions<=1024&&!(running&&awaitingActivation),'JOB_STATE_BOUNDS');
      if(home)requireThat(!running&&!awaitingActivation&&!completed&&!resultDispatched&&(!resultFinalized||requested),'HOME_JOB_STATE');
      const result={key:chain.key,stage,role:chain.role,chainId:chain.chainId,eid:chain.eid,router:getAddress(chain.router),engine:chain.engine,root:chain.root,
        routerCodeHash:routerCreation.codeHash,routerDeploymentTx:routerCreation.deploymentTx,routerDeploymentBlock:routerCreation.deploymentBlock,
        routerDeploymentBlockHash:routerCreation.deploymentBlockHash,verifiedBlock:Number(BigInt(blockTag)),verifiedBlockHash:block.hash,
        endpoint:getAddress(endpointAddress),endpointCodeHash:keccak256(endpointCode),runtimeVerification:routerCreation.runtimeVerification,
        sessionSnapshot:{requested,completed,running,awaitingActivation,resultFinalized,resultDispatched,promptLength,maxNewTokens,processedPositions},
        verifiedWeightShards:0,verifiedCatalogs:0,verifiedPayloadBytes:0};
      if(selection.executorMode==='self-relay') {
        const artifact=built.artifacts.GH0STSelfRelayExecutor;requireThat(artifact,'SELF_RELAY_ARTIFACT_MISSING');
        const iface=new Interface(artifact.abi),ec=(method,args)=>call(chain.selfRelayExecutor,iface,method,args);
        requireThat(equal(await ec('sendLibrary'),chain.sendLibrary)&&equal(await ec('authorizedOApp'),chain.router)
          &&Number(await ec('remoteEid'))===other.eid&&BigInt(await ec('deploymentChainId'))===BigInt(chain.chainId)
          &&Number(await ec('MAX_MESSAGE_BYTES'))===4480,'SELF_RELAY_BINDING');
        const created=await verifyCreation({rpc,chain,address:chain.selfRelayExecutor,transactionHash:chain.selfRelayExecutorDeploymentTx,
          artifact,blockTag,expectedArgs:args=>requireThat(equal(args[0],chain.sendLibrary)&&equal(args[1],chain.router)
            &&Number(args[2])===other.eid&&BigInt(args[3])===BigInt(chain.chainId),'SELF_RELAY_CREATION_ARGUMENTS')});
        requireThat(equal(created.deployer,config.admin),'SELF_RELAY_DEPLOYER');
        Object.assign(result,{selfRelayExecutor:chain.selfRelayExecutor,selfRelayExecutorCodeHash:created.codeHash,
          selfRelayExecutorDeploymentTx:created.deploymentTx});
      }
      if(!home) {
        const e=(method,args)=>call(chain.engine,engineInterface,method,args);
        const rootCode=await rpc.request('eth_getCode',[chain.root,blockTag]);addressTable(rootCode,77);const rootCodeHash=keccak256(rootCode);
        requireThat(equal(await e('controller'),chain.router)&&equal(await e('modelId'),MODEL_ID)
          &&equal(await e('manifest'),chain.root)&&equal(await e('manifestCodeHash'),rootCodeHash),'ENGINE_BINDING');
        requireThat(Number(await e('firstLayer'))===0&&Number(await e('endLayer'))===12&&await e('doesEmbedding')===true&&await e('doesOutput')===true,'ENGINE_WHOLE_MODEL');
        const engineCreation=await verifyCreation({rpc,chain,address:chain.engine,transactionHash:chain.engineDeploymentTx,artifact:engineArtifact,blockTag,expectedArgs:args=>{
          requireThat(equal(args[0],chain.root)&&equal(args[1],rootCodeHash)&&equal(args[2],MODEL_ID)&&BigInt(args[3])===BigInt(chain.chainId)
            &&Number(args[4])===0&&Number(args[5])===12&&args[6]===true&&args[7]===true&&equal(args[8],chain.router),'ENGINE_CREATION_ARGUMENTS');
        }});
        requireThat(equal(engineCreation.deployer,config.admin),'ENGINE_DEPLOYER');
        const phase=Number(await e('phase')),position=Number(await e('position'));
        requireThat(phase>=0&&phase<=12&&position>=0&&position<1024,'ENGINE_STATE_BOUNDS');
        if(running)requireThat(requested&&!completed&&!awaitingActivation&&phase>=1&&position===processedPositions,'RUNNING_ENGINE_SEQUENCE');
        else if(completed)requireThat(requested&&phase===12&&processedPositions===promptLength+maxNewTokens-1&&position+1===processedPositions,'COMPLETED_ENGINE_SEQUENCE');
        else requireThat(phase===0&&processedPositions===0&&!resultDispatched&&(!requested||awaitingActivation),'IDLE_ENGINE_SEQUENCE');
        requireThat(!resultFinalized&&(!resultDispatched||completed),'COMPUTE_JOB_STATE');
        const weights=await verifyWeights({rpc,root:chain.root,rootCode,stagePlan,manifest,dataDirectory,blockTag,progress});
        Object.assign(result,{engineCodeHash:engineCreation.codeHash,rootCodeHash,engineContract:selection.engineContract,
          engineDeploymentTx:engineCreation.deploymentTx,engineDeploymentBlock:engineCreation.deploymentBlock,
          engineDeploymentBlockHash:engineCreation.deploymentBlockHash,...weights});
        Object.assign(result.sessionSnapshot,{phase,enginePosition:position});
      }
      const end=await rpc.request('eth_getBlockByNumber',[blockTag,false]);requireThat(end&&equal(end.hash,block.hash),'SNAPSHOT_REORG');
      requireThat(BigInt(await rpc.request('eth_chainId'))===BigInt(chain.chainId),'RPC_CHAIN_ID_CHANGED');
      result.rpcReads=rpc.requestCount();report.chains.push(result);progress({stage,phase:'VERIFIED_JOB_STAGE',verifiedShards:result.verifiedWeightShards});
    }catch(error){if(error instanceof VerificationError){error.stage??=stage;throw error;}throw new VerificationError('STAGE_VERIFICATION_FAILED',stage);}
  }
  assertSourcesUnchanged(built);
  requireThat(hash(fs.readFileSync(path.join(dataDirectory,'manifest.json')))===plan.manifestSha256,'MODEL_MANIFEST_CHANGED');
  report.status='PASS_VERIFIED_JOB_DEPLOYMENT';report.completedAt=new Date().toISOString();
  report.totals={verifiedWeightShards:report.chains.reduce((n,c)=>n+c.verifiedWeightShards,0),verifiedPayloadBytes:report.chains.reduce((n,c)=>n+c.verifiedPayloadBytes,0)};
  return report;
}
export function jobReportPath(configFile,config) {
  const output=path.resolve(path.dirname(configFile),config.verificationFile);
  const relative=path.relative(HERE,output),first=relative.split(path.sep)[0];
  requireThat(['reports','deployments'].includes(first)&&!relative.startsWith('..')&&output.endsWith('.json')&&output!==path.resolve(configFile),'VERIFICATION_OUTPUT_PATH');
  let existing=path.dirname(output);while(!fs.existsSync(existing))existing=path.dirname(existing);
  const real=fs.realpathSync(existing),realRoot=fs.realpathSync(HERE);requireThat(real===realRoot||real.startsWith(realRoot+path.sep),'VERIFICATION_OUTPUT_SYMLINK');
  return output;
}
export function atomicJobReport(output,report) {
  fs.mkdirSync(path.dirname(output),{recursive:true});const temporary=output+'.tmp-'+process.pid;
  try{fs.writeFileSync(temporary,json(report),{mode:0o600,flag:'wx'});fs.renameSync(temporary,output);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
export async function run(args) {
  if(args.length===1&&args[0]==='--help'){console.log('verify-job-deployment --config=deployments/job/runtime.json --data=model-export-directory\nRead-only exact audited constructors/runtime and all77 tensors. Does not attest LayerZero security readiness.');return;}
  requireThat(args.every(x=>/^--(?:config|data)=.+/.test(x))&&args.filter(x=>x.startsWith('--config=')).length===1&&args.filter(x=>x.startsWith('--data=')).length===1,'CLI_ARGUMENTS');
  const configFile=path.resolve(args.find(x=>x.startsWith('--config=')).slice(9)),config=JSON.parse(fs.readFileSync(configFile));
  const dataDirectory=path.resolve(args.find(x=>x.startsWith('--data=')).slice(7)),output=jobReportPath(configFile,config);
  atomicJobReport(output,{schemaVersion:2,status:'VERIFYING',messagingReady:false});
  try{const report=await verifyJobDeployment({config,dataDirectory,progress:v=>console.log(json(v).trim())});atomicJobReport(output,report);console.log(json({status:report.status,totals:report.totals,messagingReady:false}).trim());}
  catch(error){atomicJobReport(output,{schemaVersion:2,status:'VERIFICATION_FAILED',reason:error instanceof VerificationError?error.code:'LOCAL_CONFIGURATION_OR_IO_FAILED',messagingReady:false});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(error=>{
  console.error(json({status:'VERIFICATION_FAILED',reason:error instanceof VerificationError?error.code:'LOCAL_CONFIGURATION_OR_IO_FAILED'}).trim());process.exitCode=1;
});
