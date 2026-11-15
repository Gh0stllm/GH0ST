// Read-only production token check. No wallet, signer, approval, transfer or deployment.
import { keccak256 } from 'ethers';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const chainId = 4663;
const token = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const expectedRuntimeHash = '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
const endpoint = process.env.ROBINHOOD_MAINNET_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
let requestId = 0;
async function rpc(method, params = []) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Read-only RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data.error || data.result === undefined) throw new Error(`Read-only RPC ${method} failed`);
  return data.result;
}

try {
  // Verify the chain before requesting any chain-specific data.
  if (Number(BigInt(await rpc('eth_chainId'))) !== chainId) throw new Error('Unexpected chain');
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  const results = await Promise.allSettled([
    rpc('eth_getCode', [token, block.number]),
    rpc('eth_call', [{ to: token, data: '0x313ce567' }, block.number]),
  ]);
  for (const result of results) if (result.status !== 'fulfilled') throw result.reason;
  const codeHash = keccak256(results[0].value);
  const decimals = Number(BigInt(results[1].value));
  if (codeHash !== expectedRuntimeHash || decimals !== 18) throw new Error('Token runtime or decimals mismatch');
  const report = {
    scope: 'Read-only Robinhood mainnet token identity snapshot; no chess deployment or funding',
    checkedAt: new Date().toISOString(), chainId, token, decimals,
    blockNumber: Number(BigInt(block.number)), blockHash: block.hash,
    runtimeHash: codeHash, runtimeBytes: (results[0].value.length - 2) / 2,
    passed: true,
  };
  if (process.argv.includes('--write')) await writeFile(fileURLToPath(new URL('./binding-snapshot.json', import.meta.url)), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Never echo a credential-bearing URL or a provider's request/response body.
  console.error(error instanceof Error && /^(Unexpected chain|Token runtime|Read-only RPC)/.test(error.message)
    ? error.message : 'Read-only binding check failed; no transaction was sent');
  process.exitCode = 1;
}
