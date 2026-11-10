import assert from 'node:assert/strict';
import { assertReviewedFeeBounds } from './fee-guards.mjs';

const signed = Object.freeze({ maxFeePerGas: '41872000', maxPriorityFeePerGas: '0' });
const original = JSON.stringify(signed);
assert.doesNotThrow(() => assertReviewedFeeBounds(signed, 20_564_000n));
assert.doesNotThrow(() => assertReviewedFeeBounds(signed, 41_872_000n));
assert.doesNotThrow(() => assertReviewedFeeBounds({ maxFeePerGas: '41872000', maxPriorityFeePerGas: '1000000' }, 40_872_000n));
assert.throws(() => assertReviewedFeeBounds(signed, 41_872_001n), /Current fees exceed/);
assert.throws(() => assertReviewedFeeBounds({ maxFeePerGas: '41872000', maxPriorityFeePerGas: '1000000' }, 40_872_001n), /Current fees exceed/);
assert.throws(() => assertReviewedFeeBounds({ maxFeePerGas: '41872000', maxPriorityFeePerGas: '-1' }, 1n), /Invalid reviewed fee/);
assert.throws(() => assertReviewedFeeBounds({ maxFeePerGas: '0', maxPriorityFeePerGas: '0' }, 0n), /Invalid reviewed fee/);
assert.throws(() => assertReviewedFeeBounds({ maxFeePerGas: '1', maxPriorityFeePerGas: '2' }, 0n), /Invalid reviewed fee/);
assert.throws(() => assertReviewedFeeBounds(signed, null), /no base fee/);
assert.throws(() => assertReviewedFeeBounds(signed, -1n), /Current fees exceed/);
assert.throws(() => assertReviewedFeeBounds({ maxFeePerGas: 'invalid', maxPriorityFeePerGas: '0' }, 1n));
assert.equal(JSON.stringify(signed), original, 'The guard must not change signed fee values');
console.log(JSON.stringify({ passed: true, checks: 12, rpcCalls: 0, newSignatures: 0, broadcasts: 0 }));
