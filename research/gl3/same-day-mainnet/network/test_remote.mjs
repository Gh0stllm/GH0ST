// Unit fixtures only. No public network calls, chain writes, keys or live claims.
import assert from 'node:assert/strict';
import { binding, validRequest, proxy } from './rpc/netlify/functions/rpc.mjs';
import { deriveBridgeState, FAST_CONFIRMER, SECURITY_BADGE, SECURITY_NOTE } from './bridge-state.mjs';

const genesis = '0x' + 'ab'.repeat(32);
const env = { GL3_RPC_ENABLED: 'true', GL3_RPC_READ_ONLY: 'false', GL3_CHAIN_ID: '4663001', GL3_GENESIS_HASH: genesis,
  GL3_RPC_UPSTREAM_HTTPS_URL: 'https://fixture.invalid/' };
const rpc = (method, params = []) => ({ jsonrpc: '2.0', id: 1, method, params });
const event = (body, method = 'POST') => ({ httpMethod: method, body: JSON.stringify(body) });
const checks = [];
async function test(name, run) { await run(); checks.push(name); }
const makeFixture = ({ wrongChain = false, wrongGenesis = false, fail = false } = {}) => {
  const forwarded = [];
  const fetcher = async (url, opts) => {
    assert.equal(url, env.GL3_RPC_UPSTREAM_HTTPS_URL);
    assert.equal(opts.redirect, 'error');
    assert.ok(opts.signal instanceof AbortSignal);
    if (fail) throw Error('private error that must not leak');
    const q = JSON.parse(opts.body);
    if (Array.isArray(q) && q[0]?.id === 'binding-chain') return new Response(JSON.stringify([
      { jsonrpc: '2.0', id: 'binding-genesis', result: { hash: wrongGenesis ? '0x' + 'cd'.repeat(32) : genesis } },
      { jsonrpc: '2.0', id: 'binding-chain', result: wrongChain ? '0x1237' : '0x' + (4663001).toString(16) }
    ]), { status: 200 });
    forwarded.push(q);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, result: '0x01' }), { status: 200 });
  };
  return { fetcher, forwarded };
};

await test('default disabled', async () => assert.equal((await proxy(event(rpc('eth_chainId')), {})).statusCode, 503));
await test('wrong configured chain rejected', () => assert.throws(() => binding({ ...env, GL3_CHAIN_ID: '4663' })));
await test('missing genesis rejected', () => assert.throws(() => binding({ ...env, GL3_GENESIS_HASH: '' })));
await test('plaintext upstream rejected', () => assert.throws(() => binding({ ...env, GL3_RPC_UPSTREAM_HTTPS_URL: 'http://fixture.invalid' })));
await test('credential upstream rejected', () => assert.throws(() => binding({ ...env, GL3_RPC_UPSTREAM_HTTPS_URL: 'https://secret@fixture.invalid' })));
await test('GET rejected and OPTIONS empty', async () => {
  assert.equal((await proxy(event(null, 'GET'), env)).statusCode, 405);
  const r = await proxy(event(null, 'OPTIONS'), env); assert.equal(r.statusCode, 204); assert.equal(r.body, '');
});
await test('admin/debug/engine/personal/unknown rejected', () => {
  for (const m of ['admin_peers', 'debug_traceCall', 'engine_newPayloadV3', 'personal_unlockAccount', 'txpool_content', 'arbdebug_getPricingModel', 'evm_mine']) assert.equal(validRequest(rpc(m)), false);
});
await test('notifications and unsafe numeric id rejected', () => {
  assert.equal(validRequest({ jsonrpc: '2.0', method: 'eth_chainId' }), false);
  assert.equal(validRequest({ ...rpc('eth_chainId'), id: Number.MAX_SAFE_INTEGER + 1 }), false);
});
await test('malformed and oversized requests rejected', async () => {
  assert.equal((await proxy({ httpMethod: 'POST', body: '{' }, env)).statusCode, 400);
  assert.equal((await proxy({ httpMethod: 'POST', body: 'x'.repeat(262145) }, env)).statusCode, 413);
  assert.equal((await proxy(event(Array(51).fill(rpc('eth_chainId'))), env)).statusCode, 400);
  assert.equal((await proxy(event([]), env)).statusCode, 400);
});
await test('upstream chain mismatch blocks signed transaction', async () => {
  const f = makeFixture({ wrongChain: true });
  assert.equal((await proxy(event(rpc('eth_sendRawTransaction', ['0x01'])), env, f.fetcher)).statusCode, 502);
  assert.equal(f.forwarded.length, 0);
});
await test('upstream genesis mismatch blocks signed transaction', async () => {
  const f = makeFixture({ wrongGenesis: true });
  assert.equal((await proxy(event(rpc('eth_sendRawTransaction', ['0x01'])), env, f.fetcher)).statusCode, 502);
  assert.equal(f.forwarded.length, 0);
});
await test('correct binding forwards exact signed transaction once', async () => {
  const f = makeFixture(); const q = rpc('eth_sendRawTransaction', ['0x01']);
  const r = await proxy(event(q), env, f.fetcher);
  assert.equal(r.statusCode, 200); assert.deepEqual(f.forwarded, [q]);
  assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['access-control-allow-origin'], '*');
});
await test('backend error details never leak', async () => {
  const f = makeFixture({ fail: true }); const r = await proxy(event(rpc('eth_chainId')), env, f.fetcher);
  assert.equal(r.statusCode, 502); assert.ok(!r.body.includes('private error'));
});
await test('streaming response size bound stops oversized upstream', async () => {
  let cancelled = false;
  const fetcher = async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; }
  }));
  const r = await proxy(event(rpc('eth_chainId')), env, fetcher);
  assert.equal(r.statusCode, 502); assert.equal(cancelled, true);
});
const bridgeBinding = { profile: 'nitro-project-run-fast-confirmation', zkAtLaunch: false,
  fastConfirmerEnabled: true, expectedAnyTrustFastConfirmer: FAST_CONFIRMER,
  childGenesisHash: genesis, rollupAddress: '0x' + '11'.repeat(20) };
