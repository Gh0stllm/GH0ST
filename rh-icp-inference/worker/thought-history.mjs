import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { keccak256, toUtf8Bytes } from "ethers";
import { swapSourceId } from "./swaps.mjs";

export const THOUGHT_HISTORY_SCHEMA = "gh0st-thought-history-v1";
const serverState = process.env.GH0ST_SERVER_RUNTIME === "1" ? process.env.GH0ST_STATE_DIR : null;
if (process.env.GH0ST_SERVER_RUNTIME === "1" && (!serverState || !path.isAbsolute(serverState)))
  throw Error("Server requires the existing private persistent state directory");
export const DEFAULT_THOUGHT_HISTORY_JOURNALS = Object.freeze([
  "rh-pilot-v2-worker.json", "buy-worker.json", "buy-worker-unlimited.json",
].map(name => serverState ? path.join(serverState, name) : fileURLToPath(new URL("../.state/" + name, import.meta.url))));

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const stages = new Set(["historical", "relay", "publish", "delivered", "posted"]);
const copy = value => JSON.parse(JSON.stringify(value));

function problem(message, code = "THOUGHT_HISTORY_INVALID") {
  const error = Error(message);
  error.code = code;
  return error;
}
function hash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw problem("Invalid " + label);
  return value.toLowerCase();
}
export function exactThoughtHash(answer) {
  if (typeof answer !== "string" || !answer.length) throw problem("Thought text is missing");
  let bytes;
  try { bytes = toUtf8Bytes(answer); } catch { throw problem("Thought is not valid UTF-8 text"); }
  if (bytes.length > 8192) throw problem("Thought exceeds the supported byte length");
  return keccak256(bytes);
}
function thought(value) {
  if (!value || typeof value !== "object") throw problem("Thought record is missing");
  const sourceId = hash(value.sourceId ?? value.requestId, "thought source ID");
  const answerHash = hash(value.answerHash, "thought answer hash");
  if (exactThoughtHash(value.answer) !== answerHash) throw problem("Thought text differs from its answer hash");
  const stage = value.stage ?? "historical";
  if (!stages.has(stage)) throw problem("Invalid thought history stage");
  return { sourceId, answer: value.answer, answerHash, stage };
}
function newHistory(chainId, canisterId) {
  return { schema: THOUGHT_HISTORY_SCHEMA, chainId, canisterId, sources: {}, hashes: {}, seededFrom: [] };
}
function validateHistory(history, chainId, canisterId) {
  if (!history || history.schema !== THOUGHT_HISTORY_SCHEMA || history.chainId !== chainId || history.canisterId !== canisterId ||
      !history.sources || Array.isArray(history.sources) || !history.hashes || Array.isArray(history.hashes) || !Array.isArray(history.seededFrom))
    throw problem("Thought history schema or chain/coordinator binding differs");
  for (const [id, source] of Object.entries(history.sources)) {
    const item = thought({ ...source, sourceId: id });
    if (source.sourceId !== item.sourceId || !Array.isArray(source.stages) || source.stages.some(stage => !stages.has(stage)))
      throw problem("Corrupt thought source index");
    const entry = history.hashes[item.answerHash];
    if (!entry || entry.answer !== item.answer || !entry.sourceIds?.includes(id)) throw problem("Thought source/hash index differs");
  }
  for (const [key, entry] of Object.entries(history.hashes)) {
    if (hash(key, "indexed answer hash") !== exactThoughtHash(entry.answer) || !Array.isArray(entry.sourceIds) || !entry.sourceIds.length ||
        new Set(entry.sourceIds).size !== entry.sourceIds.length || entry.ownerSourceId !== entry.sourceIds[0])
      throw problem("Corrupt thought hash index");
    for (const id of entry.sourceIds) if (history.sources[id]?.answerHash !== key) throw problem("Thought hash/source index differs");
  }
  return history;
}
function insert(history, value) {
  const item = thought(value);
  const existing = history.sources[item.sourceId];
  if (existing && (existing.answer !== item.answer || existing.answerHash !== item.answerHash))
    throw problem("A source ID has conflicting historical thoughts");
  if (!existing) history.sources[item.sourceId] = { ...item, stages: [] };
  const record = history.sources[item.sourceId];
  if (!record.stages.includes(item.stage)) record.stages.push(item.stage);
  const group = history.hashes[item.answerHash] ??= { answer: item.answer, ownerSourceId: item.sourceId, sourceIds: [] };
  if (group.answer !== item.answer) throw problem("Thought hash collision");
  if (!group.sourceIds.includes(item.sourceId)) group.sourceIds.push(item.sourceId);
  return item;
}
function unique(history, value) {
  const item = thought(value);
  const existing = history.sources[item.sourceId];
  if (existing && (existing.answer !== item.answer || existing.answerHash !== item.answerHash))
    throw problem("A source ID cannot replace its reserved thought");
  const group = history.hashes[item.answerHash];
  if (group && group.ownerSourceId !== item.sourceId) {
    const error = problem("Exact thought already belongs to another source", "DUPLICATE_THOUGHT");
    error.duplicateSourceId = group.ownerSourceId;
    error.answerHash = item.answerHash;
    error.sourceId = item.sourceId;
    throw error;
  }
  return item;
}

