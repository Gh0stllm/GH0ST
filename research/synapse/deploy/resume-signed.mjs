#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeActions, validateSigned } from './vendor/execute-rh.mjs';
import { CHAIN_ID, SPONSOR, assertChain, ethers, options, privateOutput, providerFor, readRpc, safeError, save, sha256 } from './lib.mjs';
import { createFreshCheck, validateDeployPlan } from './guards.mjs';
import { verifyCompleted } from './verify.mjs';

function privateFile(path, sizeLimit = 2_000_000) {
  assert.ok(isAbsolute(path), 'Evidence paths must be absolute');
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && (!process.getuid || stat.uid === process.getuid()), 'Evidence must be a user-owned mode0600 regular file');
  assert.ok(stat.size > 0 && stat.size <= sizeLimit, 'Unexpected evidence size');
  return readFileSync(path);
}

export function validateSavedEvidence({ planHash, batch, journal, actions }) {
  assert.equal(batch.schema, 'gh0st-synapse-signed-batch-v1'); assert.equal(journal.schema, 'gh0st-rh-signed-v1');
  for (const value of [batch, journal]) { assert.equal(value.planHash, planHash); assert.equal(ethers.getAddress(value.owner), SPONSOR); assert.equal(Number(value.chainId), Number(CHAIN_ID)); }
  assert.equal(batch.actions.length, actions.length, 'Saved signed batch is incomplete');
  assert.ok(Array.isArray(journal.actions) && journal.actions.length > 0 && journal.actions.length <= actions.length, 'Existing journal is missing or invalid');
  const signed = actions.map((action, index) => {
    const entry = batch.actions[index];
    assert.equal(entry.id, action.id); assert.equal(entry.unsignedHash, action.unsignedHash);
    const transaction = validateSigned(action, entry.rawSignedTransaction, SPONSOR);
    assert.equal(entry.hash, transaction.hash); assert.equal(transaction.nonce, action.nonce); assert.equal(transaction.chainId, CHAIN_ID);
    return transaction;
  });
  for (const [index, entry] of journal.actions.entries()) {
    assert.equal(entry.id, index, 'Confirmed journal actions must form a contiguous prefix');
    assert.equal(entry.status, 'confirmed', 'Journal has an unresolved signed/broadcast/reverted action; reconcile it before recovery');
    assert.equal(entry.hash, batch.actions[index].hash); assert.equal(entry.unsignedHash, actions[index].unsignedHash); assert.equal(entry.nonce, actions[index].nonce); assert.equal(entry.rawSignedTransaction, batch.actions[index].rawSignedTransaction);
  }
  return signed;
}

export async function reconcileSigned({ planPath, batchPath, journalPath, provider }) {
  for (const path of [planPath, batchPath, journalPath]) assert.ok(isAbsolute(path), 'Evidence paths must be absolute');
  assert.ok(!existsSync(journalPath + '.lock'), 'Journal is locked; do not remove an active or unresolved execution lock');
  assert.equal(dirname(batchPath), dirname(journalPath), 'Signed batch and journal must share one session directory');
  const planBytes = privateFile(planPath), batchBytes = privateFile(batchPath), journalBytes = privateFile(journalPath);
  const planHash = sha256(planBytes), batchHash = sha256(batchBytes), journalHash = sha256(journalBytes);
  const plan = JSON.parse(planBytes), batch = JSON.parse(batchBytes), journal = JSON.parse(journalBytes);
  const actions = validateDeployPlan(plan);
  assert.equal(actions.length, 9, 'Recovery supports only the exact reviewed nine-action deployment');
  const signed = validateSavedEvidence({ planHash, batch, journal, actions });
  await assertChain(provider);
  const head = await provider.getBlockNumber();
  const confirmed = [];
  for (const [index, entry] of journal.actions.entries()) {
    const action = actions[index], expected = batch.actions[index], transaction = signed[index];
    assert.equal(entry.id, index, 'Confirmed journal actions must form a contiguous prefix');
    assert.equal(entry.status, 'confirmed', 'Journal has an unresolved signed/broadcast/reverted action; reconcile it before recovery');
    assert.equal(entry.hash, expected.hash); assert.equal(entry.unsignedHash, action.unsignedHash); assert.equal(entry.nonce, action.nonce); assert.equal(entry.rawSignedTransaction, expected.rawSignedTransaction);
    const [observed, receipt] = await Promise.all([provider.getTransaction(entry.hash), provider.getTransactionReceipt(entry.hash)]);
    assert.ok(observed && receipt, 'A confirmed journal hash is absent from the canonical chain'); assert.equal(receipt.status, 1);
    const block = await provider.getBlock(receipt.blockNumber); assert.equal(block.hash, receipt.blockHash); assert.ok(head - receipt.blockNumber >= 12, 'A prior receipt needs twelve canonical descendant blocks');
    assert.equal(observed.hash, transaction.hash); assert.equal(observed.from, SPONSOR); assert.equal(observed.chainId, CHAIN_ID); assert.equal(observed.nonce, action.nonce); assert.equal(observed.to, transaction.to); assert.equal(observed.data, transaction.data); assert.equal(observed.value, 0n); assert.equal(observed.gasLimit, transaction.gasLimit); assert.equal(observed.maxFeePerGas, transaction.maxFeePerGas); assert.equal(observed.maxPriorityFeePerGas, transaction.maxPriorityFeePerGas);
    assert.equal(entry.receipt.transactionHash, receipt.hash); assert.equal(entry.receipt.blockHash, receipt.blockHash); assert.equal(entry.receipt.blockNumber, receipt.blockNumber);
    confirmed.push({ id: action.id, hash: receipt.hash, blockNumber: receipt.blockNumber });
  }
  const remaining = [];
  for (let index = confirmed.length; index < actions.length; index++) {
    const [observed, receipt] = await Promise.all([provider.getTransaction(signed[index].hash), provider.getTransactionReceipt(signed[index].hash)]);
    assert.ok(!observed && !receipt, 'A remaining signed hash is already observed; reconcile the existing journal before any recovery');
    remaining.push({ id: index, label: actions[index].label, nonce: actions[index].nonce, hash: signed[index].hash, unsignedHash: actions[index].unsignedHash, maximumFeeWei: String(actions[index].maxCostWei) });
  }
  const [latest, pending] = await Promise.all([provider.getTransactionCount(SPONSOR, 'latest'), provider.getTransactionCount(SPONSOR, 'pending')]);
  const expectedNonce = remaining.length ? actions[confirmed.length].nonce : actions.at(-1).nonce + 1;
  assert.equal(latest, expectedNonce, 'Latest nonce differs from exact remaining saved action'); assert.equal(pending, expectedNonce, 'Pending nonce differs from exact remaining saved action');
  const freshCheck = createFreshCheck(plan);
  let fresh = null;
  if (remaining.length) fresh = await freshCheck(provider, actions[confirmed.length]);
  return { plan, planHash, batch, batchHash, journal, journalHash, actions, signed, confirmed, remaining, latest, pending, freshCheck, fresh };
}