const observed = { parentChainId: 4663, childChainId: 4663001, childGenesisHash: genesis,
  rollupAddress: bridgeBinding.rollupAddress, anyTrustFastConfirmer: FAST_CONFIRMER,
  nativeBackingVerified: true, nodeHealthy: true, batchPosterHealthy: true };
await test('fast-confirmation badge and trust note are exact; no ZK or instant claim', () => {
  const s = deriveBridgeState(bridgeBinding, observed);
  assert.equal(s.status, 'ready'); assert.equal(s.securityBadge, SECURITY_BADGE);
  assert.equal(s.securityNote, SECURITY_NOTE); assert.equal(s.zkVerified, false);
  assert.equal(s.guaranteedInstant, false); assert.equal(s.depositEnabled, true); assert.equal(s.claimEnabled, false);
});
await test('zero or changed actual fast confirmer disables bridge', () => {
  for (const role of ['0x' + '00'.repeat(20), '0x' + '22'.repeat(20), null]) {
    const s = deriveBridgeState(bridgeBinding, { ...observed, anyTrustFastConfirmer: role });
    assert.equal(s.status, 'unavailable'); assert.equal(s.depositEnabled, false); assert.equal(s.claimEnabled, false);
  }
});
await test('unexpected configured role or old standard profile disables bridge', () => {
  assert.equal(deriveBridgeState({ ...bridgeBinding, expectedAnyTrustFastConfirmer: '0x' + '22'.repeat(20) }, observed).status, 'unavailable');
  assert.equal(deriveBridgeState({ ...bridgeBinding, profile: 'standard-nitro-project-validators', fastConfirmerEnabled: false }, observed).status, 'unavailable');
});
await test('wrong parent child genesis or rollup cannot show a paid bridge', () => {
  for (const change of [{ parentChainId: 1 }, { childChainId: 4663 }, { childGenesisHash: '0x' + 'cd'.repeat(32) }, { rollupAddress: '0x' + '22'.repeat(20) }]) {
    assert.equal(deriveBridgeState(bridgeBinding, { ...observed, ...change }, { paidReceiptVerified: true }).status, 'unavailable');
  }
});
await test('unhealthy node or backing disables bridge', () => {
  for (const field of ['nativeBackingVerified', 'nodeHealthy', 'batchPosterHealthy']) assert.equal(deriveBridgeState(bridgeBinding, { ...observed, [field]: false }).status, 'unavailable');
});
await test('burn waits for GH0ST confirmation without a fixed seven-day countdown', () => {
  const s = deriveBridgeState(bridgeBinding, observed, { burnReceiptVerified: true });
  assert.equal(s.status, 'awaiting_gh0st_confirmation'); assert.equal(s.claimEnabled, false);
  assert.ok(s.message.includes('GH0ST')); assert.ok(!s.message.includes('7 day'));
});
await test('verified fast-confirmed root enables RH claim and fee explanation', () => {
  const s = deriveBridgeState(bridgeBinding, observed, { burnReceiptVerified: true, fastConfirmedRootVerified: true });
  assert.equal(s.status, 'claim_ready'); assert.equal(s.claimEnabled, true); assert.ok(s.message.includes('processing fees'));
});
await test('paid status requires verified payout observation', () => {
  const s = deriveBridgeState(bridgeBinding, observed, { paidReceiptVerified: true });
  assert.equal(s.status, 'paid'); assert.equal(s.claimEnabled, false);
});
console.log(JSON.stringify({ scope: 'Runpod Node18 unit fixtures; not deployed Netlify, Nitro, bridge, or mainnet evidence', passed: checks.length, checks }, null, 2));
