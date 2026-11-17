// Runpod-only exact bounded deployment. Requires the user's completed local review.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {Wallet,Transaction,JsonRpcProvider,keccak256}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
const sha=b=>createHash('sha256').update(b).digest('hex');
const root='/workspace/gl3/mainnet';
const privateFile=p=>{const s=fs.lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink()&&fs.realpathSync(p)===p&&(s.mode&0o077)===0&&s.uid===process.getuid());};
const encode=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
try{
 assert.equal(process.platform,'linux');process.umask(0o077);
 const approvalPath=path.resolve(process.argv[2]);privateFile(approvalPath);const approval=JSON.parse(fs.readFileSync(approvalPath));
 assert(approval.userApproved===true&&approval.exactBridgeRehearsalPassed===true&&approval.licenseTermsAcceptedByUser===true&&approval.recoveryVerifiedOffPod===true);
 const planPath='/workspace/gl3/same-day-mainnet/deployment-packet/isolated-deployer/plan-isolated-deployer.json';
 const planBytes=fs.readFileSync(planPath),planHash=sha(planBytes);assert.equal(planHash,approval.delegatedPlanSHA256);const plan=JSON.parse(planBytes);
 const reviewedBytes=fs.readFileSync(approval.sponsorReviewFile);assert.equal(sha(reviewedBytes),approval.sponsorReviewSHA256);const review=JSON.parse(reviewedBytes);
 assert.equal(sha(Buffer.from(review.delegatedPlanJSON)),planHash);assert.equal(review.deployer,'0x1E0a95665dc872899eb89018455ef44B27108FCd');
 assert.equal(approval.maxFundingWei,'5000000000000000');assert.equal(plan.actions.length,27);
 for(const [file,expected] of Object.entries(approval.sourceHashes)){assert.equal(sha(fs.readFileSync(file)),expected,'Execution source changed.');}
 const {validateSponsorPlan}=await import('./review-core.mjs');validateSponsorPlan(review,review.deployer);
 const {executeActions,unsignedForAction}=await import('./execution-runtime/execute-rh.mjs');
 const {verifyStep}=await import(pathToFileURL('/workspace/gl3/same-day-mainnet/deployment-packet/verify-deployment-step.mjs'));
 const provider=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,cacheTimeout:-1});
 assert.equal(BigInt(await provider.send('eth_chainId',[])),4663n);
 assert.equal(approval.fundingTransactionHashes.length,4);
 for(let i=0;i<4;i++){
  const h=approval.fundingTransactionHashes[i],a=review.actions[i],t=Transaction.from(a.unsignedSerialized);
  const [tx,r]=await Promise.all([provider.getTransaction(h),provider.getTransactionReceipt(h)]);
  assert(tx&&r&&r.status===1&&tx.from===review.owner&&Transaction.from(tx).unsignedHash===t.unsignedHash&&tx.hash===h);
  const b=await provider.getBlock(r.blockNumber);assert.equal(b.hash,r.blockHash);assert((await provider.getBlockNumber())-r.blockNumber>=12);
 }
 const keyPath=root+'/private/deployment-signer.json';privateFile(keyPath);const identity=JSON.parse(fs.readFileSync(keyPath));assert.equal(identity.address,review.deployer);
 const journal=planPath+'.signed-journal.json';
 const actions=plan.actions.map((a,i)=>{const t=Transaction.from(a.unsignedSerialized);assert.equal(a.from,review.deployer);assert.equal(t.nonce,i);assert.equal(t.value,0n);assert.equal(t.unsignedHash,a.unsignedHash);const action={...a,id:i,nonce:i,maxCostWei:t.gasLimit*t.maxFeePerGas,transaction:{type:2,chainId:4663,nonce:i,to:t.to,value:'0',data:t.data,gas:t.gasLimit.toString(),maxFeePerGas:t.maxFeePerGas.toString(),maxPriorityFeePerGas:t.maxPriorityFeePerGas.toString()}};unsignedForAction(action);return action;});
 const fullFee=actions.reduce((s,a)=>s+a.maxCostWei,0n);assert(fullFee<=5000000000000000n);
 async function audit(index){
  const j=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal)):null;
  const receipts=[];for(let i=0;i<index;i++){const e=j?.actions.find(e=>e.id===i);assert(e?.status==='confirmed');receipts.push(e.hash);}
  const result=await verifyStep({planSHA256:planHash,actionIndex:index,receiptHashes:receipts},(method,params)=>provider.send(method,params));
  assert(result.passed);return result;
 }
 async function fresh(rpc,a){
  assert.equal(sha(fs.readFileSync(planPath)),planHash);await audit(a.id);
  const [block,fees,estimate,balance]=await Promise.all([rpc.getBlock('latest'),rpc.getFeeData(),rpc.estimateGas({from:a.from,to:a.transaction.to,value:0n,data:a.transaction.data}),rpc.getBalance(a.from)]);
  const cap=BigInt(a.transaction.maxFeePerGas),tip=BigInt(a.transaction.maxPriorityFeePerGas);
  assert(block.baseFeePerGas!=null&&block.baseFeePerGas+tip<=cap&&fees.maxPriorityFeePerGas!=null&&fees.maxPriorityFeePerGas<=tip,'Reviewed fees are stale.');
  assert(estimate<=BigInt(a.transaction.gas),'Actual execution estimate exceeds the reviewed gas limit.');
  assert(balance>=actions.slice(a.id).reduce((s,a)=>s+a.maxCostWei,0n),'Remaining bounded funding does not cover the remaining maximum fees.');
 }
 await fresh(provider,actions[0]);
 const signer=new Wallet(identity.privateKey,provider);assert.equal(signer.address,review.deployer);identity.privateKey=undefined;
 const result=await executeActions({planPath,planHash,owner:review.deployer,actions,provider,getSigner:async()=>signer,freshCheck:fresh,log:message=>console.log(message)});
 const final=await audit(27);const out={schema:'gh0st.gl3.isolated-deployment-result.v1',passed:true,planSHA256:planHash,userReviewSHA256:approval.sponsorReviewSHA256,deployed:final.deployed,transactionHashes:result.actions.map(e=>e.hash),fundingCapWei:'5000000000000000',coldOwnerUnchanged:true,refunded:false,publicServicesActivated:false};
 fs.writeFileSync(root+'/identities/deployment-result.json',encode(out),{mode:0o600,flag:'wx'});console.log(encode(out));provider.destroy();
}catch{
 console.error('Isolated deployment stopped. Preserve its signed journal and reconcile saved transaction hashes before retrying. No automatic replacement or top-up.');process.exitCode=1;
}
