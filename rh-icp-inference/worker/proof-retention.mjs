import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

export const PROOF_RETENTION = Object.freeze({
  legacySchema: "gh0st-x-proof-sidecar-v1",
  schema: "gh0st-x-proof-sidecar-v2",
  indexSchema: "gh0st-proof-reply-retention-v1",
  archiveSchema: "gh0st-proof-reply-archive-v1",
  recentPosted: 256,
  maxJournalBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 256 * 1024,
  minFreeBytes: 64 * 1024 * 1024,
});
const POST = /^[1-9][0-9]{0,19}$/;
const HEX = /^0x[0-9a-f]{64}$/i;
const SHA = /^[0-9a-f]{64}$/;
const object = v => v && typeof v === "object" && !Array.isArray(v);
const exact = value => JSON.stringify(value);
const digest = value => createHash("sha256").update(value).digest("hex");
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const fail = message => { throw Error(message); };

function privateStat(file, maxBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      typeof process.getuid === "function" && stat.uid !== process.getuid())
    fail("Proof retention requires owned private regular files");
  if (stat.size > maxBytes) fail("Proof retention byte limit reached; reconcile storage before continuing");
  return stat;
}
function readPrivate(file, maxBytes) {
  privateStat(file, maxBytes);
  return fs.readFileSync(file);
}
function privateDirectory(directory, create = false) {
  if (!fs.existsSync(directory)) {
    if (!create) return false;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      typeof process.getuid === "function" && stat.uid !== process.getuid())
    fail("Proof archive requires an owned private directory");
  return true;
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function enoughDisk(directory, bytes, statfs = fs.statfsSync) {
  let available;
  try { const value = statfs(directory, { bigint: true }); available = BigInt(value.bavail) * BigInt(value.bsize); }
  catch { fail("Proof archive disk-space check unavailable; no compaction performed"); }
  if (available < BigInt(PROOF_RETENTION.minFreeBytes + bytes * 2))
    fail("Insufficient free disk space for proof archive; no compaction performed");
}
export const proofArchiveDirectory = file => file + ".archive";
export const archivedProofReplies = state => state.retention?.archivedReplies ?? {};

function validatePosted(parentPostId, entry) {
  const plan = entry?.plan, publication = entry?.publication;
  if (!POST.test(parentPostId) || !object(entry) || !object(plan) || !object(publication) ||
      publication.status !== "posted" || !POST.test(publication.postId ?? "") ||
      !["gh0st-x-proof-followup-v1", "gh0st-x-proof-followup-v2"].includes(plan.schema) ||
      publication.schema !== plan.schema || plan.parentPostId !== parentPostId ||
      publication.parentPostId !== parentPostId || !HEX.test(plan.planId ?? "") ||
      publication.planId !== plan.planId || !HEX.test(plan.sourceId ?? "") ||
      !HEX.test(plan.parentPlan?.planId ?? "") ||
      !HEX.test(plan.parentPlan?.delivery?.transactionHash ?? "") ||
      typeof plan.parentPlan?.delivery?.answer !== "string")
    fail("Only a complete, parent-bound posted proof reply may be archived");
  return entry;
}
function recordFor(parentPostId, entry, bindingHash) {
  validatePosted(parentPostId, entry);
  return { schema: PROOF_RETENTION.archiveSchema, bindingHash, parentPostId,
    entrySha256: digest(exact(entry)), entry };
}
function descriptorFor(record, bytes) {
  const plan = record.entry.plan;
  return { parentPostId: record.parentPostId, planId: plan.planId,
    sourceId: plan.sourceId, parentPlanId: plan.parentPlan.planId,
    callbackTransactionHash: plan.parentPlan.delivery.transactionHash,
    answerSha256: digest(plan.parentPlan.delivery.answer),
    replyPostId: record.entry.publication.postId, entrySha256: record.entrySha256,
    file: record.parentPostId + "-" + record.entrySha256 + ".json",
    recordSha256: digest(bytes) };
}
function validateDescriptor(parentPostId, descriptor) {
  if (!object(descriptor) || descriptor.parentPostId !== parentPostId || !POST.test(parentPostId) ||
      !HEX.test(descriptor.planId ?? "") || !HEX.test(descriptor.sourceId ?? "") ||
      !HEX.test(descriptor.parentPlanId ?? "") || !HEX.test(descriptor.callbackTransactionHash ?? "") ||
      !POST.test(descriptor.replyPostId ?? "") || !SHA.test(descriptor.answerSha256 ?? "") ||
      !SHA.test(descriptor.entrySha256 ?? "") || !SHA.test(descriptor.recordSha256 ?? "") ||
      descriptor.file !== parentPostId + "-" + descriptor.entrySha256 + ".json")
    fail("Invalid durable proof-reply deduplication index");
}

function validateState(state, binding) {
  if (!object(state) || ![PROOF_RETENTION.legacySchema, PROOF_RETENTION.schema].includes(state.schema) ||
      exact(state.binding) !== exact(binding) || !object(state.replies))
    fail("Sidecar journal belongs to another source or has invalid retention metadata");
  for (const [id, entry] of Object.entries(state.replies)) {
    if (!POST.test(id) || !object(entry)) fail("Invalid proof sidecar hot entry");
  }
  if (state.schema === PROOF_RETENTION.legacySchema) {
    if (state.retention !== undefined) fail("Legacy proof state cannot contain an archive index");
    return;
  }
  const index = state.retention;
  if (!object(index) || index.schema !== PROOF_RETENTION.indexSchema ||
      index.bindingHash !== digest(exact(binding)) || !object(index.archivedReplies))
    fail("Invalid durable proof-reply retention metadata");
  for (const [id, descriptor] of Object.entries(index.archivedReplies)) {
    validateDescriptor(id, descriptor);
    if (Object.hasOwn(state.replies, id)) fail("Proof reply appears in both hot and archived state");
  }
}

/** Verify every referenced immutable file and any durable pre-commit orphan.
 * A crash after archive fsync and before journal rename leaves a harmless
 * duplicate of an exact hot posted entry. Any other orphan fails closed. */
function verifyArchive(file, state) {
  const directory = proofArchiveDirectory(file), descriptors = archivedProofReplies(state);
  if (!privateDirectory(directory)) {
    if (Object.keys(descriptors).length) fail("A committed proof archive is missing");
    return;
  }
  const remaining = new Set(Object.keys(descriptors));
  for (const name of fs.readdirSync(directory)) {
    if (!/^[1-9][0-9]{0,19}-[0-9a-f]{64}\.json$/.test(name))
      fail("Unexpected proof archive file requires reconciliation");
    const bytes = readPrivate(path.join(directory, name), PROOF_RETENTION.maxArchiveBytes);
    let record; try { record = JSON.parse(bytes); } catch { fail("Proof archive bytes are invalid"); }
    if (record.schema !== PROOF_RETENTION.archiveSchema || record.bindingHash !== digest(exact(state.binding)) ||
        record.entrySha256 !== digest(exact(record.entry))) fail("Proof archive integrity check failed");
    const descriptor = descriptorFor(record, bytes);
    if (descriptor.file !== name) fail("Proof archive filename integrity check failed");
    const indexed = descriptors[record.parentPostId];
    if (indexed) {
      if (exact(indexed) !== exact(descriptor)) fail("Proof archive differs from its committed deduplication index");
      remaining.delete(record.parentPostId);
    } else {
      const hot = state.replies[record.parentPostId];
      if (!hot || hot.publication?.status !== "posted" || digest(exact(hot)) !== record.entrySha256)
        fail("Unindexed proof archive requires reconciliation before sending");
    }
  }
  if (remaining.size) fail("A committed proof archive is missing");
}

export function loadRetainedProofState(file, binding) {
  if (!fs.existsSync(file)) {
    const directory = proofArchiveDirectory(file);
    if (privateDirectory(directory) && fs.readdirSync(directory).length)
      fail("Proof journal is missing while an archive exists; reconcile before sending");
    return { schema: PROOF_RETENTION.legacySchema, binding, replies: {} };
  }
  let state;
  try { state = JSON.parse(readPrivate(file, PROOF_RETENTION.maxJournalBytes)); }
  catch (error) { if (error.message?.startsWith("Proof ")) throw error; fail("Proof journal is unavailable or exceeds its byte limit"); }
  validateState(state, binding); verifyArchive(file, state); return state;
}

function assertPreserved(previous, incoming, planned) {
  for (const [id, descriptor] of Object.entries(archivedProofReplies(previous))) {
    if (exact(archivedProofReplies(planned)[id]) !== exact(descriptor))
      fail("A durable proof deduplication entry cannot be dropped or rewritten");
  }
  for (const [id, entry] of Object.entries(previous.replies)) {
    if (Object.hasOwn(incoming.replies, id)) continue;
    if (entry.publication?.status !== "posted" || !archivedProofReplies(planned)[id])
      fail("A proof reply cannot be discarded during retention");
  }
}

/** File fsync + directory fsync happen before the compact journal can commit.
 * Only successfully posted replies are moved. Every uncertain/pending entry
 * remains hot, regardless of count. The durable index has a byte safeguard,
 * while the archive is limited by actual available disk rather than job age. */
export function saveRetainedProofState(file, state, { recentPosted = PROOF_RETENTION.recentPosted,
  onArchiveDurable, beforeJournalCommit, statfs = fs.statfsSync } = {}) {
  if (!Number.isSafeInteger(recentPosted) || recentPosted < 1) fail("Invalid proof hot-window size");
  validateState(state, state.binding);
  const previous = loadRetainedProofState(file, state.binding);
  privateDirectory(path.dirname(file), true);
  const next = structuredClone(state), posted = Object.keys(next.replies)
    .filter(id => next.replies[id].publication?.status === "posted")
    .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  const candidates = posted.slice(0, Math.max(0, posted.length - recentPosted));
  const records = [];
  if (candidates.length) {
    next.schema = PROOF_RETENTION.schema;
    next.retention ??= { schema: PROOF_RETENTION.indexSchema,
      bindingHash: digest(exact(next.binding)), archivedReplies: {} };
    for (const id of candidates) {
      const record = recordFor(id, next.replies[id], next.retention.bindingHash), bytes = encoded(record);
      if (bytes.length > PROOF_RETENTION.maxArchiveBytes) fail("Proof archive record exceeds its byte limit");
      const descriptor = descriptorFor(record, bytes);
      if (next.retention.archivedReplies[id]) fail("A proof parent cannot be archived twice");
      next.retention.archivedReplies[id] = descriptor; records.push({ descriptor, bytes });
      delete next.replies[id];
    }
  }
  validateState(next, next.binding);
  if (previous) assertPreserved(previous, state, next);
  const body = encoded(next);
  if (body.length > PROOF_RETENTION.maxJournalBytes)
    fail("Proof journal byte limit reached; archive/index maintenance is required before continuing");
  enoughDisk(path.dirname(file), body.length + records.reduce((n, r) => n + r.bytes.length, 0), statfs);
  const directory = proofArchiveDirectory(file);
  if (records.length) privateDirectory(directory, true);
  for (const { descriptor, bytes } of records) {
    const target = path.join(directory, descriptor.file);
    if (fs.existsSync(target)) {
      if (!readPrivate(target, PROOF_RETENTION.maxArchiveBytes).equals(bytes))
        fail("Existing immutable proof archive differs; reconcile before continuing");
    } else {
      // Stage outside the archive directory: an interrupted write must never
      // appear under a committed immutable record's filename. link() publishes
      // the fully fsynced inode without overwriting any existing record.
      const staging = file + "." + randomBytes(6).toString("hex") + ".archive.tmp";
      const fd = fs.openSync(staging, "wx", 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try {
        try { fs.linkSync(staging, target); }
        catch (error) {
          if (error.code !== "EEXIST" || !readPrivate(target, PROOF_RETENTION.maxArchiveBytes).equals(bytes))
            throw error;
        }
        syncDirectory(directory);
      } finally {
        fs.unlinkSync(staging); syncDirectory(path.dirname(file));
      }
    }
    onArchiveDurable?.(descriptor);
  }
  const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  const fd = fs.openSync(tmp, "wx", 0o600);
  try { fs.writeFileSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  beforeJournalCommit?.();
  fs.renameSync(tmp, file); syncDirectory(path.dirname(file));
  // Preserve retained entry identities: the sender may hold a reference whose
  // next mutation is its durable "sending" intent. Replacing hot entries with
  // clones would detach that reference and lose the intent before broadcast.
  const replies = state.replies;
  for (const id of Object.keys(replies)) if (!Object.hasOwn(next.replies, id)) delete replies[id];
  for (const [id, entry] of Object.entries(next.replies)) if (!Object.hasOwn(replies, id)) replies[id] = entry;
  for (const key of Object.keys(state)) if (key !== "replies") delete state[key];
  Object.assign(state, next, { replies });
}

/** Remove archived completed parents before the existing planner runs. Compact
 * metadata binds the same source, parent publication and callback; it is never
 * interpreted as authorization to send another reply. */
export function unarchivedProofInputs(journal, state) {
  const index = archivedProofReplies(state);
  if (!Array.isArray(journal?.requests)) return journal;
  const requests = journal.requests.filter(item => {
    const parent = item?.publication?.postId, descriptor = index[parent];
    if (!descriptor) return true;
    if (item.id !== descriptor.sourceId || item.publication.planId !== descriptor.parentPlanId ||
        item.delivery?.transactionHash !== descriptor.callbackTransactionHash ||
        typeof item.delivery?.answer !== "string" || digest(item.delivery.answer) !== descriptor.answerSha256)
      fail("Archived proof parent changed its source, callback or exact thought");
    return false;
  });
  return { ...journal, requests };
}

export function assertArchivedProofPlan(state, plan) {
  const descriptor = archivedProofReplies(state)[plan.parentPostId];
  if (!descriptor) return false;
  if (descriptor.planId !== plan.planId || descriptor.sourceId !== plan.sourceId)
    fail("Archived proof reply changed its fixed plan");
  return true;
}
