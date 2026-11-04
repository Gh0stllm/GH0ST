"""Reconcile every Watcher signal with one historical quote outcome."""
import argparse
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path


def key(row):
    return (row["address"].lower(), row["pool"].lower(), row["entry"], row["exit"])


def summarize(signals, batches):
    if not signals["complete"]:
        raise ValueError("Incomplete candle acquisition pass")
    outcomes, benchmarks = {}, []
    for batch in batches:
        for row in batch["rows"]:
            if row["kind"] == "buy-and-hold":
                benchmarks.append(row)
                continue
            k = key(row)
            if k in outcomes or row["kind"] != "signal":
                raise ValueError("Duplicate or unrecognized quote")
            outcomes[k] = row
    rows, totals = [], Counter()
    for market in signals["entries"]:
        for window in market["windows"]:
            k = key(dict(market, **window))
            if k not in outcomes:
                raise ValueError(f"Missing quote outcome for {k}")
            result = outcomes.pop(k)
            state = result["status"]
            item = dict(name=market["name"], address=k[0], pool=k[1], entry=k[2], exit=k[3], status=state)
            diagnostic = window.get("holdingCandleReturnPct")
            if diagnostic is not None:
                item["holdingCandleReturnPct"] = diagnostic
                totals["knownDirections"] += 1
                totals["positiveDirections"] += int(diagnostic > 0)
            if state == "quoted":
                buy, sell = result["buy"], result["sell"]
                stake = int(result["paperStakeWei"])
                if stake != 5 * 10**15 or int(buy["input"]) != stake or int(sell["input"]) != int(buy["output"]):
                    raise ValueError("Quoted legs do not correspond to the designated paper trade")
                pnl = int(result["pnlAfterEstimatedGasWei"])
                if buy["blockTime"] < k[2] or sell["blockTime"] < k[3] or buy["block"] >= sell["block"]:
                    raise ValueError("Quotes do not follow the decision and exit boundaries")
                if int(sell["output"]) - stake - int(result["estimatedGasWei"]) != pnl:
                    raise ValueError("Inconsistent reported costs or net result")
                item.update(netWei=str(pnl), returnOnStakePct=float(Decimal(pnl) * 100 / stake),
                            entryBlock=buy["block"], exitBlock=sell["block"])
                totals["wins"] += int(pnl > 0)
                totals["netWei"] += pnl
                totals["quotedStakeWei"] += stake
            else:
                if state not in ("unsupported", "entry-unavailable", "exit-unavailable"):
                    raise ValueError("Unrecognized outcome: " + state)
                item["reason"] = result["reason"]
            totals[state] += 1
            rows.append(item)
    counts = signals["counts"]
    if outcomes or len(rows) != counts["long"] or len(rows) + counts["flat"] + counts["missing"] != counts["eligibleBoundaries"]:
        raise ValueError("Decision, entry and exit records do not reconcile")
    return dict(cutoff=signals["end"], counts=counts, outcomes={s:totals[s] for s in (
        "quoted", "wins", "entry-unavailable", "exit-unavailable", "unsupported")},
        holdingCandleDirections={"known":totals["knownDirections"],"positive":totals["positiveDirections"]},
        resolvedNetETH=str(Decimal(totals["netWei"]) / 10**18),
        resolvedReturnOnTotalQuotedStakePct=(float(Decimal(100) * totals["netWei"] / totals["quotedStakeWei"])
                                             if totals["quotedStakeWei"] else None),
        rows=rows, benchmarks=[{k:r.get(k) for k in ("name","address","entry","exit","status","pnlAfterEstimatedGasWei","reason")}
                              for r in benchmarks])


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("signals",type=Path)
    parser.add_argument("batches",nargs="+",type=Path)
    args=parser.parse_args()
    print(json.dumps(summarize(json.loads(args.signals.read_text()),
                               [json.loads(p.read_text()) for p in args.batches]),indent=2))
