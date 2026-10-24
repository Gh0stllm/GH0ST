// Creates unsigned artifacts and probes constructors on an unforked local chain.
// There is no public RPC, private key, or public transaction submission here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import * as ethers from 'ethers';
import {buildLiquidityPlan} from '../nova-pool/liquidity-plan.mjs';
import {HERE,EXPORT,CHAIN,GAS,SENDER,FACTORY,MANAGER,CHECKPOINT,GROUPS,SEED,sha,json,save,read,dataInit,deterministic,compileProduction} from './common.mjs';
import {rpc,resetLocal,sendLocal,contract,value} from './local.mjs';

async function main(){
 const snapshot=read('network-snapshot.json');assert.equal(snapshot.chain_id,CHAIN);assert.equal(snapshot.wallet.latest_nonce,snapshot.wallet.pending_nonce,'Pending wallet transactions');
 assert(BigInt(snapshot.arb_gas_info.getGasAccountingParams[2])>=GAS,'Network limit below rehearsal ceiling');
 const manifest=JSON.parse(fs.readFileSync(path.join(EXPORT,'manifest.json'),'utf8'));assert.equal(manifest.checkpoint_sha256,CHECKPOINT);
 const liquidity=buildLiquidityPlan({ethUsd:snapshot.eth_usd.amount,targetFdvUsd:'25000'});
 save('liquidity-plan.json',liquidity);
 const a=compileProduction();const{accounts}=await resetLocal();const helper=accounts[0];assert.notEqual(helper.toLowerCase(),SENDER.toLowerCase());
 const entries=[],injected=new Map(),catalogs={},groups={},seen=new Map();const coder=ethers.AbiCoder.defaultAbiCoder();
 function blob(kind,runtime,detail={}){
  const init=dataInit(runtime),d=deterministic(init,'immutable-data'),key=d.address.toLowerCase();
  if(!seen.has(key)){
   const e={kind,...detail,address:d.address,salt:d.salt,init_code_hash:d.init_code_hash,runtime_code_hash:ethers.keccak256(runtime),runtime_bytes:ethers.getBytes(runtime).length,transaction:{to:FACTORY,value:'0',data:d.data,chainId:CHAIN}};
   entries.push(e);seen.set(key,e);injected.set(d.address,runtime);
  }
  return d.address;
 }
 for(const group of GROUPS){
  const bytes=fs.readFileSync(path.join(EXPORT,group+'.bin'));assert.equal(sha(bytes),manifest.artifacts[group+'.bin'].sha256);assert.equal(bytes.length,manifest.artifacts[group+'.bin'].bytes);
  const addresses=[];let commitment=ethers.ZeroHash;
  for(let off=0;off<bytes.length;off+=24000){const runtime='0x00'+bytes.subarray(off,off+24000).toString('hex');addresses.push(blob('data',runtime,{group,index:addresses.length}));commitment=ethers.keccak256(coder.encode(['bytes32','bytes32'],[commitment,ethers.keccak256(runtime)]));}
  const pages=[];for(let i=0;i<addresses.length;i+=1024)pages.push(blob('catalog-page','0x00'+addresses.slice(i,i+1024).map(x=>x.slice(2)).join(''),{group,index:pages.length}));
  catalogs[group]=blob('catalog-root','0x00'+pages.map(x=>x.slice(2)).join(''),{group});groups[group]={bytes:bytes.length,shards:addresses.length,commitment,catalog:catalogs[group]};
 }
 for(const [address,code]of injected)await rpc('hardhat_setCode',[address,code]);
 console.log('Prepared '+entries.length+' immutable data/catalog deployments.');
 const deployment=(artifact,args)=>new ethers.ContractFactory(artifact.abi,artifact.evm.bytecode.object).getDeployTransaction(...args);
 const modelInit=(await deployment(a.model,GROUPS.map(g=>catalogs[g]))).data,modelD=deterministic(modelInit,'model');
 let receipt=await sendLocal(helper,{to:FACTORY,data:modelD.data});assert.equal(receipt.status,'0x1','Model constructor probe');
 const model=contract(modelD.address,a.model),modelCode=await rpc('eth_getCode',[model.address,'latest']);
 const expectedModelHash=ethers.keccak256(coder.encode(['string',...GROUPS.map(()=>'bytes32')],[manifest.model_domain,...GROUPS.map(g=>groups[g].commitment)]));assert.equal(await value(model,'modelHash'),expectedModelHash);
 const vaultAddress=ethers.getCreateAddress({from:SENDER,nonce:snapshot.wallet.latest_nonce});const tokenAddress=ethers.getCreateAddress({from:vaultAddress,nonce:1});
 const config=[tokenAddress,vaultAddress,liquidity.fee_pips,liquidity.tick_spacing,liquidity.initial_sqrt_price_x96,26000000,expectedModelHash,ethers.keccak256(modelCode),SEED,512];
 const hookInit=(await deployment(a.hook,[MANAGER,model.address,config])).data,hookHash=ethers.keccak256(hookInit);let hookSalt,hookAddress,attempts;
 for(let i=0;i<1000000;i++){const salt=ethers.zeroPadValue(ethers.toBeHex(i),32),address=ethers.getCreate2Address(FACTORY,salt,hookHash);if((BigInt(address)&0x3fffn)===0x3040n){hookSalt=salt;hookAddress=address;attempts=i+1;break;}}
 assert(hookAddress,'Hook address mining failed');
 const vaultInit=(await deployment(a.vault,[MANAGER,hookAddress,liquidity.fee_pips,liquidity.tick_spacing,liquidity.initial_sqrt_price_x96,liquidity.tick_lower,liquidity.tick_upper,liquidity.liquidity])).data;
 receipt=await sendLocal(SENDER,{data:vaultInit,nonce:ethers.toBeHex(snapshot.wallet.latest_nonce)});assert.equal(receipt.status,'0x1','Vault probe');assert.equal(receipt.contractAddress.toLowerCase(),vaultAddress.toLowerCase());
 const vault=contract(vaultAddress,a.vault);assert.equal((await value(vault,'token')).toLowerCase(),tokenAddress.toLowerCase());
 receipt=await sendLocal(helper,{to:FACTORY,data:hookSalt+hookInit.slice(2)});assert.equal(receipt.status,'0x1','Hook probe');
 const hook=contract(hookAddress,a.hook);assert.equal(await value(vault,'poolId'),await value(hook,'poolId'));
 const routerInit=(await deployment(a.router,[MANAGER,tokenAddress,hookAddress,liquidity.fee_pips,liquidity.tick_spacing])).data,routerD=deterministic(routerInit,'router');
 receipt=await sendLocal(helper,{to:FACTORY,data:routerD.data});assert.equal(receipt.status,'0x1','Router probe');
 const codeHash=async address=>ethers.keccak256(await rpc('eth_getCode',[address,'latest']));
 entries.unshift({kind:'vault',address:vaultAddress,required_nonce:snapshot.wallet.latest_nonce,init_code_hash:ethers.keccak256(vaultInit),runtime_code_hash:await codeHash(vaultAddress),transaction:{to:null,value:'0',data:vaultInit,chainId:CHAIN}});
 entries.push({kind:'model',address:model.address,salt:modelD.salt,init_code_hash:modelD.init_code_hash,runtime_code_hash:ethers.keccak256(modelCode),transaction:{to:FACTORY,value:'0',data:modelD.data,chainId:CHAIN}});
 entries.push({kind:'hook',address:hookAddress,salt:hookSalt,init_code_hash:hookHash,runtime_code_hash:await codeHash(hookAddress),transaction:{to:FACTORY,value:'0',data:hookSalt+hookInit.slice(2),chainId:CHAIN}});
 entries.push({kind:'router',address:routerD.address,salt:routerD.salt,init_code_hash:routerD.init_code_hash,runtime_code_hash:await codeHash(routerD.address),transaction:{to:FACTORY,value:'0',data:routerD.data,chainId:CHAIN}});
 entries.forEach((e,i)=>{e.order=i;e.transaction_data_sha256=sha(ethers.getBytes(e.transaction.data));assert(ethers.getBytes(e.transaction.data).length<=49184);});
 const archive=gzipSync(Buffer.from(entries.map(e=>JSON.stringify(e)).join('\n')+'\n'),{level:9,mtime:0});fs.mkdirSync(path.join(HERE,'bundle'),{recursive:true});fs.writeFileSync(path.join(HERE,'bundle/transactions.jsonl.gz'),archive);
 const plan={schema:1,status:'PREPARED_PENDING_EXACT_REHEARSAL',chain_id:CHAIN,created_at:new Date().toISOString(),sender:SENDER,wallet_nonce:snapshot.wallet.latest_nonce,network_snapshot_sha256:sha(fs.readFileSync(path.join(HERE,'network-snapshot.json'))),dependencies:snapshot.dependencies,model:{name:'GH0ST N0VA-8M',parameters:8175493,checkpoint_sha256:CHECKPOINT,model_hash:expectedModelHash,code_hash:ethers.keccak256(modelCode),selection:'User selected the gas-tested rumor/crowd candidate despite the failed grammar/continuity review.',language_quality_passed:false},contracts:{vault:vaultAddress,token:tokenAddress,model:model.address,hook:hookAddress,router:routerD.address},token_runtime_code_hash:await codeHash(tokenAddress),pool_id:await value(hook,'poolId'),groups,settings:{fee_pips:liquidity.fee_pips,tick_spacing:liquidity.tick_spacing,initial_sqrt_price_x96:String(liquidity.initial_sqrt_price_x96),tick_lower:liquidity.tick_lower,tick_upper:liquidity.tick_upper,liquidity:String(liquidity.liquidity),eth_usd:snapshot.eth_usd,target_fdv_usd:'25000',fixed_supply:'1000000',seed:SEED,temperature_q10:512,inference_gas_limit:26000000,transaction_gas_limit:String(GAS),hook_flags:'0x3040',hook_salt_attempts:attempts},deployment_count:entries.length,archive:{path:'bundle/transactions.jsonl.gz',sha256:sha(archive),bytes:archive.length},deployments:entries.map(({transaction,...e})=>e),funding:{to:vaultAddress,value:ethers.parseEther('1').toString(),data:vault.interface.encodeFunctionData('fundAndInitialize'),chainId:CHAIN},source_manifest_sha256:sha(fs.readFileSync(path.join(HERE,'build/source-manifest.json'))),warnings:['Principal, fees and dust are permanently locked.','Inference failure reverts both buys and sells.','The selected model failed long-output grammar/continuity tests.','Other pools can trade freely transferable N0VA without this hook.','Spot FDV is not redeemable backing or a guaranteed market price.'],public_transactions_submitted:0};
 save('plan.json',plan);save('reviewed-pins.json',{plan_sha256:sha(fs.readFileSync(path.join(HERE,'plan.json'))),archive_sha256:sha(archive),checkpoint_sha256:CHECKPOINT,chain_id:CHAIN,sender:SENDER});
 console.log(json({status:plan.status,contracts:plan.contracts,deployment_count:entries.length,archive_bytes:archive.length,pool_id:plan.pool_id,target_fdv:liquidity.initial_fdv_usd}));
}
main().catch(e=>{console.error(e.stack??e.message);process.exitCode=1;});
