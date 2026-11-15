// Reproducible conditional arithmetic. Does not execute a full Solidity search.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { formatEther } from 'ethers';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
const samples = read('../solidity-research/position-gas-results.json');
const profile = read('../solidity-research/search-counters.json');
const snapshot = read('./mainnet-snapshot.json');
const deployment = read('./weight-deployment.json');
if (!samples.passed || !samples.completed || !profile.exactSearchOutcomePreserved || snapshot.chainId !== 4663)
  throw new Error('Required completed evidence is missing');
if (samples.sourceSha256 !== hash('../solidity-research/NnueKernel.sol'))
  throw new Error('The measured kernel source has changed');
const counted = profile.runs.find(r => r.binary === 'instrumented-native');
const reference = profile.runs.find(r => r.binary === 'official-native');
if (!counted || !reference || ['bestmove', 'nodes', 'depth'].some(k => counted[k] !== reference[k]))
  throw new Error('The instrumented search differs from its reference');
const calls = BigInt(counted.counters.network_evaluations);
const gas = samples.cases.map(c => {
  if (String(c.nativeOutput) !== String(c.solidityOutput)) throw new Error('Sample output mismatch');
  return BigInt(c.gasUsed);
});
const minimum = gas.reduce((a, b) => a < b ? a : b);
const maximum = gas.reduce((a, b) => a > b ? a : b);
const sum = gas.reduce((a, b) => a + b, 0n);
const price = BigInt(snapshot.gasPriceWei);
const cap = BigInt(snapshot.arbGasInfo.getMaxTxGasLimit[0]);
const scenario = units => ({
  gas: String(units), executionEthAtSnapshot: formatEther(units * price),
  illustrativeUsd: Number(formatEther(units * price)) * deployment.quote.usdPerEth,
  // Conditional arithmetic only: real batching/caching can change the gas basis.
  ceilingDividedByTxLimit: String((units + cap - 1n) / cap),
});
const report = {
  scope: 'Conditional dense-component repetition scenario for one native reference decision, NOT a measured full Solidity move or game bill',
  generatedAt: new Date().toISOString(),
  evidence: {
    sampleSha256: hash('../solidity-research/position-gas-results.json'),
    profileSha256: hash('../solidity-research/search-counters.json'),
    snapshotSha256: hash('./mainnet-snapshot.json'),
  },
  referenceDecision: { position: profile.position, targetNodes: profile.targetNodes, bestmove: counted.bestmove, actualNodes: counted.nodes, depth: counted.depth, actualDenseInvocations: String(calls) },
  sampledStandaloneTransactions: { count: gas.length, minimumGas: String(minimum), maximumGas: String(maximum), meanGasRounded: String((sum + BigInt(gas.length) / 2n) / BigInt(gas.length)) },
  chainId: 4663, feeSnapshotAt: snapshot.checkedAt, gasPriceWei: snapshot.gasPriceWei, txGasLimit: String(cap),
  conditionalMinimumSampleCostRepeated: scenario(calls * minimum),
  conditionalMaximumSampleCostRepeated: scenario(calls * maximum),
  conditionalMeanSampleCostRepeated: scenario(calls * sum / BigInt(gas.length)),
  usdQuote: deployment.quote,
  completeNativeMoveGas: null, completeNativeGameGas: null,
  caveats: [
    'The full Stockfish Solidity engine does not exist in this repository.',
    'Sixteen samples do not establish the input distribution across all neural invocations; min/max are not universal bounds.',
    'Sample receipts include standalone transaction/calldata and repeated model-copy overhead; a batched engine may share or avoid those costs.',
    'Feature extraction, PSQT, legality, search, transposition storage and continuation are unimplemented or excluded.',
    'The transaction-count division is conditional arithmetic, not an implemented transaction plan or latency guarantee.',
    'Snapshot gas and ETH/USD prices can change. No public transaction was sent.',
  ],
};
writeFileSync(new URL('./playing-scenario.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ referenceDecision: report.referenceDecision, min: report.conditionalMinimumSampleCostRepeated, max: report.conditionalMaximumSampleCostRepeated }, null, 2));