function journalThoughts(journal, chainId, canisterId) {
  if (!journal || journal.version !== 1 || !journal.binding || Number(journal.binding.chainId) !== chainId ||
      journal.binding.canisterId !== canisterId || !ADDRESS.test(journal.binding.gateway ?? "") || !Array.isArray(journal.requests))
    throw problem("Historical worker journal schema or binding differs");
  const result = [];
  const ids = new Set();
  for (const item of journal.requests) {
    const id = hash(item.id, "historical request ID");
    if (ids.has(id)) throw problem("Duplicate source ID in a worker journal");
    ids.add(id);
    const signed = item.result;
    const delivered = item.delivery;
    const publication = item.publication;
    const sent = publication && (publication.status === "posted" || publication.status === "sending" || publication.status === "needs_reconciliation" ||
      Number(publication.attempt ?? 0) > 0 || publication.postId != null || publication.startedAt != null);
    if ((item.state === "fulfilled" || sent) && delivered?.confirmed !== true)
      throw problem("Completed or attempted publication lacks confirmed thought history");
    if (!signed && !delivered) continue;
    if (item.kind === "swap") {
      if (!item.source || swapSourceId(chainId, item.source) !== id) throw problem("Historical swap source ID does not match its source");
    }
    let normalized;
    if (signed) {
      if (!signed.result || hash(signed.result.requestId, "signed request ID") !== id) throw problem("Signed thought source ID differs");
      normalized = thought({ sourceId: id, answer: signed.answer, answerHash: signed.result.answerHash, stage: "historical" });
    }
    if (delivered) {
      if (delivered.confirmed !== true) throw problem("Historical delivery is not confirmed");
      hash(delivered.transactionHash, "historical callback transaction");
      hash(delivered.blockHash, "historical callback block");
      if (delivered.requestId !== undefined && hash(delivered.requestId, "delivered request ID") !== id) throw problem("Delivered source ID differs");
      const output = thought({ sourceId: id, answer: delivered.answer, answerHash: delivered.answerHash, stage: sent && publication.status === "posted" ? "posted" : "delivered" });
      if (normalized && (normalized.answerHash !== output.answerHash || normalized.answer !== output.answer)) throw problem("Signed and delivered thoughts differ");
      normalized = output;
    }
    result.push(normalized);
  }
  return result;
}

function readJson(file, label) {
  try {
    if (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw Error("not a regular file");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { throw problem(label + " is missing, corrupt, or not a regular file", "THOUGHT_HISTORY_UNAVAILABLE"); }
}
function writeAtomic(file, history) {
  const temporary = file + ".tmp-" + randomUUID();
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(history, null, 2) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/**
 * A local, append-only ownership index for exact UTF-8 thought text. All supplied
 * journals are required on every operation; an absent or corrupt history never
 * becomes an empty history. Historical duplicates are retained, with the first
 * recorded source owning the text. No network calls or publication occurs here.
 *
 * Call reserve before signing/broadcasting a new RH callback and before new X
 * publication. Already-sent transaction reconciliation must happen separately.
 */
export function openThoughtHistory({ file, journalFiles = DEFAULT_THOUGHT_HISTORY_JOURNALS, chainId = 4663,
  canisterId = "6jacx-5yaaa-aaaaj-a65jq-cai" } = {}) {
  if (typeof file !== "string" || !file.length || !Number.isSafeInteger(chainId) || chainId <= 0 ||
      typeof canisterId !== "string" || !canisterId.length || !Array.isArray(journalFiles) || journalFiles.length === 0)
    throw problem("A history path, binding, and nonempty required journal set are required");
  const target = path.resolve(file);
  const journals = [...new Set(journalFiles.map(name => {
    if (typeof name !== "string" || !name.length) throw problem("Invalid required journal path");
    return path.resolve(name);
  }))];
  if (journals.includes(target)) throw problem("History cannot also be a worker journal");
  let hasOpened = false;
  function operation(change) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    let lock;
    try { lock = fs.openSync(target + ".lock", "wx", 0o600); }
    catch { throw problem("Thought history is locked; reconcile the prior writer before retrying", "THOUGHT_HISTORY_LOCKED"); }
    try {
      if (hasOpened && !fs.existsSync(target)) throw problem("Previously opened thought history is missing", "THOUGHT_HISTORY_UNAVAILABLE");
      const history = fs.existsSync(target) ? validateHistory(readJson(target, "Thought history"), chainId, canisterId) : newHistory(chainId, canisterId);
      for (const journal of journals) {
        for (const item of journalThoughts(readJson(journal, "Required worker journal"), chainId, canisterId)) insert(history, item);
        if (!history.seededFrom.includes(journal)) history.seededFrom.push(journal);
      }
      const output = change(history);
      validateHistory(history, chainId, canisterId);
      writeAtomic(target, history);
      hasOpened = true;
      return copy(output);
    } finally { fs.closeSync(lock); fs.unlinkSync(target + ".lock"); }
  }
  operation(history => history);
  return Object.freeze({
    assertUnique(value) { return operation(history => unique(history, value)); },
    reserve(value) { return operation(history => insert(history, unique(history, value))); },
    // Reconcile an already-confirmed historical result without erasing a prior
    // owner. A later assertUnique/reserve still rejects its duplicate text.
    record(value) { return operation(history => insert(history, value)); },
    snapshot() { return operation(history => history); },
  });
}
