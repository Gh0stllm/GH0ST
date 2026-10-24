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
import {quoteExactInput} from '../../../nova-pool/liquidity-plan.mjs';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=path.resolve(dir,'../../..');
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
const outputDir=path.resolve(dir,opt('--out','results'));
assert(outputDir.startsWith(dir+path.sep),'Output must stay in optimization directory');fs.mkdirSync(outputDir,{recursive:true});
const modelSource=path.resolve(dir,opt('--source','selected/GRU2SIMDModel.sol'));
assert(modelSource.startsWith(dir+path.sep),'Source must stay in optimization directory');
const hookSource=opt('--hook','')?path.resolve(dir,opt('--hook','')):null;
if(hookSource)assert(hookSource.startsWith(dir+path.sep),'Hook must stay in experiment directory');
const inferenceBudget=Number(opt('--budget','13300000'));
modelDir=opt('--export','')?path.resolve(dir,opt('--export','')):defaultExport;
const loadOnly=process.argv.includes('--load-only');
const stressOnly=process.argv.includes('--stress-only');
const sentenceOnly=process.argv.includes('--sentence-only');
const sentenceSecurity=process.argv.includes('--sentence-security');
const compactSentence=process.argv.includes('--compact-sentence');
assert(Number(loadOnly)+Number(stressOnly)+Number(sentenceOnly)+Number(sentenceSecurity)<=1,'Select one test mode');
assert(args.every(x=>['--load-only','--stress-only','--sentence-only','--sentence-security','--compact-sentence'].includes(x)||/^--(out|source|hook|budget|tx-gas|export)=/.test(x)),'Unknown option');
assert(!compactSentence||sentenceOnly||sentenceSecurity,'Compact flag applies only to sentence tests');
const report={status:'RUNNING',mode:'UNFORKED_LOCAL_ONLY',chain_id:31337,transaction_gas_ceiling:Number(opt('--tx-gas','16000000')),started_at:new Date().toISOString(),public_transactions_submitted:0,model_data_injected:false,model_deployments:[],checks:[],swaps:[],concurrent_swaps:[],failure_policy:'A failed inference reverts the entire trade; no fail-open bypass.',plan,seed:ethers.zeroPadValue('0x2a',32),temperatureQ10:512};
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const save=()=>fs.writeFileSync(path.join(outputDir,sentenceSecurity?'sentence-security.json':sentenceOnly?'sentence-results.json':stressOnly?'stress-results.json':loadOnly?'load-test-results.json':'integration-results.json'),json(report));
const sha=b=>createHash('sha256').update(b).digest('hex');
const rpc=(method,params=[])=>hre.network.provider.request({method,params});
const gas=BigInt(opt('--tx-gas','16000000')),hex=ethers.toBeHex,coder=ethers.AbiCoder.defaultAbiCoder();
const b=n=>BigInt(n), WAD=10n**18n;
const lower=b(plan.sqrt_price_lower_x96),upper=b(plan.sqrt_price_upper_x96),initial=b(plan.initial_sqrt_price_x96),liquidity=b(plan.liquidity);
let artifacts,accounts,manager,factory,reader;
function check(name,detail={}){report.checks.push({name,passed:true,...detail});save();}
function compile(){
 const sources={};for(const name of fs.readdirSync(path.resolve(dir,'../nova-pool/contracts')).filter(x=>x.endsWith('.sol')))sources[prefix+name]={content:fs.readFileSync(path.resolve(dir,'../nova-pool/contracts',name),'utf8')};
 if(!sentenceSecurity)sources[MODEL]={content:fs.readFileSync(modelSource,'utf8')};
 if(hookSource)sources[prefix+'NovaPoolHook.sol']={content:fs.readFileSync(hookSource,'utf8')};
 if(sentenceSecurity)sources[prefix+'NovaBatchMockModel.sol']={content:fs.readFileSync(path.join(dir,'evm32/audit/NovaBatchMockModel.sol'),'utf8')};
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
 const blob=async(code,kind)=>{const length=(code.length-2)/2;assert(length<=24576);const init='0x61'+length.toString(16).padStart(4,'0')+'80600a3d393df3'+code.slice(2);const r=await send({data:init});assert.equal(r.status,'0x1');assert.equal(await rpc('eth_getCode',[r.contractAddress,'latest']),code);report.model_deployments.push({kind,address:r.contractAddress,gas:r.gasUsed,bytes:length});return r.contractAddress;};
 for(const group of groups){const data=fs.readFileSync(path.join(modelDir,group+'.bin'));assert.equal(sha(data),manifest.artifacts[group+'.bin'].sha256);const addresses=[];let commitment=ethers.ZeroHash;
  for(let offset=0;offset<data.length;offset+=24000){const code='0x00'+data.subarray(offset,offset+24000).toString('hex');addresses.push(await blob(code,'data'));commitment=ethers.keccak256(coder.encode(['bytes32','bytes32'],[commitment,ethers.keccak256(code)]));if(report.model_deployments.length%500===0){console.log('Local data contracts: '+report.model_deployments.length);save();}}
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
async function trade(p,buy,amount,from,record=true){
 const before=await snapshot(p);const predicted=quote(before.pool[0],buy,amount);assert.equal(predicted.unspentAmountIn,0n);
 const request=buy?buyReq(p,amount,predicted.amountOut):sellReq(p,amount,predicted.amountOut);
 const r=await send(request,from);
 if(r.status!=='0x1'){
  let diagnostic;
  try{diagnostic=await rpc('eth_call',[{from,gas:hex(gas),...request},'latest']);}catch(error){diagnostic={message:error.message,data:error.data};}
  report.failed_trade={direction:buy?'BUY':'SELL',receipt:r,diagnostic};save();console.error(json(report.failed_trade));
 }
 assert.equal(r.status,'0x1',(buy?'buy':'sell')+' failed');assert(r.gasUsed<gas);
 const after=await snapshot(p),events=r.logs.filter(l=>l.address.toLowerCase()===p.hook.address.toLowerCase()).map(l=>p.hook.interface.parseLog(l));assert.equal(events.length,1);const e=events[0].args;
 assert.equal(e.sequence,before.context[4]+1n);assert.equal(e.sampleIndex,before.context[4]);assert.equal(after.context[4],e.sequence);assert.equal(after.pool[0],predicted.sqrtPriceX96);assert.equal(after.position,liquidity);
 const traderIndex=accounts.slice(0,4).indexOf(from);if(traderIndex>=0){const delta=b(after.nova[traderIndex])-b(before.nova[traderIndex]);assert.equal(delta,buy?predicted.amountOut:-amount);const nativeDelta=b(after.eth[traderIndex])-b(before.eth[traderIndex]);assert.equal(nativeDelta,buy?-amount:predicted.amountOut);}
 const row={direction:buy?'BUY':'SELL',from,amountIn:amount,amountOut:predicted.amountOut,gasUsed:r.gasUsed,hash:r.transactionHash,block:r.blockNumber,token:Number(e.token),punct:Number(e.punct),text:e.text,terminal:e.terminal,features:Array.from(e.features),branchScores:Array.from(e.branchScores),sampleIndex:Number(e.sampleIndex),sequence:Number(e.sequence),before,after};
 if(record){report.swaps.push(row);save();}return row;
}
async function runLoad(p){
 const bursts=[{size:4,buy:true},{size:8,buy:true},{size:16,buy:true},{size:16,buy:false}];
 report.bursts=[];report.stage='QUEUED_REAL_MODEL_SWAPS';save();
 for(const batch of bursts){
  if(!batch.buy)for(const from of accounts.slice(1,batch.size+1))assert.equal((await tx(p.token,'approve',[p.router.address,ethers.MaxUint256],{from})).status,'0x1');
  const startSequence=Number((await view(p.hook,'contexts',[p.id]))[4]);
  const current=(await view(reader,'state',[manager.address,p.key]))[0];
  const hashes=[],submittedAt=Date.now();await rpc('evm_setAutomine',[false]);let minedBlocks=0;
  try{
   for(const from of accounts.slice(1,batch.size+1)){
    const amount=batch.buy?WAD/1000n:(await value(p.token,'balanceOf',[from]))/2n;
    assert(amount>0n);const expected=quote(current,batch.buy,amount).amountOut;
    const req=batch.buy?buyReq(p,amount,expected*99n/100n):sellReq(p,amount,expected*99n/100n);
    const hash=await rpc('eth_sendTransaction',[{from,gas:hex(gas),gasPrice:'0x0',...req}]);hashes.push(hash);
   }
   const queueAcceptedAt=Date.now();
   for(let i=0;i<batch.size+2;i++){
    if((await Promise.all(hashes.map(h=>rpc('eth_getTransactionReceipt',[h])))).every(Boolean))break;
    await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);await rpc('evm_mine');minedBlocks++;
   }
   const receipts=await Promise.all(hashes.map(h=>rpc('eth_getTransactionReceipt',[h])));
   assert(receipts.every(Boolean),'Queue did not drain');
   const rows=receipts.map(r=>{
    assert.equal(r.status,'0x1','Queued trade reverted');const e=r.logs.filter(l=>l.address.toLowerCase()===p.hook.address.toLowerCase()).map(l=>p.hook.interface.parseLog(l));assert.equal(e.length,1);
    return{hash:r.transactionHash,blockNumber:Number(r.blockNumber),gasUsed:b(r.gasUsed),sequence:Number(e[0].args.sequence),text:e[0].args.text};
   });
   const ordered=[...rows].sort((a,b)=>a.sequence-b.sequence);ordered.forEach((r,i)=>assert.equal(r.sequence,startSequence+i+1));
   const endSequence=Number((await view(p.hook,'contexts',[p.id]))[4]);assert.equal(endSequence,startSequence+batch.size);
   assert.equal(await value(p.vault,'positionLiquidity'),liquidity);assert.equal(await value(p.token,'totalSupply'),1000000n*WAD);
   const byBlock={};for(const r of rows){assert(r.gasUsed<gas);byBlock[r.blockNumber]=(byBlock[r.blockNumber]||0)+1;}
   report.bursts.push({direction:batch.buy?'BUY':'SELL',submitted:batch.size,accepted_before_mining:hashes.length,successful:rows.length,failed:0,startSequence,endSequence,blocksMined:minedBlocks,blocksContainingSwaps:Object.keys(byBlock).length,maxSwapsInOneBlock:Math.max(...Object.values(byBlock)),maxGas:rows.reduce((m,r)=>r.gasUsed>m?r.gasUsed:m,0n),totalGas:rows.reduce((s,r)=>s+r.gasUsed,0n),queue_submission_wall_ms:queueAcceptedAt-submittedAt,local_execution_wall_ms:Date.now()-queueAcceptedAt,rows});save();
   console.log(json({burst:batch.size,direction:batch.buy?'BUY':'SELL',successful:rows.length,blocks:Object.keys(byBlock).length,maxSwapsPerBlock:Math.max(...Object.values(byBlock))}));
  }finally{await rpc('evm_setAutomine',[true]);}
 }
 const all=report.bursts.flatMap(b=>b.rows);report.total_successful_swaps=all.length;report.failure_count=0;report.max_tested_pending_swaps=16;report.max_swaps_per_32m_block=Math.max(...report.bursts.map(b=>b.maxSwapsInOneBlock));
 report.gas_summary={minimum:all.reduce((m,r)=>r.gasUsed<m?r.gasUsed:m,gas),maximum:all.reduce((m,r)=>r.gasUsed>m?r.gasUsed:m,0n),mean:all.reduce((s,r)=>s+r.gasUsed,0n)/BigInt(all.length)};
 report.local_timing_is_not_mainnet_throughput=true;report.status='PASS';report.stage='COMPLETE';report.finished_at=new Date().toISOString();save();console.log(json({status:report.status,total:all.length,maxPending:16,maxPerBlock:report.max_swaps_per_32m_block,gas:report.gas_summary}));
}
async function runStress(p){
 report.stage='STRESS_INVENTORY';save();
 const traders=accounts.slice(1,17),inventory=new Map();
 for(const from of traders){
  await trade(p,true,WAD/10000n,from,false);
  assert.equal((await tx(p.token,'approve',[p.router.address,ethers.MaxUint256],{from})).status,'0x1');
  inventory.set(from,await value(p.token,'balanceOf',[from]));
 }
 const initialState=await snapshot(p),startSequence=Number(initialState.context[4]),startPrice=initialState.pool[0];
 report.stress={arrivals_per_second:10,successful_orders_requested:100,scheduled_arrival_seconds:10,
  note:'All orders are queued before local mining. Arrival times are a deterministic 10/s scenario for later gas-demand analysis, not observed mainnet throughput.',
  startSequence,initialState,orders:[],blocks:[]};
 report.stage='STRESS_QUEUE';save();await rpc('evm_setAutomine',[false]);
 try{
  for(let i=0;i<100;i++){
   const from=traders[i%traders.length],buy=(Math.floor(i/traders.length)%2===0),amount=buy?WAD/100000n:inventory.get(from)/10n;
   const expected=quote(startPrice,buy,amount).amountOut;
   const req=buy?buyReq(p,amount,expected*99n/100n):sellReq(p,amount,expected*99n/100n);
   const hash=await rpc('eth_sendTransaction',[{from,gas:hex(gas),gasPrice:'0x0',...req}]);
   report.stress.orders.push({order:i,arrival_ms:i*100,expected_success:true,direction:buy?'BUY':'SELL',hash});
   if(i%25===24){
    const failed=await rpc('eth_sendTransaction',[{from,gas:hex(gas),gasPrice:'0x0',...buyReq(p,WAD/100000n,1000000n*WAD)}]);
    report.stress.orders.push({order:i,arrival_ms:i*100,expected_success:false,direction:'INVALID_SLIPPAGE',hash:failed});
   }
  }
  report.stress.accepted_before_mining=report.stress.orders.length;report.stage='STRESS_MINING';save();
  for(let i=0;i<report.stress.orders.length+2;i++){
   const pending=await Promise.all(report.stress.orders.map(o=>rpc('eth_getTransactionReceipt',[o.hash])));
   if(pending.every(Boolean))break;
   await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);await rpc('evm_mine');
   const block=await rpc('eth_getBlockByNumber',['latest',false]);
   assert.equal(b(block.gasLimit),32000000n);assert(b(block.gasUsed)<=32000000n);
   report.stress.blocks.push({number:Number(block.number),hash:block.hash,gas_limit:b(block.gasLimit),gas_used:b(block.gasUsed),transactions:block.transactions});
   if(i%10===0){console.log('Stress blocks: '+(i+1));save();}
  }
  let success=0,failed=0;
  for(const order of report.stress.orders){
   const r=await rpc('eth_getTransactionReceipt',[order.hash]);assert(r,'Stress queue did not drain');
   assert.equal(r.status,order.expected_success?'0x1':'0x0');
   const events=r.logs.filter(l=>l.address.toLowerCase()===p.hook.address.toLowerCase()).map(l=>p.hook.interface.parseLog(l));
   if(order.expected_success){assert.equal(events.length,1);assert(events[0].args.text.length>0);success++;order.sequence=Number(events[0].args.sequence);order.text=events[0].args.text;}
   else{assert.equal(events.length,0);failed++;}
   order.gas_used=b(r.gasUsed);order.block=Number(r.blockNumber);order.transaction_index=Number(r.transactionIndex);
  }
  const successful=report.stress.orders.filter(o=>o.expected_success).sort((a,b)=>a.block-b.block||a.transaction_index-b.transaction_index);
  successful.forEach((o,i)=>assert.equal(o.sequence,startSequence+i+1));
  const finalState=await snapshot(p);assert.equal(Number(finalState.context[4]),startSequence+100);
  assert.equal(finalState.position,liquidity);assert.equal(await value(p.token,'totalSupply'),1000000n*WAD);
  report.stress.successful=success;report.stress.expected_reverts=failed;report.stress.finalState=finalState;
  report.stress.valid_gas=successful.reduce((s,o)=>s+o.gas_used,0n);
  report.stress.reverted_gas=report.stress.orders.filter(o=>!o.expected_success).reduce((s,o)=>s+o.gas_used,0n);
  report.stress.minimum_valid_gas=successful.reduce((m,o)=>o.gas_used<m?o.gas_used:m,gas);
  report.stress.maximum_valid_gas=successful.reduce((m,o)=>o.gas_used>m?o.gas_used:m,0n);
  report.stress.mean_valid_gas=report.stress.valid_gas/100n;
  const counts={};for(const o of successful)counts[o.block]=(counts[o.block]??0)+1;
  report.stress.max_words_per_block=Math.max(...Object.values(counts));
  report.status='PASS';report.stage='COMPLETE';report.finished_at=new Date().toISOString();save();
  console.log(json({status:report.status,successful:success,expected_reverts:failed,blocks:report.stress.blocks.length,max_words_per_block:report.stress.max_words_per_block,mean_valid_gas:report.stress.mean_valid_gas}));
 }finally{await rpc('evm_setAutomine',[true]);}
}
async function runSentence(p){
 report.stage='REAL_SENTENCE_32M_LIMIT';report.requested_output='complete_neural_sentence_per_swap';save();
 const before=await snapshot(p),beforeCount=await value(p.hook,'sentenceCount',[p.id]);
 const checkpoint=await rpc('evm_snapshot');
 const request=buyReq(p,WAD/1000n);
 const r=await send(request,accounts[1],32000000n);
 const block=await rpc('eth_getBlockByNumber',[hex(r.blockNumber),false]);
 report.sentence_32m={status:r.status,gas_used:r.gasUsed,block_gas_limit:b(block.gasLimit),hash:r.transactionHash,logs:r.logs.length};
 assert.equal(b(block.gasLimit),32000000n);
 if(r.status==='0x0'){
  assert.equal(json(await snapshot(p)),json(before),'Failed sentence must rollback all pool/neural/token/ETH state');
  assert.equal(await value(p.hook,'sentenceCount',[p.id]),beforeCount);
  assert.equal(r.logs.length,0);report.sentence_32m.atomic_rollback=true;
 }else{
  const events=r.logs.filter(l=>l.address.toLowerCase()===p.hook.address.toLowerCase()).map(l=>p.hook.interface.parseLog(l));
  assert.equal(events.filter(e=>e.name==='SentenceSpoken').length,1);
  if(!compactSentence)assert.equal(events.filter(e=>e.name==='WordSpoken').at(-1).args.terminal,true);
 }
 save();assert.equal(await rpc('evm_revert',[checkpoint]),true);
 // Explicit local-only diagnostic: the larger block exposes full sentence cost, not a valid 32M deployment setting.
 await rpc('evm_setBlockGasLimit',[hex(512000000n)]);
 await rpc('evm_setNextBlockTimestamp',[Number(block.timestamp)]);
 report.stage='DIAGNOSTIC_ONLY_512M_SENTENCE';save();
 const diagnostic=await send(request,accounts[1],500000000n);
 const diagnosticBlock=await rpc('eth_getBlockByNumber',[hex(diagnostic.blockNumber),false]);
 report.sentence_diagnostic={diagnostic_only:true,production_valid:false,status:diagnostic.status,gas_used:diagnostic.gasUsed,transaction_gas_limit:500000000,block_gas_limit:b(diagnosticBlock.gasLimit),hash:diagnostic.transactionHash};
 if(diagnostic.status==='0x1'){
  const events=diagnostic.logs.filter(l=>l.address.toLowerCase()===p.hook.address.toLowerCase()).map(l=>p.hook.interface.parseLog(l));
  const words=events.filter(e=>e.name==='WordSpoken'),sentences=events.filter(e=>e.name==='SentenceSpoken');
  assert.equal(sentences.length,1);const wordCount=compactSentence?Number(sentences[0].args.lastWord-sentences[0].args.firstWord+1n):words.length;
  assert(wordCount>0&&wordCount<=32);assert.equal(words.length,compactSentence?0:wordCount);
  const after=await snapshot(p);assert.equal(await value(p.hook,'sentenceCount',[p.id]),beforeCount+1n);
  assert.equal(after.context[4],before.context[4]+BigInt(wordCount));assert.equal(after.position,liquidity);
  words.forEach((w,i)=>{assert.equal(w.args.sequence,before.context[4]+BigInt(i+1));assert.equal(w.args.sampleIndex,before.context[4]+BigInt(i));assert.equal(w.args.terminal,i===words.length-1);});
  if(!compactSentence)assert.equal(sentences[0].args.text,words.map(w=>w.args.text).join(' '));
  report.sentence_diagnostic.words=words.map(w=>({sequence:w.args.sequence,token:w.args.token,punct:w.args.punct,text:w.args.text,terminal:w.args.terminal,features:Array.from(w.args.features),scores:Array.from(w.args.branchScores),sampleIndex:w.args.sampleIndex,stateHash:w.args.stateHash,previousStateHash:w.args.previousStateHash}));
  const move=Math.min(1024,Math.abs(Number(after.pool[1])-Number(before.context[0]))),elapsed=Math.min(300,Number(after.context[3])-Number(before.context[3]));
  report.sentence_diagnostic.features=[move*4,Number(before.context[2])*4,Math.abs(move-Number(before.context[1]))*4,Math.floor(elapsed*1024/300),1024,1024];
  report.sentence_diagnostic.compact_output=compactSentence;
  report.sentence_diagnostic.text=sentences[0].args.text;report.sentence_diagnostic.word_count=wordCount;
  report.sentence_diagnostic.before=before;report.sentence_diagnostic.after=after;
 }else{
  assert.equal(json(await snapshot(p)),json(before));assert.equal(await value(p.hook,'sentenceCount',[p.id]),beforeCount);assert.equal(diagnostic.logs.length,0);
  report.sentence_diagnostic.atomic_rollback=true;
 }
 await rpc('evm_setBlockGasLimit',[hex(32000000n)]);
 report.status='LOCAL_SENTENCE_TEST_COMPLETE';report.requested_10_sentences_per_second_demonstrated=false;
 report.stage='COMPLETE';report.finished_at=new Date().toISOString();save();
 console.log(json({status:report.status,within32M:report.sentence_32m,diagnostic:{...report.sentence_diagnostic,words:undefined,before:undefined,after:undefined}}));
}
async function runSentenceSecurity(p){
 report.uses_adversarial_mock_model=true;report.stage='BATCH_TEXT_ATOMICITY';save();
 assert.equal((await tx(p.token,'approve',[p.router.address,ethers.MaxUint256],{from:accounts[1]})).status,'0x1');
 const parse=r=>r.logs.filter(l=>l.address.toLowerCase()===p.hook.address.toLowerCase()).map(l=>p.hook.interface.parseLog(l));
 const sequence=async()=> (await view(p.hook,'contexts',[p.id]))[4];
 const setPlan=async(terminal=0,faultAt=0,fault=0)=>{assert.equal((await tx(p.model,'setPlan',[await sequence(),terminal,faultAt,fault])).status,'0x1');};
 report.decoder_probes=[];
 for(const count of [1,2,3]){
  await setPlan(count);
  const raw=await rpc('eth_call',[{to:p.model.address,data:p.model.interface.encodeFunctionData('stepBatchChecked',[8192,0,Array(768).fill(0),Array(6).fill(0),report.seed,0,512,3]),gas:hex(gas)},'latest']);
  const data=p.hook.interface.encodeFunctionData('decodeBatch',[raw]);
  const needed=await rpc('eth_estimateGas',[{from:p.hook.address,to:p.hook.address,data,gasPrice:'0x0',gas:hex(gas)}]);
  report.decoder_probes.push({count,raw_bytes:(raw.length-2)/2,transaction_estimate:b(needed),note:'Includes intrinsic calldata gas; direct self-call minimum probed below.'});
  let lo=100000n,hi=5000000n;
  while(hi-lo>1000n){const mid=(lo+hi)/2n;try{await rpc('eth_call',[{from:p.hook.address,to:p.hook.address,data,gas:hex(mid)},'latest']);hi=mid;}catch{lo=mid;}}
  report.decoder_probes.at(-1).transaction_minimum_call_gas=hi;
  // High calldata intrinsic cost is included by eth_call; an internal self-call excludes it.
  const bytes=ethers.getBytes(data),intrinsic=21000n+bytes.reduce((s,x)=>s+(x===0?4n:16n),0n);
  report.decoder_probes.at(-1).intrinsic_gas=intrinsic;
  report.decoder_probes.at(-1).estimated_execution_gas=hi-intrinsic;save();
 }
 const fragment=async(req,words,terminal,limit=gas)=>{
  const before=await snapshot(p),beforeCount=await value(p.hook,'sentenceCount',[p.id]);
  const receipt=await send(req,accounts[1],limit);
  if(receipt.status!=='0x1'){
   try{await rpc('eth_call',[{from:accounts[1],...req,gas:hex(limit)},'latest']);}catch(e){report.failed_valid_fragment_error={message:e.message,data:e.data};}
   report.failed_valid_fragment_receipt=receipt;save();
  }
  assert.equal(receipt.status,'0x1','valid batch fragment must succeed');
  const events=parse(receipt);assert.equal(events.length,1);const event=events[0];assert.equal(event.name,'TextAdvanced');
  const after=await snapshot(p),nowCount=await value(p.hook,'sentenceCount',[p.id]);
  assert.equal(event.args.firstWord,before.context[4]+1n);assert.equal(event.args.lastWord,before.context[4]+BigInt(words));
  assert.equal(event.args.terminal,terminal);assert.equal(event.args.previousStateHash,before.context[8]);
  assert.equal(event.args.stateHash,after.context[8]);assert.equal(after.context[4],before.context[4]+BigInt(words));
  assert.equal(after.hidden[0],after.context[4]);const dense=await value(p.model,'denseState');assert(after.hidden.slice(1).every((x,i)=>x===(dense?((Number(after.context[4])+i)%2===0?1024n:-1024n):0n)));
  assert.equal(nowCount,beforeCount+(terminal?1n:0n));assert.equal(event.args.text,Array.from({length:words},(_,i)=>terminal&&i===words-1?'speaks.':'nova').join(' '));assert.equal(after.position,liquidity);
  let hash=before.context[8];for(let index=0;index<words;index++){
   const state=Array(768).fill(0);state[0]=Number(before.context[4])+index+1;if(dense)for(let j=1;j<768;j++)state[j]=(Number(before.context[4])+index+j)%2===0?1024:-1024;
   const end=terminal&&index===words-1;hash=ethers.keccak256(coder.encode(['bytes32','bytes32','uint64','uint16','uint8','int16[768]'],[await value(p.model,'modelHash'),p.id,before.context[4]+BigInt(index)+1n,end?1:0,end?2:0,state]));
  }assert.equal(event.args.stateHash,hash,'independent canonical state hash');
  report.fragments??=[];report.fragments.push({words,terminal,gas:receipt.gasUsed,first:event.args.firstWord,last:event.args.lastWord,text:event.args.text,previous:event.args.previousStateHash,stateHash:event.args.stateHash});save();return receipt;
 };
 await setPlan();await fragment(buyReq(p,WAD/1000n),3,false);check('three_nonterminal_batch_words_are_explicit_fragment');
 await setPlan();await fragment(buyReq(p,WAD/100000n),1,false,16000000n);check('adaptive16m_one_word_batch');
 await setPlan();await fragment(buyReq(p,WAD/100000n),2,false,25000000n);check('adaptive25m_two_word_batch');
 for(const terminal of [1,2,3]){await setPlan(terminal);await fragment(buyReq(p,WAD/100000n),terminal,true);check('batch_natural_eos_at_word_'+terminal);}
 await setPlan();await fragment(buyReq(p,WAD/100000n),3,false);await setPlan(2);const tokens=await value(p.token,'balanceOf',[accounts[1]]);
 await fragment(sellReq(p,tokens/100n),2,true);check('batch_continuation_across_buy_sell');
 for(const fault of [3,4,5,6,8,9,10])for(const ordinal of [1,2,3])for(const buy of [true,false]){
  await setPlan(3,ordinal,fault);const count=await value(p.hook,'sentenceCount',[p.id]);await reject(p,'batch_fault_'+fault+'_word_'+ordinal+'_'+(buy?'buy':'sell'),buy?buyReq(p,WAD/100000n):sellReq(p,tokens/1000n));assert.equal(await value(p.hook,'sentenceCount',[p.id]),count);
 }
 for(const fault of [1,2,7,11,12,13,14,15,16,17,18,24])for(const buy of [true,false]){
  await setPlan(3,1,fault);const count=await value(p.hook,'sentenceCount',[p.id]);await reject(p,'batch_structure_fault_'+fault+'_'+(buy?'buy':'sell'),buy?buyReq(p,WAD/100000n):sellReq(p,tokens/1000n));assert.equal(await value(p.hook,'sentenceCount',[p.id]),count);
 }
 for(const fault of [19,20,21,22,23])for(const buy of [true,false]){
  await setPlan(1,3,fault);const count=await value(p.hook,'sentenceCount',[p.id]);await reject(p,'batch_unused_slot_fault_'+fault+'_'+(buy?'buy':'sell'),buy?buyReq(p,WAD/100000n):sellReq(p,tokens/1000n));assert.equal(await value(p.hook,'sentenceCount',[p.id]),count);
 }
 await setPlan();await reject(p,'batch_slippage_reverts_valid_fragment',buyReq(p,WAD/100000n,1000000n*WAD));
 await reject(p,'batch_insufficient_initial_gas_reverts',buyReq(p,WAD/100000n),accounts[1],1000000n);
 const originalCode=await rpc('eth_getCode',[p.model.address,'latest']);await rpc('hardhat_setCode',[p.model.address,'0x00']);await reject(p,'batch_changed_model_code_reverts',buyReq(p,WAD/100000n));await rpc('hardhat_setCode',[p.model.address,originalCode]);
 assert.equal((await tx(p.model,'setDenseState',[true])).status,'0x1');
 await setPlan();await fragment(buyReq(p,WAD/100000n),3,false);check('batch_all_dense_state_cells_and_first_packed_storage_save');
 assert.equal((await tx(p.model,'setGasWork',[24000000])).status,'0x1');
 await setPlan();
 const syntheticBefore=await snapshot(p),directData=p.model.interface.encodeFunctionData('stepBatchChecked',[syntheticBefore.context[5],syntheticBefore.context[6],syntheticBefore.hidden,Array(6).fill(0),report.seed,syntheticBefore.context[4],512,3]);
 const directEstimate=b(await rpc('eth_estimateGas',[{to:p.model.address,data:directData,gas:hex(gas),gasPrice:'0x0'}]));
 const directIntrinsic=21000n+ethers.getBytes(directData).reduce((s,x)=>s+(x===0?4n:16n),0n);
 report.synthetic_model={work:24000000,transaction_estimate:directEstimate,intrinsic:directIntrinsic,execution:directEstimate-directIntrinsic};assert(directEstimate-directIntrinsic<26000000n);save();
 await fragment(buyReq(p,WAD/100000n),3,false);check('batch_reserve_after_calibrated_24m_synthetic_work');
 assert.equal((await tx(p.model,'setGasWork',[0])).status,'0x1');
 const actor=await deploy(art(prefix+'NovaTestHarness.sol','NovaReentryTrader'),[p.router.address]);
 await setPlan();await fragment({to:actor.address,data:actor.interface.encodeFunctionData('buy',[lower]),value:hex(WAD/100000n)},2,false);check('contract_wallet_extra_frame_adapts_to_two_word_batch');
 assert.equal((await tx(actor,'approve',[p.token.address,ethers.MaxUint256])).status,'0x1');const actorTokens=await value(p.token,'balanceOf',[actor.address]);
 await setPlan();await fragment({to:actor.address,data:actor.interface.encodeFunctionData('sell',[actorTokens,upper])},2,false);assert.equal(await value(actor,'attempted'),true);assert.equal(await value(actor,'blocked'),true);check('contract_wallet_sell_blocks_payout_reentry_and_keeps_valid_text');
 await setPlan(3);const remaining=await value(p.token,'balanceOf',[accounts[1]]);await fragment(sellReq(p,remaining/10n),3,true);check('batch_valid_sell_recovers_after_all_adversarial_cases');
 assert.equal(await value(p.vault,'positionLiquidity'),liquidity);assert.equal(await value(p.token,'totalSupply'),1000000n*WAD);
 report.status='PASS';report.stage='COMPLETE';report.finished_at=new Date().toISOString();save();console.log(json({status:report.status,checks:report.checks.length,mock_only:true,decoder_probes:report.decoder_probes,fragments:report.fragments}));
}
async function main(){
 assert.equal(hre.network.name,'hardhat');assert(!hre.config.networks.hardhat.forking);report.optimization={source:modelSource,hook:hookSource,export:modelDir,inference_budget:inferenceBudget,transaction_limit:gas.toString(),block_limit:32000000};report.stage='COMPILING';save();artifacts=compile();
 hre.config.networks.hardhat.chainId=31337;hre.config.networks.hardhat.blockGasLimit=32000000;hre.config.networks.hardhat.initialBaseFeePerGas=0;hre.config.networks.hardhat.throwOnTransactionFailures=false;
 await rpc('hardhat_reset');assert.equal(await rpc('eth_chainId'),'0x7a69');assert.match(await rpc('web3_clientVersion'),/Hardhat/);accounts=await rpc('eth_accounts');
 const genesisBlock=await rpc('eth_getBlockByNumber',['latest',false]);assert.equal(b(genesisBlock.gasLimit),32000000n);report.verified_block_gas_limit=b(genesisBlock.gasLimit);
 report.stage='REAL_MODEL_DEPLOYMENT';const realModel=sentenceSecurity?await deploy(art(prefix+'NovaBatchMockModel.sol','NovaBatchMockModel')):await model();
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
 if(loadOnly){await runLoad(p);return;}
 if(stressOnly){await runStress(p);return;}
 if(sentenceOnly){await runSentence(p);return;}
 if(sentenceSecurity){await runSentenceSecurity(p);return;}
 report.stage='REAL_BUYS_AND_SELLS';save();
 for(const who of accounts.slice(1,4)){const r=await tx(p.token,'approve',[p.router.address,ethers.MaxUint256],{from:who});assert.equal(r.status,'0x1');}
 const first=await trade(p,true,WAD/100n,accounts[1]);const second=await trade(p,false,first.amountOut,accounts[1]);report.first_round_trip={eth_in:first.amountIn,nova_received:first.amountOut,eth_returned:second.amountOut,gas_buy:first.gasUsed,gas_sell:second.gasUsed};
 for(let i=0;i<15;i++){const who=accounts[1+i%3],amount=[WAD/1000n,WAD/200n,WAD/50n][i%3];const buy=await trade(p,true,amount,who);await trade(p,false,buy.amountOut,who);console.log('Real model swaps: '+report.swaps.length);}
 assert.equal(report.swaps.length,32);check('32_real_model_buys_and_sells_match_independent_amm_math');
 await reject(p,'slippage_protection_rolls_back_inference',buyReq(p,WAD/100n,1000000n*WAD));
 await reject(p,'expired_order_reverts',{to:p.router.address,data:p.router.interface.encodeFunctionData('buy',[1,lower,1]),value:hex(WAD/100n)});
 await reject(p,'unfunded_seller_reverts',sellReq(p,WAD),accounts[4]);
 await reject(p,'partial_fill_at_range_boundary_reverts',buyReq(p,200n*WAD,1n,lower));
 await reject(p,'insufficient_gas_rolls_back_trade',buyReq(p,WAD/100n),accounts[1],1000000n);
 const originalCode=await rpc('eth_getCode',[realModel.address,'latest']);await rpc('hardhat_setCode',[realModel.address,'0x00']);await reject(p,'changed_model_code_reverts_atomically',buyReq(p,WAD/100n));await rpc('hardhat_setCode',[realModel.address,originalCode]);check('code_mutation_injection_was_test_only_and_restored');
 report.stage='CONCURRENT_ORDERS';save();const before=await snapshot(p);await rpc('evm_setAutomine',[false]);let hashes=[];
 try{for(const from of accounts.slice(1,3))hashes.push(await rpc('eth_sendTransaction',[{from,gas:hex(gas),gasPrice:'0x0',...buyReq(p,WAD/1000n)}]));await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);await rpc('evm_mine');await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);await rpc('evm_mine');}finally{await rpc('evm_setAutomine',[true]);}
 for(const hash of hashes){const r=await rpc('eth_getTransactionReceipt',[hash]);assert(r&&r.status==='0x1');const events=r.logs.filter(l=>l.address.toLowerCase()===p.hook.address.toLowerCase()).map(l=>p.hook.interface.parseLog(l));assert.equal(events.length,1);report.concurrent_swaps.push({hash,gasUsed:b(r.gasUsed),sequence:Number(events[0].args.sequence),text:events[0].args.text});}
 assert.equal((await snapshot(p)).context[4],before.context[4]+2n);check('two_pending_orders_no_stale_context_failure');
 const actor=await deploy(art(prefix+'NovaTestHarness.sol','NovaReentryTrader'),[p.router.address]);assert.equal((await tx(actor,'buy',[lower],{value:WAD/1000n})).status,'0x1');assert.equal((await tx(actor,'approve',[p.token.address,ethers.MaxUint256])).status,'0x1');const actorTokens=await value(p.token,'balanceOf',[actor.address]);assert.equal((await tx(actor,'sell',[actorTokens,upper])).status,'0x1');assert.equal(await value(actor,'attempted'),true);assert.equal(await value(actor,'blocked'),true);check('native_payout_reentrancy_blocked_without_blocking_normal_sell');
 report.stage='ADVERSARIAL_MODEL';save();const bad=await deploy(art(prefix+'NovaHookMockModels.sol','NovaHookMockModel'));const q=await boot(bad);assert.equal((await tx(q.vault,'fundAndInitialize',[],{value:WAD})).status,'0x1');assert.equal((await tx(q.token,'approve',[q.router.address,ethers.MaxUint256],{from:accounts[1]})).status,'0x1');
 const stocked=await trade(q,true,WAD/100n,accounts[1],false);
 for(let mode=1;mode<=15;mode++){assert.equal((await tx(bad,'setMode',[mode])).status,'0x1');await reject(q,'bad_model_mode_'+mode+'_blocks_buy_atomically',buyReq(q,WAD/1000n));await reject(q,'bad_model_mode_'+mode+'_blocks_sell_atomically',sellReq(q,stocked.amountOut/2n));}
 assert.equal((await tx(bad,'setMode',[0])).status,'0x1');await trade(q,false,stocked.amountOut,accounts[1],false);check('valid_inference_restores_mock_trading_after_all_failure_tests');
 const preSyncBuyer=await deploy(art(prefix+'NovaTestHarness.sol','NovaPreSyncBuyer'));
 assert.equal((await tx(preSyncBuyer,'buy',[manager.address,p.token.address,p.router.address,lower],{value:WAD/1000n})).status,'0x1');
 check('prior_token_sync_does_not_block_native_buy');
 report.final_state={sequence:(await view(p.hook,'contexts',[p.id]))[4],position_liquidity:await value(p.vault,'positionLiquidity'),total_supply:await value(p.token,'totalSupply')};
 assert.equal(report.final_state.position_liquidity,liquidity);assert.equal(report.final_state.total_supply,1000000n*WAD);
 report.max_real_swap_gas=report.swaps.reduce((m,x)=>x.gasUsed>m?x.gasUsed:m,0n);report.status='PASS';report.stage='COMPLETE';report.finished_at=new Date().toISOString();save();fs.writeFileSync(path.join(outputDir,'actual-transcript.txt'),report.swaps.map(x=>x.text).join(' ')+'\n');console.log(json({status:report.status,checks:report.checks.length,real_swaps:report.swaps.length,concurrent_swaps:report.concurrent_swaps.length,max_real_swap_gas:report.max_real_swap_gas,first_round_trip:report.first_round_trip}));
}
main().catch(e=>{report.status='FAILED';report.error=String(e.stack??e);save();console.error(e);process.exitCode=1;});
