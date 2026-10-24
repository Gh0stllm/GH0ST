// Default is read-only. Signing requires an explicit interactive CLI mode.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import * as ethers from 'ethers';
import {HERE,ROOT,CHAIN,GAS,SENDER,FACTORY,CHECKPOINT,sha,read,json,restoreArtifact} from './common.mjs';

export function loadPackage(){
 const pins=read('reviewed-pins.json'),bytes=fs.readFileSync(path.join(HERE,'plan.json'));assert.equal(sha(bytes),pins.plan_sha256,'Plan differs from reviewed pins');const plan=JSON.parse(bytes);
 assert.equal(plan.chain_id,CHAIN);assert.equal(plan.sender,SENDER);assert.equal(plan.model.checkpoint_sha256,CHECKPOINT);assert.equal(pins.checkpoint_sha256,CHECKPOINT);
 const zipped=fs.readFileSync(restoreArtifact(plan.archive.path,pins.archive_sha256));assert.equal(sha(zipped),pins.archive_sha256);assert.equal(sha(zipped),plan.archive.sha256);
 const entries=gunzipSync(zipped).toString().trim().split('\n').map(x=>JSON.parse(x));assert.equal(entries.length,plan.deployment_count);
 for(const [i,e]of entries.entries()){
  assert.equal(e.order,i);assert.equal(e.transaction.chainId,CHAIN);assert.equal(BigInt(e.transaction.value),0n);assert.equal(sha(ethers.getBytes(e.transaction.data)),e.transaction_data_sha256);assert.equal(e.address,plan.deployments[i].address);assert.equal(e.runtime_code_hash,plan.deployments[i].runtime_code_hash);
  if(e.kind==='vault'){assert.equal(i,0);assert.equal(ethers.getCreateAddress({from:SENDER,nonce:plan.wallet_nonce}),e.address);assert.equal(ethers.keccak256(e.transaction.data),e.init_code_hash);}
  else{assert.equal(e.transaction.to,FACTORY);assert.equal(e.transaction.data.slice(0,66),e.salt);assert.equal(ethers.keccak256('0x'+e.transaction.data.slice(66)),e.init_code_hash);assert.equal(ethers.getCreate2Address(FACTORY,e.salt,e.init_code_hash),e.address);}
 }
 assert.equal(plan.funding.to,plan.contracts.vault);assert.equal(BigInt(plan.funding.value),ethers.parseEther('1'));assert.equal(plan.funding.data,new ethers.Interface(['function fundAndInitialize()']).encodeFunctionData('fundAndInitialize'));
 return{plan,pins,entries};
}
export function endpoint(){const file=path.join(ROOT,'.env.local');const raw=fs.existsSync(file)?fs.readFileSync(file,'utf8').match(/^ROBINHOOD_MAINNET_RPC_URL\s*=\s*(.+)$/m)?.[1]?.trim():null;return process.env.ROBINHOOD_MAINNET_RPC_URL||raw?.replace(/^(['"])(.*)\1$/,'$2')||'https://rpc.mainnet.chain.robinhood.com';}
export async function verifyNetwork(provider,plan){assert.equal(Number(BigInt(await provider.send('eth_chainId',[]))),CHAIN,'Wrong chain');for(const d of Object.values(plan.dependencies))assert.equal(ethers.keccak256(await provider.getCode(d.address)),d.code_hash,'Dependency code changed');}
export async function inspect(provider,entry){const code=await provider.getCode(entry.address);if(code==='0x')return false;assert.equal(ethers.keccak256(code),entry.runtime_code_hash,'Conflicting runtime at '+entry.address);return true;}
async function hiddenKey(){
 assert(process.stdin.isTTY&&process.stdout.isTTY,'Signing needs an interactive terminal');process.stdout.write('Private key (hidden; never saved): ');
 return new Promise((resolve,reject)=>{let value='';const old=process.stdin.isRaw;const finish=error=>{process.stdin.off('data',onData);process.stdin.setRawMode(!!old);process.stdin.pause();process.stdout.write('\n');if(error){value='';reject(error);}else{const answer=value;value='';resolve(answer);}};const onData=chunk=>{for(const c of chunk.toString()){if(c==='\u0003')return finish(Error('Cancelled'));if(c==='\r'||c==='\n')return finish();if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(/[0-9a-fA-FxX]/.test(c))value+=c;}};process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);});
}
export async function main(args=process.argv.slice(2)){
 assert(args.every(x=>['--broadcast','--fund','--help'].includes(x)),'Unknown option');assert(!(args.includes('--broadcast')&&args.includes('--fund')),'Deployment and funding are separate explicit stages');
 if(args.includes('--help')){console.log('Default: read-only status. --broadcast: deploy contracts only. --fund: after deployment, permanently lock exactly 1 ETH. Keys are entered interactively and never saved.');return;}
 const{plan,pins,entries}=loadPackage();const provider=new ethers.JsonRpcProvider(endpoint(),CHAIN,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});let fd;
 const lock=path.join(HERE,'.local/deploy.lock'),stateFile=path.join(HERE,'.local/receipts.json');
 try{
  await verifyNetwork(provider,plan);const done=new Set();
  for(let start=0;start<entries.length;start+=12){const batch=entries.slice(start,start+12);const checks=await Promise.all(batch.map(e=>inspect(provider,e)));checks.forEach((yes,i)=>{if(yes)done.add(batch[i].order);});}
  const balance=await provider.getBalance(SENDER),latest=Number(BigInt(await provider.send('eth_getTransactionCount',[SENDER,'latest']))),pending=Number(BigInt(await provider.send('eth_getTransactionCount',[SENDER,'pending'])));
  console.log(`Robinhood mainnet verified. Wallet: ${SENDER}\nVerified contracts: ${done.size}/${entries.length}\nETH balance: ${ethers.formatEther(balance)}\nWallet nonce: ${latest}; pending nonce: ${pending}\nLiquidity deposit: exactly 1 ETH, separate --fund stage.`);
  fs.writeFileSync(path.join(HERE,'preflight.json'),json({status:'READ_ONLY_CONFIRMED',checked_at:new Date().toISOString(),plan_sha256:pins.plan_sha256,chain_id:CHAIN,contracts_verified:done.size,total_contracts:entries.length,balance_eth:ethers.formatEther(balance),latest_nonce:latest,pending_nonce:pending,public_transactions_submitted:0}));
  if(!args.includes('--broadcast')&&!args.includes('--fund'))return;
  const rehearsal=read('rehearsal/results.json');assert.equal(rehearsal.status,'PASS');assert.equal(rehearsal.plan_sha256,pins.plan_sha256,'Rehearsal does not match this plan');const replay=read('rehearsal/independent-reference.json');assert.equal(replay.status,'PASS');assert.equal(replay.source_checkpoint_sha256,CHECKPOINT);
  const quotedGasPrice=BigInt(await provider.send('eth_gasPrice',[]));
  const remainingGas=rehearsal.deployments.filter(e=>!done.has(e.order)).reduce((s,e)=>s+BigInt(e.gas_used),0n);
  if(args.includes('--broadcast'))assert(balance>=ethers.parseEther('1')+(remainingGas*quotedGasPrice*150n+99n)/100n,'Fund this wallet for the 1 ETH liquidity reserve plus remaining deployment gas before starting');
  assert.equal(latest,pending,'Wallet has pending transactions; reconcile them before continuing');
  if(!done.has(0))assert.equal(latest,plan.wallet_nonce,'Wallet nonce changed before vault deployment; regenerate and rehearse the plan');
  if(args.includes('--fund'))assert.equal(done.size,entries.length,'All contracts must be verified before funding');
  const vault=new ethers.Contract(plan.contracts.vault,['function launched() view returns(bool)'],provider);
  if(args.includes('--fund')&&await vault.launched()){console.log('Pool already launched; no second deposit sent.');return;}
  if(args.includes('--broadcast')&&done.size===entries.length){console.log('All contracts already verified; no deployment sent.');return;}
  fs.mkdirSync(path.dirname(lock),{recursive:true,mode:0o700});fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,String(process.pid));
  const question=createInterface({input:process.stdin,output:process.stdout});const confirmation=args.includes('--fund')?'LOCK 1 ETH':'DEPLOY N0VA';let answer;try{answer=await question.question(`Type ${confirmation} to continue: `);}finally{question.close();}assert.equal(answer,confirmation,'Cancelled');
  let key=await hiddenKey(),signer;try{signer=new ethers.Wallet(key,provider);}catch{throw Error('Invalid private key');}finally{key='';}assert.equal(signer.address,SENDER,'Wrong signing wallet');
  const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{plan_sha256:pins.plan_sha256,transactions:{}};assert.equal(state.plan_sha256,pins.plan_sha256,'Receipts belong to a different plan');
  const save=()=>{const tmp=stateFile+'.tmp';fs.writeFileSync(tmp,json(state),{mode:0o600});fs.renameSync(tmp,stateFile);};let nonce=pending,nextAllowedAt=0;
  const feeSnapshot=read('network-snapshot.json'),cost=read('cost-estimate.json');
  const gasPriceCeiling=(BigInt(cost.gas_price_wei)*150n+99n)/100n;
  const gasPerSecond=Number(feeSnapshot.arb_gas_info.getGasAccountingParams[0]);assert(gasPerSecond>0);
  async function submit(request,label){
   if(state.transactions[label]?.status==='pending')throw Error('A prior submission has an unresolved outcome; inspect its saved transaction hash before resuming');
   const wait=nextAllowedAt-Date.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
   await verifyNetwork(provider,plan);const tx={...request,value:BigInt(request.value??0),from:SENDER,chainId:CHAIN,nonce};if(tx.to===null)delete tx.to;
   const estimate=await provider.estimateGas(tx);assert(estimate<=GAS,'Fresh estimate exceeds 32M gas');const gasLimit=(estimate*150n+99n)/100n<GAS?(estimate*150n+99n)/100n:GAS;const gasPrice=BigInt(await provider.send('eth_gasPrice',[]));assert(gasPrice<=gasPriceCeiling,'Network gas price exceeds the reviewed 150% snapshot ceiling; wait for fees to settle');
   const reserve=args.includes('--broadcast')?ethers.parseEther('1'):0n;
   assert(await provider.getBalance(SENDER,'pending')>=reserve+tx.value+gasLimit*gasPrice,'Insufficient ETH for this transaction and the 1 ETH liquidity reserve');
   const serialized=await signer.signTransaction({...tx,type:0,gasLimit,gasPrice});const hash=ethers.keccak256(serialized);state.transactions[label]={hash,nonce,status:'pending'};save();
   console.log(`${label}: checking receipt for ${hash}`);
   const sentAt=Date.now();try{await provider.broadcastTransaction(serialized);}catch{} // Reconcile our precomputed hash, never blindly resubmit.
   const receipt=await provider.waitForTransaction(hash,1,120000);assert(receipt,'Unknown transaction outcome; inspect saved hash before resuming');assert.equal(receipt.status,1,'Transaction reverted');
   state.transactions[label]={hash,nonce,status:'confirmed',gas_used:receipt.gasUsed.toString()};save();nonce++;nextAllowedAt=sentAt+Math.ceil(Number(receipt.gasUsed)*1000/gasPerSecond);console.log(`${label}: ${hash}`);
  }
  if(args.includes('--fund')){await submit(plan.funding,'fund-and-lock');assert(await vault.launched(),'Launch not confirmed');console.log('Exactly 1 ETH and fixed-supply N0VA liquidity are permanently locked.');}
  else for(const e of entries){if(done.has(e.order))continue;const prior=state.transactions[e.order];if(prior?.status==='pending'){const receipt=await provider.getTransactionReceipt(prior.hash);assert(receipt&&receipt.status===1,'Previous submission is unresolved; inspect its saved hash');assert(await inspect(provider,e),'Confirmed transaction lacks expected runtime');continue;}await submit(e.transaction,String(e.order));assert(await inspect(provider,e),'Post-deployment runtime mismatch');}
 }finally{provider.destroy();if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{const message=String(e.shortMessage||e.message).replace(/https?:\/\/[^\s)"']+/g,'[RPC URL redacted]').replace(/(?:alch_|nfp_)[A-Za-z0-9]+/g,'[credential redacted]');console.error(message.slice(0,1000));process.exitCode=1;});
