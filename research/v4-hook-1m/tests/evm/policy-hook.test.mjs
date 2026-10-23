import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { AbiCoder, ZeroHash, keccak256 } from 'ethers';
import { compileResearch, createFixture, expectReason, hash, params, Reason } from './helpers.mjs';

let fixture, snapshot;
before(async () => { fixture = await createFixture(compileResearch()); });
beforeEach(async () => { snapshot = await fixture.rpc.request({ method: 'evm_snapshot', params: [] }); });
afterEach(async () => { await fixture.rpc.request({ method: 'evm_revert', params: [snapshot] }); });
after(async () => { await fixture?.close(); });

test('deployed hook has exact v4 permissions and derives the real PoolId encoding', async () => {
  const { hook, key, poolId } = fixture;
  assert.equal(BigInt(await hook.getAddress()) & 0x3fffn, 0x10c0n);
  const abi = AbiCoder.defaultAbiCoder();
  const encoded = abi.encode(['address', 'address', 'uint24', 'int24', 'address'], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]);
  assert.equal(poolId, keccak256(encoded));
  const permissions = await hook.getHookPermissions();
  assert.equal(permissions.afterInitialize, true);
  assert.equal(permissions.beforeSwap, true);
  assert.equal(permissions.afterSwap, true);
  assert.equal(permissions.beforeSwapReturnDelta, false);
  assert.equal(permissions.afterSwapReturnDelta, false);
  assert.equal(permissions.beforeRemoveLiquidity, false);
});

test('missing policy uses baseline and upstream hook-return handling accepts the override flag', async () => {
  await expectReason(fixture, Reason.NotFinalized);
  const fee = await fixture.manager.driveBeforeSwap.staticCall(fixture.key, params, '0x');
  assert.equal(fee, 3000n);
  await (await fixture.manager.driveBeforeSwap(fixture.key, params, '0x')).wait();
  assert.equal(await fixture.manager.lastAppliedFee(), 3000n);
  assert.equal(await fixture.hook.lastAcceptedNonce(), 0n);
});

test('accepted cached policy applies exact LP fee with zero custom accounting deltas', async () => {
  await fixture.publish();
  await expectReason(fixture, Reason.Accepted, 5000n);
  await (await fixture.manager.driveCallbackCycle(fixture.key, params, 20, '0x')).wait();
  assert.equal(await fixture.manager.lastAppliedFee(), 5000n);
  assert.equal(await fixture.hook.lastAcceptedNonce(), 1n);
  assert.equal(await fixture.hook.lastAcceptedSnapshotId(), 1n);
  assert.notEqual(await fixture.hook.lastAcceptedPolicyHash(), ZeroHash);
  const observation = await fixture.hook.snapshot(await fixture.hook.latestSnapshotId());
  assert.equal(observation.tick, 20n);
});

test('EOAs cannot call hook callbacks or publish another authority\'s mock policy', async () => {
  await assert.rejects(fixture.hook.beforeSwap.staticCall(await fixture.alice.getAddress(), fixture.key, params, '0x'));
  await assert.rejects(fixture.hook.afterSwap.staticCall(await fixture.alice.getAddress(), fixture.key, params, 0, '0x'));
  await assert.rejects(fixture.hook.afterInitialize.staticCall(await fixture.alice.getAddress(), fixture.key, 1n << 96n, 0));
  await assert.rejects(fixture.source.connect(fixture.bob).publish.staticCall(await fixture.policy()));
  await assert.rejects(fixture.source.connect(fixture.bob).setMode.staticCall(1));
});

test('callbacks reject a different pool, static fee marker, or tick spacing', async () => {
  for (const changed of [
    { ...fixture.key, currency1: '0x0000000000000000000000000000000000000300' },
    { ...fixture.key, fee: 3000 }, { ...fixture.key, tickSpacing: 10 },
  ]) await assert.rejects(fixture.manager.driveBeforeSwap.staticCall(changed, params, '0x'));
});

