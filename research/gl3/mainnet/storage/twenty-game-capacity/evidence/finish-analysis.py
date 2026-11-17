"""Runpod-only arithmetic/provenance reconciliation; no search or database write."""
from pathlib import Path
import hashlib,json,platform

if platform.system()!="Linux":raise SystemExit("Run on Runpod only")
root=Path('/root/gl3-twenty-game-capacity');out=root/'evidence'
read=lambda p:json.loads(Path(p).read_text())
def sha(p):return hashlib.file_digest(Path(p).open('rb'),'sha256').hexdigest()
measurement=read(out/'completed-database-measurement.json')
before=read(out/'database-files-before.json');after=read(out/'database-files-after.json')
a={r['path']:r for r in before};b={r['path']:r for r in after}
content_fields=['path','bytes','allocated','inode','SHA256']
content_equal=set(a)==set(b) and all(all(a[k][f]==b[k][f] for f in content_fields) for k in a)
changes=[k for k in a if a[k]!=b.get(k)]
lock_only=changes==['l2chaindata/LOCK'] and content_equal
lock_source=Path('/root/go/pkg/mod/github.com/cockroachdb/pebble@v1.1.5/vfs/file_lock_unix.go')
source_text=lock_source.read_text();expected_lock_call='f, err := os.Create(name)' in source_text
reconciliation={'measurementTestExitCode':read(out/'exit.json')['exitCode'],'originalStrictAllMetadataGatePassed':False,'all297ContentHashesSizesInodesAllocatedUnchanged':content_equal,'allNonLockMetadataUnchanged':lock_only,'onlyChangedPath':changes,'lockSource':str(lock_source),'lockSourceSHA256':sha(lock_source),'sourceBackedOsCreateOnLock':expected_lock_call,'lockMtimeWasNotRestored':True,'stateCommitted':False,'scope':'Data and measured roots unchanged; opening read-only Pebble touched the empty LOCK timestamp. Original strict failure is preserved.'}
(out/'lock-metadata-reconciliation.json').write_text(json.dumps(reconciliation,indent=2)+'\n')
if not(content_equal and lock_only and expected_lock_call):raise SystemExit('Unexpected DB mutation; cannot use measurement')
seed=measurement['genesisCurrentState']['CodeUniqueBytes'];per=measurement['deltaUniqueCodeBytes']
games,moves=20,80;decisions=games*moves
capacities=[]
for disk in [512_000_000_000,1_000_000_000_000]:
    payload_budget=disk*80//100-seed
    capacities.append({'advertisedDecimalDiskBytes':disk,'planningReservePercent':20,'remainingBeforeOtherOverheadBytes':payload_budget,'maximumAverageUniqueCodeBytesPerDecision':payload_budget//decisions,'requiredReductionOrCrossDecisionDedupFractionAtMeasuredRate':1-payload_budget/(decisions*per),'codeOnlyDecisionCapacityAtMeasuredRate':payload_budget//per,'codeOnlyWhole80MoveGameCapacityAtMeasuredRate':payload_budget//(moves*per),'twentyGamesAccepted':False})
dedup=[]
for numerator,denominator in [(0,1),(1,4),(1,2),(3,4),(9,10)]:
    extra=decisions*per*(denominator-numerator)//denominator
    dedup.append({'hypotheticalCrossDecisionCodeDedupFraction':numerator/denominator,'codePayloadWithSharedSeedBytes':seed+extra,'scope':'Sensitivity only; no cross-game dedup ratio was measured'})
export=read('/root/bounded-restore/final-state-export/export-manifest.json')
envelope={'status':'BLOCKED_20X80_CAPACITY_NOT_ACCEPTED','allExecutionOnRunpod':True,'selectedMachineUnchanged':True,'unchangedEngineSearchesRunByThisLane':0,'measuredCompletedDecisionsInPersistedDatabase':1,'nativeContinuationEvidenceExistsButSecondDecisionStorageNotMeasured':True,'planningGames':games,'planningBlackDecisionsPerGame':moves,'planningTotalBlackDecisions':decisions,'sharedSeedUniqueCodeBytes':seed,'measuredFirstDecisionUniqueDeltaCodeBytes':per,'observedNoDedupWithinDeltaCode':measurement['deltaUniqueCodeRecords']==measurement['authenticatedDeltaChunkReferences'],'allCodeStillReferencedAtCurrentHead':measurement['unreferencedCodeBytes']==0,'oneGame80DecisionsAtMeasuredNoCrossDecisionDedupRateBytes':seed+moves*per,'twentyGames1600DecisionsAtMeasuredNoCrossDecisionDedupRateBytes':seed+decisions*per,'twentyIndependentOneDecisionStatesAtSameRateBytes':seed+games*per,'currentProtocolActiveGameAdmission':1,'twentySimultaneousActiveGamesAccepted':False,'finalChildDBFileLengthBytes':sum(r['bytes'] for r in after),'finalChildDBAllocatedBytes':sum(r['allocated'] for r in after),'capacityScenarios':capacities,'dedupSensitivity':dedup,'checkpointA15':{'activePieces':64,'checkpointBodyBytes':162059912,'oldCodeDeleted':False,'reducesActiveRestoreAncestry':True,'reducesRetainedCodeStorage':False,'guestOrProductionAccepted':False},'frozenCompletedExportMemorySHA256':export['files']['export/memory.bin']['sha256'],'measuredMemoryMatchesFrozenExport':measurement['memorySHA256']==export['files']['export/memory.bin']['sha256'],'measuredCanonicalMatchesFrozenExport':measurement['canonicalSHA256']==export['files']['export/canonical.bin']['sha256'],'neededPersistentLayoutChange':'A separately versioned mutable fixed-address bank or authenticated shared-reference-aware retirement must remove old current-head code references; historical pruning alone cannot remove referenced blobs. Then prove journal/reorg/cache/witness correctness and archive/challenge-safe retained-disk bounds under a new STF/module root.','selected865StorageFixImplemented':False,'reasonNoSilentNativeOnlyFix':'Changing authoritative cell address/write/retirement semantics changes the STF and requires a new proof machine. Selected865 remains immutable.','scope':'Measured one completed first decision plus native continuation receipts. All1600-decision numbers are planning extrapolations, not1600 executed decisions or a workload-independent worst-case proof.'}
(out/'twenty-game-envelope.json').write_text(json.dumps(envelope,indent=2)+'\n')
sources={
 'closed-full-decision-report':'/root/gl3-process-recovery/full/attempt-02/run/full-process-recovery.json',
 'worker-manifest':'/root/gl3-process-recovery/full/attempt-02/run/worker-manifest.json',
 'completed-image-export':'/root/bounded-restore/final-state-export/export-manifest.json',
 'a15-native-checkpoint':'/root/gl3-checkpoint-integration/546810a186d247fe8d7bbf170d401ea3/evidence/native-v10/completed-native.json',
 'a15-full-continuation':'/root/gl3-checkpoint-integration/546810a186d247fe8d7bbf170d401ea3/evidence/continuation-v9/continuation-result.json',
 'selected-A14-source':'/root/future-lifecycle-865-geometry43-build/nitro/precompiles/ArbGhostChessSlices.go',
 'selected-delta-source':'/root/future-lifecycle-865-geometry43-build/nitro/precompiles/ArbGhostChessSliceDelta.go',
 'hash-pruner-source':'/root/future-lifecycle-865-geometry43-build/nitro/go-ethereum/core/state/pruner/pruner.go',
 'pebble-lock-source':str(lock_source),
}
provenance={k:{'path':v,'SHA256':sha(v),'bytes':Path(v).stat().st_size} for k,v in sources.items()}
(out/'data-source-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps({'dataContentUnchanged':content_equal,'strictMetadataGatePassed':False,'twentyGameStatus':envelope['status'],'measuredCodeBytesPerFirstDecision':per,'1600DecisionCodeOnlyExtrapolationBytes':seed+decisions*per,'capacities':capacities},indent=2))
