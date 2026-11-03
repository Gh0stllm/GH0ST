import { getAddress } from 'ethers';
import { networks } from './scan.js';

const TRENDING = 'https://api.geckoterminal.com/api/v2/networks/robinhood/trending_pools?include=base_token%2Cquote_token&duration=24h';
const usd = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', notation:'compact', maximumFractionDigits:1});
const LIST_LIMIT = 6;
const SEARCH_LIMIT = 8;
const numbers = new Intl.NumberFormat('en-US');

function element(tag, className, label) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label != null) node.textContent = label;
  return node;
}

function cleanLabel(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, limit);
}

function tokensFrom(items, searching) {
  const tokens = [];
  const addresses = new Set();
  for (const item of items) {
    if (!item || (searching ? item.type !== 'token' || item.token_type !== 'ERC-20' : item.type !== 'ERC-20')) continue;
    if (!/^0x[\da-f]{40}$/i.test(item.address_hash)) continue;
    const address = getAddress(item.address_hash.toLowerCase());
    if (addresses.has(address)) continue;
    addresses.add(address);
    const holders = /^\d+$/.test(String(item.holders_count)) ? numbers.format(BigInt(item.holders_count)) : null;
    tokens.push({
      address, metric: holders === null ? 'Scan ↗' : holders+' holders',
      symbol: cleanLabel(item.symbol, 24) || 'ERC-20',
      name: cleanLabel(item.name, 80) || 'Unnamed token',
    });
    if (tokens.length === (searching ? SEARCH_LIMIT : LIST_LIMIT)) break;
  }
  return tokens;
}

async function directory(network, query, signal) {
  const url = new URL(query ? '/api/v2/search' : '/api/v2/tokens', network.explorer);
  url.searchParams.set(query ? 'q' : 'type', query || 'ERC-20');
  const response = await fetch(url, {signal, credentials:'omit'});
  if (!response.ok) throw Error('Explorer unavailable');
  const data = await response.json();
  if (!Array.isArray(data?.items)) throw Error('Missing token list');
  const tokens = tokensFrom(data.items, Boolean(query));
  const status = query
    ? (tokens.length ? 'Matches from the explorer. Check the contract address.' : 'No matching ERC-20 tokens in the explorer results.')
    : (tokens.length ? 'ERC-20 tokens in explorer order. Select one to scan.' : 'The explorer returned no ERC-20 tokens.');
  return {tokens, status};
}

async function trending(signal) {
  const response = await fetch(TRENDING, {signal, credentials:'omit'});
  if (!response.ok) throw Error('Pool feed unavailable');
  const pools = await response.json();
  if (!Array.isArray(pools?.data) || !Array.isArray(pools.included)) throw Error('Missing pool data');
  const assets = new Map(pools.included.filter(asset => asset?.type === 'token').map(asset => [asset.id,asset.attributes]));
  const tokens = [];
  for (const pool of pools.data) {
    if (pool?.type !== 'pool') continue;
    // A V4 pool ID can be 32 bytes. Always resolve the base-token relationship to its address.
    const baseId = pool.relationships?.base_token?.data?.id;
    const base = assets.get(baseId);
    if (!/^0x[\da-f]{40}$/i.test(base?.address) || baseId?.toLowerCase() !== 'robinhood_'+base.address.toLowerCase()) continue;
    const rawVolume = pool.attributes?.volume_usd?.h24;
    const volume = rawVolume == null || rawVolume === '' ? NaN : Number(rawVolume);
    tokens.push({
      address:getAddress(base.address.toLowerCase()),
      symbol:cleanLabel(base.symbol, 24) || 'Token',
      name:cleanLabel(pool.attributes?.name, 80) || cleanLabel(base.name,80) || 'Unnamed pool',
      metric:Number.isFinite(volume) && volume >= 0 ? usd.format(volume)+' vol · 24h' : 'Volume unavailable',
    });
    if (tokens.length === LIST_LIMIT) break;
  }
  return {tokens, status: tokens.length ? '24h trending pools in GeckoTerminal order. Select a pair to scan its base token.' : 'No ranked pools with a scannable base token.'};
}

