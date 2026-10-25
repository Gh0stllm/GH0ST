// Reconcile optimized/native-profile receipts, declared gas billing, and raw calldata sizes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { confinedOutput, json, sha256 } from '../scripts/build.mjs';

const args = process.argv.slice(2);
assert(args.length === 1 && args[0].startsWith('--report='));
const directory = confinedOutput(args[0].slice(9));
const rawReport = fs.readFileSync(path.join(directory, 'results.json')), report = JSON.parse(rawReport);
assert.equal(report.status, 'PASS_OPTIMIZED_FOUR_CHAIN_FULL_MODEL_LOCAL_BENCHMARK');
const rawLedger = fs.readFileSync(path.join(directory, 'transactions.jsonl'));
const receipts = rawLedger.toString().trim().split('\n').map(JSON.parse);
const makeTotals = () => ({ gas: 0n, billed_gas: 0n, transactions: 0, calldata_bytes: 0, by_category: {} });
const accumulate = (target, entry, gas, billed) => {
  target.gas += gas; target.billed_gas += billed; target.transactions++; target.calldata_bytes += entry.calldata_bytes;
  const category = target.by_category[entry.category] ??= { gas: 0n, billed_gas: 0n, transactions: 0, calldata_bytes: 0 };
  category.gas += gas; category.billed_gas += billed; category.transactions++; category.calldata_bytes += entry.calldata_bytes;
};
const stages = report.stages.map(stage => ({ stage: stage.stage, name: stage.name, chain_id: stage.chain_id, profile: stage.profile, ...makeTotals() }));
const positions = report.tokens.map(token => ({ position: token.position, input_token: token.input_token, output_token: token.output_token,
  ...makeTotals(), by_stage: stages.map(stage => ({ stage: stage.stage, name: stage.name, chain_id: stage.chain_id, profile: stage.profile, ...makeTotals() })) }));
const all = makeTotals(), seen = new Set(); let current = -1, maximum = 0n;
for (const entry of receipts) {
  assert.equal(entry.status, '0x1'); assert.equal(entry.receipt.status, '0x1');
  const gas = BigInt(entry.gas), declared = BigInt(entry.declared_gas), stage = stages[entry.stage];
  assert.equal(gas, BigInt(entry.receipt.gasUsed)); assert.equal(entry.hash.toLowerCase(), entry.receipt.transactionHash.toLowerCase());
  assert.equal(entry.gas_limit_verified_from_transaction, true);
  assert(declared <= BigInt(report.stages[entry.stage].maxTransactionGas) && gas <= declared);
  assert(Number.isSafeInteger(entry.calldata_bytes) && entry.calldata_bytes >= 0);
  const billed = stage.profile === 'monad' ? declared : gas;
  assert.equal(billed, BigInt(entry.billed_gas_scenario));
  const key = entry.chain_id + ':' + entry.hash; assert(!seen.has(key)); seen.add(key);
  assert.equal(entry.index, stage.transactions + 1);
  accumulate(all, entry, gas, billed); accumulate(stage, entry, gas, billed);
  if (gas > maximum) maximum = gas;
  if (!['deployment', 'route_setup'].includes(entry.category)) {
    if (entry.purpose === 'beginToken') current++;
    assert(current >= 0 && current < positions.length);
    accumulate(positions[current], entry, gas, billed); accumulate(positions[current].by_stage[entry.stage], entry, gas, billed);
  }
}
assert.equal(receipts.length, report.totals.transaction_count); assert.equal(all.gas, BigInt(report.totals.all_measured_gas));
assert.equal(all.billed_gas, BigInt(report.totals.all_billed_gas_scenario));
for (const position of positions) {
  assert.equal(position.by_category.model_compute.gas, BigInt(report.tokens[position.position].model_gas));
  for (const stage of position.by_stage) assert.equal(stage.by_category.model_compute.gas, BigInt(report.tokens[position.position].stages[stage.stage].gas));
}
const summary = { status: 'PASS_NATIVE_PROFILE_RECEIPT_RECONCILIATION', name: report.layout.name, engine: report.engine_artifact,
  report_sha256: sha256(rawReport), ledger_sha256: sha256(rawLedger), public_transactions_submitted: 0,
  scope: 'Locally measured execution gas plus declared-limit Monad billing scenario. External price/transport snapshots are required for USD estimates.',
  calldata_scope: 'Raw transaction byte counts, including deployment; no compression or L1 posting cost is inferred.',
  maximum_receipt_gas: maximum, all, stages, positions };
fs.writeFileSync(path.join(directory, 'cost-summary.json'), json(summary));
console.log(json({ status: summary.status, name: summary.name, engine: summary.engine, total_receipts: all.transactions,
  positions: positions.map(position => ({ position: position.position, gas: position.gas, billed_gas: position.billed_gas,
    stages: position.by_stage.map(stage => ({ name: stage.name, gas: stage.gas, billed_gas: stage.billed_gas, calldata_bytes: stage.calldata_bytes })) })) }));
