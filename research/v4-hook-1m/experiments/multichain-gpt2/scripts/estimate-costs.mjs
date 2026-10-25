// Offline, receipt-backed fee scenarios. Never sends RPC requests or transactions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HERE, json, sha256 } from './build.mjs';

const args = process.argv.slice(2);
assert(args.every(arg => /^--(?:baseline|optimized|fees|out|markdown)=/.test(arg)), 'Unknown option');
const option = (name, fallback) => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const filename = value => {
  const resolved = path.resolve(HERE, value);
  assert(resolved.startsWith(HERE + path.sep), 'Inputs and output must remain inside this project');
  return resolved;
};
const feeFile = filename(option('fees', 'research/fee-snapshot.json'));
const fees = JSON.parse(fs.readFileSync(feeFile));
const byId = new Map(fees.chains.map(chain => [chain.chainId, chain]));
assert.equal(byId.size, 4);
for (const chain of byId.values()) {
  const recomputed = Number(chain.gasPriceWei) * Number(chain.nativeUsd) / (10 ** chain.nativeDecimals);
  assert(Math.abs(recomputed - Number(chain.nominalUsdPerNativeGas)) <= recomputed * 1e-12, 'Fee units do not reconcile');
}
const usd = (gas, chain) => Number(gas) * Number(chain.nominalUsdPerNativeGas);
const modelCategories = new Set(['model_compute', 'activation_import_and_begin']);

