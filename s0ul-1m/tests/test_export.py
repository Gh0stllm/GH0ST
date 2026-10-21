"""Meaningful export-integrity and independently computed arithmetic checks."""

from dataclasses import asdict
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from s0ul.export import export_checkpoint, export_state, load_exported_state, model_from_export, quantize_rows, verify_export
from s0ul.model import ModelConfig, S0ULModel
from s0ul.reference import dot_int8_int16, forward_float, requantize, round_divide
from s0ul.tokenizer import S0ULTokenizer


class IntegerReferenceTests(unittest.TestCase):
    def test_signed_extremes_and_rounding(self):
        self.assertEqual(dot_int8_int16([-127, 127, 3], [-32768, 32767, -2]), 8322939)
        for x, expected in ((3, 2), (-3, -2), (1, 1), (-1, -1), (0, 0)):
            self.assertEqual(round_divide(x, 2), expected)
        self.assertEqual(round_divide(-4, 3), -1)
        self.assertEqual(requantize(-3, 1, 1), -2)
        self.assertEqual(requantize(40000, 1, 0), 32767)
        self.assertEqual(requantize(-40000, 1, 0), -32768)

    def test_invalid_integer_inputs(self):
        for w, a in (([-128], [1]), ([0], [32768]), ([1, 2], [3]), ([0.5], [1])):
            with self.assertRaises(ValueError):
                dot_int8_int16(w, a)
        with self.assertRaises(OverflowError):
            requantize(1 << 254, 4, 1)


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def model(self):
        torch.manual_seed(13)
        cfg = ModelConfig(vocab_size=32, dim=16, n_layers=2, n_heads=2, hidden_dim=24, max_seq_len=32)
        return S0ULModel(cfg).eval()

    def test_row_quantization_error_and_zero_rows(self):
        values = np.asarray([[0., 0., 0.], [-127., -0.5, 0.5], [3.14, -2.0, 0.1]], dtype=np.float32)
        q, scales = quantize_rows(values)
        self.assertTrue(np.array_equal(q[0], [0, 0, 0]))
        self.assertEqual(float(scales[0]), 1.0)
        self.assertEqual(q[1].tolist(), [-127, -1, 1])
        self.assertTrue(np.all(np.abs(q.astype(np.float32) * scales[:, None] - values) <= scales[:, None] * 0.50001))

    def test_full_export_round_trip_and_numpy_parity(self):
        model = self.model()
        tokens = [1, 6, 3, 7, 2]
        with tempfile.TemporaryDirectory() as temp:
            manifest = export_state(model.state_dict(), asdict(model.config), temp, shard_bytes=1000)
            self.assertEqual(manifest["parameter_count"], model.parameter_count())
            self.assertGreater(len(manifest["shards"]), 1)
            self.assertFalse(manifest["full_integer_inference"])
            config, restored = load_exported_state(Path(temp) / "manifest.json")
            decoded_model = model_from_export(Path(temp) / "manifest.json")
            with torch.no_grad():
                expected = decoded_model(torch.tensor([tokens]))[0].numpy()
                fp_original = model(torch.tensor([tokens]))[0].numpy()
            actual = forward_float(tokens, {key: value.numpy() for key, value in restored.items()}, config)
            np.testing.assert_allclose(actual, expected, rtol=2e-4, atol=2e-6)
            self.assertLess(float(np.max(np.abs(fp_original - expected))), 0.03)

    def test_hash_and_coverage_corruption_rejected(self):
        model = self.model()
        with tempfile.TemporaryDirectory() as temp:
            manifest = export_state(model.state_dict(), asdict(model.config), temp, shard_bytes=1000)
            manifest_path = Path(temp) / "manifest.json"
            shard = Path(temp) / manifest["shards"][0]["path"]
            block = bytearray(shard.read_bytes())
            block[0] ^= 1
            shard.write_bytes(block)
            with self.assertRaisesRegex(ValueError, "shard"):
                verify_export(manifest_path)
            export_state(model.state_dict(), asdict(model.config), temp, shard_bytes=1000)
            payload = Path(temp) / "weights.bin"
            block = bytearray(payload.read_bytes())
            block[0] ^= 1
            payload.write_bytes(block)
            with self.assertRaisesRegex(ValueError, "payload"):
                verify_export(manifest_path)

    def test_manifest_tampering_rejected(self):
        model = self.model()
        with tempfile.TemporaryDirectory() as temp:
            manifest = export_state(model.state_dict(), asdict(model.config), temp)
            path = Path(temp) / "manifest.json"
            manifest["tensors"][0]["offset"] = 1
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "offset"):
                verify_export(path)
            manifest["payload"]["path"] = "../weights.bin"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "basenames"):
                verify_export(path)

    def test_default_model_export_parameter_count(self):
        torch.manual_seed(1)
        model = S0ULModel()
        with tempfile.TemporaryDirectory() as temp:
            manifest = export_state(model.state_dict(), asdict(model.config), temp)
            self.assertEqual(manifest["parameter_count"], 984192)
            self.assertEqual(len(manifest["shards"]), 12)
            self.assertTrue(all(shard["nbytes"] <= 90000 for shard in manifest["shards"]))

    def test_checkpoint_tokenizer_provenance(self):
        model = S0ULModel(ModelConfig(vocab_size=512, dim=16, n_layers=2, n_heads=2,
                                     hidden_dim=24, max_seq_len=32))
        with tempfile.TemporaryDirectory() as temp:
            checkpoint_path = Path(temp) / "checkpoint.pt"
            checkpoint = {"config": asdict(model.config), "model_state_dict": model.state_dict()}
            torch.save(checkpoint, checkpoint_path)
            with self.assertRaisesRegex(ValueError, "tokenizer"):
                export_checkpoint(checkpoint_path, Path(temp) / "export")
            checkpoint["tokenizer"] = S0ULTokenizer().spec()
            torch.save(checkpoint, checkpoint_path)
            manifest = export_checkpoint(checkpoint_path, Path(temp) / "export")
            self.assertEqual(manifest["tokenizer"], checkpoint["tokenizer"])
            self.assertEqual(len(manifest["source_checkpoint_sha256"]), 64)
            manifest["tokenizer"]["domain_sha256"] = "0" * 64
            path = Path(temp) / "export" / "manifest.json"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "tokenizer"):
                model_from_export(path)


if __name__ == "__main__":
    unittest.main()
