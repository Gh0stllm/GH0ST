'use strict';

const assert = require('node:assert/strict');
const { Contract, Interface, JsonRpcProvider, keccak256, toUtf8String } = require('ethers');
const { compile } = require('../compile.cjs');

async function canonical(provider, receipt) {
  const block = await provider.getBlock(receipt.blockNumber);
  assert.equal(block?.hash, receipt.blockHash, 'Receipt is not in a canonical block');
}

function oneEvent(receipt, target, abi, eventName) {
  const events = receipt.logs
    .filter(log => log.address.toLowerCase() === target.toLowerCase())
    .map(log => abi.parseLog(log))
    .filter(log => log?.name === eventName);
  assert.equal(events.length, 1, 'Expected one ' + eventName + ' event from the deployed room');
  return events[0].args;
}

function strictlyBefore(first, second) {
  return first.blockNumber < second.blockNumber ||
    (first.blockNumber === second.blockNumber && first.index < second.index);
}

async function verifyReceipts(provider, txHashes, artifact = compile()) {
  assert.equal(txHashes.length, 3, 'Supply deploy, archive and clear transaction hashes, in order');
  for (const hash of txHashes) assert.match(hash, /^0x[0-9a-f]{64}$/i);
  const receipts = await Promise.all(txHashes.map(hash => provider.getTransactionReceipt(hash)));
  for (const receipt of receipts) {
    assert.ok(receipt, 'Missing receipt');
    assert.equal(receipt.status, 1, 'Transaction reverted');
    await canonical(provider, receipt);
  }
  const [deploy, archive, clear] = receipts;
  const target = deploy.contractAddress;
  assert.ok(target && !deploy.to, 'Expected a direct deployment');
  assert.ok(strictlyBefore(deploy, archive) && strictlyBefore(archive, clear), 'Unexpected transaction order');
  for (const receipt of [deploy, archive, clear]) {
    assert.equal(await provider.getCode(target, receipt.blockNumber), artifact.deployedBytecode, 'Room runtime mismatch');
  }
  const abi = new Interface(artifact.abi);
  const room = new Contract(target, abi, provider);
  const saved = oneEvent(archive, target, abi, 'RunRecorded');
  const solved = oneEvent(clear, target, abi, 'RoomCleared');
  assert.equal(saved.runId, solved.runId);
  assert.equal(saved.player, solved.ghostPlayer);
  assert.notEqual(saved.player, solved.player);
  const state = { blockTag: clear.blockNumber };
  const [record, replay, marked] = await Promise.all([
    room.getRun(saved.runId, state), room.preview(saved.runId, solved.moves, state),
    room.clearedWith(solved.player, saved.runId, state)
  ]);
  assert.equal(record.player, saved.player);
  assert.equal(record.moves, saved.moves);
  assert.equal(replay.won, true, 'Replay did not finish on the exit');
  assert.equal(marked, true, 'Missing permanent clear state');
  for (const receipt of receipts) await canonical(provider, receipt);
  return {
    chainId: Number((await provider.getNetwork()).chainId), address: target,
    runtimeHash: keccak256(artifact.deployedBytecode), verifiedAtBlock: clear.blockNumber,
    receiptBlocks: receipts.map(r => ({ tx: r.hash, block: r.blockNumber, hash: r.blockHash })),
    archiveId: saved.runId.toString(), archivist: saved.player, runner: solved.player,
    ghostRoute: toUtf8String(saved.moves), runnerRoute: toUtf8String(solved.moves),
    finalRunnerTile: Number(replay.runnerTile), finalGhostTile: Number(replay.ghostTile),
    cleared: marked
  };
}

module.exports = { verifyReceipts };

async function main() {
  const provider = new JsonRpcProvider(process.env.ROBINHOOD_MAINNET_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com');
  try {
    assert.equal((await provider.getNetwork()).chainId, 4663n, 'Wrong Robinhood network');
    assert.equal((await provider.getBlock(0))?.hash, '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c');
    console.log(JSON.stringify(await verifyReceipts(provider, process.argv.slice(2)), null, 2));
  } finally {
    provider.destroy();
  }
}

if (require.main === module) main().catch(error => {
  // RPC client errors may embed a credentialed URL. Avoid logging them verbatim.
  console.error(error instanceof assert.AssertionError ? error.message : 'Receipt verification failed. Check RPC availability and transaction hashes.');
  process.exitCode = 1;
});
