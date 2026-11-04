"""Freeze the market pools already present in the public Watcher recent reports."""
import argparse
import hashlib
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API = 'https://gh0st.fyi/.netlify/functions/watcher-scans'
ADDRESS = re.compile(r'0x[0-9a-f]{40}', re.I)
POOL = re.compile(r'0x(?:[0-9a-f]{40}|[0-9a-f]{64})', re.I)


def get(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'Accept': 'application/json'}), timeout=20) as response:
                raw = response.read()
            return json.loads(raw), hashlib.sha256(raw).hexdigest()
        except (HTTPError, URLError, TimeoutError) as error:
            if attempt == 2 or isinstance(error, HTTPError) and error.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(1 + attempt)


def iso_second(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('timezone missing')
    return math.ceil(stamp.timestamp())


def extract(summary, entry, row, cutoff):
    token = row['address']
    if entry.get('network') != 'mainnet' or str(entry.get('address')).lower() != token:
        return 'saved report does not match the listed network/address'
    scanned = entry.get('scannedAt')
    if type(scanned) is not int or scanned <= 0 or summary.get('scannedAt') != scanned:
        return 'scan timestamp missing or changed since listing'
    row['scannedAt'] = scanned
    report = entry.get('report')
    market = (entry.get('details') or {}).get('market') or {}
    if not market.get('available'):
        return market.get('reason') or ('platform profile without a saved market pair' if report is None else 'no saved market snapshot')
    row.update({k: market.get(k) for k in ('asOf', 'dex', 'baseSymbol', 'quoteSymbol', 'priceUsd', 'liquidityUsd', 'poolCount', 'volume24h')})
    pool = market.get('pairAddress')
    if not isinstance(pool, str) or not POOL.fullmatch(pool):
        return 'saved pool ID missing or invalid'
    row['pool'] = pool.lower()
    if market.get('baseTokenAddress') and str(market['baseTokenAddress']).lower() != token:
        return 'saved market base address does not match the contract'
    if market.get('side', 'base') != 'base':
        return 'saved market side is not base'
    # Legacy snapshots omit the side/address: fetchMarket filters baseToken.address
    # against the queried token. Symbols are display labels and cannot prove identity.
    row['side'] = 'base'
    if market.get('url', '').lower() != 'https://dexscreener.com/robinhood/' + row['pool']:
        return 'saved pool reference is not the same Robinhood pair'
    try:
        row['observed'] = max((scanned + 999) // 1000, iso_second(row['asOf']))
    except (TypeError, ValueError, AttributeError, OverflowError):
        return 'market timestamp missing or invalid'
    if row['observed'] <= 0 or row['observed'] > cutoff:
        return 'observation timestamp outside capture period'
    if report is not None and (report.get('network') != 'mainnet' or str(report.get('address')).lower() != token):
        return 'contract evidence identity mismatch'
    value = row['priceUsd']
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        return 'saved market price missing or invalid'
    value = row['liquidityUsd']
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        return 'saved market liquidity missing or invalid'
    return None


def read_entry(summary, cutoff):
    address = str(summary.get('address', '')).lower()
    row = dict(network='mainnet', address=address, name=summary.get('name'), pool=None, side=None,
               observed=None, asOf=None, scannedAt=summary.get('scannedAt'), priceUsd=None, liquidityUsd=None)
    if not ADDRESS.fullmatch(address):
        return dict(row, reason='invalid address in recent list')
    row['source'] = API + '?' + urlencode({'network': 'mainnet', 'address': address})
    try:
        data, row['sourceSha256'] = get(row['source'])
        row['reason'] = extract(summary, data['entry'], row, cutoff)
    except (KeyError, TypeError, ValueError, AttributeError, URLError, TimeoutError) as error:
        row['reason'] = 'saved report unavailable or unreadable: ' + str(error)[:140]
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='Destination JSON file')
    args = parser.parse_args()
    started = datetime.now(timezone.utc)
    listing, list_digest = get(API)
    summaries = listing['entries']
    if not isinstance(summaries, list):
        raise ValueError('Unreadable shared Watcher list')
    unique = {}
    for summary in summaries:
        if summary.get('network') == 'mainnet':
            unique.setdefault(str(summary.get('address')).lower(), summary)
    with ThreadPoolExecutor(max_workers=4) as workers:
        rows = list(workers.map(lambda summary: read_entry(summary, math.ceil(started.timestamp())), unique.values()))
    captured = datetime.now(timezone.utc)
    snapshot = dict(schemaVersion=1, source=API, sourceSha256=list_digest, listedAt=started.isoformat(),
                    capturedAt=captured.isoformat(), listedRows=len(summaries), distinctMainnet=len(rows),
                    skippedOtherNetworks=sum(s.get('network') != 'mainnet' for s in summaries),
                    eligible=sum(r['reason'] is None for r in rows), entries=rows,
                    scope='Latest public shared recent list (maximum 24 rows), one saved report per network/address. Earlier versions and older unlisted addresses are unavailable through this list.',
                    methodology='Pool and market fields come only from the saved report. Observed is the rounded-up later of market asOf and scannedAt, in Unix seconds. The Watcher scanner filters by exact base-token address; symbols are descriptive.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(snapshot, indent=2, allow_nan=False) + '\n'
    vintage = args.output.with_name(f'{args.output.stem}-{captured.strftime("%Y%m%dT%H%M%S%fZ")}{args.output.suffix}')
    with vintage.open('x') as archive:
        archive.write(text)
    tmp = args.output.with_suffix('.tmp')
    tmp.write_text(text)
    tmp.replace(args.output)
    print(f"{snapshot['eligible']} eligible / {len(rows)} distinct mainnet; snapshot {vintage}")


if __name__ == '__main__':
    main()
