// Bounds and sensitivity only. Query execution/delta production are NOT measured.
const rate=1_638_900_000_000;
const turns=20*80;
const representativeEngineInstructions=972_184_038_255;
const engineInstructionsPerQuery=4_000_000_000;
const chunks=Math.ceil(representativeEngineInstructions/engineInstructionsPerQuery);
const basePerCommit=5_000_000+1_200_000;
const fixedAllowanceICP=17.99; // Includes allocated 13 ICP; do NOT add it again.
const verificationInstructionsPerSig=1_000_000; // UNMEASURED sensitivity input.
const wireMetadataBytes=2048; // UNMEASURED realistic-CBOR/Candid overhead input.
const engineStateApplyInstructionsPerByte=10; // UNMEASURED sensitivity input.
const cases=[];
for(const averageDeltaBytes of [8,16,32,64,128,256,512,1024].map(k=>k*1024)) {
  const ingressBytes=averageDeltaBytes+wireMetadataBytes;
  const commitCycles=basePerCommit+2_000*ingressBytes+9*verificationInstructionsPerSig+
    engineStateApplyInstructionsPerByte*averageDeltaBytes;
  const commitICP=turns*chunks*commitCycles/rate;
  const row={averageDeltaBytes,ingressOnlyICP:turns*chunks*2_000*ingressBytes/rate,
    assumedCommitWorkICP:commitICP,
    withExistingAutonomousBridgeICP:fixedAllowanceICP+commitICP+turns*(32_095_715_090+37_343_176_982)/rate,
    withBrowserSubmissionAndExistingCoordinatorICP:fixedAllowanceICP+commitICP+turns*32_095_715_090/rate};
  cases.push(row);
}
console.log(JSON.stringify({scope:'unmeasured custom quorum-query design cost sensitivity, not 20-game funding proof',
  games:20,blackDecisionsPerGame:80,turns,rateAt:'2026-11-15T14:29:00Z',cyclesPerICP:rate,
  representativeEngineInstructions,maximumOfficialInstructionsPerQuery:5_000_000_000,
  engineInstructionsPerQuery,chunksPerRepresentativeTurn:chunks,
  assumptions:{fixedAllowanceICP,verificationInstructionsPerSig,wireMetadataBytes,engineStateApplyInstructionsPerByte,
    signaturesPerCommit:9,ingressCyclesPerByte:2000,queryComputePriceCycles:0,
    allNewCodeUnmeasured:true,alreadyConvertedICPIncludedNotAddedAgain:true,
    noPaidMainnetQueriesOrMovesExecuted:true},cases,
  excludes:['query/chunk time variance and rate limits','query routing and node certificate verification',
    'real delta serialization/compression and capture cost','changed module installation/reserve',
    'higher compute from proof/patch verification','RH gas beyond existing capped authority','games beyond assumed80 Black decisions']},null,2));