function reconcile(directory) {
  const reportFile = path.join(directory, 'results.json');
  const ledgerFile = path.join(directory, 'transactions.jsonl');
  const reportBytes = fs.readFileSync(reportFile), ledgerBytes = fs.readFileSync(ledgerFile);
  const report = JSON.parse(reportBytes);
  assert.equal(report.status, 'PASS_OPTIMIZED_FOUR_CHAIN_FULL_MODEL_LOCAL_BENCHMARK', 'Only a complete successful full-model run can be priced');
  assert.equal(report.public_transactions_submitted, 0);
  assert.equal(report.weight_data_injected, false);
  assert.equal(report.host_inference_results_injected, false);
  assert.deepEqual(report.generated_token_ids, [198, 464]);
  const ledger = ledgerBytes.toString().trim().split('\n').map(line => JSON.parse(line));
  assert.equal(ledger.length, report.totals.transaction_count);
  const sums = {}, sumsBilled = {}, positions = new Map(), deployments = new Map(), hashes = new Set();
  let position = -1, allGas = 0n;
  for (const entry of ledger) {
    const stage = report.stages[entry.stage], chain = byId.get(entry.chain_id);
    assert(stage && chain && stage.chain_id === entry.chain_id);
    assert.equal(entry.status, '0x1');
    assert(!hashes.has(entry.chain_id + ':' + entry.hash), 'Duplicate receipt');
    hashes.add(entry.chain_id + ':' + entry.hash);
    const gas = BigInt(entry.gas), declared = BigInt(entry.declared_gas);
    assert(gas <= declared && declared <= BigInt(stage.maxTransactionGas));
    assert.equal(gas, BigInt(entry.receipt.gasUsed));
    const billed = stage.profile === 'monad' ? declared : gas;
    assert.equal(billed, BigInt(entry.billed_gas_scenario));
    sums[entry.stage] = (sums[entry.stage] ?? 0n) + gas;
    sumsBilled[entry.stage] = (sumsBilled[entry.stage] ?? 0n) + billed;
    allGas += gas;
    if (entry.category === 'activation_import_and_begin' && entry.stage === 0 && entry.purpose === 'beginToken') position++;
    if (entry.category === 'deployment' || entry.category === 'route_setup') {
      // The local transport mock is not part of a production deployment.
      if (entry.purpose === 'deploy MockEndpoint') continue;
      const row = deployments.get(entry.stage) ?? { chainId: entry.chain_id, key: chain.key, gas: 0n, billedGas: 0n, transactions: 0 };
      row.gas += gas; row.billedGas += billed; row.transactions++;
      deployments.set(entry.stage, row);
      continue;
    }
    assert(position >= 0 && position < report.tokens.length);
    if (!modelCategories.has(entry.category)) continue;
    const rows = positions.get(position) ?? new Map();
    const row = rows.get(entry.stage) ?? { stage: entry.stage, chainId: entry.chain_id, key: chain.key,
      profile: stage.profile, gas: 0n, declaredGas: 0n, billedGas: 0n, transactions: 0, calldataBytes: 0,
      firstLayer: stage.first, endLayer: stage.end, doesEmbedding: stage.embedding, doesOutput: stage.output };
    row.gas += gas; row.declaredGas += declared; row.billedGas += billed; row.transactions++;
    assert(Number.isSafeInteger(entry.calldata_bytes) && entry.calldata_bytes >= 0, 'Benchmark must retain calldata lengths');
    row.calldataBytes += entry.calldata_bytes;
    rows.set(entry.stage, row); positions.set(position, rows);
  }
  assert.equal(allGas, BigInt(report.totals.all_measured_gas));
  for (const [stage, total] of Object.entries(sums)) {
    assert.equal(total, BigInt(report.totals.gas_by_stage[stage]));
    assert.equal(sumsBilled[stage], BigInt(report.totals.billed_gas_by_stage[stage]));
  }
  for (const token of report.tokens) {
    assert.equal(token.complete, true);
    assert.equal(token.verified_vocabulary_rows, 50257);
    assert.equal(token.reference_checks.length, 86);
    assert.equal(token.kv_checks.length, (token.position + 1) * 24);
  }
  const pricedPositions = [...positions].map(([index, rows]) => {
    const chains = [...rows.values()].map(row => ({ ...row, modelAndImportUsd: usd(row.billedGas, byId.get(row.chainId)) }));
    const rh = chains.find(row => row.key === 'robinhood');
    const parent = byId.get(4663).arbGasInfoGetPricesInWei.decoded;
    // Explicit raw-calldata + 140-byte envelope scenario; not an exact Brotli-compressed posting quote.
    const rhRawBytes = rh.calldataBytes + rh.transactions * 140;
    const rhParentFeeWei = BigInt(rh.calldataBytes) * BigInt(parent.perL1CalldataByteWei)
      + BigInt(rh.transactions) * BigInt(parent.perL2TransactionWei);
    return { position: index, inputToken: report.tokens[index].input_token, outputToken: report.tokens[index].output_token,
      chains, modelAndImportUsd: chains.reduce((sum, row) => sum + row.modelAndImportUsd, 0),
      rhPostingScenario: { rawCalldataAndEnvelopeBytes: rhRawBytes, envelopeAssumptionBytesPerTransaction: 140,
        transactionEnvelopePricing: 'perL2TransactionWei already includes the fixed transaction envelope; no second envelope fee',
        nativeWei: String(rhParentFeeWei), usd: Number(rhParentFeeWei) / 1e18 * Number(byId.get(4663).nativeUsd),
        status: 'RAW_BYTE_SCENARIO_NOT_COMPRESSED_POSTING_QUOTE' } };
  });
  return { directory: path.relative(HERE, directory), reportSha256: sha256(reportBytes), ledgerSha256: sha256(ledgerBytes),
    compiler: report.compiler, routeId: report.route_id, engine: report.engine_artifact,
    totalVerifiedReceipts: ledger.length, positions: pricedPositions,
    initialDeployment: [...deployments.entries()].sort(([a], [b]) => a - b).map(([, row]) => ({ ...row, usd: usd(row.billedGas, byId.get(row.chainId)) })) };
}

