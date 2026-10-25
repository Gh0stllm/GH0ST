// Independent cost reconciliation from paid transaction receipts, not simulation estimates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { confinedOutput, json, sha256 } from '../scripts/build.mjs';

const args = process.argv.slice(2);
assert(args.length <= 1 && args.every(arg => arg.startsWith('--report=')), 'Use --report=reports/local-full-verified');
const directory = confinedOutput(args[0]?.slice(9) ?? 'reports/local-full-verified');
const reportBytes = fs.readFileSync(path.join(directory, 'results.json'));
const report = JSON.parse(reportBytes);
assert.equal(report.status, 'PASS_FOUR_CHAIN_FULL_MODEL_LOCAL_BENCHMARK');
const ledgerBytes = fs.readFileSync(path.join(directory, 'transactions.jsonl'));
const entries = ledgerBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
const stages = report.stages.map(stage => ({ stage: stage.stage, name: stage.name, chain_id: stage.chain_id,
  deployment_gas: 0n, setup_gas: 0n, total_gas: 0n, transactions: 0 }));
const positions = report.tokens.map(token => ({ position: token.position, input_token: token.input_token, output_token: token.output_token,
  total_gas: 0n, model_compute_gas: 0n, transactions: 0, by_stage: stages.map(stage => ({ stage: stage.stage, name: stage.name, gas: 0n, model_compute_gas: 0n, transactions: 0 })) }));
const categories = {}, seenHashes = new Set();
let position = -1, total = 0n, maximum = 0n;
for (const entry of entries) {
  assert.equal(entry.status, '0x1', 'Every full benchmark transaction must succeed');
  assert.equal(entry.receipt.status, '0x1');
  const gas = BigInt(entry.gas), stage = stages[entry.stage];
  assert.equal(gas, BigInt(entry.receipt.gasUsed), 'Receipt gas mismatch');
  assert.equal(entry.hash.toLowerCase(), entry.receipt.transactionHash.toLowerCase());
  assert(gas <= BigInt(report.transaction_gas_ceiling));
  const identity = entry.chain_id + ':' + entry.hash;
  assert(!seenHashes.has(identity)); seenHashes.add(identity);
  assert.equal(entry.index, stage.transactions + 1, 'Missing or repeated transaction index');
  stage.transactions++; stage.total_gas += gas; total += gas; if (gas > maximum) maximum = gas;
  categories[entry.category] = (categories[entry.category] ?? 0n) + gas;
  if (entry.category === 'deployment') stage.deployment_gas += gas;
  else if (entry.category === 'route_setup') stage.setup_gas += gas;
  else {
    if (entry.purpose === 'beginToken') position++;
    assert(position >= 0 && position < positions.length, 'Inference receipt outside a token interval');
    const token = positions[position], stageToken = token.by_stage[entry.stage];
    token.total_gas += gas; token.transactions++; stageToken.gas += gas; stageToken.transactions++;
    if (entry.category === 'model_compute') { token.model_compute_gas += gas; stageToken.model_compute_gas += gas; }
  }
}
assert.equal(entries.length, report.totals.transaction_count);
assert.equal(total, BigInt(report.totals.all_measured_gas));
for (const token of positions) {
  assert.equal(token.model_compute_gas, BigInt(report.tokens[token.position].model_gas));
  for (const stage of token.by_stage) assert.equal(stage.model_compute_gas, BigInt(report.tokens[token.position].stages[stage.stage].gas));
}
const summary = { status: 'PASS_INDEPENDENT_RECEIPT_RECONCILIATION', report_sha256: sha256(reportBytes), ledger_sha256: sha256(ledgerBytes),
  scope: 'Local gas units only. Generic Cancun EVMs, simulated transport, zero test gas prices. Live monetary fees are not measured.',
  public_transactions_submitted: 0, deployment_gas: categories.deployment, route_setup_gas: categories.route_setup,
  all_receipt_gas: total, maximum_receipt_gas: maximum, receipt_count: entries.length, gas_by_category: categories, stages, positions };
fs.writeFileSync(path.join(directory, 'cost-summary.json'), json(summary));
console.log(json(summary));
