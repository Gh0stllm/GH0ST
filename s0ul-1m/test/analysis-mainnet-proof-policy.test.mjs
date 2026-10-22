import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Interface} from 'ethers';
import {assessManualReceiptHistory,canonicalManualReceiptCredit,MANUAL_MAX_REIMBURSEMENT_SHORTFALL_BPS,MANUAL_MAX_TOTAL_NETWORK_FEE_WEI} from '../scripts/analysis-mainnet-proof.mjs';
const owner='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
const executor='0x150e7F441bF5218d00716aD3B25a72D6e22423B5';
const abi=JSON.parse(fs.readFileSync(new URL('../reports/analysis-build/S0ULAnalysisExecutor.json',import.meta.url))).abi;
const ex={target:executor,interface:new Interface(abi)};
const paid=(overrides={})=>({hash:'receipt1',method:'advance',jobId:'1',state:'confirmed',feeWei:'147784478736000',creditedWei:'147780517968000',...overrides});
const log=(jobId=1n,worker=owner,amount=147780517968000n,address=executor)=>({address,...ex.interface.encodeEventLog(ex.interface.getEvent('RewardCredited'),[jobId,worker,amount,7312971n,1n])});
const advance={method:'advance',jobId:'1',data:ex.interface.encodeFunctionData('advance',[1n,128n,4n]),valueWei:'0'};
test('actual mainnet196gas shortfall is explicit tolerated cost, not hidden profit',()=>{
 const p=assessManualReceiptHistory([paid()]);
 assert.equal(MANUAL_MAX_REIMBURSEMENT_SHORTFALL_BPS,5);assert.equal(p.allowed,true);
 assert.equal(p.actualPaidReimbursementShortfallWei,3960768000n);assert.equal(p.toleratedPaidReimbursementShortfallWei,3960768000n);
 assert.equal(p.actualPaidReimbursementShortfallWei/20208000n,196n);assert.equal(p.paidShortfallReceiptCount,1);assert.equal(p.profitabilityClaimed,false);
 assert.equal(p.toleratedPaidShortfallUpperBoundWei,250000000000000n);
});
test('historical positive-credit receipt exactly at floor bound passes and one wei above fails',()=>{
 assert.equal(assessManualReceiptHistory([paid({feeWei:'20001',creditedWei:'19991'})]).allowed,true);
 assert.equal(assessManualReceiptHistory([paid({feeWei:'20001',creditedWei:'19990'})]).allowed,false);
});
test('zero-credit and reverted historical paid receipts cannot continue',()=>{
 assert.equal(assessManualReceiptHistory([paid({feeWei:'1',creditedWei:'0'})]).allowed,false);
 assert.equal(assessManualReceiptHistory([paid({state:'reverted',creditedWei:'200000000000000'})]).allowed,false);
});
test('cumulative0.5ETH actual fee policy includes owner opening and withdrawal costs',()=>{
 const records=[{method:'open',feeWei:'100'},{method:'withdraw',feeWei:'200'},paid({feeWei:String(MANUAL_MAX_TOTAL_NETWORK_FEE_WEI-300n),creditedWei:String(MANUAL_MAX_TOTAL_NETWORK_FEE_WEI-300n)})];
 let p=assessManualReceiptHistory(records);assert.equal(p.allowed,true);assert.equal(p.ownerAndWithdrawalOperatingFeeWei,300n);
 p=assessManualReceiptHistory([...records,{method:'withdraw',feeWei:'1'}]);assert.equal(p.allowed,false);assert.equal(p.feeBudgetExceeded,true);
});
test('positive over-reimbursement never offsets another receipt shortfall',()=>{
 const p=assessManualReceiptHistory([paid(),paid({hash:'receipt2',feeWei:'10',creditedWei:'1000000000000000'})]);
 assert.equal(p.actualPaidReimbursementShortfallWei,3960768000n);assert.equal(p.toleratedPaidReimbursementShortfallWei,3960768000n);
});
test('canonical executor reward is bound to signed method/job/worker/emitter',()=>{
 assert.equal(canonicalManualReceiptCredit(ex,{logs:[log()]},advance),147780517968000n);
 assert.equal(canonicalManualReceiptCredit(ex,{logs:[log(1n,'0x0000000000000000000000000000000000000001'),log(1n,owner,10n,'0x0000000000000000000000000000000000000002')]},advance),0n);
 assert.throws(()=>canonicalManualReceiptCredit(ex,{logs:[log(2n)]},advance),/not for this paid job/);
});
test('edited saved method or job cannot disguise a paid receipt as withdrawal',()=>{
 assert.throws(()=>canonicalManualReceiptCredit(ex,{logs:[]},{...advance,method:'withdraw'}),/method differs/);
 assert.throws(()=>canonicalManualReceiptCredit(ex,{logs:[]},{...advance,jobId:'2'}),/different job/);
});
