import unittest
from signals import HOUR, quote_windows


class SignalTest(unittest.TestCase):
    def test_future_bar_and_gaps(self):
        start = 8 * HOUR
        bars = [[h * HOUR, 2, 3, 1, 2, 1500] for h in range(3, 8)]
        bars[-1][2:5] = [5, 2, 4]
        before = quote_windows(bars, start, start + HOUR)
        self.assertEqual(before["windows"], [{"entry": start, "exit": start + HOUR}])
        self.assertEqual(before, quote_windows(bars + [[start, 100, 200, 50, 150, 5000]], start, start + HOUR))
        self.assertEqual(quote_windows(bars[1:], start, start + HOUR)["missing"], 1)
        bars[-1][5] = 100
        self.assertEqual(quote_windows(bars, start, start + HOUR)["flat"], 1)


if __name__ == "__main__":
    unittest.main()
