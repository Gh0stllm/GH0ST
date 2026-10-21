"""Independent layout, cryptographic identity and corruption checks."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from s0ul.integer import IntegerModel
from s0ul.model import ModelConfig, S0ULModel
from s0ul.solidity_export import (build_export, keccak256, ordered_names,
                                  shard_initcode, verify_export, _manifest_preimage)


class SolidityExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        torch.manual_seed(27)
        config = ModelConfig(vocab_size=16, dim=8, n_layers=1, n_heads=2,
                             hidden_dim=16, max_seq_len=12)
        model = S0ULModel(config).eval()
        cls.model = IntegerModel.from_state_dict(model.state_dict(), config.to_dict())

    def test_ethereum_keccak_known_vectors(self):
        self.assertEqual(keccak256(b""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
        self.assertEqual(keccak256(b"abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45")
        # Padding edge vectors independently obtained with ethers Keccak-256.
        self.assertEqual(keccak256(bytes(135)), "0x29e3704feeca7fb9ba229f0fa04d9b36449cf3ad6e1d85d9cfff3a10df9abc3e")

    def test_layout_reconstructs_every_reference_tensor_without_numeric_change(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = build_export(self.model, directory)
            self.assertEqual(manifest, verify_export(directory))
            self.assertEqual(len(manifest["tensors"]), 20)
            raw = Path(directory, "payload.bin").read_bytes()
            arrays = {}
            for entry in manifest["tensors"]:
                block = raw[entry["offset"]:entry["offset"] + entry["nbytes"]]
                array = np.frombuffer(block, dtype=entry["dtype"]).reshape(entry["shape"])
                np.testing.assert_array_equal(array, self.model.arrays[entry["name"]])
                arrays[entry["name"]] = array
            restored = IntegerModel(self.model.config, arrays, eps_q28=self.model.eps_q28,
                                    attention_scale_q14=self.model.attention_scale_q14)
            np.testing.assert_array_equal(restored.forward([1, 4, 3]), self.model.forward([1, 4, 3]))
            self.assertEqual(ordered_names(1), [entry["name"] for entry in manifest["tensors"]])
            self.assertEqual(manifest["constructor"]["manifestHash"], manifest["manifestHash"])

    def test_shard_runtime_initcode_and_reassembly(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = build_export(self.model, directory, shard_bytes=4096)
            payload = Path(directory, "payload.bin").read_bytes()
            reconstructed = b""
            for shard in manifest["shards"]:
                part = Path(directory, shard["path"]).read_bytes()
                init = bytes.fromhex(shard["initCodeHex"][2:])
                self.assertEqual(init[:1], b"\x61")
                self.assertEqual(int.from_bytes(init[1:3], "big"), len(part) + 1)
                self.assertEqual(init[3:8], b"\x60\x0e\x60\x00\x39")
                self.assertEqual(init[14:], b"\x00" + part)
                self.assertEqual(init, shard_initcode(part))
                self.assertLessEqual(len(init[14:]), 23_001)
                reconstructed += part
            self.assertEqual(reconstructed, payload)
            verify_export(directory)

    def test_payload_corruption_and_metadata_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            build_export(self.model, directory)
            path = Path(directory, "payload.bin")
            data = bytearray(path.read_bytes())
            data[0] ^= 1
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "payload hash"):
                verify_export(directory)
        with tempfile.TemporaryDirectory() as directory:
            manifest = build_export(self.model, directory)
            manifest["constructor"]["sourceCheckpoint"] = "0x" + "1" * 64
            Path(directory, "model.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "constructor"):
                verify_export(directory)

    def test_semantic_reordering_and_output_reuse_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = build_export(self.model, directory)
            with self.assertRaisesRegex(ValueError, "empty"):
                build_export(self.model, directory)
            manifest["tensors"][0]["name"], manifest["tensors"][1]["name"] = manifest["tensors"][1]["name"], manifest["tensors"][0]["name"]
            manifest["manifestHash"] = keccak256(_manifest_preimage(manifest))
            Path(directory, "model.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "order"):
                verify_export(directory)
        for size in (0, 23001, True):
            with self.assertRaises(ValueError):
                build_export(self.model, "unused-solidity-export", size)


if __name__ == "__main__":
    unittest.main()
