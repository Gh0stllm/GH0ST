// Anonymous read-only parent-chain checks. No key, signer, wallet RPC,
// transaction submission, factory deployment, or token approval is supported.
import { writeFileSync } from 'node:fs';
import { keccak256 } from 'ethers';

const endpoint = process.env.ROBINHOOD_MAINNET_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const token = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const expectedRuntime = '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
let id = 0;
async function read(method, params = []) {
  if (!['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getCode', 'eth_call'].includes(method))
    throw Error('Unsupported read-only method');
  const response = await fetch(endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'GH0ST-L3-read-only/1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error('Parent RPC read failed');
  const payload = await response.json();
  if (payload.error || payload.result === undefined) throw Error('Parent RPC returned an error');
  return payload.result;
}
try {
  if (BigInt(await read('eth_chainId')) !== 4663n) throw Error('Wrong parent chain');
  const head = BigInt(await read('eth_blockNumber'));
  if (head < 12n) throw Error('Parent chain too short');
  const blockTag = '0x' + (head - 12n).toString(16);
  const results = await Promise.allSettled([
    read('eth_getBlockByNumber', [blockTag, false]), read('eth_gasPrice'),
    read('eth_getCode', [token, blockTag]),
    read('eth_call', [{ to: token, data: '0x313ce567' }, blockTag]),
  ]);
  for (const result of results) if (result.status !== 'fulfilled') throw result.reason;
  const [block, gasPrice, code, decimals] = results.map(result => result.value);
  if (keccak256(code) !== expectedRuntime || BigInt(decimals) !== 18n)
    throw Error('Canonical GH0ST runtime or decimals mismatch');
  const report = {
    scope: 'Read-only Robinhood parent availability and canonical-token snapshot; not a rollup deployment or custom-gas-token audit',
    checkedAtUTC: new Date().toISOString(), chainId: 4663,
    blockNumber: Number(BigInt(block.number)), blockHash: block.hash,
    gasPriceWei: String(BigInt(gasPrice)),
    token, tokenRuntimeKeccak256: expectedRuntime, tokenDecimals: 18,
    credentialURLLogged: false, endpointFromEnvironment: Boolean(process.env.ROBINHOOD_MAINNET_RPC_URL),
    canonicalFactoriesVerified: false, actualL3EngineExecutionTested: false,
    privateKeysAccessed: false, updatesOrTransactionsSubmitted: 0,
  };
  if (process.argv.includes('--write'))
    writeFileSync(new URL('./parent-snapshot.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch {
  // RPC libraries can embed credential-bearing endpoints in error text.
  console.error('Read-only parent preflight failed; no funds or live state changed.');
  process.exitCode = 1;
}
