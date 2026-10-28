import { getAddress } from "ethers";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const copy = value => structuredClone(value);
function hash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw Error("Invalid " + label);
  return value.toLowerCase();
}
function phase(job) { return Object.keys(job?.phase ?? {})[0]; }

/** Pure preparation only. The operator must stop the writer and verify the
 * paused coordinator before saving these results and restarting its worker. */
export function prepareRuntimeMigration({ journal, feeLedger, oldGateway, newGateway,
  oldArtifactHash, newArtifactHash, coordinatorJobs, coordinatorPaused,
  nowMs, evidenceRef } = {}) {
  oldGateway = getAddress(oldGateway);
  newGateway = getAddress(newGateway);
  oldArtifactHash = hash(oldArtifactHash, "old artifact hash");
  newArtifactHash = hash(newArtifactHash, "new artifact hash");
  if (oldGateway === newGateway || oldArtifactHash === newArtifactHash)
    throw Error("A fresh gateway and artifact binding are required");
  if (coordinatorPaused !== true || !Array.isArray(coordinatorJobs) || coordinatorJobs.some(job =>
    job.busy !== false || !["Complete", "Failed"].includes(phase(job)) ||
    Object.keys(job.phase ?? {}).length !== 1 || job.recovery?.some(value => value.accounting_uncertain)))
    throw Error("Pause and reconcile all coordinator work before rebinding");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || typeof evidenceRef !== "string" || !evidenceRef.trim())
    throw Error("Migration timestamp and reviewed evidence are required");
  if (journal?.version !== 1 || journal.binding?.chainId !== 4663 ||
      journal.binding?.canisterId !== "6jacx-5yaaa-aaaaj-a65jq-cai" ||
      getAddress(journal.binding.gateway) !== oldGateway || !Array.isArray(journal.requests) ||
      !Array.isArray(journal.buyQueue?.entries) || journal.buyQueue.activeSourceId != null)
    throw Error("Worker journal is not idle and bound to the reviewed gateway");
  if (journal.requests.some(item => item.pendingUpdate || item.pendingResume || item.buyHalt ||
      (item.rawTransaction && item.delivery?.confirmed !== true) ||
      (item.transactionHash && item.delivery?.confirmed !== true) ||
      (item.result && item.delivery?.confirmed !== true && item.state !== "skipped") ||
      (item.publication && ((item.publication.status !== "posted" &&
        !["ready", "disabled"].includes(item.publication.status)) ||
        (item.publication.status !== "posted" && (item.publication.attempt ?? 0) > 0)))))
    throw Error("Reconcile pending updates, old callbacks and publications before rebinding");
  if (journal.requests.some(item => item.delivery?.confirmed &&
      (item.publication?.status !== "posted" || item.memoryAcknowledged !== true)))
    throw Error("Finish confirmed delivery acknowledgements before rebinding");
  if (feeLedger?.schema !== "gh0st-relayer-fees-v1" || feeLedger.chainId !== 4663 ||
      getAddress(feeLedger.gateway) !== oldGateway || !Array.isArray(feeLedger.reservations) ||
      feeLedger.reservations.some(entry => entry.status !== "confirmed" ||
        typeof entry.transactionHash !== "string" || !HASH.test(entry.transactionHash) ||
        !/^(0|[1-9]\d*)$/.test(String(entry.actualFeeWei))))
    throw Error("Reconcile all historical fee reservations before rebinding");
  const transition = { at: new Date(nowMs).toISOString(), fromGateway: oldGateway,
    toGateway: newGateway, fromArtifactHash: oldArtifactHash, toArtifactHash: newArtifactHash, evidenceRef };
  const migratedJournal = copy(journal);
  migratedJournal.bindingHistory ??= [];
  migratedJournal.bindingHistory.push({ ...transition, previousBinding: copy(journal.binding) });
  migratedJournal.binding.gateway = newGateway.toLowerCase();
  const migratedFees = copy(feeLedger);
  migratedFees.bindingHistory ??= [];
  migratedFees.bindingHistory.push(copy(transition));
  migratedFees.gateway = newGateway;
  return { journal: migratedJournal, feeLedger: migratedFees, transition,
    envPatch: { RH_GATEWAY: newGateway },
    relayerPolicyPatch: { gateway: newGateway, artifactHash: newArtifactHash },
    preserved: { requests: journal.requests.length, queuedEntries: journal.buyQueue.entries.length,
      feeReservations: feeLedger.reservations.length, nextBlock: journal.nextBlock,
      thoughtHistoryMustRemainUnchanged: true } };
}
