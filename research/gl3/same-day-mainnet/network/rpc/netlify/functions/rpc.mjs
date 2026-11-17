// Separate RPC site only. Never add this catch-all to the existing GH0ST website.
// Binding values are public chain metadata; upstream credentials are unsupported.
const MAX_BYTES = 262144;
const MAX_BATCH = 50;
const METHODS = new Set([
  'web3_clientVersion', 'net_version', 'eth_chainId', 'eth_blockNumber',
  'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount',
  'eth_getBlockByHash', 'eth_getBlockByNumber', 'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber', 'eth_getTransactionByHash',
  'eth_getTransactionByBlockHashAndIndex', 'eth_getTransactionByBlockNumberAndIndex',
  'eth_getTransactionReceipt', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getLogs', 'eth_sendRawTransaction',
  'eth_syncing'
]);
const BASE_HEADERS = {
  'content-type': 'application/json', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type', 'x-content-type-options': 'nosniff'
};
const response = (statusCode, data) => ({ statusCode, headers: BASE_HEADERS, body: statusCode === 204 ? '' : JSON.stringify(data) });
const error = (code, message, id = null) => ({ jsonrpc: '2.0', id, error: { code, message } });

export function binding(env) {
  if (env.GL3_RPC_ENABLED !== 'true') throw Error('disabled');
  if (env.GL3_CHAIN_ID !== '4663001') throw Error('chain binding');
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.GL3_GENESIS_HASH || '')) throw Error('genesis binding');
  const upstream = new URL(env.GL3_RPC_UPSTREAM_HTTPS_URL || '');
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash) throw Error('upstream binding');
  return { upstream: upstream.toString(), genesis: env.GL3_GENESIS_HASH.toLowerCase() };
}

export function validRequest(item) {
  return !!item && typeof item === 'object' && !Array.isArray(item) && item.jsonrpc === '2.0'
    && (typeof item.id === 'string' || (typeof item.id === 'number' && Number.isSafeInteger(item.id)))
    && METHODS.has(item.method) && (item.params === undefined || Array.isArray(item.params));
}

// Chain/genesis checked before forwarding every user request. Never forward a
// signed transaction to a different chain after an upstream configuration change.
export async function proxy(event, env = process.env, fetcher = fetch) {
  if (event.httpMethod === 'OPTIONS') return response(204, null);
  if (event.httpMethod !== 'POST') return response(405, error(-32600, 'Use HTTP POST JSON-RPC'));
  let config;
  try { config = binding(env); } catch { return response(503, error(-32000, 'GH0ST RPC is not enabled')); }
  if (event.isBase64Encoded || Buffer.byteLength(event.body || '', 'utf8') > MAX_BYTES) return response(413, error(-32600, 'Request too large'));
  let body;
  try { body = JSON.parse(event.body || ''); } catch { return response(400, error(-32700, 'Invalid JSON')); }
  const list = Array.isArray(body) ? body : [body];
  if (!list.length || list.length > MAX_BATCH || !list.every(validRequest)) return response(400, error(-32600, 'Unsupported or invalid RPC request'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const send = async (payload) => {
      const r = await fetcher(config.upstream, {
        method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify(payload), signal: controller.signal, redirect: 'error'
      });
      if (!r.ok) throw Error('upstream unavailable');
      const declaredBytes = Number(r.headers.get('content-length') || 0);
      if (declaredBytes > 8 * 1024 * 1024) throw Error('upstream response too large');
      if (!r.body) throw Error('upstream response missing');
      const reader = r.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 8 * 1024 * 1024) throw Error('upstream response too large');
          chunks.push(Buffer.from(value));
        }
      } catch (e) { await reader.cancel(); throw e; }
      finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    };
    const check = await send([
      { jsonrpc: '2.0', id: 'binding-chain', method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 'binding-genesis', method: 'eth_getBlockByNumber', params: ['0x0', false] }
    ]);
    if (!Array.isArray(check)) throw Error('upstream binding');
    const chain = check.find(x => x.id === 'binding-chain');
    const genesis = check.find(x => x.id === 'binding-genesis');
    if (BigInt(chain?.result || '0') !== 4663001n || genesis?.result?.hash?.toLowerCase() !== config.genesis) throw Error('upstream binding');
    const result = await send(body);
    return response(200, result);
  } catch { return response(502, error(-32000, 'GH0ST RPC upstream unavailable or chain binding failed')); }
  finally { clearTimeout(timer); }
}
export const handler = (event) => proxy(event);