test('reverting, short, gas-exhausting and oversized source responses fall back', async () => {
  await fixture.publish();
  for (const mode of [1, 2, 3, 4]) {
    await (await fixture.source.setMode(mode)).wait();
    await expectReason(fixture, Reason.SourceUnavailable);
    const receipt = await (await fixture.manager.driveBeforeSwap(fixture.key, params, '0x', { gasLimit: 180_000 })).wait();
    assert.equal(receipt.status, 1);
    assert.equal(await fixture.manager.lastAppliedFee(), 3000n);
  }
});

test('pool, model, finalization, feature hash and integer-width metadata are enforced', async () => {
  const vectors = [
    [{ finalized: 0n }, Reason.NotFinalized], [{ finalized: 2n }, Reason.NotFinalized],
    [{ poolId: hash('different-pool') }, Reason.WrongPool],
    [{ modelHash: hash('different-model') }, Reason.WrongModel],
    [{ inputHash: ZeroHash }, Reason.InvalidMetadata], [{ nonce: 0n }, Reason.InvalidMetadata],
    [{ nonce: 1n << 64n }, Reason.InvalidMetadata], [{ snapshotId: 0n }, Reason.InvalidMetadata],
    [{ snapshotId: 1n << 64n }, Reason.InvalidMetadata],
    [{ notBefore: 1n << 64n }, Reason.InvalidMetadata], [{ expiresAt: 1n << 64n }, Reason.InvalidMetadata],
    [{ snapshotId: 63n }, Reason.SnapshotMissing],
    [{ snapshotHash: hash('wrong-state') }, Reason.SnapshotMismatch],
  ];
  for (const [changed, reason] of vectors) {
    await fixture.publish(changed);
    await expectReason(fixture, reason);
  }
});

test('validity window is anchored to the observed snapshot and has a hard maximum age', async () => {
  const observation = await fixture.hook.snapshot(1);
  for (const [changed, reason, fee] of [
    [{ notBefore: observation.timestamp + 10n }, Reason.NotYetValid, 3000n],
    [{ notBefore: observation.timestamp - 1n }, Reason.WindowTooLong, 3000n],
    [{ expiresAt: observation.timestamp + 601n }, Reason.WindowTooLong, 3000n],
    [{ expiresAt: observation.timestamp + 600n }, Reason.Accepted, 5000n],
    [{ expiresAt: observation.timestamp }, Reason.InvalidMetadata, 3000n],
  ]) {
    await fixture.publish(changed);
    await expectReason(fixture, reason, fee);
  }
  await fixture.publish({ expiresAt: observation.timestamp + 1n });
  await fixture.rpc.request({ method: 'evm_increaseTime', params: [1] });
  await fixture.rpc.request({ method: 'evm_mine', params: [] });
  await expectReason(fixture, Reason.Expired);
});

test('fee is bounded and extreme uint256 values fall back without truncation', async () => {
  for (const [fee, accepted] of [[499n, false], [500n, true], [10_000n, true], [10_001n, false], [1n << 250n, false]]) {
    await fixture.publish({ lpFee: fee });
    await expectReason(fixture, accepted ? Reason.Accepted : Reason.FeeOutOfRange, accepted ? fee : 3000n);
  }
});

test('positive and negative tick drift boundary is exact', async () => {
  await fixture.publish();
  for (const tick of [120, -120, 121, -121, 887272, -887272]) {
    await (await fixture.manager.setTick(fixture.key, tick)).wait();
    await expectReason(fixture, Math.abs(tick) <= 120 ? Reason.Accepted : Reason.TickDrift, Math.abs(tick) <= 120 ? 5000n : 3000n);
  }
});

test('accepted nonce prevents rollback while unchanged policy can be reused', async () => {
  await fixture.publish({ nonce: 9n });
  await (await fixture.manager.driveBeforeSwap(fixture.key, params, '0x')).wait();
  await expectReason(fixture, Reason.Accepted, 5000n);
  await fixture.publish({ nonce: 8n });
  await expectReason(fixture, Reason.NonceRollback);
  await fixture.publish({ nonce: 10n });
  await expectReason(fixture, Reason.Accepted, 5000n);
});

