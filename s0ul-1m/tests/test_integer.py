"""Behavioral checks for the integer inference candidate."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from s0ul.integer import IntegerModel, _dot, _round_div, ONE
from s0ul.model import ModelConfig, S0ULModel


class IntegerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        torch.manual_seed(27)
        cls.config = ModelConfig(vocab_size=16, dim=8, n_layers=1, n_heads=2,
                                 hidden_dim=16, max_seq_len=12)
        cls.float_model = S0ULModel(cls.config).eval()

    def candidate(self):
        return IntegerModel.from_state_dict(self.float_model.state_dict(), self.config.to_dict())

    def test_rounding_and_overflow(self):
        result = _round_div(np.array([-7, -5, -3, -1, 1, 3, 5, 7]), 2)
        np.testing.assert_array_equal(result, [-4, -3, -2, -1, 1, 2, 3, 4])
        with self.assertRaises(OverflowError):
            _dot(np.array([[1 << 62]], dtype=np.int64), np.array([[4]], dtype=np.int64))
        with self.assertRaises(TypeError):
            _round_div(np.array([1.0]), 2)

    def test_zero_normalization(self):
        candidate = self.candidate()
        value = candidate._norm(np.zeros((2, 8), dtype=np.int64), "norm.weight")
        np.testing.assert_array_equal(value, np.zeros((2, 8), dtype=np.int64))
        unit = candidate._norm(np.full((1, 8), ONE, dtype=np.int64), "norm.weight")
        self.assertTrue(np.all(np.abs(unit - ONE) <= 1))

    def test_causal_and_integer_outputs(self):
        candidate = self.candidate()
        prefix = candidate.forward([1, 4, 3])
        full = candidate.forward([1, 4, 3, 7, 5])
        self.assertEqual(prefix.dtype, np.dtype("int64"))
        np.testing.assert_array_equal(prefix, full[:3])
        np.testing.assert_array_equal(prefix, candidate.forward([1, 4, 3]))

    def test_tie_breaking_and_context(self):
        zero = {name: torch.zeros_like(value) for name, value in self.float_model.state_dict().items()}
        candidate = IntegerModel.from_state_dict(zero, self.config.to_dict())
        self.assertEqual(candidate.generate([1, 3], 3), [1, 3, 0, 0, 0])
        with self.assertRaises(ValueError):
            candidate.generate([1, 3], 11)
        with self.assertRaises(ValueError):
            candidate.forward([16])
        with self.assertRaises(TypeError):
            candidate.forward([1.0, 3.0])

    def test_bundle_round_trip_determinism_and_corruption(self):
        candidate = self.candidate()
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            candidate.save(first)
            candidate.save(second)
            for name in ("integer-manifest.json", "integer-weights.bin"):
                self.assertEqual((Path(first) / name).read_bytes(), (Path(second) / name).read_bytes())
            restored = IntegerModel.load(first)
            np.testing.assert_array_equal(candidate.forward([1, 3]), restored.forward([1, 3]))
            path = Path(first) / "integer-weights.bin"
            raw = bytearray(path.read_bytes())
            raw[0] ^= 1
            path.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, "hash"):
                IntegerModel.load(first)

    def test_numeric_and_tokenizer_metadata_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            self.candidate().save(directory)
            path = Path(directory) / "integer-manifest.json"
            original = json.loads(path.read_text())
            invalid = dict(original, activation_fraction_bits=13)
            path.write_text(json.dumps(invalid))
            with self.assertRaisesRegex(ValueError, "specification"):
                IntegerModel.load(directory)
            invalid = dict(original, tokenizer={"version": "unrecognized"})
            path.write_text(json.dumps(invalid))
            with self.assertRaisesRegex(ValueError, "tokenizer"):
                IntegerModel.load(directory)
            invalid = dict(original, eps_q28=2684.9)
            path.write_text(json.dumps(invalid))
            with self.assertRaisesRegex(ValueError, "scalars"):
                IntegerModel.load(directory)

    def test_negative_slice_layout_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            self.candidate().save(directory)
            path = Path(directory) / "integer-manifest.json"
            manifest = json.loads(path.read_text())
            length = manifest["payload"]["nbytes"]
            # Python's negative slicing formerly accepted this layout with all
            # tensor hashes unchanged and a final cursor equal to payload size.
            manifest["arrays"][0]["nbytes"] -= length
            for entry in manifest["arrays"][1:]:
                entry["offset"] -= length
            manifest["arrays"][-1]["nbytes"] += length
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "offsets and sizes"):
                IntegerModel.load(directory)

    def test_noncanonical_array_dtype_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            self.candidate().save(directory)
            path = Path(directory) / "integer-manifest.json"
            manifest = json.loads(path.read_text())
            matrix = next(entry for entry in manifest["arrays"] if entry["name"].endswith(".q"))
            matrix["dtype"] = "<i8"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "noncanonical"):
                IntegerModel.load(directory)

    def test_real_architecture_reference_smoke(self):
        torch.manual_seed(19)
        model = S0ULModel().eval()
        self.assertEqual(model.parameter_count(), 984192)
        candidate = IntegerModel.from_state_dict(model.state_dict(), model.config.to_dict())
        output = candidate.forward([1, 40, 3])
        self.assertEqual(output.shape, (3, 512))
        self.assertEqual(candidate.saturation_count, 0)
        with torch.no_grad():
            expected = model(torch.tensor([[1, 40, 3]]))[0].numpy()
        # This checks basic numerical drift on one seeded random network only.
        # It is not a trained-model accuracy result or exact float equivalence.
        difference = np.max(np.abs(output / ONE - expected))
        self.assertLess(difference, 0.08)


if __name__ == "__main__":
    unittest.main()
