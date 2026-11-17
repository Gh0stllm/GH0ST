import {Transaction, Interface, parseEther} from 'ethers';
export const OWNER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
export const POSTER='0x52cc715ef517CE1933142d2168B43F8fdc54b7c5';
export const VALIDATOR='0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad';
export const TOKEN='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const CREATE2='0x4e59b44847b379578588920cA78FbF26c0B4956C';
const abi=new Interface(['function transfer(address,uint256)']);
const check=x=>{if(!x)throw Error('The deployment differs from the reviewed GL3 plan.');};
export function validateReviewPlan(plan){
 check(plan.owner===OWNER&&plan.parentChainId===4663&&plan.childChainId===4663001);
 check(Array.isArray(plan.actions)&&plan.actions.length===30&&plan.totals.automaticTopups===false);
 let totalFee=0n,totalValue=0n;const first=plan.actions[0].transaction.nonce;
 check(Number.isSafeInteger(first)&&first>=0);
 const actions=plan.actions.map((a,i)=>{
  const t=Transaction.from(a.unsignedSerialized),q=a.transaction;
  check(a.index===i&&a.from===OWNER&&t.signature===null&&t.type===2&&t.chainId===4663n&&t.unsignedHash===a.unsignedHash);
  check(t.nonce===first+i&&q.nonce===t.nonce&&q.type===2&&q.chainId===4663);
  check(t.to?.toLowerCase()===q.to?.toLowerCase()&&t.data.toLowerCase()===q.data.toLowerCase());
  check(t.value===BigInt(q.value)&&t.gasLimit===BigInt(q.gasLimit)&&t.maxFeePerGas===BigInt(q.maxFeePerGas)&&t.maxPriorityFeePerGas===BigInt(q.maxPriorityFeePerGas));
  check(t.gasLimit>0n&&t.gasLimit<=30000000n&&t.maxFeePerGas>0n&&t.maxPriorityFeePerGas>=0n&&t.maxPriorityFeePerGas<=t.maxFeePerGas);
  if(i<26)check(a.kind==='constructor'&&t.to===CREATE2&&t.value===0n);
  totalFee+=t.gasLimit*t.maxFeePerGas;totalValue+=t.value;
  return {...a,id:i,nonce:t.nonce,maxCostWei:t.gasLimit*t.maxFeePerGas,tx:t,transaction:{type:2,chainId:4663,nonce:t.nonce,to:t.to,data:t.data,value:t.value.toString(),gas:t.gasLimit.toString(),maxFeePerGas:t.maxFeePerGas.toString(),maxPriorityFeePerGas:t.maxPriorityFeePerGas.toString()}};
 });
 check(plan.actions[26].kind==='rollup-creation'&&actions[26].tx.value===0n&&plan.actions[26].postconditions.minimumAssertionPeriod===0&&plan.actions[26].postconditions.fastConfirmer===VALIDATOR);
 check(actions[27].tx.to===POSTER&&actions[27].tx.value===parseEther('0.01')&&actions[27].tx.data==='0x');
 check(actions[28].tx.to===VALIDATOR&&actions[28].tx.value===parseEther('0.005')&&actions[28].tx.data==='0x');
 check(actions[29].tx.to===TOKEN&&actions[29].tx.value===0n&&actions[29].tx.data===abi.encodeFunctionData('transfer',[VALIDATOR,parseEther('100000')]));
 check(totalFee===BigInt(plan.totals.maxGasFeeWei)&&totalValue===BigInt(plan.totals.ETHSentToOperatorsWei));
 check(totalValue===parseEther('0.015')&&totalFee+totalValue===BigInt(plan.totals.maxColdETHDebitWei)&&totalFee+totalValue<=parseEther('0.02'));
 check(plan.totals.GH0STSentToValidatorUnits===parseEther('100000').toString());
 return {actions,totalFee,totalValue};
}

