// Reproducible arithmetic from saved measurements and a freshly certified rate.
// Does not deploy, run a game, convert ICP, or alter any live resource.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const rateRecord = read('./cmc-rate.json');
assert(rateRecord.blsCertificateVerified && rateRecord.witnessRootVerified && rateRecord.returnedRateLeafVerified);
const rate = BigInt(rateRecord.cyclesPerIcp);
const prior = read('../../ops/hybrid/BUDGET_100.json');
const delta = read('../exact-savings-20261116/evidence/retained-delta.json');
const routing = read('./public-query-probe.json');
const probe = read('../exact-savings-20261116/evidence/probe.json');
const engine = BigInt(prior.costBasis.engineCycles);
const orchestration = BigInt(prior.costBasis.coordinatorAndRelayCycles);
const instructions = BigInt(prior.pricing.PocketICSearchSampledInstructions);
const engineInstructionsPerQuery = 4_000_000_000n;
const chunks = (instructions + engineInstructionsPerQuery - 1n) / engineInstructionsPerQuery;
const asICP = cycles => Number(cycles) / Number(rate);
const scenarios = [40, 80].map(blackMovesPerGame => {
  const turns = BigInt(20 * blackMovesPerGame);
  return { games: 20, blackMovesPerGame, turns: Number(turns),
    engineOnlyICP: asICP(turns * engine),
    existingEngineAndOrchestrationICP: asICP(turns * (engine + orchestration)),
    engineReductionNeededBeforeAllOtherCostsPercent:
      100 * (1 - 100 * Number(rate) / Number(turns * engine)),
  };
});
const illustrativeDeltaBytes = delta.records[0].smallestMeasuredPayloadBytes;
const turns = 1600n;
const hypotheticalIngress = turns * chunks * BigInt(illustrativeDeltaBytes) * 2000n;
const hashes = {};
for (const path of ['./cmc-rate.json', './cmc-witness.json', './public-query-probe.json',
  '../exact-savings-20261116/evidence/retained-delta.json',
  '../exact-savings-20261116/evidence/probe.json',
  '../quorum-query-20261116/test-results.json', '../../ops/hybrid/BUDGET_100.json']) {
  hashes[path] = createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
}
const report = {
  status: 'No validated unchanged-strength, fully-on-chain twenty-game solution within 100 ICP',
  scope: 'Research measurements and explicitly hypothetical cost scenarios; no production promotion',
  budgetICP: 100, priorConvertedICP: 13, priorLedgerFeesICP: 0.0003,
  allocationAccounting: 'Converted ICP is not identical to burned cycles. Existing funded cycles count toward work; do not add 13 ICP to their consumption again. Existing creation/install/fees/reserves still count toward the cap.',
  cyclesPerICP: String(rate), certifiedRateAt: rateRecord.rateTimestampUTC,
  measuredEngineCyclesPerRepresentativeSearch: String(engine),
  measurementLimit: 'Saved local actual-IC/PocketIC representative search, not a measured mainnet whole game or universal per-position bound',
  scenarios,
  affineMemoizationProbe: { source: '../exact-savings-20261116/evidence/probe.json',
    scope: 'Bounded native measurement; not promoted and not a full-budget cost test', details: probe },
  signedQueryTransport: { source: './public-query-probe.json',
    distinctSigners: routing.distinctVerifiedSigners, requests: routing.rows.length,
    sameRequestAndReply: routing.reachedNineDistinctSigners && routing.failures.length === 0,
    fullSearchesExecuted: 0, consensusCommitsExecuted: 0 },
  customQuorumEconomics: {
    status: 'Custom application-quorum research; not standard replicated update execution',
    maximumOfficialQueryInstructions: 5_000_000_000,
    hypotheticalEngineInstructionsPerQuery: String(engineInstructionsPerQuery),
    chunksPerRepresentativeTurn: Number(chunks), commitsForTwentyEightyMoveGames: Number(chunks * turns),
    ingressCyclesPerByte: 2000,
    illustrativeDeltaBytes,
    inputLimit: 'Completed short-search retained-state payload is NOT a measured mid-search query continuation; this substitution is only a rejection/sensitivity indicator, not a rigorous lower bound',
    hypotheticalIngressOnlyICP: asICP(hypotheticalIngress),
    excludes: ['signature/certificate verification', 'continuation capture/restore/serialization',
      'query capacity and delays', 'coordination', 'creation/install/storage/fees/reserves', 'Robinhood gas'],
    productionReady: false,
  },
  decisions: {
    noWeakerEngine: true, noOffchainInference: true, noDedicatedL3Spend: true,
    noPublicTwentyGameGuarantee: true, noAdditionalSpending: true,
    nextExperiment: 'Only a real mid-search continuation/log and actual-IC quorum verifier benchmark can qualify the query design; current measured payload indicators do not meet its target',
  },
  sourceSHA256: hashes,
};
writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, cyclesPerICP: report.cyclesPerICP,
  certifiedRateAt: report.certifiedRateAt, scenarios,
  routing: report.signedQueryTransport, customQuorumEconomics: report.customQuorumEconomics }, null, 2));
