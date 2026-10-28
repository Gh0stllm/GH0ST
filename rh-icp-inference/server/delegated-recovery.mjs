import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {Actor, HttpAgent, IC_REQUEST_AUTH_DELEGATION_DOMAIN_SEPARATOR, requestIdOf} from "@icp-sdk/core/agent";
import {DelegationChain, DelegationIdentity, Ed25519KeyIdentity} from "@icp-sdk/core/identity";
import {Principal} from "@icp-sdk/core/principal";
import {idlFactory} from "../worker/candid.mjs";
import {listCoordinatorJobs} from "../worker/job-history.mjs";
import {swapSourceId} from "../worker/swaps.mjs";

export const RECOVERY_COORDINATOR = "6jacx-5yaaa-aaaaj-a65jq-cai";
export const RECOVERY_OWNER = "uk6ji-rtv4f-j3fqm-5ngmm-genqp-yhglz-xeetj-qnavf-ia55g-um3ru-3qe";
export const RECOVERY_REASON = "user authorized skip failed generation";
export const RECOVERY_MAX_REMAINING_MS = 30 * 24 * 60 * 60 * 1000;
const START_MINIMUM_REMAINING_MS = 15 * 60 * 1000;
const UPDATE_MINIMUM_REMAINING_MS = 60 * 1000;
const MAX_NAT128 = (1n << 128n) - 1n;
const HASH = /^0x[0-9a-f]{64}$/;
const SESSION_FILE = "coordinator-recovery-session";
const DELEGATION_FILE = "coordinator-recovery-delegation";
function blocked(message) {const error = Error(message); error.code = "DELEGATED_RECOVERY_BLOCKED"; return error;}
function bytes(value) {return Buffer.from(value);}
function equal(a, b) {const left = bytes(a), right = bytes(b); return left.length === right.length && crypto.timingSafeEqual(left, right);}
function assertTime(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw blocked("Invalid recovery verification time");
  return value;
}
function exactKeys(object, required, optional = []) {
  if (!object || typeof object !== "object" || Array.isArray(object) ||
      required.some(key => !Object.hasOwn(object, key)) ||
      Object.keys(object).some(key => !required.includes(key) && !optional.includes(key)))
    throw blocked("Unexpected recovery credential fields");
}
function parseJson(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 32768) throw blocked("Invalid recovery credential encoding");
  try {return JSON.parse(value);} catch {throw blocked("Invalid recovery credential JSON");}
}
function parseSession(value) {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some(item => typeof item !== "string" || !/^[0-9a-f]+$/i.test(item)) ||
      parsed[1].length !== 64 || parsed[0].length !== 88)
    throw blocked("Recovery session must be a serialized Ed25519 session identity");
  const secret = Buffer.from(parsed[1], "hex");
  try {
    if (secret.every(byte => byte === 0)) throw blocked("Recovery session must have a nonzero private seed");
    const session = Ed25519KeyIdentity.fromSecretKey(Uint8Array.from(secret));
    if (!equal(session.getPublicKey().toDer(), Buffer.from(parsed[0], "hex")))
      throw blocked("Recovery session public and private keys differ");
    return session;
  } finally {secret.fill(0);}
}
function verifySignature(publicDer, signature, message) {
  try {
    const key = crypto.createPublicKey({key: bytes(publicDer), format: "der", type: "spki"});
    if (key.asymmetricKeyType === "ed25519") return crypto.verify(null, message, key, bytes(signature));
    if (key.asymmetricKeyType === "ec" && ["prime256v1", "secp256k1"].includes(key.asymmetricKeyDetails?.namedCurve))
      return crypto.verify("sha256", message, {key, dsaEncoding: "ieee-p1363"}, bytes(signature));
  } catch {return false;}
  return false;
}

/** Offline verification only. expectedOwner is an explicit unit-test seam;
 * the production loader below always supplies the fixed deployed owner.
 * Target scoping is cryptographic. Method scoping is only the local wrapper:
 * possession of these credentials authorizes ALL owner methods on coordinator.
 * A delegation has no issued-at field, so the 30-day check bounds remaining
 * validity, not an independently provable original issuance duration. */
