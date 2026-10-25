// Evidence-dependent accounting tests; run after restoring the raw evidence package.
import assert from 'node:assert/strict';
import { estimateEconomy } from '../scripts/estimate-economy-costs.mjs';

const report = estimateEconomy();
assert.equal(report.computeGas, '7787263841');
assert.equal(report.computeActions, 633);
assert.equal(report.exactComputePostingWei, '4132224041145');
assert.equal(report.publicDestinationDeliveryVerified, false);
assert.equal(report.managedExecutorSupportsRoute, false);
for (const row of report.cases) {
  const chains = row.chains;
  assert.equal(chains.find(c => c.chainId === 4663).modelComputeUsd, 0);
  for (const id of [56, 5042, 143]) assert.equal(chains.find(c => c.chainId === id).totalJobUsd, 0);
  assert(Math.abs(row.totalJobUsd - chains.reduce((n, c) => n + c.totalJobUsd, 0)) < 1e-12);
  assert.equal(row.perOutputTokenUsd, row.totalJobUsd / 2);
  assert(row.perOutputIncludingSessionExecutionUsd > row.perOutputTokenUsd);
}
const unbuffered = estimateEconomy({ deliveryGasPerChain: 0n, rhPostingUsd: 0, otherPostingUsd: 0 });
assert(unbuffered.cases[0].totalJobUsd < report.cases[0].totalJobUsd);
assert.equal(unbuffered.cases[0].computeAndExactModelPostingUsd, report.cases[0].computeAndExactModelPostingUsd);
assert.equal(report.cases[0].chains[0].dvnQuoteUsd, report.cases[1].chains[0].dvnQuoteUsd);
assert.equal(report.cases[0].chains[1].dvnQuoteUsd, report.cases[1].chains[1].dvnQuoteUsd);
assert(report.cases[0].perOutputTokenUsd > report.cases[1].perOutputTokenUsd);
console.log('PASS_ECONOMY_COST_RECONCILIATION_AND_ALLOWANCE_SENSITIVITY');
