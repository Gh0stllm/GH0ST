// Unsigned, read-only simulation. Each generated block builds on the preceding
// one in the same eth_simulateV1 call; no Echо code or storage is injected.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Interface, getCreateAddress, hexlify, id, keccak256, toUtf8Bytes } = require('ethers');
const { compile } = require('../compile.cjs');

const rpcURL = 'https://rpc.mainnet.chain.robinhood.com';
const genesis = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const gas = '0x7a1200';
const address = (label) => '0x' + id('gh0st.echo.rehearsal.' + label).slice(-40);
const deployer = address('builder'), recorder = address('first-player'), runner = address('second-player');
const moves = (str) => hexlify(toUtf8Bytes(str));
const roomId = 1;
const archive = 'UURR..L', solution = 'RRRRRR', missed = '......RRRRRR';
const allowed = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getTransactionCount', 'eth_simulateV1']);
let requestId = 0;

async function rpc(method, params) {
  assert(allowed.has(method));
  const reqid = ++requestId;
  const response = await fetch(rpcURL, { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ jsonrpc: '2.0', id: reqid, method, params }) });
  assert(response.ok, 'Robinhood HTTP ' + response.status);
  const reply = await response.json();
  assert.equal(reply.id, reqid);
  if (reply.error) throw Error(method + ': ' + JSON.stringify(reply.error));
  return reply.result;
}

async function main() {
  const artifact = compile();
  const iface = new Interface(artifact.abi);
  const chainId = Number(BigInt(await rpc('eth_chainId', [])));
  assert.equal(chainId, 4663);
  const blockTag = process.argv[2] || 'latest';
  assert(/^(latest|safe|finalized|0x[0-9a-f]+)$/i.test(blockTag));
  const [origin, base] = await Promise.all([rpc('eth_getBlockByNumber', ['0x0', false]), rpc('eth_getBlockByNumber', [blockTag, false])]);
  assert.equal(origin.hash, genesis);
  assert(base && base.hash);
  const nonce = BigInt(await rpc('eth_getTransactionCount', [deployer, base.number]));
  const contract = getCreateAddress({ from: deployer, nonce });
  assert.equal(await rpc('eth_getCode', [contract, base.number]), '0x');
  const make = (label, from, name, args, expect = 'pass') => ({
    label, name, expect, tx: { from, to: contract, gas, data: iface.encodeFunctionData(name, args) }
  });
  const blocks = [
    [{ label: 'deploy', expect: 'pass', tx: { from: deployer, gas, data: artifact.bytecode } }],
    [make('archive', recorder, 'recordRun', [moves(archive)])],
    [make('readArchive', runner, 'getRun', [roomId]),
      make('archiveCount', runner, 'runCount', []),
      make('previewMiss', runner, 'preview', [roomId, moves(missed)]),
      make('lateRunner', runner, 'clearRoom', [roomId, moves(missed)], 'revert'),
      make('selfPair', recorder, 'clearRoom', [roomId, moves(solution)], 'revert'),
      make('stillUncleared', runner, 'clearedWith', [runner, roomId])],
    [make('previewWin', runner, 'preview', [roomId, moves(solution)]),
      make('clear', runner, 'clearRoom', [roomId, moves(solution)]),
      make('verifyClear', runner, 'clearedWith', [runner, roomId]),
      make('repeatedClear', runner, 'clearRoom', [roomId, moves(solution)], 'revert')]
  ];
  const simulation = await rpc('eth_simulateV1', [{
    validation: false, traceTransfers: false, returnFullTransactions: false,
    blockStateCalls: blocks.map(block => ({ calls: block.map(call => call.tx) }))
  }, base.number]);
  assert.equal(simulation.length, blocks.length);
  const outputs = {};
  const checks = [];
  for (const [blockIndex, expected] of blocks.entries()) {
    const result = simulation[blockIndex];
    assert.equal(result.parentHash, blockIndex === 0 ? base.hash : simulation[blockIndex - 1].hash);
    assert.equal(result.calls.length, expected.length);
    for (const [callIndex, planned] of expected.entries()) {
      const resultCall = result.calls[callIndex];
      assert.equal(BigInt(resultCall.status), planned.expect === 'pass' ? 1n : 0n, planned.label + ': ' + JSON.stringify(resultCall.error));
      const check = { label: planned.label, simulatedBlock: Number(BigInt(result.number)), sender: planned.tx.from,
        result: planned.expect, gasUsed: Number(BigInt(resultCall.gasUsed)) };
      if (planned.label === 'deploy') {
        assert.equal(keccak256(resultCall.returnData), keccak256(artifact.deployedBytecode), 'runtime hash');
        check.runtimeHash = keccak256(resultCall.returnData);
      } else if (planned.expect === 'pass') {
        outputs[planned.label] = iface.decodeFunctionResult(planned.name, resultCall.returnData).toArray();
        check.decoded = outputs[planned.label].map(x => typeof x === 'bigint' ? x.toString() : x);
      } else {
        const data = resultCall.returnData !== '0x' ? resultCall.returnData : resultCall.error?.data;
        const decoded = iface.parseError(data);
        assert(decoded, planned.label + ' returned no ABI-decodable error');
        check.error = decoded.name;
      }
      const logs = resultCall.logs.map(log => {
        assert.equal(log.address.toLowerCase(), contract.toLowerCase());
        const event = iface.parseLog(log);
        assert(event, 'Unrecognized event from room');
        return { name: event.name, args: event.args.toArray().map(x => typeof x === 'bigint' ? x.toString() : x) };
      });
      if (logs.length) check.events = logs;
      checks.push(check);
    }
  }
  assert.equal(outputs.archive[0], 1n);
  assert.equal(outputs.readArchive[0].toLowerCase(), recorder);
  assert.equal(outputs.readArchive[1], moves(archive));
  assert.deepEqual(outputs.archiveCount, [1n]);
  assert.equal(outputs.previewMiss[0], false);
  assert.deepEqual(outputs.stillUncleared, [false]);
  assert.equal(outputs.previewWin[0], true);
  assert.equal(outputs.previewWin[1], 34n);
  assert.deepEqual(outputs.clear, [true]);
  assert.deepEqual(outputs.verifyClear, [true]);
  const checkFor = (label) => checks.find(c => c.label === label);
  assert(checkFor('archive').events?.length >= 1 && checkFor('clear').events?.length >= 1);
  const canonical = await rpc('eth_getBlockByNumber', [base.number, false]);
  assert.equal(base.hash, canonical.hash, 'base changed during rehearsal');
  const evidence = {
    schema: 'gh0st.echo.rh-rehearsal.v1',
    scope: 'Unsigned eth_simulateV1 call on the public Robinhood mainnet RPC. The generated blocks share state only within the simulation. They are not mainnet receipts. Gas figures are simulated EVM gas, not a published transaction fee.',
    chainId, genesisHash: genesis, rpcURL, observedAt: new Date().toISOString(),
    baseBlock: Number(BigInt(base.number)), baseHash: base.hash, baseTimestamp: Number(BigInt(base.timestamp)),
    simulatedContract: contract, creationCodeHash: keccak256(artifact.bytecode),
    runtimeCodeHash: keccak256(artifact.deployedBytecode), compiler: artifact.compiler, sourceSha256: artifact.sourceSha256,
    archive, runner: solution, lateRunner: missed, checks
  };
  const json = JSON.stringify(evidence, null, 2) + '\n';
  if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), json);
  process.stdout.write(json);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
