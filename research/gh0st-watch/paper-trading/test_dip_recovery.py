import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from dip_recovery import VerifiedSource, dip_windows
from signals import HOUR
from watcher_signals import candle_url, scan_row


def candles(closes, volume=1000):
    return [[i * HOUR, c, c, c, c, volume] for i, c in enumerate(closes)]


class DipRecoveryTests(unittest.TestCase):
    def test_strict_dip_rebound_reference_and_volume(self):
        valid = [10, 8, 12, 7, 11]
        result = dip_windows(candles(valid), 5 * HOUR, 6 * HOUR)
        self.assertEqual(result["windows"], [{"entry": 5 * HOUR, "exit": 6 * HOUR}])
        for closes in ([10, 8, 12, 8, 11], [10, 8, 12, 7, 7], [10, 8, 12, 7, 12]):
            self.assertEqual(dip_windows(candles(closes), 5 * HOUR, 6 * HOUR)["flat"], 1)
        self.assertEqual(dip_windows(candles(valid, 999), 5 * HOUR, 6 * HOUR)["flat"], 1)
        self.assertEqual(dip_windows(candles(valid)[1:], 5 * HOUR, 6 * HOUR)["missing"], 1)

    def test_original_digest_and_common_holdout_floor(self):
        pool, token = "0x" + "a" * 64, "0x" + "1" * 40
        floor, end = 5 * HOUR, 6 * HOUR
        url = candle_url(pool, floor, end)
        raw = json.dumps({
            "meta":{"base":{"address":token}, "quote":{"address":"0x" + "0" * 40}},
            "data":{"attributes":{"ohlcv_list":candles([10,8,12,7,11])}}
        }).encode()
        sha = hashlib.sha256(raw).hexdigest()
        name = f"{pool}-{hashlib.sha256(url.encode()).hexdigest()[:16]}.json"
        row = {"name":"test", "reason":None, "network":"mainnet", "address":token,
               "side":"base", "observed":HOUR, "pool":pool}
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            (cache/name).write_bytes(raw)
            source = VerifiedSource(cache, [dict(row, candleUrl=url, payloadSha256=sha, candleFile=name)])
            evaluated = scan_row(row, end, source, first_entry=floor, build_windows=dip_windows)
            self.assertEqual((evaluated["start"], evaluated["opportunities"]), (floor,1))
            self.assertEqual(len(evaluated["windows"]),1)
            self.assertIsNone(evaluated["windows"][0]["holdingCandleReturnPct"])
            (cache/name).write_bytes(raw + b" ")
            with self.assertRaisesRegex(RuntimeError, "hash"):
                scan_row(row, end, source, first_entry=floor, build_windows=dip_windows)


if __name__ == "__main__":
    unittest.main()
