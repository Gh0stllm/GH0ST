// Read-only JSON-RPC helper. Never serializes the endpoint or provider error body.
import { readFileSync, statSync } from 'node:fs';

let endpoint = process.env.ROBINHOOD_MAINNET_RPC_URL;
let source = endpoint ? 'private environment variable' : 'public fallback';
if (!endpoint && process.env.GH0ST_RPC_ENV_FILE) {
  const path = process.env.GH0ST_RPC_ENV_FILE;
  if ((statSync(path).mode & 0o077) !== 0) throw new Error('Private RPC environment file must be owner-only');
  const text = readFileSync(path, 'utf8');
  const found = /^\s*(?:export\s+)?ROBINHOOD_MAINNET_RPC_URL\s*=\s*(.*?)\s*$/m.exec(text);
  if (found) {
    endpoint = found[1];
    if ((endpoint.startsWith('"') && endpoint.endsWith('"')) || (endpoint.startsWith("'") && endpoint.endsWith("'"))) endpoint = endpoint.slice(1, -1);
    source = 'private local environment file';
  }
}
endpoint ||= 'https://rpc.mainnet.chain.robinhood.com';
let protocol;
try { protocol = new URL(endpoint).protocol; }
catch { throw new Error('Invalid private RPC configuration'); }
if (protocol !== 'https:') throw new Error('Expected HTTPS RPC');
export const endpointSource = source;
const allowed = new Set(['eth_chainId','eth_gasPrice','eth_getBlockByNumber','eth_call','eth_estimateGas','eth_getCode','web3_clientVersion','eth_getBalance','eth_feeHistory']);
let id = 0;
export async function rpc(method, params = []) {
  if (!allowed.has(method)) throw new Error('Only named read-only RPC methods are allowed');
  let response;
  try {
    response = await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}), signal:AbortSignal.timeout(90_000) });
  } catch { throw new Error(`Read-only RPC ${method} transport failed`); }
  if (!response.ok) throw new Error(`Read-only RPC ${method} HTTP ${response.status}`);
  let value;
  try { value = await response.json(); }
  catch { throw new Error(`Read-only RPC ${method} returned invalid JSON`); }
  if (value.error) {
    const e = new Error(`Read-only RPC ${method} rejected (code ${Number(value.error.code)})`);
    e.rpcCode = Number(value.error.code);
    // A revert payload has no provider URL and is useful for decoding known custom errors.
    if (typeof value.error.data === 'string' && /^0x[0-9a-f]*$/i.test(value.error.data)) e.revertData = value.error.data;
    throw e;
  }
  if (value.result === undefined) throw new Error(`Read-only RPC ${method} missing result`);
  return value.result;
}
export async function verifyChain() {
  const chainId = Number(BigInt(await rpc('eth_chainId')));
  if (chainId !== 4663) throw new Error('Wrong chain; no chain-specific calls performed');
  return chainId;
}
