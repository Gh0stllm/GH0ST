// Market values describe one pool when DEX Screener was queried. RH contract
// checks have their own pinned block; market snapshots are not pinned to it.
const RH_CHAIN = 'robinhood';
const TOKEN = /^0x[0-9a-f]{40}$/i;
const POOL = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const unavailable = reason => ({available:false, reason});

function numeric(value, signed = false) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && (signed || n >= 0) ? n : null;
}

function label(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 48)
    : '';
}

// These are project-supplied destinations. Never fetch them while scanning.
function projectLinks(info) {
  const links = [], seen = new Set();
  for (const kind of ['websites', 'socials']) {
    for (const item of Array.isArray(info?.[kind]) ? info[kind] : []) {
      if (typeof item?.url !== 'string' || item.url.length > 2048) continue;
      let url;
      try { url = new URL(item.url); } catch { continue; }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
      const name = label(kind === 'websites' ? item.label : item.type || item.platform);
      links.push({label:name ? name + ' · ' + url.hostname : url.hostname, url:url.href});
      seen.add(url.href);
      if (links.length === 8) return links;
    }
  }
  return links;
}

export async function fetchMarket(network, address) {
  if (network !== 'mainnet') return unavailable('DEX Screener coverage is available on RH mainnet only.');
  if (!TOKEN.test(address)) return unavailable('An EVM token address is required.');
  try {
    const response = await fetch('https://api.dexscreener.com/token-pairs/v1/' + RH_CHAIN + '/' + address, {
      credentials:'omit', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(6000),
    });
    if (!response.ok) return unavailable(response.status === 429
      ? 'DEX Screener is rate-limiting requests. Try again later.'
      : 'DEX Screener could not return a market snapshot.');
    const rows = await response.json();
    if (!Array.isArray(rows)) return unavailable('DEX Screener returned an unreadable snapshot.');

    // Change, market cap, USD price and project metadata are for the *base*
    // token. Never display a paired asset's metrics as the scanned asset's.
    const pools = rows.filter(row => row?.chainId === RH_CHAIN && POOL.test(row?.pairAddress)
      && row.baseToken?.address?.toLowerCase() === address.toLowerCase());
    if (!pools.length) return unavailable('No indexed RH pool quotes this token as its base asset.');
    const pair = pools.reduce((best, p) => (numeric(p.liquidity?.usd) ?? -1) > (numeric(best.liquidity?.usd) ?? -1) ? p : best);
    return {
      available:true, asOf:new Date().toISOString(), pairAddress:pair.pairAddress,
      url:'https://dexscreener.com/' + RH_CHAIN + '/' + pair.pairAddress,
      dex:label(pair.dexId), baseSymbol:label(pair.baseToken.symbol), quoteSymbol:label(pair.quoteToken?.symbol),
      poolCount:pools.length, priceUsd:numeric(pair.priceUsd), liquidityUsd:numeric(pair.liquidity?.usd),
      marketCap:numeric(pair.marketCap), fdv:numeric(pair.fdv), volume24h:numeric(pair.volume?.h24),
      change1h:numeric(pair.priceChange?.h1, true), change24h:numeric(pair.priceChange?.h24, true),
      buys24h:numeric(pair.txns?.h24?.buys), sells24h:numeric(pair.txns?.h24?.sells),
      links:projectLinks(pair.info),
    };
  } catch { return unavailable('Market data is temporarily unavailable.'); }
}
