'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Interface, getCreateAddress, id, keccak256 } = require('ethers');

// This script uses no signer. All writes below are confined to virtual blocks
// inside a single eth_simulateV1 call. eth_estimateGas is quoted independently.
const rpcURL = 'https://rpc.mainnet.chain.robinhood.com';
const genesisHash = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const rpcMethods = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_getCode',
  'eth_call', 'eth_estimateGas', 'eth_simulateV1']);
let nextId = 0;
async function rpc(method, params) {
  assert(rpcMethods.has(method));
  const id = ++nextId;
  const response = await fetch(rpcURL, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60000), body: JSON.stringify({ id, jsonrpc: '2.0', method, params }) });
  assert(response.ok, 'Robinhood HTTP ' + response.status);
  const json = await response.json();
  assert.equal(json.id, id);
  if (json.error) throw Error(method + ' failed: ' + JSON.stringify(json.error));
  return json.result;
}
function bytes(value) {
  assert(typeof value === 'string' && /^(?:0x)?(?:[0-9a-f]{2})+$/i.test(value), 'Invalid bytecode');
  return (value.startsWith('0x') ? value : '0x' + value).toLowerCase();
}
const etherGas = '0x1e8480';
const abi = new Interface(['function quote(uint8 items, uint8 tier) view returns (uint32 cents)']);
const samples = [[10, 1], [3, 2], [1, 0], [255, 255], [0, 1], [255, 1], [255, 2]];
function price(items, tier) {
  return items * (tier === 1 ? 95 : tier === 2 ? 90 : 100);
}
async function main() {
  const artifactPath = process.argv[2] || path.join(__dirname, 'artifact.json');
  const outPath = process.argv[3] || path.join(__dirname, 'result.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const creation = bytes(artifact.bytecode), runtime = bytes(artifact.deployedBytecode);
  const chainId = Number(BigInt(await rpc('eth_chainId', [])));
  assert.equal(chainId, 4663);
  const base = await rpc('eth_getBlockByNumber', [process.argv[4] || 'latest', false]);
  assert.equal((await rpc('eth_getBlockByNumber', ['0x0', false])).hash, genesisHash);
  const from = '0x' + id('gh0st.rule.compiler.unsigned.rpc.probe').slice(-40);
  const nonce = BigInt(await rpc('eth_getTransactionCount', [from, base.number]));
  const to = getCreateAddress({ from, nonce });
  assert.equal(await rpc('eth_getCode', [to, base.number]), '0x');
  const deploy = { from, data: creation, gas: etherGas };
  const calls = samples.map(args => ({ from, to, data: abi.encodeFunctionData('quote', args), gas: etherGas }));
  const [runtimeResult, deployEstimate, sim] = await Promise.all([
    rpc('eth_call', [deploy, base.number]), rpc('eth_estimateGas', [deploy, base.number]),
    rpc('eth_simulateV1', [{ validation: false, traceTransfers: false, returnFullTransactions: false,
      blockStateCalls: [{ calls: [deploy] }, { calls }] }, base.number])
  ]);
  assert.equal(runtimeResult, runtime);
  assert.equal(sim.length, 2);
  assert.equal(sim[0].parentHash, base.hash);
  assert.equal(sim[1].parentHash, sim[0].hash);
  const deployment = sim[0].calls[0];
  assert.equal(BigInt(deployment.status), 1n);
  assert.equal(deployment.returnData, runtime);
  assert.equal(sim[1].calls.length, samples.length);
  const rows = [];
  const override = { [to]: { code: runtime } };
  for (const [i, [items, tier]] of samples.entries()) {
    const execution = sim[1].calls[i];
    const [direct, estimate] = await Promise.all([
      rpc('eth_call', [calls[i], base.number, override]), rpc('eth_estimateGas', [calls[i], base.number, override])
    ]);
    assert.equal(BigInt(execution.status), 1n);
    assert.equal(execution.returnData, direct);
    const expectedCents = price(items, tier);
    const [quoted] = abi.decodeFunctionResult('quote', direct);
    assert.equal(quoted, BigInt(expectedCents), 'Rule price differs for items=' + items + ',tier=' + tier);
    rows.push({ items, tier, expectedCents, returnedCents: Number(quoted), calldata: calls[i].data,
      returnData: direct, simulatedGasUsed: Number(BigInt(execution.gasUsed)), estimatedGas: Number(BigInt(estimate)) });
  }
  const recheck = await rpc('eth_getBlockByNumber', [base.number, false]);
  assert.equal(recheck.hash, base.hash);
  assert.equal(await rpc('eth_getCode', [to, base.number]), '0x');
  const evidence = { schema: 'gh0st.rule-compiler.robinhood-replay.v1', chainId, genesisHash, rpcURL,
    scope: 'Read-only Robinhood mainnet RPC. One eth_simulateV1 sequence creates the contract and calls it from its retained state. Independent eth_call and eth_estimateGas use only a code override at the same temporary address for quote calls. Constructor calls need no override. No transaction was signed or sent.',
    gasBasis: 'simulatedGasUsed is the per-transaction gas returned by eth_simulateV1. estimatedGas is the node quote at the canonical base block and may include posting estimates and margin. Neither is a paid fee.',
    observedAt: new Date().toISOString(), baseBlock: Number(BigInt(base.number)), baseHash: base.hash,
    temporaryAddress: to, creationBytes: (creation.length - 2) / 2, runtimeBytes: (runtime.length - 2) / 2,
    creationHash: keccak256(creation), runtimeHash: keccak256(runtime), canonicalCodeAtTemporaryAddress: '0x',
    deployment: { simulatedGasUsed: Number(BigInt(deployment.gasUsed)), estimatedGas: Number(BigInt(deployEstimate)) }, samples: rows
  };
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ baseBlock: evidence.baseBlock, deployment: evidence.deployment, samples: rows.map(
    ({ items, tier, returnedCents, simulatedGasUsed, estimatedGas }) => ({ items, tier, returnedCents, simulatedGasUsed, estimatedGas })) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
