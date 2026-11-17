// Pure transaction construction plus an explicit read-only RPC allowlist.
// This program has no signer, private-key loader, send method or license action.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {ContractFactory,Interface,ZeroAddress,ZeroHash,getCreateAddress,getCreate2Address,keccak256,concat,AbiCoder,formatEther} from '/root/dispute/node_modules/ethers/lib.esm/index.js';
const BASE='/workspace/gl3/durable/base-launch';
const REPO='/root/dispute/repo';
const PIN='4341b132cfbdcc980ead03765ca5224ff6cb5d97';
const CACHE=REPO+'/research/chess/l3/nitro/.cache/contracts-provenance';
const MAIN=CACHE+'/compiled-main/build/contracts';
const OWNER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6'; // Existing unsigned proposal, not selected custody.
const CREATE2='0x4e59b44847b379578588920cA78FbF26c0B4956C';
// Fresh project namespace: no acceptance of unknown mutable factory state.
const SALT=keccak256(new TextEncoder().encode('GH0ST GL3 BASE v1 | '+OWNER));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const allow=new Set(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getTransactionCount','eth_gasPrice','eth_estimateGas','eth_call']);
let requests=0;async function read(method,params=[]){if(!allow.has(method))throw Error('forbidden RPC method');const r=await fetch('https://rpc.mainnet.chain.robinhood.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++requests,method,params}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
if(BigInt(await read('eth_chainId'))!==4663n)throw Error('wrong parent');
const head=await read('eth_getBlockByNumber',['latest',false]);
const nonce=Number(BigInt(await read('eth_getTransactionCount',[OWNER,'pending'])));
const gasPrice=BigInt(await read('eth_gasPrice'));
const compilationFile=REPO+'/research/chess/l3/nitro/evidence/contract-source-compilation.json';
const compilation=JSON.parse(fs.readFileSync(compilationFile));if(compilation.main.sourceCommit!==PIN)throw Error('wrong contracts pin');
const files=new Map();function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.json')){const key=e.name.slice(0,-5);if(files.has(key))throw Error('ambiguous artifact '+key);files.set(key,p);}}}walk(MAIN);
function load(name){const p=files.get(name);if(!p)throw Error('missing '+name);const bytes=fs.readFileSync(p),record=compilation.main.artifacts.find(x=>x.path===path.relative(MAIN,p));if(!record||sha(bytes)!==record.sha256)throw Error('artifact hash mismatch');return {...JSON.parse(bytes),provenance:{name,path:path.relative(REPO,p),sha256:sha(bytes),sourceCommit:PIN}};}
const pkg=fs.readFileSync(CACHE+'/deps/@offchainlabs__upgrade-executor/package.tgz');
const pkgPin=compilation.npmDependencyArchives.find(x=>x.package==='@offchainlabs/upgrade-executor');if(sha(pkg)!==pkgPin.tarballSha256)throw Error('upgrade archive changed');
const tar=gunzipSync(pkg);let upgrade;
for(let o=0;o+512<=tar.length;){const n=tar.subarray(o,o+100).toString().replace(/\0.*$/,''),size=parseInt(tar.subarray(o+124,o+136).toString().replace(/\0.*$/,'').trim(),8);if(!n)break;if(n==='package/build/contracts/src/UpgradeExecutor.sol/UpgradeExecutor.json'){const b=tar.subarray(o+512,o+512+size);upgrade={...JSON.parse(b),provenance:{name:'UpgradeExecutor',artifactSHA256:sha(b),packageSHA256:sha(pkg)}};}o+=512+Math.ceil(size/512)*512;}
if(!upgrade)throw Error('missing upgrade executor');
const helper=fs.readFileSync(CACHE+'/git/nitro-contracts-'+PIN+'/src/rollup/DeployHelper.sol','utf8');
if(sha(helper)!==compilation.main.sourceFileHashes['src/rollup/DeployHelper.sol'])throw Error('helper changed');
// Derive the standard proxy creation/runtime bytes from the exact pinned payload.
const raw='0x'+helper.match(/NICK_CREATE2_PAYLOAD\s*=\s*hex"([0-9a-f]+)"/)[1].slice(2);
const {Transaction}=await import('/root/dispute/node_modules/ethers/lib.esm/index.js');const keyless=Transaction.from(raw),expectedProxy='0x'+keyless.data.slice(-138);
const actualProxy=await read('eth_getCode',[CREATE2,head.number]);
if(actualProxy!=='0x'&&actualProxy.toLowerCase()!==expectedProxy.toLowerCase())throw Error('existing canonical proxy differs');
const actions=[];let nextNonce=nonce;let proxy=CREATE2;
if(actualProxy==='0x'){proxy=getCreateAddress({from:OWNER,nonce:nextNonce});actions.push({label:'create2-proxy',category:'factory-bootstrap',nonce:nextNonce++,from:OWNER,data:keyless.data,value:'0',predictedAddress:proxy,route:'genuine proxy initcode via ordinary CREATE; upstream CREATE2_FACTORY override, not keyless fixed-gas broadcast'});}
const deployed={};
async function add(label,name,args=[],override){const a=override||load(name),factory=new ContractFactory(a.abi,a.bytecode);const tx=await factory.getDeployTransaction(...args);const address=getCreate2Address(proxy,SALT,keccak256(tx.data));const action={label,contract:name,category:'factory-dependency',nonce:nextNonce++,from:OWNER,to:proxy,data:concat([SALT,tx.data]),salt:SALT,value:'0',predictedAddress:address,constructorArgs:args,initcodeBytes:(tx.data.length-2)/2,artifact:a.provenance||{sourceSHA256:a.sourceSHA256,runtimeKeccak256:a.runtimeKeccak256}};if(action.initcodeBytes>49152)throw Error('initcode too large');actions.push(action);deployed[label]=address;return address;}
const eth=[await add('ethBridge','Bridge'),await add('ethSequencerInbox','SequencerInbox',[104857,ZeroAddress,false,false]),await add('ethSequencerInboxDelayBufferable','SequencerInbox',[104857,ZeroAddress,false,true]),await add('ethInbox','Inbox',[104857]),await add('ethRollupEventInbox','RollupEventInbox'),await add('ethOutbox','Outbox')];
const erc20=[await add('erc20Bridge','ERC20Bridge'),await add('erc20SequencerInbox','SequencerInbox',[104857,ZeroAddress,true,false]),await add('erc20SequencerInboxDelayBufferable','SequencerInbox',[104857,ZeroAddress,true,true]),await add('erc20Inbox','ERC20Inbox',[104857]),await add('erc20RollupEventInbox','ERC20RollupEventInbox'),await add('erc20Outbox','ERC20Outbox')];
const bridge=await add('bridgeCreator','BridgeCreator',[eth,erc20]);
const provers=[await add('prover0','OneStepProver0'),await add('proverMem','OneStepProverMemory'),await add('proverMath','OneStepProverMath'),await add('proverHostIo','OneStepProverHostIo',[ZeroAddress])];
const osp=await add('osp','OneStepProofEntry',provers),challenge=await add('challengeManager','EdgeChallengeManager'),admin=await add('rollupAdmin','RollupAdminLogic'),user=await add('rollupUser','RollupUserLogic'),up=await add('upgradeExecutor','UpgradeExecutor',[],upgrade),wallet=await add('validatorWalletCreator','ValidatorWalletCreator'),deployHelper=await add('deployHelper','DeployHelper');
const creator=await add('rollupCreator','RollupCreator',[OWNER,bridge,osp,challenge,admin,user,up,wallet,deployHelper]);
const pricer=JSON.parse(fs.readFileSync(BASE+'/pricer/artifact.json'));
// Fixed positive reference is ONLY for constructor-size/gas estimation. The
// production rate remains unselected; this action is not approved for signing.
const referenceRate='112830781494453514806087080';
await add('manualFeeTokenPricer','GH0STManualFeeTokenPricer',[OWNER,referenceRate],pricer);actions.at(-1).category='fee-pricer-reference-only';actions.at(-1).initialRateSelected=false;actions.at(-1).rateReferenceSource='2026-11-16 historical core/gas/market/snapshot.json; stale reference, never production-selected';
// Independent estimate calls only. A missing proxy/dependency may prevent a
// transaction estimate: preserve failures rather than replacing the chain state.
for(let i=0;i<actions.length;i+=3)await Promise.all(actions.slice(i,i+3).map(async a=>{const existing=await read('eth_getCode',[a.predictedAddress,head.number]);a.predictedAddressEmptyAtObservedBlock=existing==='0x';if(existing!=='0x'){a.existingRuntimeKeccak256=keccak256(existing);a.reuseAccepted=false;a.estimateUnavailable='Fresh namespace collision; existing code/storage/authority is NOT accepted';return;}if(a.to&&actualProxy==='0x'){a.estimateUnavailable='Proposed CREATE2 proxy is not deployed; a call to its empty address would not estimate deployment execution';return;}try{const tx={from:a.from,data:a.data,value:'0x0'};if(a.to)tx.to=a.to;a.readOnlyRHEstimateGas=String(BigInt(await read('eth_estimateGas',[tx])));a.readOnlyRHEstimatedFeeWei=(BigInt(a.readOnlyRHEstimateGas)*gasPrice).toString();}catch(e){a.estimateUnavailable=String(e).slice(0,400);}}));
const creatorABI=new Interface(load('RollupCreator').abi),schema=creatorABI.getFunction('createRollup').inputs[0];
const pending=['final owner/custody role addresses','validator security mode and validator identities','baseStake and every miniStakeValue','fresh reviewed fee-token rate and pricer owner','full parent timing/challenge geometry','exact canonical genesis assertion+dataCostEstimate','AEP/license arrangement','final child-chain-id collision review','funded batch-poster ETH operating reserve'];
const report={schema:'gh0st.gl3.base.unsigned-deployment-plan.v1',status:'UNSIGNED_CONSTRUCTOR_PLAN_NOT_READY_FOR_SIGNING',checkedUTC:new Date().toISOString(),parentChainId:4663,proposedChildChainId:4663001,childChainIdReserved:false,officialModuleRoot:'0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97',contractsCommit:PIN,compilationSHA256:sha(fs.readFileSync(compilationFile)),ownerAndDeployerProposal:OWNER,authoritySelected:false,priceRateSelected:false,securitySelected:false,parentObservation:{blockNumber:Number(BigInt(head.number)),blockHash:head.hash,nonceSource:'pending; not reserved',pendingNonce:nonce,gasPriceWei:gasPrice.toString()},create2:{canonicalAddress:CREATE2,canonicalPresent:actualProxy!=='0x',selectedProposal:proxy,expectedRuntimeKeccak256:keccak256(expectedProxy),projectSalt:SALT,namespacePolicy:'Fresh project namespace; no reuse of unknown mutable dependencies'},actions,counts:{factoryBootstrap:actions.filter(x=>x.category==='factory-bootstrap').length,factoryDependencies:actions.filter(x=>x.category==='factory-dependency').length,feePricer:1,createRollup:1,chainOwnerConfiguration:'not included; depends on selected roles'},RHIsolatedEstimates:{succeeded:actions.filter(x=>x.readOnlyRHEstimateGas).length,failed:actions.filter(x=>x.estimateUnavailable).length,sumGasForAvailableActions:actions.reduce((s,x)=>s+BigInt(x.readOnlyRHEstimateGas||0),0n).toString(),completeFactoryOrRollupEstimate:false,note:'Calls see current chain state, not prior unsigned actions; no state overrides. createRollup and later owner actions remain unestimated.'},createRollup:{to:creator,argumentSchema:schema.format('full'),exactTopLevelFields:schema.components.map(x=>x.name),nativeToken:'0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559',maxDataSize:104857,customOsp:ZeroAddress,deployFactoriesToL2:false,calldata:null,blockedBy:pending},deploymentRoute:{proposal:'Self-deploy pinned Nitro factory/templates using genuine CREATE2 proxy then createRollup',canonicalRobinhoodFactoryListed:false,upstreamSupportStatus:'Noncanonical self-deployment is documented but unsupported upstream; successful private rehearsal is not upstream support'},RPCRequests:requests,signersCreated:0,privateKeysAccessed:false,transactionsSubmitted:0,licenseAccepted:false};
fs.writeFileSync(BASE+'/unsigned-deployment-plan.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');console.log(JSON.stringify({actions:actions.length,counts:report.counts,estimates:report.RHIsolatedEstimates,transactionsSubmitted:0}));
