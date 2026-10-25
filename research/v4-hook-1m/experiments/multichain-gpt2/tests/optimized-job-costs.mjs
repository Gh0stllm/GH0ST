// Independent reconciliation of completed whole-model job evidence; no RPC or model execution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { confinedOutput, json, sha256 } from '../scripts/build.mjs';

const args = process.argv.slice(2);
assert(args.length === 1 && args[0].startsWith('--report='));
const directory = confinedOutput(args[0].slice(9));
const rawReport = fs.readFileSync(path.join(directory, 'results.json'));
const rawLedger = fs.readFileSync(path.join(directory, 'transactions.jsonl'));
const report = JSON.parse(rawReport), entries = rawLedger.toString().trim().split('\n').map(JSON.parse);
assert.equal(report.status, 'PASS_WHOLE_MODEL_JOB_LOCAL_BENCHMARK');
assert.equal(report.chain_count, 2); assert.equal(report.stages.length, 2);
assert.equal(report.public_transactions_submitted, 0);
assert.equal(report.home_has_model_weights, false);
assert.equal(report.weight_data_injected, false); assert.equal(report.host_inference_results_injected, false);
assert.equal(report.stages[0].chain_id, 4663); assert.deepEqual(report.stages[0].tensors, []);
assert.deepEqual(report.stages[1].tensors, Array.from({ length: 77 }, (_, i) => i));
assert.equal(report.stages[1].first, 0); assert.equal(report.stages[1].end, 12);
assert.equal(report.stages[1].embedding, true); assert.equal(report.stages[1].output, true);
assert.equal(report.partition.model_copies, 1); assert.equal(report.model.duplicate_tensor_bytes, 0);
assert.equal(report.deployments.filter(item => item.kind === 'weight_shard').length, report.partition.weightContracts);
assert.equal(report.deployments.filter(item => ['tensor_catalog_page', 'tensor_catalog', 'root_catalog'].includes(item.kind)).length,
  report.partition.catalogContracts);
assert.equal(report.deployments.filter(item => item.kind === 'job_router').length, 2);
assert.equal(report.deployments.filter(item => item.kind === 'real_model_engine').length, 1);
assert.deepEqual(report.generated_token_ids, report.tokens.map(token => token.output_token));
assert.equal(report.tokens.length, report.requested_token_positions);
assert.equal(report.job.messages.length, 2);
assert.deepEqual(report.job.messages.map(message => message.kind), ['request', 'result']);
assert.equal(report.job.messages[0].source, 0); assert.equal(report.job.messages[0].destination, 1);
assert.equal(report.job.messages[1].source, 1); assert.equal(report.job.messages[1].destination, 0);
assert(report.validations.every(validation => validation.passed));

const makeTotals = () => ({ gas: 0n, billed_gas: 0n, transactions: 0, calldata_bytes: 0, by_category: {} });
const accumulate = (target, entry) => {
  const gas = BigInt(entry.gas), billed = BigInt(entry.billed_gas_scenario);
  target.gas += gas; target.billed_gas += billed; target.transactions++; target.calldata_bytes += entry.calldata_bytes;
  const category = target.by_category[entry.category] ??= { gas: 0n, billed_gas: 0n, transactions: 0, calldata_bytes: 0 };
  category.gas += gas; category.billed_gas += billed; category.transactions++; category.calldata_bytes += entry.calldata_bytes;
};
const stages = report.stages.map(stage => ({ stage: stage.stage, name: stage.name, chain_id: stage.chain_id, profile: stage.profile, ...makeTotals() }));
const all = makeTotals(), inference = makeTotals(), realDeployment = makeTotals(), seen = new Set(), byHash = new Map();
const mockDeploymentHashes = new Set(report.deployments.filter(deployment => deployment.kind === 'transport_mock')
  .map(deployment => deployment.transaction.toLowerCase()));