test('reusing an accepted nonce cannot change fee, features, expiry or snapshot', async () => {
  const accepted = await fixture.publish({ nonce: 9n });
  await (await fixture.manager.driveBeforeSwap(fixture.key, params, '0x')).wait();
  for (const changed of [
    { lpFee: 5001n }, { inputHash: hash('substituted-features') },
    { expiresAt: accepted.expiresAt + 1n }, { snapshotHash: hash('different-snapshot') },
  ]) {
    await (await fixture.source.publish({ ...accepted, ...changed })).wait();
    await expectReason(fixture, Reason.NonceReuseMismatch);
  }
});

test('a new nonce cannot roll back the accepted snapshot', async () => {
  const old = await fixture.policy();
  await (await fixture.manager.driveAfterSwap(fixture.key, params, 1, '0x')).wait();
  await fixture.publish({ nonce: 2n });
  await (await fixture.manager.driveBeforeSwap(fixture.key, params, '0x')).wait();
  assert.equal(await fixture.hook.lastAcceptedSnapshotId(), 2n);
  await (await fixture.source.publish({ ...old, nonce: 3n })).wait();
  await expectReason(fixture, Reason.SnapshotRollback);
});

test('ring overwrite invalidates an old policy even with an unexpired validity window', async () => {
  await fixture.publish();
  for (let index = 0; index < 64; index++) {
    await (await fixture.manager.driveAfterSwap(fixture.key, params, 0, '0x')).wait();
  }
  assert.equal(await fixture.hook.latestSnapshotId(), 65n);
  await expectReason(fixture, Reason.SnapshotMissing);
});

test('multiple callbacks in one transaction produce only one block sample', async () => {
  await (await fixture.manager.driveTwoAfterCallbacks(fixture.key, params, 5, 10, '0x')).wait();
  assert.equal(await fixture.hook.latestSnapshotId(), 2n);
  assert.equal((await fixture.hook.snapshot(2)).tick, 5n);
  // Live tick read must still see the final pool state, independent of sampling.
  await fixture.publish();
  await (await fixture.manager.setTick(fixture.key, 126)).wait();
  await expectReason(fixture, Reason.TickDrift);
});

test('same-block observations are not usable as finalized policy inputs', async () => {
  const latest = await fixture.provider.getBlock('latest');
  const nextBlock = BigInt(latest.number + 1);
  const nextId = 2n;
  const timestamp = BigInt(latest.timestamp);
  const network = await fixture.provider.getNetwork();
  const stateHash = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'bytes32', 'bytes32', 'uint64', 'uint64', 'uint64', 'int24'],
    [network.chainId, await fixture.hook.getAddress(), fixture.poolId, fixture.modelHash, nextId, nextBlock, timestamp, 0],
  ));
  const policy = await fixture.policy({ snapshotId: nextId, snapshotHash: stateHash, notBefore: timestamp, expiresAt: timestamp + 300n });
  await fixture.rpc.request({ method: 'miner_stop', params: [] });
  try {
    const observationTx = await fixture.manager.driveAfterSwap(fixture.key, params, 0, '0x', { gasLimit: 200_000 });
    const policyTx = await fixture.source.publish(policy, { gasLimit: 400_000 });
    await fixture.rpc.request({ method: 'evm_mine', params: [{ timestamp: Number(timestamp) }] });
    await observationTx.wait();
    await policyTx.wait();
    await expectReason(fixture, Reason.SameBlockSnapshot);
    await fixture.rpc.request({ method: 'evm_mine', params: [] });
    await expectReason(fixture, Reason.Accepted, 5000n);
  } finally { await fixture.rpc.request({ method: 'miner_start', params: [1] }); }
});
