// Offline reconciliation. No RPC calls, wallet access, or paid transactions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERE, RESEARCH, BRIDGE_MODULES, json, sha256 } from './build.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(HERE, name)));
const sum = values => values.reduce((a, b) => a + BigInt(b), 0n);
const dollars = (wei, price) => Number(wei) / 1e18 * price;
const ledger = name => fs.readFileSync(path.join(HERE, name), 'utf8').trim().split('\n').map(JSON.parse);
const hash = name => sha256(fs.readFileSync(path.join(HERE, name)));
const sourceHash = name => {
  for (const root of [HERE, path.join(HERE, 'node_modules'), BRIDGE_MODULES, path.join(RESEARCH, 'node_modules')]) {
    const file = path.resolve(root, name);
    if (file.startsWith(root + path.sep) && fs.existsSync(file)) return sha256(fs.readFileSync(file));
  }
  throw new Error('Missing source: ' + name);
};

export function estimateEconomy({ deliveryGasPerChain = 2000000n, rhPostingUsd = 0.01, otherPostingUsd = 0.01 } = {}) {
  assert(deliveryGasPerChain >= 0n && Number.isSafeInteger(Number(deliveryGasPerChain)));
  assert(rhPostingUsd >= 0 && Number.isFinite(rhPostingUsd));
  assert(otherPostingUsd >= 0 && Number.isFinite(otherPostingUsd));
  const model = read('reports/job-opbnb-full/results.json');
  const costs = read('reports/job-opbnb-full/cost-summary.json');
  const fees = read('research/fee-economy-snapshot.json');
  const opbnb = read('research/opbnb-snapshot.json');
  const fork = read('reports/self-relay-fork/results.json');
  const gpo = opbnb.gpo.fullJobLedger;
  assert.equal(model.status, 'PASS_WHOLE_MODEL_JOB_LOCAL_BENCHMARK');
  assert.equal(model.public_transactions_submitted, 0);
  assert.equal(model.host_inference_results_injected, false);
  assert.equal(model.weight_data_injected, false);
  assert.deepEqual(model.generated_token_ids, [198, 464]);
  assert.equal(costs.ledger_sha256, hash('reports/job-opbnb-full/transactions.jsonl'));
  assert.equal(costs.report_sha256, hash('reports/job-opbnb-full/results.json'));
  assert.equal(gpo.localLedgerSha256, costs.ledger_sha256);
  assert.equal(gpo.oracleExecution.publicWorkloadCalls, 0);
  assert.equal(fork.status, 'PASS_LOCAL_FORK_SELF_RELAY_SOURCE_SENDS');
  assert.equal(fork.public_transactions_submitted, 0);
  assert.equal(fork.public_eth_calls, 0);
  assert.equal(fork.source_sends.length, 2);
  for (const [name, expected] of Object.entries(model.selected_source_sha256)) {
    assert.equal(sourceHash(name), expected, `Model source changed: ${name}`);
  }
  for (const name of ['contracts/GPT2JobOApp.sol', 'contracts/GH0STSelfRelayExecutor.sol']) {
    assert.equal(hash(name), fork.compiler.source_sha256[name], `Transport source changed: ${name}`);
  }
  const selected = ['model_compute', 'job_control_and_begin', 'job_control_and_next_begin'];
  const rows = ledger('reports/job-opbnb-full/transactions.jsonl');
  const computeRows = rows.filter(r => selected.includes(r.category));
  const computeGas = sum(computeRows.map(r => r.gas));
  const computePosting = sum(selected.map(k => gpo.categoryTotals[k].postingFeeWei));
  assert.equal(computeRows.length, 633);
  assert.equal(computeGas, sum(selected.map(k => gpo.categoryTotals[k].gasUsed)));
  assert.equal(computePosting, sum(gpo.rows.filter(r => selected.includes(r.category)).map(r => r.scenarios[0].l1FeeWei)));
  const market = gpo.market;
  const bnbUsd = market.raw.binancecoin.usd, ethUsd = market.raw.ethereum.usd;
  const rh = fees.chains.find(c => c.chainId === 4663);
  // Use the greater observed base fee or recommendation, avoiding an under-base bid.
  const rhGasPrice = BigInt(rh.gasPriceWei) > BigInt(rh.block.baseFeePerGas) ? BigInt(rh.gasPriceWei) : BigInt(rh.block.baseFeePerGas);
  const sourceRH = fork.source_sends.find(r => r.chain_id === 4663);
  const sourceOP = fork.source_sends.find(r => r.chain_id === 204);
  for (const row of fork.source_sends) {
    assert.equal(BigInt(row.native_fee), sum(row.dvn_fees));
    assert.equal(row.executor_service_fee, '0');
    assert.equal(row.message_bytes, 416);
  }
  const forkRows = ledger('reports/self-relay-fork/transactions.jsonl');
  const setups = [4663, 204].map(chainId => {
    const modelSetup = rows.filter(r => r.chain_id === chainId &&
      (r.category === 'route_setup' || (r.category === 'deployment' &&
       r.purpose === 'deploy GPT2ShardOptimized')));
    const executor = forkRows.filter(r => r.chain_id === chainId &&
      ['deploy contracts/GH0STSelfRelayExecutor.sol', 'deploy contracts/GPT2JobOApp.sol'].includes(r.purpose));
    const sendConfig = forkRows.filter(r => r.chain_id === chainId && ['setSendLibrary', 'setConfig'].includes(r.purpose));
    // Receive-library configuration was not measured. Keep it visible as an allowance.
    return { chainId, measuredGas: sum([...modelSetup, ...executor, ...sendConfig].map(r => r.gas)).toString(),
      measuredTransactions: modelSetup.length + executor.length + sendConfig.length,
      receiveConfigurationGasAllowance: '1000000', measuredScope: 'New routers, engine, self executors, route wiring and send configuration; reusable tensors/catalogs excluded.' };
  });
  const cases = [
    { name: 'recommended_bid', gasPriceWei: opbnb.pricingScenarios.recommendedWei, inclusion: 'RPC-recommended bid snapshot; public execution remains untested.' },
    { name: 'observed_low_bid', gasPriceWei: opbnb.pricingScenarios.observedLowWei, inclusion: 'A bid observed in unrelated public receipts; timely inclusion for this workload is unproven.' }
  ].map(scenario => {
    const bid = BigInt(scenario.gasPriceWei);
    const rhSource = dollars(BigInt(sourceRH.gas) * rhGasPrice, ethUsd);
    const rhDvn = dollars(sourceRH.native_fee, ethUsd);
    const rhDelivery = dollars(deliveryGasPerChain * rhGasPrice, ethUsd);
    const opCompute = dollars(computeGas * bid, bnbUsd);
    const opPosting = dollars(computePosting, bnbUsd);
    const opSource = dollars(BigInt(sourceOP.gas) * bid, bnbUsd);
    const opDvn = dollars(sourceOP.native_fee, bnbUsd);
    const opDelivery = dollars(deliveryGasPerChain * bid, bnbUsd);
    const chains = [
      { chain: 'Robinhood', chainId: 4663, modelComputeUsd: 0, sourceExecutionUsd: rhSource, dvnQuoteUsd: rhDvn,
        deliveryExecutionAllowanceUsd: rhDelivery, postingAllowanceUsd: rhPostingUsd,
        totalJobUsd: rhSource + rhDvn + rhDelivery + rhPostingUsd },
      { chain: 'opBNB', chainId: 204, modelComputeUsd: opCompute, measuredModelPostingUsd: opPosting,
        sourceExecutionUsd: opSource, dvnQuoteUsd: opDvn, deliveryExecutionAllowanceUsd: opDelivery,
        otherPostingAllowanceUsd: otherPostingUsd,
        totalJobUsd: opCompute + opPosting + opSource + opDvn + opDelivery + otherPostingUsd },
      { chain: 'BNB Smart Chain', chainId: 56, totalJobUsd: 0, role: 'Unused in the cheaper route' },
      { chain: 'Arc', chainId: 5042, totalJobUsd: 0, role: 'Unused in the cheaper route' },
      { chain: 'Monad', chainId: 143, totalJobUsd: 0, role: 'Measured fallback; unused in the cheapest route' }
    ];
    const totalJobUsd = chains.reduce((a, c) => a + c.totalJobUsd, 0);
    const sessionSetup = setups.map(s => ({ ...s,
      executionUsd: dollars((BigInt(s.measuredGas) + BigInt(s.receiveConfigurationGasAllowance)) * (s.chainId === 4663 ? rhGasPrice : bid), s.chainId === 4663 ? ethUsd : bnbUsd) }));
    const sessionExecutionUsd = sessionSetup.reduce((a, s) => a + s.executionUsd, 0);
    return { ...scenario, chains, computeAndExactModelPostingUsd: opCompute + opPosting, totalJobUsd,
      perOutputTokenUsd: totalJobUsd / 2, sessionSetup,
      sessionSetupExecutionOnlyUsd: sessionExecutionUsd,
      perOutputIncludingSessionExecutionUsd: (totalJobUsd + sessionExecutionUsd) / 2,
      setupPostingExcluded: true, operatorServiceAndMarginExcluded: true };
  });
  const existing = read('evidence/optimized-native-costs.json');
  const comparison = existing.positions[1].by_stage.map(s => {
    const chain = fees.chains.find(c => c.chainId === s.chain_id);
    const gas = sum(selected.slice(0, 1).concat('activation_import_and_begin').map(k => s.by_category[k]?.billed_gas ?? '0'));
    return { chain: s.name, chainId: s.chain_id, modelAndImportGas: gas.toString(),
      modelAndImportUsd: dollars(gas * BigInt(chain.gasPriceWei), Number(chain.nativeUsd)) };
  });
  return { schemaVersion: 1, status: 'LOCAL_MEASUREMENTS_PLUS_LIVE_FEE_SNAPSHOTS_AND_EXPLICIT_UNMEASURED_ALLOWANCES',
    publicTransactionsSubmitted: 0, publicDestinationDeliveryVerified: false, managedExecutorSupportsRoute: false,
    model: { parameters: 124439808, precision: 'INT8 weights / signed INT32 Q12 activations, unchanged',
      promptTokens: [50256], outputTokens: [198, 464], processedPositions: 2, generatedOutputs: 2,
      verifiedPhaseVectors: 172, verifiedLogits: 100514, verifiedKVVectors: 72 },
    market, rhGasPriceWei: rhGasPrice.toString(), computeGas: computeGas.toString(), computeActions: computeRows.length,
    exactComputePostingWei: computePosting.toString(), sourceSends: fork.source_sends,
    allowancePolicy: { deliveryGasPerChain: deliveryGasPerChain.toString(), rhPostingUsd, otherPostingUsd,
      scope: 'Per-job allowance, not measured gas or a guaranteed upper bound. Delivery covers commitVerification plus lzReceive. DVN verification is already paid by native_fee and is not double-counted. Operator hosting, margins and setup posting are excluded.' },
    cases, previousFourChainSecondPositionAtCapturedPrices: comparison,
    previousFourChainModelAndImportUsd: comparison.reduce((a, r) => a + r.modelAndImportUsd, 0),
    initialInstallation: { gasExcludingMockEndpoints: costs.initial_deployment_excluding_mock_endpoints.gas,
      transactions: costs.initial_deployment_excluding_mock_endpoints.transactions,
      weightPayloadBytes: 127716426, weightContracts: 5516, catalogs: 81,
      scope: 'Local first installation, before self-executor and production messaging configuration. Deployment posting costs not measured. Tensors/catalogs reusable; session contracts are single-use.' },
    evidence: Object.fromEntries(['reports/job-opbnb-full/results.json', 'reports/job-opbnb-full/transactions.jsonl',
      'reports/self-relay-fork/results.json', 'reports/self-relay-fork/transactions.jsonl',
      'research/opbnb-snapshot.json', 'research/fee-economy-snapshot.json'].map(name => [name, hash(name)])),
    limitations: [
      'Both complete model runs and source-send forks were local. No paid public inference or destination DVN delivery was performed.',
      'Low bid is not a guaranteed price or inclusion policy. Longer contexts cost more; this two-output EOS job is not a chat-message price.',
      'Source sends use official forked transport with a model mock only to initialize transport state. Math evidence comes from the separate real-model benchmark.',
      'A local generic Cancun profile was used for opBNB execution; GPO code/state and source Endpoint/DVN code were forked from pinned public blocks.',
      'Self-operated delivery removes a commercial executor service fee; it still needs a funded, reliable relayer and live DVN support.',
      'Initial deployment, session setup posting, operator hosting, margins and any unquoted service charges are additional.'
    ] };
}

