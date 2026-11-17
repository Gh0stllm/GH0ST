import { parseSearch, quantity, native, verifiedConfig, blockPage, presentation } from './core.mjs';
const $ = id => document.getElementById(id); let config, head = 0n, cursor = null, requestId = 0, loading = false;
function say(text) { $('status').textContent = text; }
const el = (tag, text) => { const x = document.createElement(tag); if (text !== undefined) x.textContent = text; return x; };
const short = x => String(x).slice(0, 10) + '…' + String(x).slice(-6);
function link(value, label = short(value)) { const a = el('a', label); a.href = '#q=' + encodeURIComponent(value); return a; }
async function batch(calls) {
  const qs = calls.map(([method, params]) => ({ jsonrpc: '2.0', id: ++requestId, method, params }));
  const r = await fetch(config.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(qs), signal: AbortSignal.timeout(12000), cache: 'no-store' });
  if (!r.ok) throw Error('RPC is not available. No chain data has been substituted.');
  const result = await r.json(); if (!Array.isArray(result)) throw Error('Invalid RPC batch response');
  return qs.map(q => { const x = result.find(v => v.id === q.id); if (!x || x.error) throw Error(x?.error?.message || 'Incomplete RPC response'); return x.result; });
}
const rpc = async (method, params) => (await batch([[method, params]]))[0];
async function guard() {
  verifiedConfig(config); const [chain, genesis] = await batch([['eth_chainId', []], ['eth_getBlockByNumber', ['0x0', false]]]);
  if (quantity(chain) !== 4663001n || genesis?.hash?.toLowerCase() !== config.genesisHash.toLowerCase()) throw Error('RPC chain or genesis does not match GH0ST GL3.');
}
function row(fields) { const tr = el('tr'); for (const f of fields) { const td = el('td'); typeof f === 'object' ? td.append(f) : td.textContent = f; tr.append(td); } return tr; }
function detail(title, data) { $('detail').replaceChildren(el('h2', title)); const dl = el('dl'); for (const [k, v] of data) { dl.append(el('dt', k)); const dd = el('dd'); typeof v === 'object' && v !== null ? dd.append(v) : dd.textContent = String(v ?? '—'); dl.append(dd); } $('detail').append(dl); $('detail').hidden = false; }
async function listBlocks() {
  await guard(); head = quantity(await rpc('eth_blockNumber', [])); const heights = blockPage(head, cursor);
  const blocks = await batch(heights.map(n => ['eth_getBlockByNumber', [n, false]]));
  const body = $('block-rows'); body.replaceChildren();
  for (const b of blocks) { if (!b) continue; const height = quantity(b.number); body.append(row([link(String(height), String(height)), new Date(Number(quantity(b.timestamp)) * 1000).toISOString(), String(b.transactions.length), String(quantity(b.gasUsed))])); }
  $('height').textContent = 'Block ' + String(head); $('newer').disabled = cursor === null || cursor >= head; $('older').disabled = heights.at(-1) === '0x0';
  say(presentation(config, head).status);
}
async function showBlock(b) {
  if (!b) throw Error('Block not found.');
  detail('Block ' + String(quantity(b.number)), [['Hash', b.hash], ['Parent', link(b.parentHash)], ['Timestamp', new Date(Number(quantity(b.timestamp)) * 1000).toISOString()], ['Transactions', b.transactions.length], ['Gas used', String(quantity(b.gasUsed))], ['Gas limit', String(quantity(b.gasLimit))], ['Base fee / gas', b.baseFeePerGas ? native(b.baseFeePerGas) + ' GH0ST' : 'Not provided']]);
  const h = el('h3', 'Transactions'), table = el('table');
  for (const tx of b.transactions) table.append(row([link(typeof tx === 'string' ? tx : tx.hash), typeof tx === 'string' ? '—' : link(tx.from), typeof tx === 'string' ? '—' : tx.to ? link(tx.to) : 'Contract creation', typeof tx === 'string' ? '—' : native(tx.value) + ' GH0ST']));
  $('detail').append(h, table);
}
async function search(value) {
  await guard(); const q = parseSearch(value); $('query').value = value;
  if (q.type === 'block') return showBlock(await rpc('eth_getBlockByNumber', [q.value, true]));
  if (q.type === 'address') {
    const [balance, nonce, code] = await batch([['eth_getBalance', [q.value, 'latest']], ['eth_getTransactionCount', [q.value, 'latest']], ['eth_getCode', [q.value, 'latest']]]);
    detail('Address', [['Address', q.value], ['Balance', native(balance) + ' GH0ST'], ['Nonce', String(quantity(nonce))], ['Code', code === '0x' ? 'No bytecode at this address' : String((code.length - 2) / 2) + ' bytes; source not verified']]);
    if (code !== '0x') $('detail').append(el('pre', code.slice(0, 16386) + (code.length > 16386 ? '…' : '')));
    return;
  }
  const tx = await rpc('eth_getTransactionByHash', [q.value]);
  if (!tx) return showBlock(await rpc('eth_getBlockByHash', [q.value, true]));
  const receipt = await rpc('eth_getTransactionReceipt', [q.value]);
  const data = [['Hash', tx.hash], ['From', link(tx.from)], ['To', tx.to ? link(tx.to) : 'Contract creation'], ['Value', native(tx.value) + ' GH0ST'], ['Nonce', String(quantity(tx.nonce))], ['Status', receipt ? (quantity(receipt.status) === 1n ? 'Success' : 'Reverted') : 'Pending'], ['Block', receipt ? link(String(quantity(receipt.blockNumber)), String(quantity(receipt.blockNumber))) : 'Pending']];
  if (receipt) data.push(['Gas used', String(quantity(receipt.gasUsed))], ['Transaction fee', native('0x' + (quantity(receipt.gasUsed) * quantity(receipt.effectiveGasPrice || tx.gasPrice)).toString(16)) + ' GH0ST'], ['Receipt logs', receipt.logs.length]);
  detail('Transaction', data); $('detail').append(el('h3', 'Input data'), el('pre', (tx.input || '0x').slice(0, 16386)));
  if (receipt) $('detail').append(el('h3', 'Actual receipt'), el('pre', JSON.stringify(receipt, null, 2)));
}
async function run(fn) { if (loading) return; loading = true; $('refresh').disabled = true; try { await fn(); } catch (e) { say(e.message || 'RPC request failed'); } finally { loading = false; $('refresh').disabled = !config?.enabled; } }
$('search').onsubmit = e => { e.preventDefault(); location.hash = 'q=' + encodeURIComponent($('query').value.trim()); };
window.addEventListener('hashchange', () => run(async () => { if (location.hash.startsWith('#q=')) { await search(decodeURIComponent(location.hash.slice(3))); say('Showing actual RPC data.'); } }));
$('refresh').onclick = () => run(listBlocks);
$('older').onclick = () => run(async () => { const top = cursor ?? head; cursor = top > 19n ? top - 20n : 0n; await listBlocks(); });
$('newer').onclick = () => run(async () => { if (cursor === null || cursor + 20n >= head) cursor = null; else cursor += 20n; await listBlocks(); });
await run(async () => {
  const r = await fetch('./public-config.json', { cache: 'no-store' }); config = verifiedConfig(await r.json());
  const labels = presentation(config, 0n); $('phase-badge').textContent = labels.badge; $('trust-note').textContent = labels.notice;
  $('bridge-status').textContent = config.readOnly ? 'Bridge setup pending' : 'Bridge ↗';
  if (config.readOnly) $('bridge-status').removeAttribute('href');
  for (const [k, v] of [['Chain ID', '4663001'], ['Genesis', config.genesisHash], ['RPC', config.rpcUrl], ['Rollup on Robinhood', config.rollupAddress || 'Not supplied'], ['Native gas', 'GH0ST'], ['Mode', labels.badge], ['Confirmation', 'Project-run fast confirmation; not ZK']]) { $('binding').append(el('dt', k), el('dd', v)); }
  await listBlocks(); if (location.hash.startsWith('#q=')) await search(decodeURIComponent(location.hash.slice(3)));
});