assert.equal(mockDeploymentHashes.size, 2);
let maximum = 0n, storedCalldata = 0;
for (const entry of entries) {
  const stage = stages[entry.stage];
  assert(stage); assert.equal(entry.chain_id, stage.chain_id);
  assert.equal(entry.status, '0x1'); assert.equal(entry.receipt.status, '0x1');
  const gas = BigInt(entry.gas), declared = BigInt(entry.declared_gas);
  assert.equal(gas, BigInt(entry.receipt.gasUsed));
  assert.equal(entry.hash.toLowerCase(), entry.receipt.transactionHash.toLowerCase());
  assert.equal(entry.gas_limit_verified_from_transaction, true);
  assert(gas > 0n && gas <= declared && declared <= BigInt(report.stages[entry.stage].maxTransactionGas));
  assert.equal(BigInt(entry.billed_gas_scenario), stage.profile === 'monad' ? declared : gas);
  assert(Number.isSafeInteger(entry.calldata_bytes) && entry.calldata_bytes >= 0);
  if (entry.calldata !== undefined) {
    assert.match(entry.calldata, /^0x(?:[0-9a-f]{2})*$/i);
    assert.equal((entry.calldata.length - 2) / 2, entry.calldata_bytes);
    assert.match(entry.nonce, /^0x[0-9a-f]+$/i); assert.match(entry.transaction_type, /^0x[0-9a-f]+$/i);
    assert.equal(entry.transaction_type, entry.receipt.type);
    assert.equal(entry.from.toLowerCase(), entry.receipt.from.toLowerCase());
    assert.equal(entry.to?.toLowerCase() ?? null, entry.receipt.to?.toLowerCase() ?? null);
    assert.notEqual(entry.category, 'deployment'); storedCalldata++;
  }
  // New opBNB runs require all non-deployment raw transaction fields for L1-fee reconstruction.
  if (stage.chain_id === 204 && entry.category !== 'deployment') assert.notEqual(entry.calldata, undefined);
  const key = entry.chain_id + ':' + entry.hash.toLowerCase(); assert(!seen.has(key)); seen.add(key);
  assert.equal(entry.index, stage.transactions + 1);
  accumulate(all, entry); accumulate(stage, entry); byHash.set(key, entry);
  if (!['deployment', 'route_setup'].includes(entry.category)) accumulate(inference, entry);
  if (entry.category === 'deployment' && !mockDeploymentHashes.has(entry.hash.toLowerCase())) accumulate(realDeployment, entry);
  if (gas > maximum) maximum = gas;
}
assert.equal(all.transactions, report.totals.transaction_count);
assert.equal(all.gas, BigInt(report.totals.all_measured_gas));
assert.equal(all.billed_gas, BigInt(report.totals.all_billed_gas_scenario));
for (const stage of stages) {
  assert.equal(stage.gas, BigInt(report.totals.gas_by_stage[stage.stage]));
  assert.equal(stage.billed_gas, BigInt(report.totals.billed_gas_by_stage[stage.stage]));
}
assert.deepEqual(Object.keys(all.by_category).sort(), Object.keys(report.totals.gas_by_category).sort());
for (const [category, total] of Object.entries(all.by_category)) assert.equal(total.gas, BigInt(report.totals.gas_by_category[category]));
let checkedAdvances = 0;
const checkedAdvanceHashes = new Set();
const positions = report.tokens.map((token, position) => {
  assert.equal(token.position, position); assert.equal(token.complete, true);
  assert.equal(token.input_token, position ? report.tokens[position - 1].output_token : report.job.prompt_token_ids[0]);
  assert.deepEqual(token.completed_layers, Array.from({ length: 12 }, (_, i) => i));
  assert.equal(token.verified_vocabulary_rows, 50257);
  assert.equal(token.reference_checks.length, 86);
  assert.equal(new Set(token.reference_checks.map(check => check.name)).size, 86);
  assert.equal(token.kv_checks.length, (position + 1) * 24);
  assert.equal(token.stages.length, 1); assert.equal(token.stages[0].stage, 1);
  const totals = { position, input_token: token.input_token, output_token: token.output_token, ...makeTotals() };
  for (const advance of token.stages[0].advances) {
    assert(!checkedAdvanceHashes.has(advance.transaction)); checkedAdvanceHashes.add(advance.transaction);
    const entry = byHash.get(report.stages[1].chain_id + ':' + advance.transaction.toLowerCase());
    assert(entry && entry.category === 'model_compute');
    assert.equal(BigInt(entry.gas), BigInt(advance.gas));
    accumulate(totals, entry); checkedAdvances++;
  }
  assert.equal(totals.gas, BigInt(token.model_gas));
  assert.equal(totals.gas, BigInt(token.stages[0].gas));
  assert.equal(totals.transactions, token.stages[0].transactions);
  return totals;
});
assert.equal(checkedAdvances, all.by_category.model_compute.transactions);
const summary = {
  status: 'PASS_WHOLE_MODEL_JOB_RECEIPT_RECONCILIATION', name: report.layout.name, engine: report.engine_artifact,
  compute_chain: report.compute_chain ?? 'monad', compute_chain_id: report.stages[1].chain_id,
  report_sha256: sha256(rawReport), ledger_sha256: sha256(rawLedger), public_transactions_submitted: 0,
  scope: 'Local receipts and real model checks. External prices, production transport quotes and L1 posting fees are separate evidence.',
  billing: 'Native Monad uses declared gas; Ethereum profiles use receipt gas. All local transaction gas prices are zero.',
  position_scope: 'Positions contain model-compute receipts only. Whole-job inference also includes control/begin and simulated transport receipts.',
  maximum_receipt_gas: maximum, nondeployment_transactions_with_calldata: storedCalldata,
  all, inference, initial_deployment_excluding_mock_endpoints: realDeployment, stages, positions,
  validation_counts: { phase_vectors: report.tokens.reduce((sum, token) => sum + token.reference_checks.length, 0),
    full_vocabulary_logits: report.tokens.reduce((sum, token) => sum + token.verified_vocabulary_rows, 0),
    persistent_kv_arrays: report.tokens.reduce((sum, token) => sum + token.kv_checks.length, 0), interchain_messages: 2 },
};
fs.writeFileSync(path.join(directory, 'cost-summary.json'), json(summary));
console.log(json({ status: summary.status, name: summary.name, total_receipts: all.transactions,
  inference_gas: inference.gas, inference_billed_gas: inference.billed_gas,
  model_positions: positions.map(position => ({ position: position.position, gas: position.gas, billed_gas: position.billed_gas })),
  validation_counts: summary.validation_counts }));
