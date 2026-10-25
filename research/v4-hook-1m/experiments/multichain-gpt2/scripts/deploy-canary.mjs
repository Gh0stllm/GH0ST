// Exact unsigned-plan broadcaster. Dry-run unless reviewed execution is explicit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Contract,JsonRpcProvider,Wallet,keccak256} from 'ethers';
import {compile,assertSourcesUnchanged} from './build.mjs';
import {CANARY_CONTRACT,canonical,parseCanaryArgs} from './canary-plan.mjs';
import {createCanarySequence} from './prepare-canary.mjs';
import {ENDPOINT_ABI,ULN_ABI,validateCanaryConfig,checkedOutput,equal,canaryFeeOverrides,checkCanaryTransport,writeReport,reportPath} from './canary-runtime.mjs';
import {verifyCanary} from './verify-canary.mjs';
import {gasLimitForEstimate} from './worker.mjs';
import {reserveCanarySpend,markCanaryBroadcast,recordCanaryReceipt,reconcileCanaryBudget,releaseCanaryReservation} from './canary-budget.mjs';

export async function regenerateCanaryPlan(config,built){
  validateCanaryConfig(config,{deployed:'prepared'});
  assert(config.compilerSourcesHash===built.compiler.sources_commitment_sha256,'Prepared source commitment changed');
  const base=structuredClone(config),nonces={};
  for(const ch of base.chains){nonces[ch.key]=ch.startNonce;for(const k of ['router','selfRelayExecutor','routerDeploymentTx','selfRelayExecutorDeploymentTx'])ch[k]=null;delete ch.preparedTransactions;delete ch.deploymentReceipts;}
  const regenerated=await createCanarySequence({config:base,nonces,built});
  for(const ch of config.chains){const expected=regenerated.manifest.chains[ch.stage];for(const field of ['router','selfRelayExecutor','startNonce','endNonceExclusive'])assert(equal(ch[field],expected[field]),'Predicted deployment identity changed');assert(canonical(ch.preparedTransactions)===canonical(expected.preparedTransactions),'Prepared transaction metadata changed');}
  return regenerated;
}
export function validateUnsignedRows(rows,expected){assert(Array.isArray(rows)&&rows.length===expected.length,'Wrong transaction count');for(let i=0;i<rows.length;i++)assert(canonical(rows[i])===canonical(expected[i]),'Unsigned transaction differs from exact regenerated sequence');return rows;}
async function verifyReceipt(provider,row,hash,confirmations){
  const [tx,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  if(!receipt)return null;
  assert(tx&&equal(tx.from,row.from)&&equal(tx.to,row.to)&&BigInt(tx.nonce)===BigInt(row.nonce)&&BigInt(tx.chainId)===BigInt(row.chainId)&&equal(tx.data,row.data)&&BigInt(tx.value)===0n,'Mined transaction differs from prepared plan');
  assert(receipt.status===1,'Deployment transaction reverted; manual review required');const block=await provider.getBlock(receipt.blockNumber);assert(block&&equal(block.hash,receipt.blockHash),'Deployment receipt reorganized');assert(await receipt.confirmations()>=confirmations,'Deployment receipt has insufficient confirmations');return receipt;
}
function applyReceipt(ch,row,receipt){ch.deploymentReceipts??=[];const record={index:row.index,hash:receipt.hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,confirmed:true};const at=ch.deploymentReceipts.findIndex(x=>x.index===row.index);if(at<0)ch.deploymentReceipts.push(record);else ch.deploymentReceipts[at]=record;
  if(row.index===0){assert(equal(receipt.contractAddress,ch.router),'Router CREATE address differs');ch.routerDeploymentTx=receipt.hash;ch.deploymentBlock=receipt.blockNumber;}
  if(row.index===1){assert(equal(receipt.contractAddress,ch.selfRelayExecutor),'Executor CREATE address differs');ch.selfRelayExecutorDeploymentTx=receipt.hash;}
}
export async function recoverCanaryReceipts({ledger,provider,rows,chain,persist=()=>{}}){
  let recovered=0;
  for(const entry of ledger.receipts??[]){const match=/^deployment:([0-7])$/.exec(entry.actionId);if(!match)continue;const row=rows[Number(match[1])];assert(row&&row.index===Number(match[1]),'Budget history references an unknown deployment action');
    const existing=chain.deploymentReceipts?.find(x=>x.index===row.index);if(existing)assert(equal(existing.hash,entry.hash),'Manifest and budget history differ');
    const receipt=await verifyReceipt(provider,row,entry.hash,chain.confirmations);assert(receipt,'Budget history receipt is unavailable');
    if(!existing||!existing.confirmed){applyReceipt(chain,row,receipt);persist();recovered++;}
  }return recovered;
}
export async function run(args,{signerFactory}={}){if(args.length===1&&args[0]==='--help'){console.log('deploy-canary --config=deployments/canary/manifest.json [--execute] [--once]\nDry-run by default. Regenerates all unsigned bytes. Paid mode requires explicit enabled, messagingReviewed and budgetApproved flags, an approved bounded or uncapped spending policy and funded admin key. Transaction gas ceilings and deadlines remain enforced.');return;}
  const o=parseCanaryArgs(args,['config'],['--execute','--once']);assert(o.config,'config required');const configFile=checkedOutput(o.config),config=JSON.parse(fs.readFileSync(configFile));validateCanaryConfig(config,{deployed:'prepared',paid:!!o.execute});
  const built=compile(),plan=await regenerateCanaryPlan(config,built),sequences=plan.records.map(x=>({key:x.key,txs:validateUnsignedRows(fs.readFileSync(path.join(path.dirname(configFile),x.key+'.unsigned.jsonl'),'utf8').trim().split('\n').map(JSON.parse),x.txs)}));
  const providers=[];let sent=0;
  try{for(const ch of config.chains){const url=process.env[ch.rpcEnv];assert(url,'RPC environment missing');const provider=new JsonRpcProvider(url);providers.push(provider);assert(BigInt(await provider.send('eth_chainId',[]))===BigInt(ch.chainId),'RPC chain mismatch');
      let signer;if(o.execute){const ledger=await reconcileCanaryBudget({config,chain:ch,configFile,provider});await recoverCanaryReceipts({ledger,provider,rows:sequences[ch.stage].txs,chain:ch,persist:()=>writeReport(configFile,config)});if(signerFactory){assert(typeof signerFactory==='function','Invalid signer factory');signer=await signerFactory(provider);}else{const secret=process.env[config.keyEnv];assert(typeof secret==='string'&&/^0x[0-9a-fA-F]{64}$/.test(secret),'Admin key unavailable');signer=new Wallet(secret,provider);}assert(signer&&typeof signer.getAddress==='function'&&equal(await signer.getAddress(),config.admin),'Signing key does not control configured admin');}
      for(const row of sequences[ch.stage].txs){assertSourcesUnchanged(built);const previous=ch.deploymentReceipts?.find(x=>x.index===row.index);
        if(previous){const receipt=await verifyReceipt(provider,row,previous.hash,ch.confirmations);if(!receipt){console.log(JSON.stringify({status:'WAITING_FOR_DEPLOYMENT_RECEIPT',chain:ch.key,index:row.index,hash:previous.hash}));return;}if(o.execute){applyReceipt(ch,row,receipt);writeReport(configFile,config);}continue;}
        assert(await provider.getTransactionCount(config.admin,'pending')===Number(row.nonce),'Admin pending nonce changed; do not reuse this plan');
        assert((await provider.getBlock('latest')).timestamp<=config.deadline,'Canary deadline expired');
        if(!o.execute){console.log(JSON.stringify({status:'DRY_RUN_NEXT_DEPLOYMENT',chain:ch.key,index:row.index,kind:row.kind,nonce:row.nonce,inputHash:keccak256(row.data),budgetApproved:config.budgetApproved}));break;}
        if(row.index===7){const endpoint=new Contract(ch.endpoint,ENDPOINT_ABI,provider),sendLibrary=new Contract(ch.sendLibrary,ULN_ABI,provider),receiveLibrary=new Contract(ch.receiveLibrary,ULN_ABI,provider),router=new Contract(ch.router,built.artifacts[CANARY_CONTRACT].abi,provider);assert(equal(await router.owner(),config.admin)&&equal(await router.peers(config.chains[1-ch.stage].eid),'0x'+'0'.repeat(24)+config.chains[1-ch.stage].router.slice(2)),'Seal authority or peer differs');await checkCanaryTransport({config:ch,endpoint,sendLibrary,receiveLibrary},config.chains[1-ch.stage]);}
        const tx={to:row.to,data:row.data,value:0n,from:config.admin,nonce:BigInt(row.nonce)},ceiling=BigInt(ch.maxTransactionGas);
        const estimate=await provider.estimateGas({...tx,gasLimit:ceiling}),gasLimit=gasLimitForEstimate(estimate,ceiling);
        await provider.call({...tx,gasLimit});const feeOverrides=await canaryFeeOverrides({config:ch,runtimeConfig:config,provider,deadline:config.deadline});
        const reservation=await reserveCanarySpend({config,chain:ch,configFile,provider,actionId:'deployment:'+row.index,gasLimit,feeOverrides,value:0n,data:row.data,to:row.to});
        try{assert(BigInt(reservation.nonce)===BigInt(row.nonce),'Reserved nonce differs from exact plan');
        const submitted=await signer.sendTransaction({...tx,gasLimit,...feeOverrides,nonce:reservation.nonce});await markCanaryBroadcast(reservation,submitted.hash);
        ch.deploymentReceipts??=[];ch.deploymentReceipts.push({index:row.index,hash:submitted.hash,confirmed:false});writeReport(configFile,config);
        let receipt;try{receipt=await submitted.wait(ch.confirmations);}catch(error){if(error.receipt)await recordCanaryReceipt(reservation,error.receipt,provider);throw Error('Deployment receipt failed or is uncertain');}await recordCanaryReceipt(reservation,receipt,provider);assert(receipt?.status===1,'Deployment reverted; manual review required');applyReceipt(ch,row,receipt);writeReport(configFile,config);sent++;
        console.log(JSON.stringify({status:'CANARY_DEPLOYMENT_MINED',chain:ch.key,index:row.index,hash:receipt.hash,gasUsed:String(receipt.gasUsed)}));if(o.once)return;
        }finally{await releaseCanaryReservation(reservation);}
      }
    }
    if(o.execute){const report=await verifyCanary({config,built});writeReport(reportPath(configFile,config),report);console.log(JSON.stringify({status:report.status,submitted:sent}));}
  }finally{for(const provider of providers)provider.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(()=>{console.error('CANARY_DEPLOYMENT_STOPPED: check exact unsigned plan, pending nonce, confirmed admin key, receipt state, reviewed security, budget and deadline. Pending reservations remain protected.');process.exitCode=1;});
