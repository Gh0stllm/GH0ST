// Replays the exact unsigned deployment package on an unforked local EVM.
// The only funded accounts here are synthetic Hardhat accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import solc from 'solc';
import * as ethers from 'ethers';
import {HERE,ROOT,CHAIN,GAS,SENDER,FACTORY,MANAGER,CHECKPOINT,SEED,sha,json,read,save} from './common.mjs';
import {resetLocal,rpc,sendLocal,contract,value,view} from './local.mjs';
import {quoteExactInput} from '../nova-pool/liquidity-plan.mjs';

const plan=read('plan.json'),pins=read('reviewed-pins.json'),a=read('build/artifacts.json');
const archive=fs.readFileSync(path.join(HERE,plan.archive.path));
assert.equal(sha(fs.readFileSync(path.join(HERE,'plan.json'))),pins.plan_sha256);assert.equal(sha(archive),pins.archive_sha256);
const entries=gunzipSync(archive).toString().trim().split('\n').map(x=>JSON.parse(x));
const report={status:'RUNNING',mode:'EXACT_UNSIGNED_PLAN_UNFORKED_LOCAL_ONLY',chain_id:CHAIN,transaction_gas_ceiling:Number(GAS),plan_sha256:pins.plan_sha256,source_checkpoint_sha256:CHECKPOINT,model_hash:plan.model.model_hash,poolId:plan.pool_id,seed:SEED,temperatureQ10:512,public_transactions_submitted:0,data_injection_used:false,dependency_code_injection_only:true,deployments:[],checks:[],swaps:[],started_at:new Date().toISOString()};
const write=()=>save('rehearsal/results.json',report);
const check=(name)=>{report.checks.push({name,passed:true});write();};