export function validateRecoveryDelegation({sessionJson, delegationJson, nowMs = Date.now(),
  expectedOwner = RECOVERY_OWNER, minimumRemainingMs = 0} = {}) {
  assertTime(nowMs);assertTime(minimumRemainingMs);
  const raw = parseJson(delegationJson);
  exactKeys(raw, ["publicKey", "delegations"]);
  if (typeof raw.publicKey !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(raw.publicKey) ||
      !Array.isArray(raw.delegations) || raw.delegations.length !== 1)
    throw blocked("Recovery requires one direct owner-to-session delegation");
  for (const entry of raw.delegations) {
    exactKeys(entry, ["delegation", "signature"]);
    exactKeys(entry.delegation, ["pubkey", "expiration", "targets"], ["permissions"]);
    if (typeof entry.signature !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(entry.signature) ||
        typeof entry.delegation.pubkey !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(entry.delegation.pubkey) ||
        typeof entry.delegation.expiration !== "string" || !/^[0-9a-f]+$/i.test(entry.delegation.expiration) ||
        !Array.isArray(entry.delegation.targets) || entry.delegation.targets.length !== 1 ||
        entry.delegation.targets.some(target => typeof target !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(target)) ||
        ![undefined, "all"].includes(entry.delegation.permissions))
      throw blocked("Recovery delegation encoding or update permission is invalid");
  }
  let chain;
  try {chain = DelegationChain.fromJSON(raw);} catch {throw blocked("Recovery delegation cannot be decoded");}
  if (Principal.selfAuthenticating(chain.publicKey).toText() !== expectedOwner)
    throw blocked("Recovery delegation root is not the approved coordinator owner");
  const session = parseSession(sessionJson);
  let signer = chain.publicKey;
  const lower = BigInt(nowMs + minimumRemainingMs) * 1000000n;
  const upper = BigInt(nowMs + RECOVERY_MAX_REMAINING_MS) * 1000000n;
  let expiry = upper;
  for (const {delegation, signature} of chain.delegations) {
    if (delegation.targets?.length !== 1 || delegation.targets[0].toText() !== RECOVERY_COORDINATOR)
      throw blocked("Every recovery delegation must target only the approved coordinator");
    if (delegation.expiration <= lower || delegation.expiration > upper)
      throw blocked("Recovery delegation is expired, expires too soon, or exceeds 30 days remaining");
    const message = Buffer.concat([bytes(IC_REQUEST_AUTH_DELEGATION_DOMAIN_SEPARATOR), bytes(requestIdOf(delegation.toCborValue()))]);
    if (!verifySignature(signer, signature, message)) throw blocked("Recovery delegation signature is invalid or unsupported");
    signer = delegation.pubkey;
    expiry = delegation.expiration < expiry ? delegation.expiration : expiry;
  }
  if (!equal(signer, session.getPublicKey().toDer())) throw blocked("Recovery delegation is for a different session key");
  const identity = DelegationIdentity.fromDelegation(session, chain);
  if (identity.getPrincipal().toText() !== expectedOwner) throw blocked("Delegated recovery principal differs from its root");
  return {identity, principal: expectedOwner, target: RECOVERY_COORDINATOR,
    expiresAtMs: Number(expiry / 1000000n), remainingMs: Number(expiry / 1000000n) - nowMs};
}

function nat(value) {
  if (!["bigint", "string", "number"].includes(typeof value) ||
      (typeof value === "number" && !Number.isSafeInteger(value)) || !/^(0|[1-9][0-9]*)$/.test(String(value)))
    throw blocked("Invalid failed-job cycles");
  const parsed = BigInt(value);
  if (parsed > MAX_NAT128) throw blocked("Failed-job cycles exceed Nat128");
  return parsed;
}
function terminalJobs(jobs) {
  if (!Array.isArray(jobs)) throw blocked("Coordinator job list is unavailable");
  for (const job of jobs) {
    const phase = Object.keys(job?.phase ?? {});
    if (phase.length !== 1 || !["Complete", "Failed"].includes(phase[0]) || job.busy !== false ||
        !Array.isArray(job.recovery) || job.recovery.length > 1 || job.recovery.some(item => item.accounting_uncertain !== false))
      throw blocked("Recovery requires all jobs terminal, nonbusy and accounting reconciled");
  }
}

