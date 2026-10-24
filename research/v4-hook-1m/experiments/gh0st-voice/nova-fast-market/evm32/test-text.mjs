// Isolated integration tests. No URLs, production credentials or external providers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import hre from 'hardhat';
import solc from 'solc';
import solcV4 from 'solc-v4';
import * as ethers from 'ethers';
import {quoteExactInput} from '../../nova-pool/liquidity-plan.mjs';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=path.resolve(dir,'../../..');
const prefix='experiments/gh0st-voice/nova-pool/contracts/';
const originalExport=path.resolve(dir,'../voice-v8/exports/grammar4m');
const selectedExport=path.resolve(dir,'../voice-v8/exports/selected');
const defaultExport=fs.existsSync(path.join(originalExport,'core.bin'))?originalExport:selectedExport;
let modelDir;
const MODEL='experiments/gh0st-voice/voice-v8/exports/grammar4m/GRU2SIMDModel.sol';
const MANAGER='@uniswap/v4-core/src/PoolManager.sol';
const plan=JSON.parse(fs.readFileSync(path.resolve(dir,'../nova-pool/liquidity-plan.json')));
const args=process.argv.slice(2);
const opt=(k,d)=>args.find(x=>x.startsWith(k+'='))?.slice(k.length+1)??d;
const outputDir=path.resolve(dir,opt('--out','evm32/real-test'));
assert(outputDir.startsWith(dir+path.sep),'Output must stay in optimization directory');fs.mkdirSync(outputDir,{recursive:true});
const modelSource=path.resolve(dir,opt('--source','selected/GRU2SIMDModel.sol'));
assert(modelSource.startsWith(dir+path.sep),'Source must stay in optimization directory');
const hookSource=opt('--hook','evm32/NovaBoundedTextHook.sol')?path.resolve(dir,opt('--hook','evm32/NovaBoundedTextHook.sol')):null;
if(hookSource)assert(hookSource.startsWith(dir+path.sep),'Hook must stay in experiment directory');
const inferenceBudget=Number(opt('--budget','10000000'));
modelDir=opt('--export','')?path.resolve(dir,opt('--export','')):defaultExport;
const loadOnly=process.argv.includes('--load-only');
const stressOnly=process.argv.includes('--stress-only');
const sentenceOnly=process.argv.includes('--sentence-only');
const sentenceSecurity=process.argv.includes('--sentence-security');
const compactSentence=process.argv.includes('--compact-sentence');
assert(Number(loadOnly)+Number(stressOnly)+Number(sentenceOnly)+Number(sentenceSecurity)<=1,'Select one test mode');
assert(args.every(x=>['--load-only','--stress-only','--sentence-only','--sentence-security','--compact-sentence'].includes(x)||/^--(out|source|hook|budget|tx-gas|export|swaps)=/.test(x)),'Unknown option');
assert(!compactSentence||sentenceOnly||sentenceSecurity,'Compact flag applies only to sentence tests');
const report={status:'RUNNING',mode:'UNFORKED_LOCAL_ONLY',chain_id:31337,transaction_gas_ceiling:Number(opt('--tx-gas','32000000')),started_at:new Date().toISOString(),public_transactions_submitted:0,model_data_injected:false,model_deployments:[],checks:[],swaps:[],concurrent_swaps:[],failure_policy:'A failed inference reverts the entire trade; no fail-open bypass.',plan,seed:ethers.zeroPadValue('0x2a',32),temperatureQ10:512};
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const save=()=>fs.writeFileSync(path.join(outputDir,'text-results.json'),json(report));
const sha=b=>createHash('sha256').update(b).digest('hex');
const rpc=(method,params=[])=>hre.network.provider.request({method,params});
const gas=BigInt(opt('--tx-gas','32000000')),hex=ethers.toBeHex,coder=ethers.AbiCoder.defaultAbiCoder();
const b=n=>BigInt(n), WAD=10n**18n;
const lower=b(plan.sqrt_price_lower_x96),upper=b(plan.sqrt_price_upper_x96),initial=b(plan.initial_sqrt_price_x96),liquidity=b(plan.liquidity);
let artifacts,accounts,manager,factory,reader;
function check(name,detail={}){report.checks.push({name,passed:true,...detail});save();}
function compile(){
 const sources={};for(const name of fs.readdirSync(path.resolve(dir,'../nova-pool/contracts')).filter(x=>x.endsWith('.sol')))sources[prefix+name]={content:fs.readFileSync(path.resolve(dir,'../nova-pool/contracts',name),'utf8')};
 sources[MODEL]={content:fs.readFileSync(modelSource,'utf8')};
 if(hookSource)sources[prefix+'NovaPoolHook.sol']={content:fs.readFileSync(hookSource,'utf8')};
 if(sentenceSecurity)sources[prefix+'NovaSentenceMockModel.sol']={content:fs.readFileSync(path.join(dir,'audit/NovaSentenceMockModel.sol'),'utf8')};
 const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
 const imports={import:p=>{for(const f of [path.join(base,p),path.join(base,'node_modules',p),path.join(base,'node_modules/@uniswap/v4-core/lib',p)])if(fs.existsSync(f))return{contents:fs.readFileSync(f,'utf8')};return{error:'Missing import '+p};}};
 const run=(compiler,s)=>{const result=JSON.parse(compiler.compile(JSON.stringify({language:'Solidity',sources:s,settings}),imports));const e=(result.errors||[]).filter(x=>x.severity==='error');assert.equal(e.length,0,e.map(x=>x.formattedMessage).join('\n'));return result.contracts;};
 const out=run(solc,sources);out[MANAGER]=run(solcV4,{[MANAGER]:{content:fs.readFileSync(path.join(base,'node_modules',MANAGER),'utf8')}})[MANAGER];
 report.source_hashes=Object.fromEntries(Object.entries(sources).map(([p,v])=>[p,sha(v.content)]));report.compiler={model:solc.version(),pool_manager:solcV4.version(),viaIR:true,optimizer_runs:200};return out;
}
const art=(file,name)=>artifacts[file][name];
async function send(req,from=accounts[0],limit=gas){
 assert.equal(hre.network.name,'hardhat');assert(!hre.config.networks.hardhat.forking);
 await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);
 const hash=await rpc('eth_sendTransaction',[{from,gas:hex(limit),gasPrice:'0x0',value:'0x0',...req}]);
 const receipt=await rpc('eth_getTransactionReceipt',[hash]);assert(receipt);return {...receipt,gasUsed:b(receipt.gasUsed),blockNumber:Number(receipt.blockNumber)};
}
function contract(address,a){return{address:ethers.getAddress(address),interface:new ethers.Interface(a.abi),artifact:a};}
async function view(c,name,args=[]){const r=await rpc('eth_call',[{to:c.address,data:c.interface.encodeFunctionData(name,args),gas:hex(gas)},'latest']);return c.interface.decodeFunctionResult(name,r);}
async function value(c,name,args=[]){return(await view(c,name,args))[0];}
const tx=(c,name,args=[],opts={})=>send({to:c.address,data:c.interface.encodeFunctionData(name,args),...(opts.value!==undefined?{value:hex(opts.value)}:{})},opts.from??accounts[0],opts.gas??gas);
async function deploy(a,args=[],name='contract'){
 const req=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(...args),r=await send({data:req.data});assert.equal(r.status,'0x1',name+' deployment');
 return contract(r.contractAddress,a);
}
async function model(){
 const manifest=JSON.parse(fs.readFileSync(path.join(modelDir,'manifest.json')));report.source_checkpoint_sha256=manifest.checkpoint_sha256;
 const groups=['core','groups','words','vocabulary','fused','punctuation'],catalogs={},commitments=[];
 let fixtureAddress=0x100000n;report.model_data_injected=true;
 const blob=async(code,kind)=>{const length=(code.length-2)/2;assert(length<=24576);const address=ethers.getAddress(hex(fixtureAddress++,20));await rpc('hardhat_setCode',[address,code]);report.model_deployments.push({kind,address,bytes:length,injected:true});return address;};
 for(const group of groups){const data=fs.readFileSync(path.join(modelDir,group+'.bin'));assert.equal(sha(data),manifest.artifacts[group+'.bin'].sha256);const addresses=[];let commitment=ethers.ZeroHash;
  for(let offset=0;offset<data.length;offset+=24000){const code='0x00'+data.subarray(offset,offset+24000).toString('hex');addresses.push(await blob(code,'data'));commitment=ethers.keccak256(coder.encode(['bytes32','bytes32'],[commitment,ethers.keccak256(code)]));if(report.model_deployments.length%500===0){console.log('Local weight shards: '+report.model_deployments.length);save();}}
  commitments.push(commitment);const pages=[];for(let i=0;i<addresses.length;i+=1024)pages.push(await blob('0x00'+addresses.slice(i,i+1024).map(a=>a.slice(2)).join(''),'catalog_page'));
  catalogs[group]=await blob('0x00'+pages.map(a=>a.slice(2)).join(''),'catalog_root');
 }
 const deployed=await deploy(art(MODEL,'GRU2SIMDModel'),groups.map(g=>catalogs[g]),'selected model');
 const expected=ethers.keccak256(coder.encode(['string',...groups.map(()=>'bytes32')],[manifest.model_domain,...commitments]));assert.equal(await value(deployed,'modelHash'),expected);report.model_hash=expected;check('selected_model_and_all_data_runtime_hashes');return deployed;
}
async function boot(m){
 const nonce=Number(await rpc('eth_getTransactionCount',[accounts[0],'latest']));const vaultAddress=ethers.getCreateAddress({from:accounts[0],nonce});const tokenAddress=ethers.getCreateAddress({from:vaultAddress,nonce:1});
 const config=[tokenAddress,vaultAddress,plan.fee_pips,plan.tick_spacing,initial,inferenceBudget,await value(m,'modelHash'),ethers.keccak256(await rpc('eth_getCode',[m.address,'latest'])),report.seed,512];
 const hookArt=art(prefix+'NovaPoolHook.sol','NovaPoolHook');const init=(await new ethers.ContractFactory(hookArt.abi,hookArt.evm.bytecode.object).getDeployTransaction(manager.address,m.address,config)).data;
 let salt,hookAddress;for(let n=0;;n++){salt=ethers.zeroPadValue(hex(n),32);hookAddress=ethers.getCreate2Address(factory.address,salt,ethers.keccak256(init));if((b(hookAddress)&0x3fffn)===0x3040n)break;assert(n<1000000);}
 const vault=await deploy(art(prefix+'NovaLiquidityVault.sol','NovaLiquidityVault'),[manager.address,hookAddress,plan.fee_pips,plan.tick_spacing,initial,plan.tick_lower,plan.tick_upper,liquidity],'locked vault');assert.equal(vault.address,vaultAddress);
 const token=contract(await value(vault,'token'),art(prefix+'NovaToken.sol','NovaToken'));assert.equal(token.address,tokenAddress);
 const missing=await tx(vault,'fundAndInitialize',[],{value:WAD});assert.equal(missing.status,'0x0');check('cannot_fund_before_bound_hook_exists');
 const r=await tx(factory,'deploy',[salt,init]);assert.equal(r.status,'0x1','hook CREATE2');
 const hook=contract(hookAddress,hookArt);const key=[ethers.ZeroAddress,token.address,plan.fee_pips,plan.tick_spacing,hookAddress];
 assert.equal(await value(vault,'poolId'),await value(hook,'poolId'));const router=await deploy(art(prefix+'NovaSwapRouter.sol','NovaSwapRouter'),[manager.address,token.address,hook.address,plan.fee_pips,plan.tick_spacing],'router');
 return{vault,token,hook,router,key,id:await value(hook,'poolId'),model:m};
}
async function snapshot(p){return{context:Array.from(await view(p.hook,'contexts',[p.id])),hidden:Array.from(await value(p.hook,'hiddenState',[p.id])),pool:Array.from(await view(reader,'state',[manager.address,p.key])),position:await value(p.vault,'positionLiquidity'),nova:await Promise.all([...accounts.slice(0,4),p.vault.address,p.router.address,manager.address].map(a=>value(p.token,'balanceOf',[a]))),eth:await Promise.all([...accounts.slice(0,4),p.vault.address,p.router.address,manager.address].map(a=>rpc('eth_getBalance',[a,'latest'])))};}
async function reject(p,name,req,from=accounts[1],limit=gas){const before=await snapshot(p);const r=await send(req,from,limit);assert.equal(r.status,'0x0',name+' must revert');assert.equal(json(await snapshot(p)),json(before),name+' atomic state');assert.equal(r.logs.length,0);check(name,{gas:r.gasUsed});return r;}
function quote(state,buy,amount){return quoteExactInput({sqrtPriceX96:state, sqrtPriceLowerX96:lower,sqrtPriceUpperX96:upper,liquidity,fee:plan.fee_pips,zeroForOne:buy,amountIn:amount});}
const deadline=2n**63n;
const buyReq=(p,amount,min=1n,limit=lower)=>({to:p.router.address,data:p.router.interface.encodeFunctionData('buy',[min,limit,deadline]),value:hex(amount)});
const sellReq=(p,amount,min=1n,limit=upper)=>({to:p.router.address,data:p.router.interface.encodeFunctionData('sell',[amount,min,limit,deadline])});

