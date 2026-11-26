'use strict';

const assert = require('node:assert/strict');
const { BrowserProvider, ContractFactory, getBytes, hexlify, keccak256, toUtf8Bytes, toUtf8String } = require('ethers');
const ganache = require('ganache');
const { compile } = require('../compile.cjs');
const { verifyReceipts } = require('./verify-receipts.cjs');

const bytes = text => hexlify(toUtf8Bytes(text));
const rows = ['#########', '#..P.#..#', '#.##.#..#', '#S...G.E#', '#.##.#..#', '#....#..#', '#########'];

function decodedEvent(contract, receipt, name) {
  const event = receipt.logs.map(log => contract.interface.parseLog(log)).find(log => log.name === name);
  assert.ok(event, 'missing ' + name);
  return event.args;
}

async function expectError(contract, simulation, name) {
  await assert.rejects(simulation, error => {
    const data = error.data ?? error.info?.error?.data;
    assert.equal(contract.interface.parseError(data).name, name);
    return true;
  });
}

async function run() {
  const artifact = compile();
  const chain = ganache.provider({
    chain: { hardfork: 'shanghai', chainId: 1337 }, logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 3 }
  });
  try {
    const provider = new BrowserProvider(chain);
    provider.pollingInterval = 20;
    const [archivist, runner, other] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, archivist).deploy();
    await contract.waitForDeployment();
    const target = await contract.getAddress();
    assert.equal(await provider.getCode(target), artifact.deployedBytecode);
    assert.equal(toUtf8String(await contract.room()), rows.join(''));
    assert.equal(await contract.MAX_TICKS(), 32n);
    assert.equal(await contract.runCount(), 0n);
    for (const id of [0, 1]) await expectError(contract, contract.getRun(id), 'UnknownRun');
    for (const moves of ['', 'U'.repeat(33)]) {
      await expectError(contract, contract.recordRun.staticCall(bytes(moves)), 'InvalidLength');
    }
    for (const input of ['0xff', bytes('UURR?')]) {
      await expectError(contract, contract.recordRun.staticCall(input), 'InvalidMove');
    }
    await expectError(contract, contract.recordRun.staticCall(bytes('RRRRRR')), 'MissedPlate');
    const ghost = bytes('UURR..L');
    const solution = bytes('RRRRRR');
    assert.equal(await contract.recordRun.staticCall(ghost), 1n);
    const first = await (await contract.recordRun(ghost)).wait();
    const recorded = decodedEvent(contract, first, 'RunRecorded');
    assert.equal(recorded.runId, 1n);
    assert.equal(recorded.player, archivist.address);
    assert.equal(recorded.moves, ghost);
    assert.deepEqual([...await contract.getRun(1)], [archivist.address, ghost]);
    assert.equal(await contract.runCount(), 1n);
    assert.deepEqual([...await contract.preview(1, solution)], [true, 34n, 12n]);
    assert.deepEqual([...await contract.preview(1, bytes('.RRRR.RR'))], [true, 34n, 11n]);
    // A late approach finds the gate closed. Both walls and closed gates consume a tick.
    assert.deepEqual([...await contract.preview(1, bytes('...RRRRRR'))], [false, 31n, 11n]);
    assert.deepEqual([...await contract.preview(1, bytes('LLLL'))], [false, 28n, 12n]);
    // Final position decides the outcome even when a runner touched the exit earlier.
    assert.deepEqual([...await contract.preview(1, bytes('RRRRRRL'))], [false, 33n, 11n]);
    // Leaving the gate remains possible when the switch closes this tick.
    assert.deepEqual([...await contract.preview(1, bytes('..RRRRRR'))], [true, 34n, 11n]);
    const second = contract.connect(runner);
    for (const moves of ['', '.'.repeat(33)]) {
      await expectError(contract, contract.preview(1, bytes(moves)), 'InvalidLength');
    }
    await expectError(contract, contract.preview(1, bytes('RRRRRR?')), 'InvalidMove');
    await expectError(contract, contract.clearRoom.staticCall(1, solution), 'OwnGhost');
    await expectError(contract, second.clearRoom.staticCall(2, solution), 'UnknownRun');
    await expectError(contract, second.clearRoom.staticCall(1, bytes('...RRRRRR')), 'MissedExit');
    assert.equal(await contract.clearedWith(runner.address, 1), false);
    assert.equal(await second.clearRoom.staticCall(1, solution), true);
    const clear = await (await second.clearRoom(1, solution)).wait();
    const log = decodedEvent(contract, clear, 'RoomCleared');
    assert.deepEqual([log.runId, log.player, log.ghostPlayer, log.moves],
      [1n, runner.address, archivist.address, solution]);
    const proof = await verifyReceipts(provider, [contract.deploymentTransaction().hash, first.hash, clear.hash], artifact);
    assert.equal(proof.cleared, true);
    assert.equal(proof.finalRunnerTile, 34);
    assert.equal(proof.ghostRoute, 'UURR..L');
    await assert.rejects(
      verifyReceipts(provider, [contract.deploymentTransaction().hash, clear.hash, first.hash], artifact),
      /transaction order/
    );
    assert.equal(await contract.clearedWith(runner.address, 1), true);
    await expectError(contract, second.clearRoom.staticCall(1, solution), 'AlreadyCleared');
    assert.equal(await contract.connect(other).clearRoom.staticCall(1, solution), true);
    // Holding on the plate and long Solidity bytes storage (32 bytes) work with a fresh run id.
    const long = bytes('UURR' + '.'.repeat(28));
    await (await contract.recordRun(long)).wait();
    assert.deepEqual([...await contract.getRun(2)], [archivist.address, long]);
    assert.equal(getBytes(long).length, 32);
    assert.deepEqual([...await contract.preview(2, bytes('.'.repeat(26) + 'RRRRRR'))], [true, 34n, 12n]);
    assert.equal(await contract.clearedWith(runner.address, 2), false);
    // Finishing the ghost's own recorded route on the plate also holds it open after the final move.
    await (await contract.recordRun(bytes('UURR'))).wait();
    assert.deepEqual([...await contract.preview(3, bytes('....RRRRRR'))], [true, 34n, 12n]);
    // An archived solo ghost cannot cross its own gate and affect the runner's reachable region.
    await (await contract.recordRun(bytes('UURRLLDDRRRRRR'))).wait();
    assert.deepEqual([...await contract.preview(4, bytes('.'.repeat(14)))], [false, 28n, 31n]);
    console.log(JSON.stringify({
      network: 'local Ganache Shanghai', chainId: 1337, compiler: artifact.compiler,
      runtimeBytes: getBytes(artifact.deployedBytecode).length,
      runtimeHash: keccak256(artifact.deployedBytecode),
      recordRunGas: first.gasUsed.toString(), clearRoomGas: clear.gasUsed.toString(),
      outcome: 'pass'
    }, null, 2));
  } finally {
    await chain.disconnect();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