/** Narrow actor wrapper; the existing failure-deferral caller must persist its
 * intent before invoking either update and reconcile every uncertain outcome.
 * This wrapper never retries an update and does not expose agent or identity. */
export function createRecoveryOperations({actor, validateCredential} = {}) {
  if (typeof validateCredential !== "function" || (typeof actor?.list_jobs_page !== "function" && typeof actor?.list_jobs !== "function") || ["get_voice_state", "set_paused", "defer_failed_swap"].some(method => typeof actor?.[method] !== "function"))
    throw blocked("Recovery actor and credential validation are required");
  async function beforeUpdate(minimumRemainingMs) {
    await validateCredential(minimumRemainingMs);
    const jobs = await listCoordinatorJobs(actor);terminalJobs(jobs);
    const voice = await actor.get_voice_state();
    if (!Array.isArray(voice?.remembering) || voice.remembering.length) throw blocked("Coordinator memory acknowledgement is in flight");
    await validateCredential(UPDATE_MINIMUM_REMAINING_MS);
    return jobs;
  }
  return Object.freeze({
    async set_paused(value) {
      if (typeof value !== "boolean") throw blocked("Pause value must be boolean");
      await beforeUpdate(value ? START_MINIMUM_REMAINING_MS : UPDATE_MINIMUM_REMAINING_MS);
      return actor.set_paused(value);
    },
    async defer_failed_swap(sourceId, expectedCycles, reason) {
      if (typeof sourceId !== "string" || !HASH.test(sourceId) || reason !== RECOVERY_REASON)
        throw blocked("Exact lowercase failed source and fixed recovery reason are required");
      const cycles = nat(expectedCycles), jobs = await beforeUpdate(UPDATE_MINIMUM_REMAINING_MS);
      const matches = jobs.filter(job => job.request?.id === sourceId);
      if (matches.length !== 1 || !("Failed" in matches[0].phase) || nat(matches[0].model_cycles) !== cycles ||
          !Array.isArray(matches[0].source) || matches[0].source.length !== 1 ||
          swapSourceId(4663, matches[0].source[0]) !== sourceId)
        throw blocked("Failed job source or measured cycles differ");
      return actor.defer_failed_swap(sourceId, cycles, RECOVERY_REASON);
    },
  });
}

function credential(directory, name) {
  const filename = path.join(directory, name);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd), uid = typeof process.getuid === "function" ? process.getuid() : -1;
    if (!stat.isFile() || stat.size > 32768 || (stat.mode & 0o077) !== 0 || ![0, uid].includes(stat.uid))
      throw blocked("Recovery credentials must be private owned regular files");
    return fs.readFileSync(fd, "utf8");
  } finally {fs.closeSync(fd);}
}

/** Loads only the dedicated systemd credentials. It never reads deployer CLI
 * key material, an environment secret, a treasury key, or any owner PEM. */
export async function loadDelegatedRecovery({credentialsDirectory = process.env.CREDENTIALS_DIRECTORY,
  now = Date.now} = {}) {
  if (typeof credentialsDirectory !== "string" || !path.isAbsolute(credentialsDirectory) || typeof now !== "function")
    throw blocked("An absolute systemd credentials directory is required");
  const stat = fs.lstatSync(credentialsDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0)
    throw blocked("Systemd credentials directory must be protected and not a symlink");
  const sessionJson = credential(credentialsDirectory, SESSION_FILE);
  const delegationJson = credential(credentialsDirectory, DELEGATION_FILE);
  const validateCredential = minimumRemainingMs => validateRecoveryDelegation({sessionJson, delegationJson,
    expectedOwner: RECOVERY_OWNER, nowMs: now(), minimumRemainingMs});
  const checked = validateCredential(START_MINIMUM_REMAINING_MS);
  const agent = await HttpAgent.create({host: "https://icp-api.io", identity: checked.identity,
    retryTimes: 0, verifyQuerySignatures: true});
  const actor = Actor.createActor(idlFactory, {agent, canisterId: RECOVERY_COORDINATOR});
  return createRecoveryOperations({actor, validateCredential});
}
