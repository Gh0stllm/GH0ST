"""Replay a fixed dip-recovery paper rule on the original Watcher pools and a later window.

Collect retrieves the five later hourly decisions' source data. Replay reads both
vintages from disk, verifies their hashes, and produces three signal manifests.
"""
import argparse
import hashlib
import json
from pathlib import Path

from signals import HOUR, quote_windows
from watcher_signals import CandleSource, atomic_write, candle_url, scan_row, signal_counts, utc_end

FIRST_END = "2026-11-04T07:00:00Z"
LATER_END = "2026-11-04T12:00:00Z"


def dip_recovery(history):
    """Five valid, contiguous and already closed hours, ordered oldest first."""
    c1, c2, c3, c4, c5 = [bar[1] for bar in history]
    return c4 < min(c1, c2, c3) and c4 < c5 < c3 and history[-1][2] >= 1000


def dip_windows(rows, start, end):
    return quote_windows(rows, start, end, decision=dip_recovery)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, (json.dumps(data, indent=2) + "\n").encode())


class VerifiedSource:
    """Require the exact previously recorded URL, response filename and digest."""
    def __init__(self, cache, records):
        self.cache = CandleSource(cache, offline=True)
        self.records = {r["pool"].lower(): r for r in records if r.get("payloadSha256")}
        self.failures = {r["pool"].lower(): r.get("reason") for r in records
                         if r.get("pool") and r.get("reason")}

    def read(self, pool, url):
        saved = self.records.get(pool)
        if saved is None:
            raise ValueError(self.failures.get(pool) or "No recorded response for this pool")
        if saved["candleUrl"] != url:
            raise RuntimeError("Frozen provider request differs: " + pool)
        path, raw = self.cache.read(pool, url)
        if path.name != saved["candleFile"] or digest(raw) != saved["payloadSha256"]:
            raise RuntimeError("Frozen candle hash or filename differs: " + pool)
        return path, raw


def collect(universe, output):
    start, end = utc_end(FIRST_END), utc_end(LATER_END)
    cache = CandleSource(output / "late-candles", offline=False)
    rows = []
    for asset in universe["entries"]:
        if asset["reason"] is not None:
            continue
        pool = asset["pool"].lower()
        url = candle_url(pool, start, end)
        row = {"pool":pool, "address":asset["address"], "candleUrl":url}
        try:
            path, raw = cache.read(pool, url)
            row.update(candleFile=path.name, payloadSha256=digest(raw), reason=None)
        except (OSError, ValueError) as exc:
            row["reason"] = str(exc)
        rows.append(row)
        print(asset["name"], row["reason"] or "source archived", flush=True)
    write_json(output / "late-sources.json", {"start":start, "end":end, "entries":rows})


def replay(universe, universe_hash, original, original_cache, output, only_main=False):
    if original["universeSha256"] != universe_hash:
        raise ValueError("Input universe differs from its published digest")
    first_end, later_end = utc_end(FIRST_END), utc_end(LATER_END)
    if first_end != original["end"]:
        raise ValueError("Published cutoff differs from the frozen first window")
    first_source = VerifiedSource(original_cache, original["entries"])
    periods = [("main", None, first_end, first_source, dip_windows, "dip_recovery.v1")]
    if not only_main:
        later = json.loads((output / "late-sources.json").read_bytes())
        if (later["start"], later["end"]) != (first_end, later_end):
            raise ValueError("Wrong later-period source manifest")
        later_source = VerifiedSource(output / "late-candles", later["entries"])
        periods.extend([
            ("late-new", first_end, later_end, later_source, dip_windows, "dip_recovery.v1"),
            ("late-baseline", first_end, later_end, later_source, quote_windows, "signals.quote_windows"),
        ])
    for name, floor, end, source, build_windows, rule in periods:
        entries = [scan_row(row, end, source, first_entry=floor, build_windows=build_windows)
                   for row in universe["entries"]]
        counts = signal_counts(entries)
        manifest = {"start":floor if floor is not None else original["start"], "end":end,
                    "rule":rule, "universeSha256":universe_hash, "complete":True,
                    "entries":entries, "counts":counts}
        write_json(output / name / "signals.json", manifest)
        print(name, json.dumps(counts), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["collect", "replay", "main-only"])
    parser.add_argument("--original-dir", required=True, type=Path,
                        help="Original universe.json, signals.json and candle cache")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--published-signals", type=Path,
                        default=Path(__file__).parent / "watcher-2026-11-04" / "signals.json",
                        help="Frozen first-window request and response hash manifest")
    args = parser.parse_args()
    raw = (args.original_dir / "universe.json").read_bytes()
    universe = json.loads(raw)
    if args.action == "collect":
        collect(universe, args.output_dir)
    else:
        original = json.loads(args.published_signals.read_bytes())
        replay(universe, digest(raw), original, args.original_dir / "candles", args.output_dir, args.action == "main-only")


if __name__ == "__main__":
    main()
