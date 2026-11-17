import { Interface, Transaction } from 'ethers';
export const OWNER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
export const TOKEN='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
export const GENESIS='0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';
export const FAST='0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad';
export const ZERO='0x0000000000000000000000000000000000000000';
export const ADMIN='0x0000000000000000000000000000000000000070';
export const PUBLIC='0x000000000000000000000000000000000000006b';
export const GAS='0x000000000000000000000000000000000000006c';
export const NODE='0x00000000000000000000000000000000000000c8';
// Deposit principal and transaction-fee budget are deliberately separate.
export const TARGET=10000000000000n, FUNDING=1000000n*10n**18n, CHILD_FEE_CAP=100n*10n**18n, PARENT_FEE_CAP=100000000000000n, COMPUTE_CAP=16777216n;
export const TOKEN_HASH='0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
export const CALLS=[['setMinimumL2BaseFee(uint256)',[String(TARGET)]],['setL2BaseFee(uint256)',[String(TARGET)]],['setNetworkFeeAccount(address)',[OWNER]],['setInfraFeeAccount(address)',[OWNER]],['setL1PricingRewardRecipient(address)',[OWNER]],['addChainOwner(address)',[ZERO]],['removeChainOwner(address)',[OWNER]]];
export const admin=new Interface(CALLS.map(([s])=>'function '+s));
export const token=new Interface(['function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)','event Transfer(address indexed from,address indexed to,uint256 value)']);
export const inbox=new Interface(['function depositERC20(uint256) returns(uint256)']);
export const pub=new Interface(['function getAllChainOwners() view returns(address[])','function getAllNativeTokenOwners() view returns(address[])','function getNativeTokenManagementFrom() view returns(uint64)','function getScheduledUpgrade() view returns(uint64,uint64)','function getNetworkFeeAccount() view returns(address)','function getInfraFeeAccount() view returns(address)']);
export const gas=new Interface(['function getMinimumGasPrice() view returns(uint256)','function getL1RewardRecipient() view returns(address)']);
export const ni=new Interface(['function gasEstimateL1Component(address,bool,bytes) payable returns(uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)']);
export const creator=new Interface(['event RollupCreated(address indexed rollupAddress,address indexed nativeToken,address inboxAddress,address outbox,address rollupEventInbox,address challengeManager,address adminProxy,address sequencerInbox,address bridge,address upgradeExecutor,address validatorWalletCreator)']);
export const rollup=new Interface(['function chainId() view returns(uint256)','function bridge() view returns(address)','function inbox() view returns(address)','function outbox() view returns(address)','function anyTrustFastConfirmer() view returns(address)']);
export const bridge=new Interface(['function nativeToken() view returns(address)','function nativeTokenDecimals() view returns(uint8)']);
export const check=(x,m='The child setup differs from the reviewed policy.')=>{if(!x)throw Error(m);};
export const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export const address=x=>/^0x[0-9a-f]{40}$/i.test(x||'')&&!same(x,ZERO);
export const hash=x=>/^0x[0-9a-f]{64}$/i.test(x||'')&&!/^0x0{64}$/i.test(x);
export const qty=x=>'0x'+BigInt(x).toString(16);
export function validatePolicy(p){
 check(p.schema==='gh0st.gl3.child-fee-bootstrap.v1'&&p.chainId===4663001&&p.temporaryProductionOwner===OWNER&&p.treasury===OWNER);
 check(p.currentBaseFeeUnits===String(TARGET)&&p.minimumBaseFeeUnits===String(TARGET)&&p.ownerPrecompile===ADMIN&&p.orderedCalls.length===7);
 CALLS.forEach(([method,args],i)=>check(p.orderedCalls[i].method===method&&JSON.stringify(p.orderedCalls[i].args)===JSON.stringify(args)));
 check(p.coldKeyMayLeaveLocalWallet===false&&p.rpcGasCapUnchanged===true&&p.protocolComputeLimitsUnchanged===true);
 return p;
}
export function actionTemplates(plan){
 const deposit=address(plan.inboxAddress)?plan.inboxAddress:null;
 return [
  {index:0,kind:'approve',chainId:4663,nonce:plan.parentNonceBase,to:TOKEN,data:deposit?token.encodeFunctionData('approve',[deposit,FUNDING]):null,value:'0',label:'Approve exactly 1,000,000 GH0ST to receipt-derived RH Inbox'},
  {index:1,kind:'deposit',chainId:4663,nonce:plan.parentNonceBase==null?null:plan.parentNonceBase+1,to:deposit,data:deposit?inbox.encodeFunctionData('depositERC20',[FUNDING]):null,value:'0',label:'Deposit 1,000,000 GH0ST through RH Inbox to the same cold wallet on GL3'},
  ...CALLS.map(([signature,args],i)=>({index:i+2,childIndex:i,kind:'child',chainId:4663001,nonce:i,to:ADMIN,data:admin.encodeFunctionData(signature,args),value:'0',label:signature}))];
}
export function validatePlan(p){
 check(p.schema==='gh0st.gl3.child-setup.review.v1'&&p.owner===OWNER&&p.parentChainId===4663&&p.childChainId===4663001&&p.genesisHash===GENESIS);
 check(p.depositUnits===String(FUNDING)&&p.maxChildFeeUnits===String(CHILD_FEE_CAP)&&/^[1-9][0-9]*$/.test(p.maxParentFeeWei||'')&&BigInt(p.maxParentFeeWei)<=PARENT_FEE_CAP,'An explicit reviewed RH fee cap of at most0.0001 ETH is required.');
 check(Number.isSafeInteger(p.parentNonceBase)&&p.parentNonceBase>=0&&p.automaticTopups===false&&p.extraHeartbeatTransactions===false);
 for(const k of ['factoryAddress','inboxAddress','bridgeAddress','rollupAddress','outboxAddress'])check(address(p[k]));
 check(hash(p.creationTransactionHash)&&hash(p.creationReceiptBlockHash)&&Number.isSafeInteger(p.parentConfirmationBlocks)&&p.parentConfirmationBlocks>=1);
 check(/^[a-f0-9]{64}$/.test(p.feePolicySHA256||'')&&/^[a-f0-9]{64}$/.test(p.priorUserConsentSHA256||''));
 check(/^[a-f0-9]{64}$/.test(p.receiptPacketSHA256||'')&&/^[a-f0-9]{64}$/.test(p.deploymentAuditSHA256||''),'Passed deployment audit/receipt packet bindings are required.');
 const expected=actionTemplates(p);check(Array.isArray(p.actions)&&p.actions.length===9);
 expected.forEach((a,i)=>{for(const k of ['index','kind','chainId','nonce','to','data','value'])check(a[k]===p.actions[i][k]);});
 return expected;
}
export function validateReceiptEvidence(plan,packet,audit,packetSHA256,auditSHA256){
 check(packetSHA256===plan.receiptPacketSHA256&&auditSHA256===plan.deploymentAuditSHA256&&packet.schema==='gh0st.gl3.receipt-derived-bootstrap.v1'&&packet.passed===true&&packet.bindings?.deploymentManifest?.SHA256===plan.deploymentAuditSHA256,'Passed receipt packet differs.');
 check(audit.schema==='gh0st.gl3.deployment-verified.v1'&&audit.passed===true&&audit.chainId===4663&&audit.childChainId===4663001&&audit.all27ReceiptsCanonicalAtObservation===true&&audit.check?.passed===true&&audit.check.actionIndex===27&&audit.receipts.length===27&&audit.receipts.every(x=>x.status===1),'Full parent deployment audit is incomplete.');
 check(same(audit.creationTransactionHash,plan.creationTransactionHash)&&same(audit.creationBlockHash,plan.creationReceiptBlockHash)&&same(audit.receipts[26].to,plan.factoryAddress)&&same(audit.RollupCreated.nativeToken,TOKEN)&&same(audit.genesisStateReceipt.blockHash,GENESIS),'Audited creation receipt/genesis differs.');
 for(const [key,eventKey]of[['rollupAddress','rollupAddress'],['inboxAddress','inboxAddress'],['bridgeAddress','bridge'],['outboxAddress','outbox']])check(same(plan[key],audit.RollupCreated[eventKey]),'Audited bridge binding differs.');
 return true;
}
export function fullGasFloor(normal,compute,l1){
 normal=BigInt(normal);compute=BigInt(compute);l1=BigInt(l1);
 check(normal>0n&&compute>0n&&l1>=0n,'Invalid actual gas observations.');
 const computeMargin=compute/5n+10000n;check(compute+computeMargin<=COMPUTE_CAP,'Unchanged compute guard exceeded.');
 const component=compute+l1,floor=normal>component?normal:component;
 return {normal,compute,l1,computeMargin,component,floor,gasLimit:floor+computeMargin+l1/5n};
}
export function receiptGas(r,child){
 const total=BigInt(r.gasUsed);check(total>0n,'Actual gas use must be positive.');
 if(!child)return {totalGasUsed:String(total)};
 check(r.gasUsedForL1!==undefined&&r.gasUsedForL1!==null,'Actual Nitro receipt must expose gasUsedForL1.');
 const poster=BigInt(r.gasUsedForL1),compute=total-poster;check(poster>=0n&&compute>=0n&&compute<=COMPUTE_CAP,'Actual Nitro gas components exceed unchanged compute guard.');
 return {totalGasUsed:String(total),l1PosterGasUsed:String(poster),l2ComputeGasUsed:String(compute)};
}
export function settled(snapshot,receipt){
 return BigInt(snapshot.number)>BigInt(receipt.blockNumber)&&BigInt(snapshot.baseFee)===TARGET&&BigInt(snapshot.quote)===TARGET&&BigInt(snapshot.minimum)===TARGET;
}
export function validateAuthority(s,childIndex){
 const owners=Array.from(s.owners).map(x=>x.toLowerCase()).sort();
 const expected=(childIndex>=7?[ZERO]:childIndex>=6?[ZERO,OWNER]:[OWNER]).map(x=>x.toLowerCase()).sort();
 check(JSON.stringify(owners)===JSON.stringify(expected),'Unexpected child-owner state.');
 check(s.minters.length===0&&BigInt(s.managementFrom)===0n&&s.upgrade.length===2&&s.upgrade.every(x=>BigInt(x)===0n),'Unexpected mint/upgrade authority.');
 if(childIndex>=1)check(BigInt(s.minimum)===TARGET,'Minimum fee was not set.');
 if(childIndex>=3)check(same(s.network,OWNER),'Network revenue recipient differs.');
 if(childIndex>=4)check(same(s.infra,OWNER),'Infrastructure revenue recipient differs.');
 if(childIndex>=5)check(same(s.reward,OWNER),'L1 reward recipient differs.');
 if(childIndex>=7)check(BigInt(s.baseFee)>=TARGET&&BigInt(s.quote)>=TARGET,'Final header/quote below the reviewed minimum.');
}
export function makeUnsigned(action,quote){
 check(!Object.hasOwn(action,'skipL1Charging')&&!Object.hasOwn(quote,'skipL1Charging'),'Read-only overrides cannot enter signed transactions.');
 const t=Transaction.from({type:2,chainId:action.chainId,nonce:action.nonce,to:action.to,data:action.data,value:0n,gasLimit:BigInt(quote.gasLimit),maxFeePerGas:BigInt(quote.price)*2n,maxPriorityFeePerGas:0n});
 return {unsignedSerialized:t.unsignedSerialized,unsignedHash:t.unsignedHash,maxCostUnits:String(t.gasLimit*t.maxFeePerGas)};
}
export function validateQuotedAction(plan,q,expectedPlanSHA256,now=Date.now()){
 const expected=validatePlan(plan)[q.index];check(expected&&/^[a-f0-9]{64}$/.test(expectedPlanSHA256||'')&&q.planSHA256===expectedPlanSHA256&&Number.isSafeInteger(q.expiresAt)&&Number.isSafeInteger(q.createdAt)&&q.expiresAt-q.createdAt===30000&&now>=q.createdAt&&now<q.expiresAt);
 const t=Transaction.from(q.unsignedSerialized);check(t.signature===null&&t.type===2&&t.chainId===BigInt(expected.chainId)&&t.nonce===expected.nonce&&same(t.to,expected.to)&&t.data===expected.data&&t.value===0n&&t.unsignedHash===q.unsignedHash);
 check(t.gasLimit===BigInt(q.gasLimit)&&t.maxFeePerGas===2n*BigInt(q.price)&&t.maxPriorityFeePerGas===0n&&BigInt(q.price)>0n);
 check(t.gasLimit*t.maxFeePerGas===BigInt(q.maxCostUnits));
 const cap=expected.chainId===4663?BigInt(plan.maxParentFeeWei):BigInt(plan.maxChildFeeUnits);
 check(BigInt(q.chainCapsAlreadySigned)+BigInt(q.maxCostUnits)<=cap,'Remaining reviewed fee budget exceeded.');
 if(expected.chainId===4663001){const f=fullGasFloor(q.normal,q.compute,q.l1);check(t.gasLimit===f.gasLimit,'Full-fee gas floor differs.');}
 return t;
}
export function validateSignedEnvelope(tx,quote,owner=OWNER){
 check(tx.signature&&same(tx.from,owner)&&tx.unsignedHash===quote.unsignedHash,'Signature does not match this exact fresh action.');return tx;
}