function tokenButton(token, onSelect) {
  const row = element('button', 'discover-row');
  row.type = 'button';
  row.title = token.address;
  row.setAttribute('aria-label', 'Scan '+token.name+' ('+token.symbol+'), '+token.address);
  row.append(
    element('strong', 'discover-symbol', token.symbol),
    element('span', 'discover-name', token.name),
    element('span', 'discover-address', token.address.slice(0, 8)+'…'+token.address.slice(-6)),
    element('span', 'discover-metric', token.metric),
  );
  row.addEventListener('click', () => onSelect(token.address));
  return row;
}

// getNetwork returns "mainnet" or "testnet". Call refresh on a network switch.
export function mountDiscovery(container, {getNetwork, onSelect}) {
  const head = element('div', 'discover-head');
  const title = element('h2', 'discover-title', 'Token directory');
  const source = element('span', 'discover-source');
  const modes = element('div','discover-modes');
  modes.setAttribute('role','group');
  modes.setAttribute('aria-label','Discovery feed');
  const trendsButton = element('button','discover-mode','Trending pools');
  const directoryButton = element('button','discover-mode','Directory');
  for (const button of [trendsButton,directoryButton]) { button.type='button'; modes.append(button); }
  const input = element('input', 'discover-input');
  input.type = 'search';
  input.placeholder = 'Find a token by name or ticker';
  input.setAttribute('aria-label', 'Find a token by name or ticker');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 100;
  const status = element('p', 'discover-status');
  status.setAttribute('role', 'status');
  const results = element('div', 'discover-results');
  const retry = element('button', 'discover-retry', 'Retry');
  retry.type = 'button';
  retry.hidden = true;
  head.append(title, source);
  container.replaceChildren(head, modes, input, status, results, retry);

  let mode = 'trending';
  let version = 0;
  let pending = null;
  let debounce;
  function refresh(delay = 0) {
    const key = getNetwork();
    const network = networks[key];
    if (!network) return;
    const request = ++version;
    const query = input.value.trim();
    clearTimeout(debounce);
    pending?.abort();
    results.replaceChildren();
    retry.hidden = true;
    const hot = key === 'mainnet' && mode === 'trending' && !query;
    trendsButton.disabled = key !== 'mainnet';
    trendsButton.title = trendsButton.disabled ? 'Available on RH Mainnet' : '';
    trendsButton.setAttribute('aria-pressed',String(hot));
    directoryButton.setAttribute('aria-pressed',String(!hot));
    title.textContent = hot ? 'Trending pools' : 'Token directory';
    source.textContent = (hot ? 'GeckoTerminal' : 'Blockscout')+' · RH '+network.label;
    if (query.length === 1) {
      status.textContent = 'Type at least two characters to search.';
      return;
    }
    status.textContent = hot ? 'Loading 24h trending pools…' : query ? 'Searching indexed tokens…' : 'Loading indexed tokens…';
    debounce = setTimeout(async () => {
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 9000);
      try {
        const feed = hot ? await trending(controller.signal) : await directory(network, query, controller.signal);
        if (request !== version || key !== getNetwork()) return;
        results.replaceChildren(...feed.tokens.map(token => tokenButton(token, address => {
          if (request === version && key === getNetwork()) onSelect(address);
        })));
        status.textContent = feed.status;
      } catch {
        if (request !== version || key !== getNetwork()) return;
        status.textContent = hot ? 'Trending pools unavailable. Try the token directory or paste an address.' : 'Token directory unavailable. You can still scan a contract address.';
        retry.hidden = false;
      } finally {
        clearTimeout(timeout);
        if (pending === controller) pending = null;
      }
    }, delay);
  }
  trendsButton.addEventListener('click', () => { mode='trending'; input.value=''; refresh(); });
  directoryButton.addEventListener('click', () => { mode='directory'; refresh(); });
  input.addEventListener('input', () => { if (input.value.trim()) mode='directory'; refresh(300); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); refresh(); }
  });
  retry.addEventListener('click', () => refresh());
  refresh();
  return () => refresh();
}
