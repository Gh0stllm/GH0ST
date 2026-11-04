"""Build one-hour paper-trade decisions from closed GeckoTerminal pool candles."""
import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import urllib.request

HOUR = 3600
POOL = "0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01"
BASE = "https://api.geckoterminal.com/api/v2/networks/robinhood/pools/" + POOL


def breakout(history):
    _, close, volume = history[-1]
    return volume >= 1000 and close > max(high for high, _, _ in history[:-1])


def quote_windows(rows, start, end, decision=breakout):
    """At boundary t, use only candles whose end is at or before t."""
    by_hour = {}
    for stamp, opening, high, low, close, volume in rows:
        if not start - 5 * HOUR <= stamp < end:
            continue
        if stamp % HOUR or stamp in by_hour:
            raise ValueError("Unexpected duplicate or unaligned candle")
        if not all(math.isfinite(x) for x in (opening, high, low, close, volume)):
            continue
        if 0 < low <= min(opening, close) <= max(opening, close) <= high and volume > 0:
            by_hour[stamp] = (high, close, volume)
    signals, flat, missing = [], 0, 0
    for entry in range(start, end, HOUR):
        history = [by_hour.get(entry - n * HOUR) for n in range(5, 0, -1)]
        if None in history:
            missing += 1
            continue
        if decision(history):
            signals.append({"entry": entry, "exit": entry + HOUR})
        else:
            flat += 1
    return {"windows": signals, "flat": flat, "missing": missing}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--end", required=True, help="Last eligible exit, UTC ISO timestamp on the hour")
    cli.add_argument("--candles", type=pathlib.Path, help="Read existing API response instead of fetching")
    cli.add_argument("--save-candles", type=pathlib.Path, help="Save the exact API response")
    args = cli.parse_args()
    end = dt.datetime.fromisoformat(args.end.replace("Z", "+00:00"))
    if end.tzinfo is None or end.minute or end.second or end.microsecond:
        cli.error("Use a timezone-aware hourly boundary")
    end = int(end.timestamp())
    if end > dt.datetime.now(dt.timezone.utc).timestamp():
        cli.error("Use closed historical hours")
    start = end - 7 * 24 * HOUR
    url = BASE + "/ohlcv/hour?aggregate=1&limit=240&currency=usd&token=base&before_timestamp=" + str(end)
    if args.candles:
        raw = args.candles.read_bytes()
    else:
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "GH0ST-Research/1.0"})
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
    if args.save_candles:
        args.save_candles.write_bytes(raw)
    data = json.loads(raw)
    base = data.get("meta", {}).get("base", {})
    if base.get("address", "").lower() != "0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559":
        raise ValueError("Pool response does not identify GH0ST as the base token")
    result = quote_windows(data["data"]["attributes"]["ohlcv_list"], start, end)
    result.update(pool=POOL, start=start, end=end, candle_url=url, payload_sha256=hashlib.sha256(raw).hexdigest())
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