export function validateSponsorPlan(plan, expectedDeployer){
 check(plan.schema==='gh0st.gl3.cold-sponsor-plan.v1'&&plan.owner===OWNER&&plan.parentChainId===4663&&plan.childChainId===4663001);
 check(plan.deployer===expectedDeployer&&expectedDeployer!==OWNER&&expectedDeployer!==POSTER&&expectedDeployer!==VALIDATOR);
 check(plan.actions.length===4&&plan.totals.automaticTopups===false);
 const first=plan.actions[0].transaction.nonce;let totalFee=0n,totalValue=0n;
 const actions=plan.actions.map((a,i)=>{
  const t=Transaction.from(a.unsignedSerialized),q=a.transaction;
  check(a.index===i&&a.from===OWNER&&t.signature===null&&t.type===2&&t.chainId===4663n&&t.unsignedHash===a.unsignedHash);
  check(Number.isSafeInteger(first)&&t.nonce===first+i&&q.nonce===t.nonce&&q.type===2&&q.chainId===4663);
  check(t.to?.toLowerCase()===q.to?.toLowerCase()&&t.data.toLowerCase()===q.data.toLowerCase()&&t.value===BigInt(q.value));
  check(t.gasLimit===BigInt(q.gasLimit)&&t.maxFeePerGas===BigInt(q.maxFeePerGas)&&t.maxPriorityFeePerGas===BigInt(q.maxPriorityFeePerGas));
  check(t.gasLimit>0n&&t.gasLimit<1000000n&&t.maxFeePerGas>0n&&t.maxPriorityFeePerGas>=0n&&t.maxPriorityFeePerGas<=t.maxFeePerGas);
  totalFee+=t.gasLimit*t.maxFeePerGas;totalValue+=t.value;
  return {...a,id:i,nonce:t.nonce,maxCostWei:t.gasLimit*t.maxFeePerGas,tx:t,transaction:{type:2,chainId:4663,nonce:t.nonce,to:t.to,data:t.data,value:t.value.toString(),gas:t.gasLimit.toString(),maxFeePerGas:t.maxFeePerGas.toString(),maxPriorityFeePerGas:t.maxPriorityFeePerGas.toString()}};
 });
 for(const [i,to,amount] of [[0,expectedDeployer,'0.005'],[1,POSTER,'0.01'],[2,VALIDATOR,'0.005']])check(actions[i].tx.to===to&&actions[i].tx.value===parseEther(amount)&&actions[i].tx.data==='0x');
 check(actions[3].tx.to===TOKEN&&actions[3].tx.value===0n&&actions[3].tx.data===abi.encodeFunctionData('transfer',[VALIDATOR,parseEther('100000')]));
 check(totalValue===parseEther('0.02')&&totalFee<=parseEther('0.0001'));
 check(totalFee===BigInt(plan.totals.maxGasFeeWei)&&totalValue===BigInt(plan.totals.ETHSentToOperatorsWei)&&totalFee+totalValue===BigInt(plan.totals.maxColdETHDebitWei));
 check(plan.totals.GH0STSentToValidatorUnits===parseEther('100000').toString());
 const delegated=typeof plan.delegatedPlanJSON==='string'?JSON.parse(plan.delegatedPlanJSON):plan.delegatedPlan;
 check(delegated&&delegated.actions.length===27&&/^([a-f0-9]{64})$/.test(plan.delegatedPlanSHA256));
 let delegatedFee=0n;
 for(const [i,a] of delegated.actions.entries()){
  const t=Transaction.from(a.unsignedSerialized),q=a.transaction;
  check(q.type===2&&q.chainId===4663&&q.nonce===t.nonce&&q.to?.toLowerCase()===t.to?.toLowerCase()&&q.data.toLowerCase()===t.data.toLowerCase()&&BigInt(q.value)===t.value&&BigInt(q.gasLimit)===t.gasLimit&&BigInt(q.maxFeePerGas)===t.maxFeePerGas&&BigInt(q.maxPriorityFeePerGas)===t.maxPriorityFeePerGas);
  check(a.from===expectedDeployer&&t.signature===null&&t.type===2&&t.chainId===4663n&&t.nonce===i&&t.unsignedHash===a.unsignedHash&&t.value===0n);
  check(t.gasLimit>0n&&t.gasLimit<=30000000n&&t.maxFeePerGas>0n&&t.maxPriorityFeePerGas<=t.maxFeePerGas);
  if(i<26)check(t.to===CREATE2&&a.kind==='constructor');
  else check(a.kind==='rollup-creation'&&a.postconditions.minimumAssertionPeriod===0&&a.postconditions.fastConfirmer===VALIDATOR&&a.postconditions.upgradeExecutorExecutor===OWNER);
  delegatedFee+=t.gasLimit*t.maxFeePerGas;
 }
 check(delegatedFee<=parseEther('0.005'));
 return {actions,totalFee,totalValue,delegatedFee};
}
