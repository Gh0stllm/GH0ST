"""Replay the fixed GH0ST rule on pools recorded in shared Watcher reports."""
import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import time
import urllib.error
import urllib.request

from urllib.parse import urlsplit

from signals import HOUR, quote_windows

ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
POOL = re.compile(r"0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})")
BASE = "https://api.geckoterminal.com/api/v2/networks/robinhood/pools/"
DEFAULT_END = "2026-11-04T07:00:00Z"
WEEK = 7 * 24 * HOUR


def utc_end(text):
    value = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    if value.tzinfo is None or value.minute or value.second or value.microsecond:
        raise ValueError("A timezone-aware UTC hour boundary is required")
    end = int(value.timestamp())
    if end % HOUR or end > time.time():
        raise ValueError("The endpoint must be a closed UTC hour")
    return end


def hour_ceiling(stamp):
    return (stamp + HOUR - 1) // HOUR * HOUR


def window_start(observed, end):
    if type(observed) is not int or observed <= 0:
        raise ValueError("Invalid Watcher observation timestamp")
    return max(end - WEEK, hour_ceiling(observed))


def candle_url(pool, start, end):
    # Five lookback bars. One extra row tolerates an inclusive provider cutoff.
    needed = (end - start) // HOUR + 6
    return (f"{BASE}{pool}/ohlcv/hour?aggregate=1&limit={needed}&currency=usd"
            f"&token=base&include_empty_intervals=false&before_timestamp={end}")


def evaluate(raw, token, start, end, build_windows=quote_windows):
    payload = json.loads(raw)
    meta = payload.get("meta", {})
    if str(meta.get("base", {}).get("address", "")).lower() != token.lower():
        raise ValueError("GeckoTerminal base address does not match the watched token")
    quote = meta.get("quote", {}).get("address")
    if not isinstance(quote, str) or not ADDRESS.fullmatch(quote) or quote.lower() == token.lower():
        raise ValueError("GeckoTerminal did not identify a distinct quote token")
    rows = payload["data"]["attributes"]["ohlcv_list"]
    if not isinstance(rows, list):
        raise ValueError("GeckoTerminal did not return a candle list")
    result = build_windows(rows, start, end)
    # Observe the holding bar only after the signal has been selected. The two
    # marks are this pool's first/last recorded prices, rather than fill quotes.
    marks = {r[0]: r[1:] for r in rows if start <= r[0] < end}
    for signal in result["windows"]:
        mark = marks.get(signal["entry"])
        opening = closing = change = None
        if mark is not None:
            o, h, low, c, volume = mark
            if (all(math.isfinite(x) for x in mark) and volume > 0 and
                    0 < low <= min(o, c) <= max(o, c) <= h):
                opening, closing, change = o, c, 100 * (c - o) / o
        signal.update(holdingCandleOpenUsd=opening, holdingCandleCloseUsd=closing,
                      holdingCandleReturnPct=change)
    # Exclude a provider row at/after end. Last needed signal bar opens at end-2h.
    present = {r[0] for r in rows}
    expected = range(start - 5 * HOUR, end - HOUR, HOUR)
    result.update(quoteAddress=quote.lower(), providerRows=len(rows),
                  missingFeatureHours=[t for t in expected if t not in present])
    return result


class CandleSource:
    def __init__(self, cache, offline):
        self.cache = cache
        self.offline = offline
        self.next_request = 0

    def read(self, pool, url):
        key = hashlib.sha256(url.encode()).hexdigest()[:16]
        path = self.cache / f"{pool}-{key}.json"
        if path.exists():
            return path, path.read_bytes()
        if self.offline:
            raise ValueError("No cached response for this exact provider request")
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "GH0ST-Research/1.0"})
        for attempt in range(2):
            time.sleep(max(0, self.next_request - time.monotonic()))
            self.next_request = time.monotonic() + 6.25
            try:
                with urllib.request.urlopen(req, timeout=20) as response:
                    if urlsplit(response.geturl())[:3] != urlsplit(url)[:3]:
                        raise ValueError("Provider redirected to a different pool endpoint")
                    raw = response.read(512_001)
                break
            except urllib.error.HTTPError as error:
                if attempt or error.code not in (429, 500, 502, 503, 504):
                    raise
                retry = error.headers.get("Retry-After", "60" if error.code == 429 else "10")
                if not retry.isdigit() or int(retry) > 90:
                    raise
                self.next_request = max(self.next_request, time.monotonic() + int(retry))
        if len(raw) > 512_000:
            raise ValueError("Provider response is larger than expected")
        # Preserve the exact bytes, including empty candle sets and missing metadata.
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, raw)
        return path, raw


