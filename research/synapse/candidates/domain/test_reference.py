import unittest

from reference import forward, trunc_div, validate


def hand_model():
    model = {"schema": "gh0st-synapse-model-v2", "scale": 256, "hiddenSize": 2,
             "contextSize": 4, "activationMax": 32767, "vocab": ["a", "b"],
             "embeddings": [0] * 16, "experts": [{"weights": [0] * 4, "bias": [0, 0]} for _ in range(2)],
             "headWeights": [-3, 0, -257, 0], "headBias": [-1, 63]}
    model["embeddings"][0:2] = [32767, -32768]
    model["embeddings"][4:6] = [32767, 1]
    model["experts"][0]["weights"][0] = -1
    model["experts"][0]["bias"][0] = 128
    model["experts"][1]["weights"][0] = 1
    return model


class ReferenceTests(unittest.TestCase):
    def test_signed_division(self):
        self.assertEqual(trunc_div(-255, 256), 0)
        self.assertEqual(trunc_div(-257, 256), -1)
        self.assertEqual(trunc_div(257, 256), 1)

    def test_four_position_layout_clipping_negative_dot_and_tie(self):
        model = hand_model()
        validate(model)
        self.assertEqual(forward(model, [0] * 4), {"hidden": [32767, 0],
            "expertActivations": [[1, 0], [127, 0]], "merged": [64, 0], "logits": [-1, -1], "token": 0})

    def test_odd_mean_and_module_override(self):
        model = hand_model()
        override = {"weights": [0] * 4, "bias": [0, 0]}
        self.assertEqual(forward(model, [0] * 4, {1: override})["merged"], [0, 0])
        model["experts"][0]["bias"][0] = 32767
        model["experts"][0]["weights"][0] = 32767
        self.assertEqual(forward(model, [0] * 4, {1: override})["merged"], [16383, 0])

    def test_invalid_contexts_and_dimensions(self):
        model = hand_model()
        with self.assertRaises(ValueError):
            forward(model, [0] * 3)
        with self.assertRaises(ValueError):
            forward(model, [0, 0, 0, 2])
        model["embeddings"].pop()
        with self.assertRaises(ValueError):
            validate(model)


if __name__ == "__main__":
    unittest.main()
