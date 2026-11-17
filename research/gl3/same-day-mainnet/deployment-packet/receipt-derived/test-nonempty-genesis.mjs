// Runpod-only regression on actual audited nonempty-genesis observations.
import fs from 'node:fs';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{assertGenesisAudit}from'./verify-deployment-audit27.mjs';
const B='/workspace/gl3/same-day-mainnet/deployment-packet/receipt-derived',I='/workspace/gl3/same-day-mainnet/deployment-packet/isolated-deployer';
const load=p=>JSON.parse(fs.readFileSync(p)),sha=b=>createHash('sha256').update(b).digest('hex');
const r=load(B+'/verify27-corrected-result.json');assert(r.passed===true&&r.actionIndex===27&&r.constructorRuntimeAndAuthorityChecks.length===26);
const a=r.deployed.genesisAudit,c=load(I+'/unsigned-deployment-plan.json').createRollup.derivedCandidateParams.config;
const args=()=>[structuredClone(c),{...structuredClone(a.event),assertion:{afterState:structuredClone(a.event.afterState)}},a.computedAssertionHash,a.latestConfirmed,structuredClone(a.storedAssertion),a.expectedConfigHash,a.eventLookupBlock,a.receiptBlock];
const cases=[];const pass=(n,f)=>{f();cases.push({name:n,passed:true})};
pass('actual_nonempty_genesis_event_computed_and_stored_confirmed_state',()=>assert.equal(assertGenesisAudit(...args()),true));
pass('documented_empty_helper_is_distinct_from_actual_genesis',()=>assert.notEqual(a.emptyGenesisConvenienceHash,a.event.assertionHash));
const zero='0x'+'00'.repeat(32),one='0x'+'01'.repeat(32);
for(const [name,change,reason]of[
 ['altered_block_hash',x=>x[1].assertion.afterState.globalState.bytes32Vals[0]=zero,'genesis_full_after_state_mismatch'],
 ['altered_send_root',x=>x[1].assertion.afterState.globalState.bytes32Vals[1]=one,'genesis_full_after_state_mismatch'],
 ['altered_batch_cursor',x=>x[1].assertion.afterState.globalState.u64Vals[0]='2','genesis_full_after_state_mismatch'],
 ['altered_position',x=>x[1].assertion.afterState.globalState.u64Vals[1]='1','genesis_full_after_state_mismatch'],
 ['altered_machine_status',x=>x[1].assertion.afterState.machineStatus='0','genesis_full_after_state_mismatch'],
 ['altered_history_root',x=>x[1].assertion.afterState.endHistoryRoot=one,'genesis_full_after_state_mismatch'],
 ['altered_parent_hash',x=>x[1].parentAssertionHash=one,'genesis_parent_or_inbox_acc_mismatch'],
 ['altered_inbox_accumulator',x=>x[1].afterInboxBatchAcc=one,'genesis_parent_or_inbox_acc_mismatch'],
 ['altered_event_assertion_hash',x=>x[1].assertionHash=one,'genesis_computed_assertion_hash_mismatch'],
 ['altered_computed_hash',x=>x[2]=one,'genesis_computed_assertion_hash_mismatch'],
 ['altered_latest_confirmed',x=>x[3]=one,'genesis_latest_confirmed_mismatch'],
 ['pending_assertion_status',x=>x[4].status='1','genesis_assertion_node_not_initial_confirmed'],
 ['altered_stored_config_hash',x=>x[4].configHash=zero,'genesis_assertion_config_hash_mismatch'],
 ['altered_lookup_block',x=>x[6]=String(BigInt(x[6])+1n),'genesis_event_lookup_block_mismatch'],
])pass(name,()=>{const x=args();change(x);assert.throws(()=>assertGenesisAudit(...x),e=>e.message===reason)});
const out={schema:'gh0st.gl3.nonempty-genesis-regressions.v1',passed:true,cases,actualAuditResultSHA256:sha(fs.readFileSync(B+'/verify27-corrected-result.json')),correctedVerifierSHA256:sha(fs.readFileSync(B+'/verify-deployment-audit27.mjs')),testSourceSHA256:sha(fs.readFileSync(new URL(import.meta.url))),frozenFailureSHA256:sha(fs.readFileSync(B+'/verify27-diagnostic-result.json')),sourceSemantics:{contractsCommit:'4341b132cfbdcc980ead03765ca5224ff6cb5d97',emptyConvenienceHelper:'src/rollup/RollupCore.sol:579-597',suppliedGenesisInitialization:'src/rollup/RollupAdminLogic.sol:71-122',actualHashFunction:'src/rollup/RollupUserLogic.sol:151-156'},RPCRequests:0,transactionsSubmitted:0};
fs.writeFileSync(B+'/nonempty-genesis-test-result.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:true,namedCases:cases.length,actualGenesis:a.event.assertionHash,emptyConvenience:a.emptyGenesisConvenienceHash}));
