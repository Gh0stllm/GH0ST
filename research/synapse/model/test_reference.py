"""Small hand-calculated cases for Solidity-compatible rounding and clipping."""
import copy
import unittest

from reference import forward, trunc_div


def tiny_model():
    model = {"hiddenSize": 8, "contextSize": 2, "scale": 256, "activationMax": 32767,
             "vocab": ["a", "b"], "embedding0": [0] * 16, "embedding1": [0] * 16,
             "experts": [{"weights": [0] * 64, "bias": [0] * 8} for _ in range(2)],
             "headWeights": [0] * 16, "headBias": [0, 0]}
    return model


class ReferenceTests(unittest.TestCase):
    def test_signed_division_toward_zero(self):
        self.assertEqual(trunc_div(-255, 256), 0)
        self.assertEqual(trunc_div(-257, 256), -1)
        self.assertEqual(trunc_div(257, 256), 1)

    def test_hand_calculated_negative_dot_products_and_tie(self):
        m = tiny_model()
        m["embedding0"][:2] = [32767, -32768]
        m["embedding1"][:2] = [32767, 1]
        m["experts"][0]["weights"][0] = -1
        m["experts"][0]["bias"][0] = 128
        m["experts"][1]["weights"][0] = 1
        m["headWeights"][0] = -3
        m["headWeights"][8] = -257
        m["headBias"] = [-1, 63]
        result = forward(m, [0, 0])
        self.assertEqual(result["hidden"], [32767] + [0] * 7)
        self.assertEqual(result["expertActivations"], [[1] + [0] * 7, [127] + [0] * 7])
        self.assertEqual(result["merged"], [64] + [0] * 7)
        self.assertEqual(result["logits"], [-1, -1])
        self.assertEqual(result["token"], 0)

    def test_expert_saturation_and_odd_mean(self):
        m = tiny_model()
        m["embedding0"][0] = 32767
        m["experts"][0]["weights"][0] = 32767
        m["experts"][0]["bias"][0] = 32767
        result = forward(m, [0, 0])
        self.assertEqual(result["expertActivations"][0][0], 32767)
        self.assertEqual(result["merged"][0], 16383)

    def test_override_only_replaces_requested_expert(self):
        m = tiny_model()
        alternate = copy.deepcopy(m["experts"][1])
        alternate["bias"][0] = 2
        self.assertEqual(forward(m, [0, 0], {1: alternate})["merged"][0], 1)
        self.assertEqual(forward(m, [0, 0])["merged"][0], 0)
        with self.assertRaises(ValueError):
            forward(m, [0])
        with self.assertRaises(ValueError):
            forward(m, [0, 2])


if __name__ == "__main__":
    unittest.main()
