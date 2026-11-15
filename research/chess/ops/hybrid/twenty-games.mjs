// Read-only planning calculator. --write replaces only the two adjacent planning files.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

if(process.argv.includes('--help')) {
  console.log('node ops/hybrid/twenty-games.mjs [--write]\nFirst refresh costs.mjs --write after final passing engine/coordinator/relay evidence. No network, identity, transaction or funding access.');
  process.exit(0);
}
const root=new URL('../../',import.meta.url), read=p=>JSON.parse(fs.readFileSync(new URL(p,root))), raw=p=>fs.readFileSync(new URL(p,root));
const assert=(ok,msg)=>{if(!ok)throw Error(msg);}, sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const cost=read('ops/hybrid/cost-report.json'),cmc=read('ops/hybrid/cmc-rate.json'),rh=read('ops/hybrid/resource-preflight.json');
const brain=read('hybrid-brain/evidence/end-to-end.json'),brainRelease=read('hybrid-brain/evidence/release-manifest.json');
const relay=read('hybrid-relay/evidence/relay-end-to-end.json'),relayRelease=read('hybrid-relay/evidence/artifact.json'),relayCost=read('hybrid-relay/evidence/relay-costs.json'),comparison=read('hybrid-relay/evidence/relay-search-cost-comparison.json');
const auth=read('ops/hybrid/launch-authorization.json'),progress=read('ops/hybrid/mainnet-progress.json'),replay=read('evm/replayed-engine-games.json');
assert(brain.passed&&relay.passed&&relayCost.passed,'Final passing coordinator and relay evidence required');
assert(brainRelease.installedGzipModuleSHA256===brain.coordinator_installed_gzip_sha256,'Coordinator manifest is stale');
assert(relayRelease.installed_gzip_sha256===relay.relay_installed_gzip_sha256,'Relay manifest is stale');
assert(relayCost.source_evidence_sha256===sha(raw('hybrid-relay/evidence/relay-end-to-end.json')),'Relay costs refer to stale evidence');
assert(cost.cyclesPerICP===cmc.cyclesPerIcp&&cost.cmcRateAt===cmc.rateTimestampUTC,'Refresh costs.mjs --write with the certified conversion');
for(const [reported,actual] of [[cost.measuredSearch.cycles,brain.search.warm_engine_balance_debit],[cost.coordinatorAndMoveSignature.cycles,brain.search.coordinator_cycles_debit],[cost.autonomousRelay.cycles,relay.relay_cycles_debit]])assert(BigInt(reported)===BigInt(actual),'Refresh costs.mjs --write after final evidence');
assert(BigInt(cost.coldReservation.cycles)===BigInt(brain.search.engine_cycles_debit)-BigInt(brain.search.warm_engine_balance_debit),'Cold reservation cost is stale');
assert(relayCost.local_relay_cycles_debit===relay.relay_cycles_debit,'Relay net-debit records disagree');
const rate=BigInt(cost.cyclesPerICP),turn=BigInt(cost.measuredSearch.cycles)+BigInt(cost.coordinatorAndMoveSignature.cycles)+BigInt(cost.autonomousRelay.cycles),cold=BigInt(cost.coldReservation.cycles),icp=n=>Number(n)/Number(rate);
const count=20,days=30,creation=1_500_000_000_000n,reserve=7_500_000_000_000n,storage=127_000n*5n/4n*86_400n*BigInt(days);
const idle=BigInt(relayCost.idle_prepayment_projection.daily_total_upper_bound_cycles),quota=BigInt(relayRelease.policy.daily_http_prepayment_limit_cycles),trace=BigInt(comparison.complete_scenario_http_booked.after_cycles),first=BigInt(comparison.http_booked_until_first_broadcast.after_cycles);
assert(quota===BigInt(relayCost.idle_prepayment_projection.daily_cap_cycles),'Relay quota records disagree');
const black=replay.games.flatMap(g=>g.moves.filter(m=>m.ply%2===0).map(m=>BigInt(m.gasUsed))),gasTotal=black.reduce((a,b)=>a+b,0n),price=BigInt(rh.gasPriceWei);
const eth=n=>Number(n)/1e18,gasPerDecisionETH=eth(gasTotal*price)/black.length;
const scenarios=[40,60,80,100].map(n=>{
  const cycles=BigInt(count)*(BigInt(n)*turn+cold),capitalNumerator=cycles*6n+(creation+reserve+idle*BigInt(days)+storage)*5n;
  const cap=Number((capitalNumerator+rate*250n-1n)/(rate*250n))*50;
  return {games:count,blackDecisionsPerGame:n,totalBlackDecisions:count*n,representativeWorkloadCycles:String(cycles),representativeWorkloadICP:icp(cycles),twentyPercentContingencyICP:icp(cycles)/5,capitalWithContingencyAndAllowancesICP:Number(capitalNumerator)/(5*Number(rate)),roundedPlanningCapICP:String(cap),RHBotGasAtSavedMeanAndPriceETH:count*n*gasPerDecisionETH,RHBotGasWithTwentyPercentMarginPlusPoint0005OtherGasETH:count*n*gasPerDecisionETH*1.2+0.0005};
});
const toE8=s=>{assert(/^\d+(\.\d{1,8})?$/.test(String(s)),'Invalid ICP decimal');const [a,b='']=String(s).split('.');return BigInt(a)*100_000_000n+BigInt(b.padEnd(8,'0'));},fromE8=n=>`${n/100_000_000n}.${String(n%100_000_000n).padStart(8,'0')}`;
const allocated=toE8(progress.ICPConverted),balance=toE8(progress.remainingICPAccountBalance),paidFees=toE8(progress.ICPTransferFees),target=toE8('1250'),head=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(root),encoding:'utf8'}).trim();
const inputs=['ops/hybrid/twenty-games.mjs','ops/hybrid/cost-report.json','ops/hybrid/cmc-rate.json','ops/hybrid/resource-preflight.json','ops/hybrid/launch-authorization.json','ops/hybrid/mainnet-progress.json','icp-costs/pricing.json','hybrid-brain/evidence/end-to-end.json','hybrid-brain/evidence/end-to-end-costs.json','hybrid-brain/evidence/release-manifest.json','hybrid-relay/evidence/relay-end-to-end.json','hybrid-relay/evidence/relay-costs.json','hybrid-relay/evidence/artifact.json','hybrid-relay/evidence/init-profiles.json','hybrid-relay/evidence/relay-search-cost-comparison.json','evm/replayed-engine-games.json','contracts/HybridChessGame.sol','hybrid-brain/src/lib.rs','hybrid-brain/src/canister.rs','hybrid-relay/src/lib.rs','hybrid-relay/src/canister.rs','engine/optimized/runtime.cpp'];
const report={
  scope:'Capital planning for20 sequential full-strength games; repeated representative-position cost plus separately measured frozen-result relay, not20 executed ICP games or an arbitrary-game upper bound',preparedAt:new Date().toISOString(),sourceCommit:head,
  rate:{certifiedAt:cost.cmcRateAt,cyclesPerICP:String(rate),refreshBeforeFinancialActions:true},strengthPolicy:cost.policy,
  releaseInputs:{engineRawModuleSHA256:brain.engine_wasm_sha256,coordinatorInstalledGzipSHA256:brain.coordinator_installed_gzip_sha256,relayInstalledGzipSHA256:relay.relay_installed_gzip_sha256,coordinatorChecks:brain.check_count,relayChecks:relay.check_count,freshModelInferenceInRelayTrace:false},
  representativeTurn:{cycles:String(turn),ICP:icp(turn),engineCycles:cost.measuredSearch.cycles,coordinatorCycles:cost.coordinatorAndMoveSignature.cycles,relayCycles:cost.autonomousRelay.cycles,coldReservationCyclesPerGame:String(cold)},
  assumptions:{gamesSequential:count,concurrentGames:1,contingencyPercent:20,contingencyIsGuarantee:false,planningCalendarDays:days,totalResidentStorageGiB:'1.25',bestEffortComputeAllocationPercent:0,creationCycles:String(creation),operatingReserveCycles:String(reserve),reserveSplitCycles:{engine:'3500000000000',coordinator:'2000000000000',relay:'2000000000000'},reserveIsCapitalNotImmediateBurn:true,idleHTTPAllowanceCyclesPerDay:String(idle),idleAllowanceIsConservativePrepaymentNotMeasuredNetBurn:true,storageCyclesForWindow:String(storage),excludesOrUncalibrated:'Actual upload/install/ledger fees, per-position instruction variation, retries, peak memory, public-network latency and future conversion. Rounded cap has unassigned cushion, not a proven upper bound.'},
  scenarios,
  proposedCapitalReview:{selectedBlackDecisionsPerGame:80,capICPTotalIncludingApproved40AndAlreadyConvertedICP:'1250',additionalCapAboveApproved40ICP:'1210',capETHTotalIncludingApprovedPoint003:'0.01',relayLifetimeProfileProposedETH:'0.0095',otherGasAllowanceETH:'0.0005',prizeEscrowGH0ST:'1000000',pilotEntryGH0STMax:'25000',automaticTopups:false,increaseApproved:auth.capacityIncreaseAboveExistingCapsApproved,suggestedAllocationICP:{engine:'1140',coordinator:'45',relay:'60',creationUploadsUnallocated:'5'}},
  fundingSnapshot:{observedAt:progress.checkedAt,ICPAlreadyConverted:progress.ICPConverted,ICPFeesAlreadyPaid:progress.ICPTransferFees,remainingICPAccountBalance:progress.remainingICPAccountBalance,existingCyclesLedgerUntouched:progress.existingCyclesLedgerUntouched,existingApprovedCapICP:auth.ICPSpendingCap,initialPausedPilotCapICP:auth.initialPausedPilotICPSpendingCap,unspentApprovedICPSpendingAuthority:fromE8(toE8(auth.ICPSpendingCap)-allocated-paidFees),additionalICPToReach1250CapitalBeforeFutureFees:fromE8(target-allocated-balance),additionalICPToReach1250AndRetain1ICP:fromE8(target-allocated-balance+toE8('1')),alreadyConvertedIncludedIn1250NotAddedAgain:true,feesCountAgainstSpendingCap:true,futureFeesReduceUnallocatedCushionNotRaiseCap:true,additionalICPToReach40CapitalBeforeFutureFees:fromE8(toE8(auth.ICPSpendingCap)-allocated-balance),existingServiceBalancesAreNotFundingSources:true,publicPaidEntryEnabled:progress.publicPaidEntryEnabled},
  dailyQuota:{relayHTTPBookedCycles:String(quota),idlePrepaymentCyclesPerDay:String(idle),gameplayHeadroomCyclesPerDay:String(quota-idle),completeSavedFaultTraceCycles:String(trace),savedFirstBroadcastTraceCycles:String(first),completeTraceCopiesWithinQuotaAfterFullIdle:Number((quota-idle)/trace),firstBroadcastCopiesWithinQuotaAfterFullIdle:Number((quota-idle)/first),daysFor1600CompleteTraceCopiesWithFullIdleEveryDay:Number(trace*1600n)/Number(quota-idle),bookingsAreNotNetBurn:true,totalGamesIsNotDailyGames:true,arbitraryGameOrMainnetThroughputGuaranteed:false,coordinatorPublicQuotaCyclesPerDay:'1000000000000',coordinatorSigningQuotaCyclesPerDay:'2000000000000',bothCoordinatorAndRelayQuotasMustBeValidatedAtIntendedPace:true},
  RHGas:{quoteAt:rh.checkedAt,priceWei:String(price),savedLocalBlackMoveReceipts:black.length,savedBlackMoveGasTotal:String(gasTotal),savedBlackMoveMeanGas:Number(gasTotal)/black.length,currentApprovedRelayLifetimeETH:'0.0025',proposedRelayLifetimeETH:'0.0095',bothInitProfilesLocallyTested:relayRelease.validation.both_lifetime_profiles_tested,currentApprovedLifetimeRepresentativeBlackMoves:0.0025/gasPerDecisionETH,actualMainnetFullGameGasMeasured:false},
  capacityAndPrizes:{concurrentGames:1,adapterMaxHistoryPlies:1024,engineAndCoordinatorMaxJobsPerGame:512,gameReleasePrunesOldJobs:true,lostReleaseAcknowledgementCleanupRequiresPinnedCoordinatorProof:true,nativeEntryDoesNotVerifyICPCycles:true,currentEngineOperatingFloorCycles:'3500000000000',floorIsWholeGameReservation:false,nativeAutomaticPauseOnHumanCheckmate:true,oneMillionFundsOnlyOneCheckmatePayout:true,twentyWinPrizeFundingNotAuthorized:true,twentyWinsWouldNeedGH0ST:'20000000',twentyEntriesGH0ST:'500000',entryTokensDoNotAutomaticallyPayICPOrGas:true,gameLengthScenariosAreNotLegalMaxima:true,representativeCostAt512DecisionsFor20GamesICP:icp(20n*(512n*turn+cold)),absoluteArbitraryGameCostBoundEstablished:false,requiredBeforePublicAdmission:'Validate operating funds, quota headroom and gas for accepted games. Direct onchain entry needs an enforceable reviewed funding/admission policy or owner-controlled reopening; frontend checks alone do not reserve whole-game computation. No weaker fallback.'},
  sourceHashesAreInputSnapshotNotFutureReleasePins:true,sourceSHA256:Object.fromEntries(inputs.map(p=>[p,sha(raw(p))])),officialPricingSource:'https://docs.internetcomputer.org/references/cycle-costs/',actions:{networkCalls:false,financialActions:false,modifiedRuntimeSource:false,outputsOnly:['ops/hybrid/twenty-games.json','ops/hybrid/TWENTY_GAMES.md']}
};
const fmt=(n,d=2)=>n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}),selected=scenarios.find(s=>s.blackDecisionsPerGame===80),quotaT=Number(quota)/1e12;
const markdown=`# Twenty-game operating plan

**Twenty sequential full-strength games need substantially more than the approved 40 ICP launch cap.** The reviewable 80-decision scenario proposes **1,250 ICP total and 0.01 ETH total**, with the existing **1,000,000 GH0ST prize pool**. These larger caps are **${report.proposedCapitalReview.increaseApproved?'approved in the saved authorization':'not approved'}**. The earlier paused pilot remains bounded by its original approval.

Full Stockfish 19, its complete pinned NNUE, 24m nodes, Hash128, maximum skill and retained state are preserved. Only one game runs at a time. This is twenty games total, not twenty concurrent games or twenty games per day.

## Measured basis

The certified saved rate is **1 ICP=${Number(rate)/1e12}T cycles**, timestamp **${cost.cmcRateAt}**. Refresh before funding. One representative Black decision combines **${cost.measuredSearch.cycles} engine cycles**, **${cost.coordinatorAndMoveSignature.cycles} coordinator/signature cycles** and **${cost.autonomousRelay.cycles} separately measured relay cycles**: **${turn} cycles, about ${fmt(icp(turn),6)} ICP**. Add ${cold} cycles for cold retained-state initialization once per game.

The engine/coordinator proof performs fresh full Stockfish inference. The relay's separate ${relay.check_count}-check trace consumes a frozen genuine result and includes conservative fault/recovery work. Twenty full ICP games have not been measured; node count fixes search policy, not instructions per position. The relay's latest extended trace cannot be compared with an older shorter trace as a matched net-burn saving.

| Black decisions per game | Decisions across 20 games | Representative workload | Capital with stated allowances | Rounded planning cap |
|---:|---:|---:|---:|---:|
${scenarios.map(s=>`| ${s.blackDecisionsPerGame} | ${fmt(s.totalBlackDecisions,0)} | ${fmt(s.representativeWorkloadICP)} ICP | ${fmt(s.capitalWithContingencyAndAllowancesICP)} ICP | ${s.roundedPlanningCapICP} ICP |`).join('\n')}

Capital adds **20% workload contingency**, **1.5T creation cycles**, **7.5T operating reserves** (engine 3.5T, coordinator 2T, relay 2T), a **30-day conservative idle HTTP prepayment allowance**, and **1.25 GiB total resident storage for 30 days**. Reserves are held capital, not immediate burn. Idle bookings deliberately overcount full-idle polling in addition to gameplay and are not measured net burn. The rounded cap leaves unassigned upload/install/fee cushion. Position variance, retries, peak memory and future rates remain uncalibrated; 20% is an example, not a proven bound.

The [official pricing](https://docs.internetcomputer.org/references/cycle-costs/) uses 13-node Application placement and 0% reserved compute here. Actual placement and storage reservation must verify. 1.25 GiB costs about ${fmt(icp(storage),3)} ICP per 30 days; paid reserved compute adds a separate recurring charge.

## Capital already allocated and remaining funding

Saved mainnet progress at **${progress.checkedAt}** records **${progress.canisters.length} dedicated canisters**, **${progress.ICPConverted} ICP already converted**, **${progress.ICPTransferFees} ICP ledger fees**, and **${progress.remainingICPAccountBalance} ICP remaining** in the deployment account. Existing service balances and the existing cycles ledger remain separate.

The proposed **1,250 ICP total includes the already converted ${progress.ICPConverted} ICP**. Do not add that amount again. Remaining external funding is about **${report.fundingSnapshot.additionalICPToReach1250CapitalBeforeFutureFees} ICP**, before future fees, or **${report.fundingSnapshot.additionalICPToReach1250AndRetain1ICP} ICP** to retain 1 ICP outside the allocation. Already paid and future ledger fees count against the spending cap; fees reduce the unassigned cushion, not increase authority. The remaining authority under the original 40 ICP approval is **${report.fundingSnapshot.unspentApprovedICPSpendingAuthority} ICP**. Refresh balances before any action.

- Suggested total allocations: engine 1,140 ICP, coordinator 45 ICP, relay 60 ICP, creation/uploads/unallocated 5 ICP. No automatic top-ups.
- Proposed **0.01 ETH total includes the earlier 0.003 ETH cap**: relay gas up to 0.0095 ETH, other deployment/pilot/manual-funding gas allowance 0.0005 ETH. The source supports both locally tested immutable profiles, but the initial approved launch profile remains 0.0025 ETH lifetime gas authority. The larger profile still requires explicit approval.
- The existing **1,000,000 GH0ST prize** and bounded **25,000 GH0ST pilot entry** remain unchanged. No extra token spending is inferred.

The RH quote is ${Number(price)/1e9} gwei at ${rh.checkedAt}. Across ${black.length} saved local Black-move receipts, mean gas is ${fmt(Number(gasTotal)/black.length,2)}. For 1,600 such moves, the modeled bot gas is ${fmt(selected.RHBotGasAtSavedMeanAndPriceETH,6)} ETH; 20% plus 0.0005 ETH for other gas is ${fmt(selected.RHBotGasWithTwentyPercentMarginPlusPoint0005OtherGasETH,6)} ETH. This is local replay priced by a mainnet snapshot, not a mainnet full-game bill or worst-case gas bound.

## Capacity, quotas and admission

The native contract and retained engine allow **one active game**. Canonical terminal release erases old engine jobs and prunes coordinator jobs. The selected coordinator proof also covers durable cleanup after a lost release acknowledgement; no twenty-engine deployment is required for twenty sequential games.

The selected relay's daily HTTP booking limit is **${quotaT}T/day**, with **${fmt(Number(idle)/1e9,3)}B/day** conservative full-idle allowance. The remaining quota fits **${report.dailyQuota.completeTraceCopiesWithinQuotaAfterFullIdle} complete saved fault-heavy trace copies**, or **${report.dailyQuota.firstBroadcastCopiesWithinQuotaAfterFullIdle} copies through first broadcast**. The full saved trace booking is ${fmt(Number(trace)/1e9,3)}B per copy. 1,600 complete copies plus full-idle polling every day project about **${fmt(report.dailyQuota.daysFor1600CompleteTraceCopiesWithFullIdleEveryDay,1)} quota days**. This is arithmetic on the saved trace, not an arbitrary-game/mainnet throughput guarantee. Twenty total games can span quota days. Coordinator public verification and protected signing have separate 1T/day and 2T/day limits that also need validation at the intended pace. Funding does not bypass quotas; quota exhaustion never permits weaker search.

The native entry method checks the prize and open slot, but cannot itself verify ICP cycles. The coordinator's engine floor of 3.5T cycles is **not a whole-game reserve**. Protected relay-only admission prevents outsiders spending the relay's search/signing lane; it does not turn a frontend readiness check into onchain compute escrow. Before opening paid entries, use an enforceable reviewed funding/admission policy or owner-controlled reopening after terminal games. Direct contract callers must be considered.

## Game length and prize limits

40/60/80/100 Black decisions are scenarios, not legal maxima. The adapter currently accepts **1,024 plies** and **512 engine/coordinator jobs per game**. This is an implementation ceiling, not a proven maximum from the draw rules. Repeating the representative cost even at that ceiling gives about **${fmt(report.capacityAndPrizes.representativeCostAt512DecisionsFor20GamesICP,0)} ICP** for twenty games before contingency and overhead. Arbitrary full-game coverage is not established by the 80-decision plan. Longer-history support or an explicitly approved challenge variant needs separate review; silently weakening the bot is not an option.

The 1M GH0ST pool funds **one checkmate payout**. Human checkmate automatically pauses entries for review and replenishment. Twenty wins would need 20M GH0ST, which is not authorized here. Twenty entry fees total 500,000 GH0ST; they do not automatically become ICP or ETH.

## Reproduce

After final passing engine/coordinator/relay evidence and the saved certified rate are frozen, run from research/chess:

\`\`\`sh
node ops/hybrid/costs.mjs --write
node ops/hybrid/twenty-games.mjs --write
\`\`\`

The calculator makes no network or financial calls. It rejects stale cost inputs or mismatched release evidence, then writes only this document and [twenty-games.json](twenty-games.json). The JSON records exact cycle arithmetic, source SHA256 input snapshots, release hashes and funding reconciliation. A hash snapshot is not a claim that a future upgrade uses those bytes.
`;
if(process.argv.includes('--write')){
  fs.writeFileSync(new URL('./twenty-games.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(new URL('./TWENTY_GAMES.md',import.meta.url),markdown);
}
console.log(JSON.stringify({rate:report.rate,representativeTurnICP:report.representativeTurn.ICP,scenarios,proposedCapital:report.proposedCapitalReview,fundingSnapshot:report.fundingSnapshot,dailyQuota:report.dailyQuota,outputWritten:process.argv.includes('--write')},null,2));
