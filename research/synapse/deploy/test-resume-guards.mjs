import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from './lib.mjs';
import { validateSavedEvidence } from './resume-signed.mjs';

// Uses existing encrypted-free signed evidence; makes no RPC call, creates no
// signature and invokes no execution engine. Arguments are explicit file paths.
const [planPath, batchPath, journalPath] = process.argv.slice(2);
assert.ok(planPath && batchPath && journalPath, 'Usage: test-resume-guards.mjs PLAN BATCH JOURNAL');
const planBytes = readFileSync(resolve(planPath));
const plan = JSON.parse(planBytes), batch = JSON.parse(readFileSync(resolve(batchPath))), journal = JSON.parse(readFileSync(resolve(journalPath)));
const input = { planHash: sha256(planBytes), actions: plan.actions, batch, journal };
assert.equal(validateSavedEvidence(input).length, 9);
const changedHash = structuredClone(batch); changedHash.actions[0].hash = '0x' + '00'.repeat(32);
assert.throws(() => validateSavedEvidence({ ...input, batch: changedHash }), { code: 'ERR_ASSERTION' });
const unresolved = structuredClone(journal); unresolved.actions.at(-1).status = 'broadcast_uncertain';
assert.throws(() => validateSavedEvidence({ ...input, journal: unresolved }), /unresolved/);
const gap = structuredClone(journal); gap.actions[0].id = 1;
assert.throws(() => validateSavedEvidence({ ...input, journal: gap }), /contiguous prefix/);
console.log(JSON.stringify({ passed: true, checks: 4, rpcCalls: 0, newSignatures: 0, broadcasts: 0 }));
