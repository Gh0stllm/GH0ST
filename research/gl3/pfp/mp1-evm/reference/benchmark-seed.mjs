import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../chess/package.json', import.meta.url));
const solc = require('solc');
const { Interface, id, getAddress, formatEther, toQuantity } = require('ethers');
const url = 'https://rpc.mainnet.chain.robinhood.com';
const genesis = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const address = getAddress('0x' + id('gh0st.mp1.seed-features.20261123').slice(-40));
const source = await readFile(new URL('./SeedFeatures.sol', import.meta.url), 'utf8');
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'SeedFeatures.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object'] } },
  },
})));
assert(!(compiled.errors ?? []).some(error => error.severity === 'error'), JSON.stringify(compiled.errors));
const runtime = compiled.contracts['SeedFeatures.sol'].SeedFeatures;
const iface = new Interface(runtime.abi);
const override = { [address]: { code: '0x' + runtime.evm.deployedBytecode.object } };
const { featureHashes } = JSON.parse(await readFile(new URL('./evidence/vectors.json', import.meta.url), 'utf8'));

let counter = 0;
async function rpc(method, params = []) {
  assert(['eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getCode', 'eth_call', 'eth_estimateGas'].includes(method));
  const id = ++counter;
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const reply = await response.json();
  if (!response.ok || reply.error || reply.id !== id || !Object.hasOwn(reply, 'result')) {
    throw Error(method + ' failed: ' + (reply.error?.message ?? response.status));
  }
  return reply.result;
}

const [chain, first, block, gasPrice] = await Promise.all([
  rpc('eth_chainId'), rpc('eth_getBlockByNumber', ['0x0', false]),
  rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_gasPrice'),
]);
assert.equal(chain, '0x1237');
assert.equal(first.hash, genesis);
assert.equal(await rpc('eth_getCode', [address, block.number]), '0x');

const cases = [
  ...Object.entries(featureHashes.noise).map(([n, sha256]) => ({ name: 'noise', args: [Number(n)], sha256 })),
  ...Object.entries(featureHashes.time).map(([n, sha256]) => ({ name: 'timeFeatures', args: [Number(n)], sha256 })),
  { name: 'spatialFeatures', args: [0, 256], sha256: featureHashes.spatial.full },
  { name: 'spatialFeatures', args: [224, 32], sha256: featureHashes.spatial.tail },
];
const rows = [];
for (const item of cases) {
  const tx = { to: address, gas: toQuantity(32_000_000), data: iface.encodeFunctionData(item.name, item.args) };
  const result = await rpc('eth_call', [tx, block.number, override]);
  const data = Buffer.from(iface.decodeFunctionResult(item.name, result)[0].slice(2), 'hex');
  assert.equal(createHash('sha256').update(data).digest('hex'), item.sha256, 'Byte parity failed for ' + item.name);
  const estimate = Number(BigInt(await rpc('eth_estimateGas', [tx, block.number, override])));
  rows.push({ ...item, bytes: data.length, estimateGas: estimate, feeETH: formatEther(BigInt(estimate) * BigInt(gasPrice)) });
  if (process.env.MP1_SEED_PROGRESS) console.log(JSON.stringify(rows.at(-1)));
}
assert.equal((await rpc('eth_getBlockByNumber', [block.number, false])).hash, block.hash);
const evidence = {
  scope: 'Read-only Robinhood state override. Deterministic preprocessing only, no deployed contract.',
  chainId: 4663, block: Number(BigInt(block.number)), blockHash: block.hash, gasPriceWei: String(BigInt(gasPrice)),
  runtimeBytes: runtime.evm.deployedBytecode.object.length / 2,
  results: rows,
};
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