export async function resumeSigned({ planPath, batchPath, journalPath, output, envFile, execute = false, log = console.log }) {
  assert.ok(isAbsolute(output) && resolve(output) === dirname(resolve(journalPath)), 'Output must be the existing journal session directory');
  const provider = providerFor(readRpc(envFile));
  try {
    const state = await reconcileSigned({ planPath, batchPath, journalPath, provider });
    const summary = { mode: execute ? 'EXPLICIT_EXECUTION_OF_EXISTING_SAVED_SIGNATURES' : 'READ_ONLY_RECONCILIATION', planHash: state.planHash, owner: SPONSOR, chainId: 4663, latestNonce: state.latest, pendingNonce: state.pending, confirmed: state.confirmed, remaining: state.remaining, firstRemainingFreshCheck: state.fresh, newSignatures: 0, changedTransactions: 0 };
    log(JSON.stringify(summary, null, 2));
    if (!execute) return summary;
    assert.equal(sha256(privateFile(planPath)), state.planHash, 'Plan changed after reconciliation');
    assert.equal(sha256(privateFile(batchPath)), state.batchHash, 'Signed batch changed after reconciliation');
    assert.equal(sha256(privateFile(journalPath)), state.journalHash, 'Journal changed after reconciliation');
    assert.ok(!existsSync(journalPath + '.lock'), 'Journal became locked after reconciliation');
    const unchangedBatch = () => assert.equal(sha256(privateFile(batchPath)), state.batchHash, 'Signed batch changed during recovery');
    const journal = await executeActions({ planPath, planHash: state.planHash, owner: SPONSOR, actions: state.actions, provider, journalPath,
      freshCheck: async (rpc, action) => { unchangedBatch(); return state.freshCheck(rpc, action); },
      getSigner: async () => ({ getAddress: async () => SPONSOR, signTransaction: async request => {
        // This adapter returns original saved bytes. It never has a keystore,
        // password or private key, and never creates a signature.
        unchangedBatch();
        const unsignedHash = ethers.Transaction.from(request).unsignedHash;
        const index = state.actions.findIndex(action => action.unsignedHash === unsignedHash);
        assert.ok(index >= state.confirmed.length, 'Recovery requested an unexpected previously confirmed or unreviewed action');
        return state.batch.actions[index].rawSignedTransaction;
      } }), log,
    });
    const verification = await verifyCompleted(state.plan, journal, provider);
    const out = privateOutput(output); save(out, 'canonical-verification.json', verification); save(out, 'deployment.json', verification.deployment);
    log(JSON.stringify({ verified: true, receipts: verification.receipts.length, fixtures: verification.fixtures.length, output: out, newSignatures: 0 }));
    return verification;
  } finally { provider.destroy(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  assert.ok(argv.filter(value => value === '--execute').length <= 1, 'Duplicate --execute flag');
  const execute = argv.includes('--execute');
  const args = options(argv.filter(value => value !== '--execute'));
  if (args.help) { console.log('Usage: node deploy/resume-signed.mjs --plan /absolute/plan.json --batch /absolute/session/signed-batch.json --journal /absolute/session/signed-journal.json --output /absolute/session [--env-file /absolute/.env.local] [--execute]\nDefault is read-only reconciliation. --execute sends only the exact remaining previously signed transactions, after all guards pass. No key is accepted and no new signatures, fees, nonces or deadlines can be created.'); process.exit(0); }
  try { await resumeSigned({ planPath: args.plan, batchPath: args.batch, journalPath: args.journal, output: args.output, envFile: args['env-file'], execute }); }
  catch (error) { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; }
}