const baseline = reconcile(filename(option('baseline', 'reports/baseline-native-full')));
const optimized = reconcile(filename(option('optimized', 'reports/optimized-native-full')));
assert.equal(baseline.positions.length, optimized.positions.length);
const quotes = fees.messaging.componentQuotes;
assert.equal(quotes.length, 4);
const route = [4663, 56, 5042, 143];
const messagingByChain = quotes.map((quote, i) => {
  assert.equal(quote.status, 'PROVIDER_COMPONENT_QUOTES_SUCCESS_NOT_OAPP_QUOTE');
  assert.equal(quote.sourceChainId, route[i]);
  assert.equal(quote.destination, byId.get(route[(i + 1) % route.length]).key);
  assert.equal(quote.payloadBytes, i === route.length - 1 ? 416 : 3488);
  assert.equal(quote.receiveGas, 500000);
  const chain = byId.get(quote.sourceChainId);
  // User-adjustable conservative source-dispatch allocation, not measured LayerZero gas.
  const sourceDispatchGasAllowance = 16777216n;
  return { source: quote.source, destination: quote.destination,
    providerComponentUsd: Number(quote.componentSumNominalUsd),
    sourceDispatchGasAllowance, sourceDispatchUsdAllowance: usd(sourceDispatchGasAllowance, chain) };
});
const providerTotal = messagingByChain.reduce((n, row) => n + row.providerComponentUsd, 0);
const sourceTotal = messagingByChain.reduce((n, row) => n + row.sourceDispatchUsdAllowance, 0);
const result = {
  schemaVersion: 1, status: 'LOCAL_NATIVE_PROFILE_FEE_SCENARIO_NOT_PAID_MAINNET_COST',
  generatedAtUtc: new Date().toISOString(), feeSnapshotSha256: sha256(fs.readFileSync(feeFile)),
  feeSnapshotAtUtc: fees.captureCompletedAtUtc,
  unit: 'one processed token position; measured at context lengths one and two',
  baseline, optimized,
  comparison: optimized.positions.map((next, i) => ({ position: next.position,
    baselineModelAndImportUsd: baseline.positions[i].modelAndImportUsd, optimizedModelAndImportUsd: next.modelAndImportUsd,
    modelAndImportSavingsPercent: 100 * (1 - next.modelAndImportUsd / baseline.positions[i].modelAndImportUsd) })),
  messaging: { status: 'LIVE_PROVIDER_COMPONENTS_PLUS_EXPLICIT_SOURCE_EXECUTION_ALLOWANCE', byChain: messagingByChain,
    providerComponentUsd: providerTotal, sourceDispatchUsdAllowance: sourceTotal,
    treasuryFee: 'NOT_QUOTED', receiveGas: 'already included in executor quote; never added twice' },
  optimizedBudgetScenarios: optimized.positions.map(position => ({ position: position.position,
    chains: position.chains.map(row => {
      const overhead = messagingByChain.find(hop => hop.source === row.key);
      const rh = row.key === 'robinhood' ? position.rhPostingScenario.usd : 0;
      return { key: row.key, modelAndImportUsd: row.modelAndImportUsd, providerComponentUsd: overhead.providerComponentUsd,
        sourceDispatchUsdAllowance: overhead.sourceDispatchUsdAllowance, rhRawPostingScenarioUsd: rh,
        estimatedSubtotalUsd: row.modelAndImportUsd + overhead.providerComponentUsd,
        subtotalWithSourceAllowanceUsd: row.modelAndImportUsd + overhead.providerComponentUsd + overhead.sourceDispatchUsdAllowance + rh };
    }),
    modelAndProviderSubtotalUsd: position.modelAndImportUsd + providerTotal,
    withSourceAllowanceAndRhRawPostingUsd: position.modelAndImportUsd + providerTotal + sourceTotal + position.rhPostingScenario.usd })),
  limitations: [
    'Monad uses local native MONAD_TEN semantics and declared gas limits. Other nodes use generic Cancun with target chain IDs, not exact target-network clients.',
    'Local full-model execution, actual outputs and receipt reconciliation are verified. All dollar figures are projections at a point-in-time public price snapshot.',
    'Model/import excludes local mock send and receive costs. Provider quotes include destination execution. Source dispatch is an explicit allowance, not measured production LayerZero execution.',
    'No exact deployed-OApp quote, treasury fee, congestion forecast or paid public-chain inference was obtained.',
    'RH raw-byte posting scenario is not an exact compressed parent-chain fee. Source dispatch posting is not independently quoted.',
    'Initial deployment is a local execution-only scenario, excludes mock endpoints, RH posting fees and production messaging security setup; it is not amortized into per-token prices.',
    'Longer prompts and contexts require more positions and growing attention/KV work; multiplying the two-position benchmark is only an illustrative scenario.',
    'This route minimizes exposure to expensive chains within the implemented whole-block partition requiring nonzero transformer work on BNB and Arc; it is not proof of a global architectural optimum.'
  ]
};
const out = filename(option('out', 'evidence/optimized-costs.json'));
assert(['evidence', 'reports'].includes(path.relative(HERE, out).split(path.sep)[0]));
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, json(result));
const markdown = option('markdown', null);
if (markdown) {
  const target = filename(markdown);
  assert(path.relative(HERE, target).startsWith('docs' + path.sep));
  const money = value => '$' + value.toFixed(value > 0 && value < 0.0001 ? 8 : 4);
  const latest = result.optimizedBudgetScenarios.at(-1), comparison = result.comparison.at(-1);
  const names = { robinhood: 'Robinhood', bsc: 'BNB', arc: 'Arc', monad: 'Monad' };
  const rows = latest.chains.map(row => `| ${names[row.key]} | ${money(row.modelAndImportUsd)} | ${money(row.providerComponentUsd)} | ${money(row.sourceDispatchUsdAllowance)} | ${money(row.subtotalWithSourceAllowanceUsd)} |`).join('\n');
  const deploymentRows = result.optimized.initialDeployment.map(row => `| ${names[row.key]} | ${row.transactions.toLocaleString('en-US')} | ${String(row.billedGas)} | ${money(row.usd)} |`).join('\n');
  const content = `# Optimized four-chain inference costs

This report prices the complete 124,439,808-parameter INT8/Q12 GPT-2 model at the public fee snapshot from **${result.feeSnapshotAtUtc}**. Values are research estimates from local receipts and live price/provider reads, not paid mainnet inference. Each unit below is one processed token position; the selected row is the second position, with a two-token context.

**Model plus activation-import execution: ${money(comparison.baselineModelAndImportUsd)} before → ${money(comparison.optimizedModelAndImportUsd)} after (${comparison.modelAndImportSavingsPercent.toFixed(2)}% lower).** This compares both layouts under the same local profiles, including native Monad metering and declared-gas billing. It excludes transport from the before/after comparison.

The optimized route is **RH input → BNB block 0 → Arc block 1 → Monad blocks 2–11 and full vocabulary head → RH result**. The code preserves all weights and INT8/Q12 precision. Every remote chain performs real model computation. This minimizes expensive-chain exposure within the implemented whole-block partition; other architectures could improve further.

| Chain | Model + import | Provider components | Source gas allowance | Total with allowance |
| --- | ---: | ---: | ---: | ---: |
${rows}
| **Total** | **${money(comparison.optimizedModelAndImportUsd)}** | **${money(providerTotal)}** | **${money(sourceTotal)}** | **${money(latest.withSourceAllowanceAndRhRawPostingUsd)}** |

The measured-model-plus-provider subtotal is **${money(latest.modelAndProviderSubtotalUsd)}**. Adding the explicit source execution allowance and RH raw-byte posting scenario gives **${money(latest.withSourceAllowanceAndRhRawPostingUsd)}**. This span is a planning scenario, not a hard bound: treasury fees and exact production OApp quotes remain unmeasured.

Provider components are read-only quotes for the exact four directed pathways, three 3,488-byte activation packets and one 416-byte result packet, two candidate DVNs, 20 confirmations, and 500,000 receive gas. The sender is a dummy address. Destination execution is included in the executor quote and is not added again. Source dispatch allows up to 16,777,216 gas per hop at the captured prices; this is a conservative operator budget rather than measured LayerZero source gas. Local mock transport costs are excluded.

Robinhood's extra posting scenario uses the captured parent-byte price, actual model/import calldata lengths and the fixed transaction envelope charge once. It is **${money(optimized.positions.at(-1).rhPostingScenario.usd)}** for this position. Exact compressed posting fees require target-network estimates. See [fee sources](FEE-SOURCES.md) and [machine-readable accounting](../evidence/optimized-costs.json).

## One-time initial installation

| Chain | Transactions | Billed gas scenario | Execution USD |
| --- | ---: | ---: | ---: |
${deploymentRows}

These deployment figures exclude mock endpoints, RH parent posting and production messaging security setup. They are not included in the per-token price. Weight catalogs can be reused for future sessions on the same chain; engine/session state is separate.

## Validation and reproduction

Both full-model scenarios generated token IDs 198 and 464, checked 172 phase commitments, 100,514 output logits and 72 KV vectors. No host-computed activation was injected. All ${baseline.totalVerifiedReceipts.toLocaleString('en-US')} baseline and ${optimized.totalVerifiedReceipts.toLocaleString('en-US')} optimized receipts were successful and reconciled. Monad used native local MONAD_TEN semantics; the other three nodes used generic Cancun with target chain IDs. These are not complete mainnet-client equivalence tests.

\`\`\`sh
npm run benchmark:baseline-native -- --tokens=2
npm run benchmark:optimized -- --tokens=2 --out=reports/optimized-native-full
npm run costs -- --markdown=docs/COSTS.md
\`\`\`

A prompt of N tokens requires N processed positions before its first next-token result; each additional output adds a position. Attention and KV costs grow with context. This one/two-position benchmark must not be presented as a constant long-context chat price. Longer-context tests and exact deployed-OApp quotes are the next pricing work.
`;
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
}
console.log(json({ status: result.status, comparison: result.comparison, optimizedBudgetScenarios: result.optimizedBudgetScenarios, out }));
