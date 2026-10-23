import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as ethers from 'ethers';
import {assertFresh,submitAction,ethUsd,checkedReceipt,verifyMint} from '../../scripts/provide-liquidity.mjs';
import '../../deployment/liquidity-plan.js';
const L=globalThis.GH0STLiquidity,C=L.CONSTANTS;
const key=new ethers.Wallet('0x'+'12'.repeat(32)); // Synthetic test key only; never used on any network.
const source=337195094064817369351858984726692n;
const plan=L.buildPlan({wallet:C.wallet,initialized:false,quoteSqrtPriceX96:source,ethUsd:'2398.48',blockTimestamp:1000},ethers);
const quote=()=>({quotedAt:1000000,block:{timestamp:1001},source:{sqrtPriceX96:source},pool:{initialized:false},plan});
test('freshness rejects expired quote, changed initialization and moved prices',()=>{
 assert.doesNotThrow(()=>assertFresh(plan,quote(),1001000));
 assert.throws(()=>assertFresh(plan,quote(),1120001),/expired/);
 assert.throws(()=>assertFresh(plan,{...quote(),pool:{initialized:true,sqrtPriceX96:source}},1001000),/initialization changed/);
 assert.throws(()=>assertFresh(plan,{...quote(),source:{sqrtPriceX96:source*2n}},1001000),/price moved/);
 const higher={...plan,prices:{eth_usd:{decimal:'2500'}}};
 assert.throws(()=>assertFresh(plan,{...quote(),plan:higher},1001000),/ETH\/USD moved/);
});
test('Coinbase quote validates currency and rejects failed HTTP',async()=>{
 assert.equal(await ethUsd(async()=>({ok:true,json:async()=>({data:{base:'ETH',currency:'USD',amount:'2398.48'}})})),'2398.48');
 await assert.rejects(ethUsd(async()=>({ok:false})),/request failed/);
 await assert.rejects(ethUsd(async()=>({ok:true,json:async()=>({data:{base:'BTC',currency:'USD',amount:'2398.48'}})})));
});
function submission({revert=false,pending=false,broadcastError=false}={}){
 const action={kind:'approve_token_exact_cap',to:C.currency1,data:'0x095ea7b3',value:'0'},state={transactions:[]},events=[];
 let signed;
 const signer={estimateGas:async()=>100000n,populateTransaction:async req=>{assert.equal(req.gasLimit,150000n);assert.equal(req.nonce,6210);return req;},signTransaction:async req=>{signed=await key.signTransaction({...req,from:undefined,gasPrice:1n});return signed;}};
 const receipt={hash:null,status:revert?0:1,blockNumber:100};
 const provider={getFeeData:async()=>({gasPrice:1n}),getBalance:async()=>10n**18n,
  broadcastTransaction:async raw=>{events.push('broadcast');assert.equal(raw,signed);assert.equal(state.transactions[0].hash,ethers.keccak256(raw));if(broadcastError)throw Error('nonce has already been used');},
  getTransactionReceipt:async hash=>pending?null:{...receipt,hash},
  getTransaction:async()=>({from:C.wallet,to:action.to,data:action.data,value:0n}),waitForTransaction:async()=>{}};
 const save=()=>events.push('save');return {provider,signer,action,nonce:6210,state,save,events};
}
test('signed hash is persisted before broadcast and accepted nonce-error is reconciled',async()=>{
 const x=submission({broadcastError:true});await submitAction(x);assert.deepEqual(x.events,['save','broadcast','save']);assert.equal(x.state.transactions[0].status,'confirmed');assert.equal(x.state.transactions[0].nonce,6210);
});
test('uncertain broadcast keeps exact hash and does not broadcast again',async()=>{
 const x=submission({pending:true,broadcastError:true});await assert.rejects(submitAction(x),/Submission unresolved/);assert.equal(x.state.transactions[0].status,'pending');assert.equal(x.events.filter(e=>e==='broadcast').length,1);
});
test('confirmed revert is never counted as a successful action',async()=>{
 const x=submission({revert:true});await assert.rejects(submitAction(x),/reverted/);assert.notEqual(x.state.transactions[0].status,'confirmed');
});
test('receipt identity mismatch is rejected',async()=>{
 await assert.rejects(checkedReceipt({getTransactionReceipt:async()=>({status:1}),getTransaction:async()=>({from:ethers.ZeroAddress,to:C.currency1,data:'0x',value:0n})},{hash:'0x123',to:C.currency1,data:'0x',value:'0'}),/differs/);
});
test('entry module has no automatic broadcast and default command is read-only',()=>{
 const source=readFileSync(new URL('../../scripts/provide-liquidity.mjs',import.meta.url),'utf8');
 assert(source.indexOf("if(!args.includes('--broadcast'))return;")<source.indexOf('let key=await hiddenKey()'));
 assert.match(source,/Type ADD LIQUIDITY/);assert.match(source,/loadReviewedPlan/);assert.match(source,/verifyMint/);
});