function compileReader(){
 const content='// SPDX-License-Identifier: MIT\npragma solidity 0.8.30; import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol"; import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol"; import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol"; contract Reader { function state(address m,bytes32 id) external view returns(uint160,int24,uint24,uint24,uint128) { (uint160 p,int24 t,uint24 f,uint24 l)=StateLibrary.getSlot0(IPoolManager(m),PoolId.wrap(id));return(p,t,f,l,StateLibrary.getLiquidity(IPoolManager(m),PoolId.wrap(id))); } }';
 const input={language:'Solidity',sources:{'LocalReader.sol':{content}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
 const out=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{for(const file of [path.join(ROOT,'node_modules',p),path.join(ROOT,'node_modules/@uniswap/v4-core/lib',p)])if(fs.existsSync(file))return{contents:fs.readFileSync(file,'utf8')};return{error:p};}}));assert(!(out.errors||[]).some(e=>e.severity==='error'));return out.contracts['LocalReader.sol'].Reader;
}
async function main(){
 const{accounts}=await resetLocal();const lp=read('liquidity-plan.json');
 assert.equal(entries.length,plan.deployment_count);assert.equal(new Set(entries.map(e=>e.address.toLowerCase())).size,entries.length);
 const input=read('build/standard-input.json');const reproduced=JSON.parse(solc.compile(JSON.stringify(input)));
 const names={model:['experiments/gh0st-voice/voice-v8/exports/grammar4m/GRU2SIMDModel.sol','GRU2SIMDModel'],hook:['experiments/gh0st-voice/nova-pool/contracts/NovaPoolHook.sol','NovaPoolHook'],vault:['experiments/gh0st-voice/nova-pool/contracts/NovaLiquidityVault.sol','NovaLiquidityVault'],router:['experiments/gh0st-voice/nova-pool/contracts/NovaSwapRouter.sol','NovaSwapRouter'],token:['experiments/gh0st-voice/nova-pool/contracts/NovaToken.sol','NovaToken']};
 for(const[k,[f,n]]of Object.entries(names))assert.equal(reproduced.contracts[f][n].evm.bytecode.object,a[k].evm.bytecode.object,'Reproducible '+k+' compiler input');check('archived_compiler_input_reproduces_all_five_artifacts');
 for(const entry of entries){
  assert.equal(sha(ethers.getBytes(entry.transaction.data)),entry.transaction_data_sha256);assert.equal(entry.transaction.chainId,CHAIN);assert.equal(entry.transaction.value,'0');
  if(entry.kind==='vault'){assert.equal(entry.order,0);assert.equal(ethers.getCreateAddress({from:SENDER,nonce:plan.wallet_nonce}).toLowerCase(),entry.address.toLowerCase());}
  else{assert.equal(entry.transaction.to,FACTORY);assert.equal(entry.transaction.data.slice(0,66),entry.salt);assert.equal(ethers.keccak256('0x'+entry.transaction.data.slice(66)),entry.init_code_hash);assert.equal(ethers.getCreate2Address(FACTORY,entry.salt,entry.init_code_hash),entry.address);}
  const r=await sendLocal(SENDER,{...entry.transaction,chainId:undefined,nonce:ethers.toBeHex(plan.wallet_nonce+entry.order)});
  if(r.status!=='0x1')throw Error('Deployment failed at '+entry.order+' '+entry.kind);
  const actual=await rpc('eth_getCode',[entry.address,'latest']);assert.equal(ethers.keccak256(actual),entry.runtime_code_hash,'Runtime '+entry.order);
  report.deployments.push({order:entry.order,kind:entry.kind,address:entry.address,gas_used:BigInt(r.gasUsed).toString(),data_bytes:ethers.getBytes(entry.transaction.data).length,runtime_code_hash:entry.runtime_code_hash});
  if(entry.order%200===0){console.log('Exact local deployments: '+(entry.order+1)+'/'+entries.length);write();}
 }
 check('every_exact_unsigned_transaction_deployed_with_expected_runtime');
 assert.equal(ethers.keccak256(await rpc('eth_getCode',[plan.contracts.token,'latest'])),plan.token_runtime_code_hash);check('nested_token_address_and_runtime_match');
 const vault=contract(plan.contracts.vault,a.vault),token=contract(plan.contracts.token,a.token),hook=contract(plan.contracts.hook,a.hook),router=contract(plan.contracts.router,a.router);
 assert.equal(await value(token,'totalSupply'),ethers.parseEther('1000000'));assert.equal(await value(token,'balanceOf',[vault.address]),ethers.parseEther('1000000'));assert.equal(await value(vault,'launched'),false);assert.equal(await value(hook,'poolId'),plan.pool_id);check('fixed_supply_and_all_immutable_bindings');
 const funcs=a.token.abi.filter(x=>x.type==='function').map(x=>x.name);assert(!funcs.some(x=>/mint|burn|owner|admin|pause|upgrade|blacklist|tax/i.test(x)));check('token_abi_has_no_admin_mint_or_upgrade_function');
 const readerArt=compileReader(),readerReq=await new ethers.ContractFactory(readerArt.abi,readerArt.evm.bytecode.object).getDeployTransaction();const rr=await sendLocal(accounts[0],{data:readerReq.data});assert.equal(rr.status,'0x1');const reader=contract(rr.contractAddress,readerArt);
 const key=[ethers.ZeroAddress,token.address,plan.settings.fee_pips,plan.settings.tick_spacing,hook.address];
 const managerI=new ethers.Interface(['function initialize((address,address,uint24,int24,address),uint160) returns(int24)']);
 let r=await sendLocal(accounts[1],{to:MANAGER,data:managerI.encodeFunctionData('initialize',[key,plan.settings.initial_sqrt_price_x96])});assert.equal(r.status,'0x0');check('unauthorized_initializer_cannot_front_run_price');
 r=await sendLocal(SENDER,{to:vault.address,data:plan.funding.data,value:ethers.toBeHex(ethers.parseEther('1')-1n)});assert.equal(r.status,'0x0');assert.equal(await value(vault,'launched'),false);check('incorrect_genesis_funding_reverts');
 r=await sendLocal(SENDER,{to:vault.address,data:plan.funding.data,value:ethers.toBeHex(BigInt(plan.funding.value))});assert.equal(r.status,'0x1');report.genesis={gas_used:BigInt(r.gasUsed).toString(),eth:plan.funding.value};
 assert.equal(await value(vault,'launched'),true);assert.equal(await value(vault,'positionLiquidity'),BigInt(plan.settings.liquidity));check('one_eth_genesis_and_permanent_position');
 r=await sendLocal(SENDER,{to:vault.address,data:plan.funding.data,value:ethers.toBeHex(BigInt(plan.funding.value))});assert.equal(r.status,'0x0');check('duplicate_launch_reverts');
 for(const from of accounts.slice(1,4)){r=await sendLocal(from,{to:token.address,data:token.interface.encodeFunctionData('approve',[router.address,ethers.MaxUint256])});assert.equal(r.status,'0x1');}
 async function snapshot(from){return{context:Array.from(await view(hook,'contexts',[plan.pool_id])),hidden:Array.from(await value(hook,'hiddenState',[plan.pool_id])),pool:Array.from(await view(reader,'state',[MANAGER,plan.pool_id])),position:await value(vault,'positionLiquidity'),nova:await value(token,'balanceOf',[from]),eth:await rpc('eth_getBalance',[from,'latest'])};}
 const lower=BigInt(lp.sqrt_price_lower_x96),upper=BigInt(lp.sqrt_price_upper_x96),liquidity=BigInt(lp.liquidity);
 async function trade(buy,amount,from){
  const before=await snapshot(from);const q=quoteExactInput({sqrtPriceX96:before.pool[0],sqrtPriceLowerX96:lower,sqrtPriceUpperX96:upper,liquidity,fee:lp.fee_pips,tickSpacing:lp.tick_spacing,zeroForOne:buy,amountIn:amount});assert.equal(q.unspentAmountIn,0n);
  const latest=await rpc('eth_getBlockByNumber',['latest',false]);const deadline=BigInt(latest.timestamp)+600n;
  const request=buy?{to:router.address,value:ethers.toBeHex(amount),data:router.interface.encodeFunctionData('buy',[q.amountOut,lower,deadline])}:{to:router.address,data:router.interface.encodeFunctionData('sell',[amount,q.amountOut,upper,deadline])};
  const receipt=await sendLocal(from,request);assert.equal(receipt.status,'0x1','Real-model swap');const after=await snapshot(from);assert.equal(after.pool[0],q.sqrtPriceX96);assert.equal(after.position,liquidity);
  const logs=receipt.logs.filter(l=>l.address.toLowerCase()===hook.address.toLowerCase()).map(l=>hook.interface.parseLog(l));assert.equal(logs.length,1);assert.equal(logs[0].name,'TextAdvanced');const e=logs[0].args,count=Number(e.lastWord-e.firstWord+1n);assert(count>=1&&count<=3);assert.equal(e.firstWord,before.context[4]+1n);assert.equal(e.lastWord,after.context[4]);assert.equal(e.stateHash,after.context[8]);assert.equal(e.previousStateHash,before.context[8]);
  const move=Math.min(1024,Math.abs(Number(after.pool[1])-Number(before.context[0]))),elapsed=Math.min(300,Number(after.context[3])-Number(before.context[3]));const features=[move*4,Number(before.context[2])*4,Math.abs(move-Number(before.context[1]))*4,Math.floor(elapsed*1024/300),buy?1024:-1024,1024];
  report.swaps.push({direction:buy?'BUY':'SELL',from,amountIn:amount,amountOut:q.amountOut,gasUsed:BigInt(receipt.gasUsed),wordCount:count,text:e.text,terminal:e.terminal,firstWord:e.firstWord,lastWord:e.lastWord,features,previousStateHash:e.previousStateHash,stateHash:e.stateHash,before,after});write();return q.amountOut;
 }
 for(let i=0;i<16;i++){const from=accounts[1+i%3],amount=[ethers.parseEther('0.001'),ethers.parseEther('0.005'),ethers.parseEther('0.02')][i%3];const got=await trade(true,amount,from);await trade(false,got,from);if(i%4===3)console.log('Rehearsed real-model swaps: '+report.swaps.length);}
 check('32_buys_sells_with_fresh_price_plan_and_continuous_neural_state');
 async function reject(name,request,limit=GAS){const before=await snapshot(accounts[1]);const receipt=await sendLocal(accounts[1],request,limit);assert.equal(receipt.status,'0x0',name);assert.equal(json(await snapshot(accounts[1])),json(before),name+' atomic rollback');check(name);}
 const deadline=BigInt((await rpc('eth_getBlockByNumber',['latest',false])).timestamp)+600n;
 await reject('slippage_reverts_pool_and_neural_state',{to:router.address,value:ethers.toBeHex(ethers.parseEther('0.001')),data:router.interface.encodeFunctionData('buy',[ethers.MaxUint256,lower,deadline])});
 await reject('insufficient_gas_reverts_pool_and_neural_state',{to:router.address,value:ethers.toBeHex(ethers.parseEther('0.001')),data:router.interface.encodeFunctionData('buy',[1,lower,deadline])},100000n);
 await reject('direct_hook_callback_rejected',{to:hook.address,data:hook.interface.encodeFunctionData('beforeInitialize',[accounts[1],key,plan.settings.initial_sqrt_price_x96])});
 const modelCode=await rpc('eth_getCode',[plan.contracts.model,'latest']);await rpc('hardhat_setCode',[plan.contracts.model,'0x00']);
 await reject('changed_model_code_reverts_pool_and_neural_state',{to:router.address,value:ethers.toBeHex(ethers.parseEther('0.001')),data:router.interface.encodeFunctionData('buy',[1,lower,deadline])});await rpc('hardhat_setCode',[plan.contracts.model,modelCode]);
 for(const signature of ['withdraw()','removeLiquidity()','collectFees()','rescueTokens(address,uint256)','transferOwnership(address)']){const i=new ethers.Interface(['function '+signature]);const fn=i.fragments[0];const args=fn.inputs.map(x=>x.type==='address'?accounts[1]:1);r=await sendLocal(accounts[1],{to:vault.address,data:i.encodeFunctionData(fn,args)});assert.equal(r.status,'0x0');}check('no_lp_withdraw_collect_rescue_or_ownership_transfer');
 const totalGas=report.deployments.reduce((s,x)=>s+BigInt(x.gas_used),0n),maxGas=report.deployments.reduce((s,x)=>BigInt(x.gas_used)>s?BigInt(x.gas_used):s,0n),swapGas=report.swaps.map(x=>x.gasUsed);assert(maxGas<GAS);assert(swapGas.every(x=>x<GAS));
 report.status='PASS';report.summary={deployment_transactions:entries.length,deployment_gas:totalGas,max_deployment_gas:maxGas,genesis_gas:report.genesis.gas_used,swaps:report.swaps.length,neural_words:report.swaps.reduce((s,x)=>s+x.wordCount,0),completed_sentences:report.swaps.filter(x=>x.terminal).length,min_swap_gas:swapGas.reduce((a,b)=>a<b?a:b),max_swap_gas:swapGas.reduce((a,b)=>a>b?a:b),mean_swap_gas:swapGas.reduce((a,b)=>a+b,0n)/BigInt(swapGas.length),checks_passed:report.checks.length};report.finished_at=new Date().toISOString();write();fs.writeFileSync(path.join(HERE,'rehearsal/actual-transcript.txt'),report.swaps.map(x=>x.text).join('\n')+'\n');console.log(json(report.summary));
}
main().catch(e=>{report.status='FAIL';report.error=String(e.stack??e);write();console.error(report.error);process.exitCode=1;});