function markdown(report) {
  const [normal, low] = report.cases;
  const money = n => '$' + n.toFixed(6);
  return `# Cheapest fully on-chain research route\n\n` +
    `Robinhood receives the prompt and final result; opBNB runs all 124,439,808 GPT-2 parameters. BNB Smart Chain, Arc and Monad are not charged by this route. Precision and canonical weights are unchanged.\n\n` +
    `**Recommended-bid scenario: ${money(normal.perOutputTokenUsd)} per output token before session setup. Observed-low-bid scenario: ${money(low.perOutputTokenUsd)}.** These are a two-output, one-token EOS benchmark, not a long-chat price. The low bid has no demonstrated inclusion guarantee.\n\n` +
    `| Cost for the complete two-output job | Recommended bid | Observed low bid |\n| --- | ---: | ---: |\n` +
    normal.chains.map((c, i) => `| ${c.chain} | ${money(c.totalJobUsd)} | ${money(low.chains[i].totalJobUsd)} |`).join('\n') +
    `\n| **Total with delivery/posting allowances** | **${money(normal.totalJobUsd)}** | **${money(low.totalJobUsd)}** |\n` +
    `| Average per generated token | ${money(normal.perOutputTokenUsd)} | ${money(low.perOutputTokenUsd)} |\n` +
    `| Extra session setup execution estimate per job | ${money(normal.sessionSetupExecutionOnlyUsd)} | ${money(low.sessionSetupExecutionOnlyUsd)} |\n` +
    `| Average including session setup execution | ${money(normal.perOutputIncludingSessionExecutionUsd)} | ${money(low.perOutputIncludingSessionExecutionUsd)} |\n\n` +
    `Session setup posting remains additional. Existing contracts are single-use: do not describe their deployment as permanently amortized. The complete first installation used ${report.initialInstallation.gasExcludingMockEndpoints} local gas, including reusable weights/catalogs plus routers and engine, before production messaging setup.\n\n` +
    `## What is measured\n\n` +
    `- Model/control: ${report.computeGas} gas across ${report.computeActions} transactions; 172 phase vectors, 100,514 logits and 72 KV vectors match the independent reference.\n` +
    `- Exact local-fork GPO posting quote for those transactions: ${report.exactComputePostingWei} wei BNB. Fee state pinned to block 199271251.\n` +
    `- Official forked source sends: ${report.sourceSends[0].gas} RH gas and ${report.sourceSends[1].gas} opBNB gas. Total two-DVN quotes are approximately ${money(normal.chains.reduce((a, c) => a + (c.dvnQuoteUsd ?? 0), 0))} per job.\n` +
    `- opBNB bid: 1,000,000 wei recommended; 10,000 wei low scenario. USD conversion captured ${report.market.retrievedAt}. RH uses ${report.rhGasPriceWei} wei/gas.\n\n` +
    `## What remains an allowance\n\n` +
    `The table budgets ${report.allowancePolicy.deliveryGasPerChain} gas on each destination for commitVerification plus lzReceive, $${report.allowancePolicy.rhPostingUsd} RH posting and $${report.allowancePolicy.otherPostingUsd} other opBNB posting per job. These are unmeasured planning allowances, not guarantees. DVN verification gas is already paid through each source quote and is not counted again. The extra session row includes measured deployment/send-configuration gas plus 1,000,000 gas per chain for unmeasured receive configuration.\n\n` +
    `Default managed LayerZero executors reject this direct pair in the captured state. The optional self-operated executor preserves both DVNs and charges no service fee, but needs a live relayer and confirmed DVN support. Public destination delivery has not been demonstrated. Hosting, margin and setup posting are excluded.\n\n` +
    `## Comparison and tradeoff\n\n` +
    `The previous four-chain second-position **model/import-only** estimate reprices to ${money(report.previousFourChainModelAndImportUsd)}. The new recommended model/control plus exact posting averages ${money(normal.computeAndExactModelPostingUsd / 2)} per output. This comparison excludes transport on both sides and uses separate short-context runs. The older $24.55 total was a different snapshot and allowance model, not a paid receipt.\n\n` +
    `Colocating the model removes 38,839,376 duplicated bytes: 38,798,404 for the tied embedding/output table and 40,972 for lookup tables. Sending one request and one final result removes per-token activation bridges. Computation remains fully on-chain; the CPU only tokenizes and verifies the benchmark.\n\n` +
    `Larger prompts require N + M - 1 processed positions for N input and M output tokens, and attention/KV costs grow with context. Do not multiply this short-context number into a promised flat reply price.\n\n` +
    `See [machine-readable costs](../evidence/economy-costs.json), [deployment/relay guide](JOB-DEPLOYMENT.md), [fee sources](ECONOMY-FEE-SOURCES.md) and [opBNB snapshot](../research/opbnb-snapshot.json). Recompute offline with \`npm run costs:economy\`.\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'This evidence calculation accepts no silent scenario overrides');
  const report = estimateEconomy();
  fs.mkdirSync(path.join(HERE, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'evidence/economy-costs.json'), json(report));
  fs.writeFileSync(path.join(HERE, 'docs/ECONOMY-COSTS.md'), markdown(report));
  console.log(json({ status: report.status, scenarios: report.cases.map(c => ({ name: c.name, perOutputTokenUsd: c.perOutputTokenUsd, perOutputIncludingSessionExecutionUsd: c.perOutputIncludingSessionExecutionUsd })) }));
}