def atomic_write(path, data):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def scan_row(row, end, source, *, first_entry=None, build_windows=quote_windows):
    keys = ("name", "address", "network", "pool", "observed", "side", "baseSymbol", "quoteSymbol", "liquidityUsd")
    out = {key: row.get(key) for key in keys}
    out.update(windows=[], flat=0, missing=0, opportunities=0, end=end)
    if row.get("reason"):
        return dict(out, status="excluded", reason=row["reason"])
    try:
        if row.get("network") != "mainnet" or row.get("side") != "base":
            raise ValueError("Watcher did not identify a Robinhood mainnet base-token pool")
        if not ADDRESS.fullmatch(row.get("address") or "") or not POOL.fullmatch(row.get("pool") or ""):
            raise ValueError("Missing or invalid Watcher address or pool identifier")
        start = window_start(row["observed"], end)
        if first_entry is not None:
            if type(first_entry) is not int or first_entry % HOUR:
                raise ValueError("Minimum entry must be an hourly boundary")
            start = max(start, first_entry)
        out["start"] = start
        if start >= end:
            return dict(out, status="outside_window", reason="No completed holding hour after Watcher observation")
        out["opportunities"] = (end - start) // HOUR
        pool = row["pool"].lower()
        url = candle_url(pool, start, end)
        out["candleUrl"] = url
        path, raw = source.read(pool, url)
        out.update(candleFile=path.name, payloadSha256=hashlib.sha256(raw).hexdigest())
        result = evaluate(raw, row["address"], start, end, build_windows)
        out.update(result, status="evaluated", reason=None)
        return out
    except (KeyError, IndexError, TypeError, ValueError, OSError) as error:
        out.update(status="unavailable", reason=f"{type(error).__name__}: {error}", missing=out["opportunities"])
        return out


def signal_counts(entries):
    directional = [w["holdingCandleReturnPct"] for r in entries for w in r["windows"]
                   if w["holdingCandleReturnPct"] is not None]
    counts = {"assets": len(entries), "eligibleBoundaries":sum(r["opportunities"] for r in entries),
                        "long":sum(len(r["windows"]) for r in entries), "flat":sum(r["flat"] for r in entries),
                        "missing":sum(r["missing"] for r in entries)}
    counts.update(holdingCandlePositive=sum(value > 0 for value in directional),
                            holdingCandleObserved=len(directional))
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("universe", type=pathlib.Path)
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    parser.add_argument("--end", default=DEFAULT_END)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    end = utc_end(args.end)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    source = CandleSource(args.output_dir / "candles", args.offline)
    snapshot = args.universe.read_bytes()
    universe = json.loads(snapshot)
    entries = universe if isinstance(universe, list) else universe["entries"]
    selected = [r["address"].lower() for r in entries if not r.get("reason")]
    if len(set(selected)) != len(selected):
        raise ValueError("Duplicate eligible token in Watcher snapshot")
    result = {"start":end - WEEK, "end":end, "universeSha256":hashlib.sha256(snapshot).hexdigest(),
              "rule":"signals.quote_windows", "complete":False, "entries":[]}
    for row in entries:
        out = scan_row(row, end, source)
        result["entries"].append(out)
        atomic_write(args.output_dir / "signals.partial.json", (json.dumps(result, indent=2)+"\n").encode())
        print(f"{out['name']} {out['status']}: {len(out['windows'])} long, {out['flat']} flat, {out['missing']} missing", flush=True)
    result["complete"] = True
    result["counts"] = signal_counts(result["entries"])
    atomic_write(args.output_dir / "signals.json", (json.dumps(result, indent=2)+"\n").encode())
    (args.output_dir / "signals.partial.json").unlink(missing_ok=True)
    print(json.dumps(result["counts"]))


if __name__ == "__main__":
    main()
