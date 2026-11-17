export function parseSearch(input) {
  const s = String(input).trim();
  if (/^0x[0-9a-f]{40}$/i.test(s)) return { type: 'address', value: s };
  if (/^0x[0-9a-f]{64}$/i.test(s)) return { type: 'hash', value: s };
  if (/^(0|[1-9][0-9]*)$/.test(s)) return { type: 'block', value: '0x' + BigInt(s).toString(16) };
  throw Error('Enter an address, transaction/block hash, or a decimal block number.');
}
export function quantity(x) { if (!/^0x[0-9a-f]+$/i.test(String(x))) throw Error('Invalid RPC quantity'); return BigInt(x); }
export function native(x) { const n = quantity(x), a = n / 10n ** 18n, b = String(n % 10n ** 18n).padStart(18, '0').replace(/0+$/, ''); return String(a) + (b ? '.' + b : ''); }
export function verifiedConfig(c) {
  if (!c?.enabled) throw Error('GH0ST Scan is waiting for verified network configuration.');
  if (c.chainId !== 4663001 || c.nativeSymbol !== 'GH0ST' || c.confirmationMode !== 'project-run-fast-confirmation' || c.zkAtLaunch !== false) throw Error('Unexpected explorer network profile');
  if (typeof c.readOnly !== 'boolean') throw Error('Explicit read-only network binding is required');
  if (c.readOnly && (c.networkPhase !== 'bootstrap-read-only' || c.bridgeEnabled !== false)) throw Error('Read-only bootstrap must keep bridge transactions disabled');
  if (!/^0x[0-9a-f]{64}$/i.test(c.genesisHash || '') || /^0x0{64}$/i.test(c.genesisHash)) throw Error('Verified genesis is required');
  const u = new URL(c.rpcUrl); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw Error('Verified HTTPS RPC is required');
  return c;
}
export function presentation(c, head) {
  verifiedConfig(c);
  return c.readOnly ? {
    badge: 'Bootstrap · read-only',
    notice: 'Public transaction submission is disabled. Bridge funding and setup are pending. GH0ST-operated confirmation; ZK verification is not live.',
    status: BigInt(head) === 0n ? 'Genesis block0 is available. No later blocks exist yet in this read-only bootstrap. Bridge setup is pending.' : 'Read-only bootstrap. Chain and genesis verified; showing actual RPC block data. Bridge setup is pending.'
  } : c.networkPhase === 'initial-setup' ? {
    badge: 'Live · initial setup',
    notice: 'Public RPC is live. GH0ST cold-wallet setup authority remains while initialization finishes. Fee calibration and owner removal are not yet complete. GH0ST-operated confirmation; ZK verification is not live.',
    status: BigInt(head) === 0n ? 'Live network · initial setup. Showing actual genesis block0; no later blocks are available yet.' : 'Live network · initial setup. Chain and genesis verified; showing actual RPC block data.'
  } : c.networkPhase === 'finalized' ? { badge: 'Live · setup complete', notice: 'Setup receipts verified: temporary chain-owner authority removed and target fee settings active. GH0ST-operated key confirms withdrawal roots; ZK verification is not live.', status: 'Live network. Chain and genesis verified; showing actual RPC block data.' } : { badge: 'Project-run fast confirmation', notice: 'GH0ST-operated key confirms withdrawal roots. ZK verification is not live.', status: 'GL3 chain and genesis verified. Showing actual RPC block data.' };
}
export function blockPage(head, cursor, size = 20) {
  const top = cursor === null ? BigInt(head) : BigInt(cursor);
  if (top < 0n || top > BigInt(head) || size < 1 || size > 20) throw Error('Invalid block page');
  return Array.from({ length: Math.min(size, Number(top < 20n ? top + 1n : 20n)) }, (_, i) => '0x' + (top - BigInt(i)).toString(16));
}