function parseText(p,r){
 const events=r.logs.filter(l=>l.address.toLowerCase()===p.hook.address.toLowerCase()).map(l=>p.hook.interface.parseLog(l));
 assert.equal(events.length,1);assert.equal(events[0].name,'TextAdvanced');return events[0].args;
}
async function textTrade(p,buy,amount,from=accounts[1],record=true){
 const before=await snapshot(p),sentenceBefore=await value(p.hook,'sentenceCount',[p.id]);
 const predicted=quote(before.pool[0],buy,amount);assert.equal(predicted.unspentAmountIn,0n);
 const request=buy?buyReq(p,amount,predicted.amountOut):sellReq(p,amount,predicted.amountOut);
 const r=await send(request,from);
 if(r.status!=='0x1'){
  report.failed_trade={receipt:r,before};
  try{await rpc('eth_call',[{from,gas:hex(gas),...request},'latest']);}
  catch(error){report.failed_trade.error={message:error.message,data:error.data};}
  save();
 }
 assert.equal(r.status,'0x1','bounded text trade must succeed');assert(r.gasUsed<=32000000n);
 const block=await rpc('eth_getBlockByNumber',[hex(r.blockNumber),false]);assert.equal(b(block.gasLimit),32000000n);
 const e=parseText(p,r),after=await snapshot(p),count=Number(e.lastWord-e.firstWord+1n);
 assert(count>=1&&count<=3);assert.equal(e.firstWord,before.context[4]+1n);assert.equal(e.lastWord,after.context[4]);
 assert.equal(e.previousStateHash,before.context[8]);assert.equal(e.stateHash,after.context[8]);
 assert.equal(after.context[4]-before.context[4],BigInt(count));
 assert.equal(await value(p.hook,'sentenceCount',[p.id]),sentenceBefore+(e.terminal?1n:0n));
 assert.equal(after.pool[0],predicted.sqrtPriceX96);assert.equal(after.position,liquidity);
 const index=accounts.slice(0,4).indexOf(from);if(index>=0){assert.equal(b(after.nova[index])-b(before.nova[index]),buy?predicted.amountOut:-amount);assert.equal(b(after.eth[index])-b(before.eth[index]),buy?-amount:predicted.amountOut);}
 const move=Math.min(1024,Math.abs(Number(after.pool[1])-Number(before.context[0]))),elapsed=Math.min(300,Number(after.context[3])-Number(before.context[3]));
 const features=[move*4,Number(before.context[2])*4,Math.abs(move-Number(before.context[1]))*4,Math.floor(elapsed*1024/300),buy?1024:-1024,1024];
 const row={direction:buy?'BUY':'SELL',from,amountIn:amount,amountOut:predicted.amountOut,gasUsed:r.gasUsed,hash:r.transactionHash,block:r.blockNumber,wordCount:count,text:e.text,terminal:e.terminal,firstWord:e.firstWord,lastWord:e.lastWord,features,previousStateHash:e.previousStateHash,stateHash:e.stateHash,before,after};
 if(record){report.swaps.push(row);save();}return row;
}
async function runText(p){
 report.requested_output='maximum bounded neural words continuing the same story';report.maximum_words_per_swap=3;
 report.stage='REAL_BOUNDED_TEXT_BUYS_AND_SELLS';save();
 for(const from of accounts.slice(1,4))assert.equal((await tx(p.token,'approve',[p.router.address,ethers.MaxUint256],{from})).status,'0x1');
 const n=Number(opt('--swaps','32'));assert(n>=2&&n<=128&&n%2===0);
 for(let i=0;i<n/2;i++){
  const from=accounts[1+i%3],amount=[WAD/1000n,WAD/200n,WAD/50n][i%3];
  const row=await textTrade(p,true,amount,from);await textTrade(p,false,row.amountOut,from);
  console.log('Bounded real-model swaps: '+report.swaps.length);
 }
 check('real_buys_and_sells_with_continuous_neural_state',{swaps:n});
 const countBefore=await value(p.hook,'sentenceCount',[p.id]);
 await reject(p,'slippage_failure_rolls_back_all_fragment_words',buyReq(p,WAD/1000n,1000000n*WAD));assert.equal(await value(p.hook,'sentenceCount',[p.id]),countBefore);
 await reject(p,'expired_order_reverts',{to:p.router.address,data:p.router.interface.encodeFunctionData('buy',[1,lower,1]),value:hex(WAD/1000n)});
 await reject(p,'unfunded_seller_reverts',sellReq(p,WAD),accounts[4]);
 await reject(p,'insufficient_gas_rolls_back_trade',buyReq(p,WAD/1000n),accounts[1],1000000n);
 const originalCode=await rpc('eth_getCode',[p.model.address,'latest']);await rpc('hardhat_setCode',[p.model.address,'0x00']);await reject(p,'changed_model_code_reverts_atomically',buyReq(p,WAD/1000n));await rpc('hardhat_setCode',[p.model.address,originalCode]);
 const start=await snapshot(p);await rpc('evm_setAutomine',[false]);const hashes=[];
 try{
  for(const from of accounts.slice(2,4))hashes.push(await rpc('eth_sendTransaction',[{from,gas:hex(gas),gasPrice:'0x0',...buyReq(p,WAD/100000n)}]));
  for(let i=0;i<3;i++){await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);await rpc('evm_mine');}
 }finally{await rpc('evm_setAutomine',[true]);}
 let last=start.context[4];for(const hash of hashes){const r=await rpc('eth_getTransactionReceipt',[hash]);assert.equal(r.status,'0x1');const e=parseText(p,r);assert.equal(e.firstWord,last+1n);last=e.lastWord;report.concurrent_swaps.push({hash,gasUsed:b(r.gasUsed),firstWord:e.firstWord,lastWord:e.lastWord,text:e.text,terminal:e.terminal});}
 assert.equal((await snapshot(p)).context[4],last);check('pending_orders_advance_state_without_interleaving');
 const actor=await deploy(art(prefix+'NovaTestHarness.sol','NovaReentryTrader'),[p.router.address]);assert.equal((await tx(actor,'buy',[lower],{value:WAD/1000n})).status,'0x1');assert.equal((await tx(actor,'approve',[p.token.address,ethers.MaxUint256])).status,'0x1');const actorTokens=await value(p.token,'balanceOf',[actor.address]);assert.equal((await tx(actor,'sell',[actorTokens,upper])).status,'0x1');assert.equal(await value(actor,'attempted'),true);assert.equal(await value(actor,'blocked'),true);check('native_payout_reentrancy_blocked');
 const costs=report.swaps.map(x=>x.gasUsed),words=report.swaps.map(x=>x.wordCount);
 report.summary={swaps:n,total_words:words.reduce((a,b)=>a+b,0),min_words:Math.min(...words),max_words:Math.max(...words),min_gas:costs.reduce((a,b)=>a<b?a:b),max_gas:costs.reduce((a,b)=>a>b?a:b),mean_gas:costs.reduce((a,b)=>a+b,0n)/BigInt(n),completed_sentences:report.swaps.filter(x=>x.terminal).length};
 report.final_state=await snapshot(p);report.status='PASS';report.stage='COMPLETE';report.finished_at=new Date().toISOString();save();
 fs.writeFileSync(path.join(outputDir,'actual-transcript.txt'),report.swaps.map(x=>x.text).join(' ')+'\n');console.log(json({status:report.status,checks:report.checks.length,...report.summary}));
}
async function main(){
 assert.equal(hre.network.name,'hardhat');assert(!hre.config.networks.hardhat.forking);report.optimization={source:modelSource,hook:hookSource,export:modelDir,inference_budget:inferenceBudget,transaction_limit:gas.toString(),block_limit:32000000};report.stage='COMPILING';save();artifacts=compile();
 hre.config.networks.hardhat.chainId=31337;hre.config.networks.hardhat.blockGasLimit=32000000;hre.config.networks.hardhat.initialBaseFeePerGas=0;hre.config.networks.hardhat.throwOnTransactionFailures=false;
 await rpc('hardhat_reset');assert.equal(await rpc('eth_chainId'),'0x7a69');assert.match(await rpc('web3_clientVersion'),/Hardhat/);accounts=await rpc('eth_accounts');
 const genesisBlock=await rpc('eth_getBlockByNumber',['latest',false]);assert.equal(b(genesisBlock.gasLimit),32000000n);report.verified_block_gas_limit=b(genesisBlock.gasLimit);
 report.stage='REAL_MODEL_DEPLOYMENT';const realModel=await model();
 manager=await deploy(art(MANAGER,'PoolManager'),[accounts[0]],'PoolManager');factory=await deploy(art(prefix+'NovaTestHarness.sol','NovaCreate2Factory'));reader=await deploy(art(prefix+'NovaTestHarness.sol','NovaPoolReader'));
 report.stage='GENESIS';save();const p=await boot(realModel);report.contracts=Object.fromEntries(['model','vault','token','hook','router'].map(k=>[k,p[k].address]));report.contracts.poolManager=manager.address;report.poolId=p.id;
 const names=p.token.interface.fragments.filter(x=>x.type==='function').map(x=>x.name).sort();assert.deepEqual(names,['FIXED_SUPPLY','allowance','approve','balanceOf','decimals','name','symbol','totalSupply','transfer','transferFrom'].sort());check('fixed_token_abi_no_mint_admin_upgrade_or_tax');
 assert.equal(await value(p.token,'totalSupply'),1000000n*WAD);assert.equal(await value(p.token,'balanceOf',[p.vault.address]),1000000n*WAD);for(const a of accounts.slice(0,4))assert.equal(await value(p.token,'balanceOf',[a]),0n);check('no_outside_token_holders_at_genesis');
 await reject(p,'unauthorized_initializer_cannot_front_run_price',{to:manager.address,data:manager.interface.encodeFunctionData('initialize',[p.key,initial])});
 for(const [name,key] of [['wrong_fee',[...p.key.slice(0,2),500,1,p.hook.address]],['wrong_spacing',[...p.key.slice(0,3),60,p.hook.address]],['wrong_token',[ethers.ZeroAddress,accounts[8],plan.fee_pips,1,p.hook.address]]])await reject(p,'pool_binding_'+name,{to:manager.address,data:manager.interface.encodeFunctionData('initialize',[key,initial])});
 await reject(p,'incorrect_genesis_eth_reverts',{to:p.vault.address,data:p.vault.interface.encodeFunctionData('fundAndInitialize'),value:hex(WAD/2n)});
 const launch=await tx(p.vault,'fundAndInitialize',[],{value:WAD});assert.equal(launch.status,'0x1','genesis');assert.equal(await value(p.vault,'positionLiquidity'),liquidity);assert.equal(await value(p.vault,'nativeRequired'),WAD);assert.equal(await value(p.vault,'tokenRequired'),b(plan.active_principal_nova_wei));assert.equal(await value(p.token,'balanceOf',[p.vault.address]),b(plan.locked_dust_nova_wei));report.genesis={gasUsed:launch.gasUsed,eth:WAD,nova:b(plan.active_principal_nova_wei),locked_nova_dust:b(plan.locked_dust_nova_wei),locked_position_liquidity:liquidity};check('one_eth_full_supply_allocation_and_permanent_lp');
 await reject(p,'duplicate_genesis_reverts',{to:p.vault.address,data:p.vault.interface.encodeFunctionData('fundAndInitialize'),value:hex(WAD)});
 await reject(p,'vault_callback_not_public',{to:p.vault.address,data:p.vault.interface.encodeFunctionData('unlockCallback',['0x'])});
 await reject(p,'hook_callback_not_public',{to:p.hook.address,data:p.hook.interface.encodeFunctionData('afterSwap',[accounts[1],p.key,[true,-1n,lower],0,'0x'])});
 for(const signature of ['withdraw()','withdraw(uint256)','removeLiquidity()','collectFees()','rescueTokens(address,uint256)','transferOwnership(address)','upgradeTo(address)'])await reject(p,'vault_has_no_'+signature,{to:p.vault.address,data:ethers.id(signature).slice(0,10)});
 const attack=await deploy(art(prefix+'NovaTestHarness.sol','NovaLPAttack'),[manager.address]);await reject(p,'another_contract_cannot_remove_locked_position',{to:attack.address,data:attack.interface.encodeFunctionData('remove',[p.key,plan.tick_lower,plan.tick_upper,liquidity])});

 await runText(p);
}
main().catch(e=>{report.status="FAILED";report.error=String(e.stack??e);save();console.error(e);process.exitCode=1;});
