import assert from 'node:assert/strict';

export function assertReviewedFeeBounds(transaction, baseFeePerGas) {
  const maximum = BigInt(transaction.maxFeePerGas);
  const priority = BigInt(transaction.maxPriorityFeePerGas);
  assert.ok(maximum > 0n && priority >= 0n && priority <= maximum, 'Invalid reviewed fee bounds');
  assert.ok(baseFeePerGas != null, 'Current block has no base fee');
  const base = BigInt(baseFeePerGas);
  // A wallet's suggested tip does not change this already signed transaction.
  // Retain the conservative policy that both its base fee and full signed tip fit.
  assert.ok(base >= 0n && base + priority <= maximum, 'Current fees exceed the reviewed cap');
}
