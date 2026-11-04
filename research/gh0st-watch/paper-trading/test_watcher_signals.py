import json
import unittest

from signals import HOUR
from watcher_signals import candle_url, evaluate, scan_row, window_start


TOKEN = "0x" + "1" * 40
QUOTE = "0x" + "0" * 40
POOL = "0x" + "2" * 64


def sample(rows):
    return json.dumps({"meta": {"base": {"address": TOKEN}, "quote": {"address": QUOTE}},
                       "data": {"attributes": {"ohlcv_list": rows}}}).encode()


class WatcherSignalTests(unittest.TestCase):
    def test_observation_and_holding_hour(self):
        self.assertEqual(window_start(5 * HOUR + 1, 7 * HOUR), 6 * HOUR)
        self.assertEqual(window_start(5 * HOUR, 7 * HOUR), 5 * HOUR)
        self.assertEqual(window_start(HOUR, 175 * HOUR), 7 * HOUR)
        row = {"name":"X", "network":"mainnet", "side":"base", "address":TOKEN, "pool":POOL, "observed":5*HOUR+1}
        self.assertEqual(scan_row(row, 6*HOUR, None)["status"], "outside_window")
        self.assertEqual(scan_row(dict(row, reason="unindexed"), 6*HOUR, None)["status"], "excluded")
        self.assertIn("limit=7", candle_url(POOL,5*HOUR,6*HOUR))

    def test_history_is_contiguous_and_bounds_independent_of_exit_candle(self):
        rows = [[n*HOUR, 1, 1, 1, 1, 100] for n in range(4)]
        rows.append([4*HOUR, 1, 2, 1, 2, 1000])
        long = evaluate(sample(rows), TOKEN, 5*HOUR, 6*HOUR)
        self.assertEqual([(w["entry"],w["exit"]) for w in long["windows"]], [(5*HOUR,6*HOUR)])
        self.assertIsNone(long["windows"][0]["holdingCandleReturnPct"])
        self.assertEqual(long["missingFeatureHours"], [])
        missing = evaluate(sample(rows[1:]), TOKEN, 5*HOUR, 6*HOUR)
        self.assertEqual((missing["missing"], missing["missingFeatureHours"]), (1, [0]))
        marked=evaluate(sample(rows+[[5*HOUR,2,20,2,20,10000]]), TOKEN, 5*HOUR, 6*HOUR)
        self.assertEqual((len(marked["windows"]),marked["windows"][0]["holdingCandleReturnPct"]), (1,900))
        inactive=evaluate(sample(rows+[[5*HOUR,2,20,2,20,0]]), TOKEN, 5*HOUR, 6*HOUR)
        self.assertIsNone(inactive["windows"][0]["holdingCandleReturnPct"])
        with self.assertRaises(ValueError):
            evaluate(sample(rows), QUOTE, 5*HOUR, 6*HOUR)

    def test_empty_series_and_provider_failure_remain_in_denominator(self):
        self.assertEqual(evaluate(sample([]),TOKEN,5*HOUR,8*HOUR)["missing"],3)
        class Offline:
            def read(self, *_):
                raise ValueError("No matching raw response")
        row = {"name":"X", "network":"mainnet", "side":"base", "address":TOKEN, "pool":POOL, "observed":5*HOUR}
        mapped = scan_row(row,8*HOUR,Offline())
        self.assertEqual((mapped["status"], mapped["opportunities"], mapped["missing"]), ("unavailable",3,3))


if __name__ == "__main__":
    unittest.main()
