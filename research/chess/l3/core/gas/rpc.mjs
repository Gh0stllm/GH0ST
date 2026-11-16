// All network requests from this module are anonymous reads. Credential URLs
// stay in memory and are never included in reports or error messages.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const READ_METHODS = Object.freeze([
  'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode',
  'eth_getStorageAt', 'eth_call', 'eth_getBalance', 'eth_gasPrice',
]);

export function resolveEndpoint() {
  if (process.env.ROBINHOOD_MAINNET_RPC_URL) {
    return { endpoint: process.env.ROBINHOOD_MAINNET_RPC_URL, source: 'environment' };
  }
  // Only inspect the requested key in an already protected, gitignored file.
  // Never source a shell file or load private keys from it.
  const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
  const candidates = [new URL('../../../../../.env.local', import.meta.url),
    new URL('../../../../../../.env.local', import.meta.url)];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (!existsSync(path)) continue;
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) continue;
    try {
      execFileSync('git', ['check-ignore', '--quiet', path], {
        cwd: path.startsWith(repo) ? repo : fileURLToPath(new URL('../../../../../../', import.meta.url)),
        stdio: 'ignore',
      });
    } catch { continue; }
    const match = readFileSync(path, 'utf8').match(/^\s*(?:export\s+)?ROBINHOOD_MAINNET_RPC_URL\s*=\s*([^\r\n]+)\s*$/m);
    if (!match) continue;
    let endpoint = match[1].trim();
    if ((endpoint.startsWith('"') && endpoint.endsWith('"')) ||
        (endpoint.startsWith("'") && endpoint.endsWith("'"))) endpoint = endpoint.slice(1, -1);
    try {
      if (!['https:', 'http:'].includes(new URL(endpoint).protocol)) continue;
      return { endpoint, source: 'protected ignored local file' };
    } catch { continue; }
  }
  return { endpoint: 'https://rpc.mainnet.chain.robinhood.com', source: 'public fallback' };
}

export function createReader(endpoint, transport = fetch) {
  let id = 0;
  return async function read(method, params = []) {
    if (!READ_METHODS.includes(method)) throw Error('Unsupported read-only method');
    if (method === 'eth_call' && (params.length !== 2 || !params[0] ||
      Object.keys(params[0]).some(key => !['to', 'from', 'data'].includes(key)))) {
      throw Error('Unsupported read-only call parameters');
    }
    try {
      const response = await transport(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'GH0ST-L3-gas-read-only/1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw Error();
      const payload = await response.json();
      if (payload.error || payload.result === undefined) throw Error();
      return payload.result;
    } catch { throw Error(`Read-only ${method} failed`); }
  };
}
