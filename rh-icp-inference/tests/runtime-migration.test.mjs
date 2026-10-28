import test from "node:test";
import assert from "node:assert/strict";
import { prepareRuntimeMigration } from "../worker/runtime-migration.mjs";

const H = byte => "0x" + byte.repeat(32);
const oldGateway = "0x" + "11".repeat(20), newGateway = "0x" + "22".repeat(20);
function input() {
  return { oldGateway, newGateway, oldArtifactHash: H("aa"), newArtifactHash: H("bb"),
    nowMs: Date.parse("2026-10-26T17:00:00Z"), evidenceRef: "reviewed-new-artifact.json", coordinatorPaused: true,
    coordinatorJobs: [{ phase: { Complete: null }, busy: false }, { phase: { Failed: null }, busy: false }],
    journal: { version: 1, binding: { chainId: 4663, gateway: oldGateway,
      canisterId: "6jacx-5yaaa-aaaaj-a65jq-cai", swapSourcesHash: H("33") }, nextBlock: 123456,
      requests: [{ id: H("44"), rawTransaction: "retained signed bytes", transactionHash: H("55"),
        delivery: { confirmed: true, answer: "A previously confirmed thought." }, memoryAcknowledged: true,
        publication: { status: "posted", postId: "123" } }, { id: H("66"), state: "queued" }],
      buyQueue: { activeSourceId: null, entries: [{ status: "completed" }, { status: "queued" }],
        policy: { skipFailedBuys: true } } },
    feeLedger: { schema: "gh0st-relayer-fees-v1", chainId: 4663, gateway: oldGateway,
      address: "0x" + "77".repeat(20), dailyBudgetWei: null, reservations: [
        { status: "confirmed", transactionHash: H("55"), actualFeeWei: "1000", nonce: 9, sourceId: H("44") }] } };
}

test("gateway migration preserves completed proofs, queued sources, cursor and every fee row", () => {
  const before = input(), unchanged = structuredClone(before), migrated = prepareRuntimeMigration(before);
  assert.deepEqual(before, unchanged);
  assert.deepEqual(migrated.journal.requests, before.journal.requests);
  assert.deepEqual(migrated.journal.buyQueue, before.journal.buyQueue);
  assert.equal(migrated.journal.nextBlock, before.journal.nextBlock);
  assert.deepEqual(migrated.feeLedger.reservations, before.feeLedger.reservations);
  assert.equal(migrated.journal.binding.gateway, newGateway);
  assert.equal(migrated.feeLedger.gateway, newGateway);
  assert.equal(migrated.relayerPolicyPatch.artifactHash, H("bb"));
  assert.equal(migrated.preserved.thoughtHistoryMustRemainUnchanged, true);
  assert.equal(migrated.journal.bindingHistory[0].previousBinding.gateway, oldGateway);
});

test("migration refuses running, busy, accounting-uncertain or unpaused coordinator snapshots", () => {
  for (const change of [x => { x.coordinatorPaused = false; },
    x => { x.coordinatorJobs[0].phase = { Running: null }; }, x => { x.coordinatorJobs[0].busy = true; },
    x => { x.coordinatorJobs[1].recovery = [{ accounting_uncertain: true }]; }]) {
    const value = input(); change(value); assert.throws(() => prepareRuntimeMigration(value), /coordinator/);
  }
});

test("migration refuses pending ingress, old callbacks, unposted deliveries or unsettled fee reservations", () => {
  for (const change of [x => { x.journal.buyQueue.activeSourceId = H("66"); },
    x => { x.journal.requests[1].pendingUpdate = {}; },
    x => { x.journal.requests[1].rawTransaction = "pending signed bytes"; },
    x => { x.journal.requests[0].publication.status = "sending"; },
    x => { x.journal.requests[0].memoryAcknowledged = false; },
    x => { x.feeLedger.reservations[0].status = "signed"; }]) {
    const value = input(); change(value); assert.throws(() => prepareRuntimeMigration(value));
  }
});

test("migration cannot quietly rebind a different source deployment or reuse an artifact", () => {
  for (const change of [x => { x.oldGateway = newGateway; },
    x => { x.newGateway = oldGateway; }, x => { x.newArtifactHash = x.oldArtifactHash; },
    x => { x.journal.binding.canisterId = "different"; }, x => { x.feeLedger.gateway = newGateway; }]) {
    const value = input(); change(value); assert.throws(() => prepareRuntimeMigration(value));
  }
});
