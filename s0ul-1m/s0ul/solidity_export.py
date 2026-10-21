"""Export the unchanged integer-v1 arithmetic to immutable Solidity code shards.

Conversion/loading happens offline. A bundle's hashes establish byte integrity;
they do not establish model quality or authorize an agent action.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

import numpy as np

from .integer import IntegerModel, FORMAT as INTEGER_FORMAT


FORMAT = "gh0st-s0ul-solidity-v1"
MAX_SHARD_BYTES = 23_000
_MASK64 = (1 << 64) - 1
_ROTATIONS = (0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39,
              41, 45, 15, 21, 8, 18, 2, 61, 56, 14)
_ROUND_CONSTANTS = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)


def _rot(value, shift):
    return ((value << shift) | (value >> (64 - shift))) & _MASK64 if shift else value


def keccak256(raw: bytes) -> str:
    """Ethereum Keccak-256 (not FIPS SHA3), without a new runtime dependency."""
    # The optional faster backend is used when already installed. The fallback
    # is exercised against published empty/abc vectors in the exporter tests.
    try:
        from Crypto.Hash import keccak
    except ImportError:
        pass
    else:
        result = keccak.new(digest_bits=256)
        result.update(raw)
        return "0x" + result.hexdigest()
    rate = 136
    padding = rate - len(raw) % rate
    padded = bytearray(raw)
    if padding == 1:
        padded.append(0x81)
    else:
        padded.append(1)
        padded.extend(bytes(padding - 2))
        padded.append(0x80)
    state = [0] * 25
    for start in range(0, len(padded), rate):
        block = padded[start:start + rate]
        for index in range(rate // 8):
            state[index] ^= int.from_bytes(block[index * 8:index * 8 + 8], "little")
        for constant in _ROUND_CONSTANTS:
            columns = [state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
                       for x in range(5)]
            delta = [columns[(x - 1) % 5] ^ _rot(columns[(x + 1) % 5], 1) for x in range(5)]
            moved = [0] * 25
            for y in range(5):
                for x in range(5):
                    index = x + 5 * y
                    moved[y + 5 * ((2 * x + 3 * y) % 5)] = _rot(state[index] ^ delta[x], _ROTATIONS[index])
            for y in range(5):
                for x in range(5):
                    state[x + 5 * y] = moved[x + 5 * y] ^ ((~moved[(x + 1) % 5 + 5 * y]) & moved[(x + 2) % 5 + 5 * y])
            state[0] ^= constant
    digest = b"".join(value.to_bytes(8, "little") for value in state)[:32]
    return "0x" + digest.hex()


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def ordered_names(layers):
    names = ["token_embedding.weight.q", "token_embedding.weight.scale_q24"]
    for layer in range(layers):
        prefix = f"layers.{layer}."
        names.append(prefix + "attn_norm.weight.q14")
        for projection in ("q", "k", "v", "o"):
            name = prefix + f"attention.{projection}.weight"
            names.extend((name + ".q", name + ".scale_q24"))
        names.append(prefix + "ffn_norm.weight.q14")
        for projection in ("up", "down"):
            name = prefix + f"ffn.{projection}.weight"
            names.extend((name + ".q", name + ".scale_q24"))
    names.extend(("norm.weight.q14", "rope.cos_q14", "rope.sin_q14", "softmax.exp_q24"))
    return names


def solidity_config(model):
    config = model.config
    result = {"vocabSize": config["vocab_size"], "dim": config["dim"],
              "layers": config["n_layers"], "heads": config["n_heads"],
              "hiddenDim": config["hidden_dim"], "maxSeqLen": config["max_seq_len"],
              "epsQ28": model.eps_q28, "attentionScaleQ14": model.attention_scale_q14}
    bounds = {"vocabSize": 512, "dim": 128, "layers": 4, "heads": 4,
              "hiddenDim": 640, "maxSeqLen": 128, "epsQ28": 1 << 28,
              "attentionScaleQ14": 1 << 14}
    if any(type(value) is not int or not 1 <= value <= bounds[key] for key, value in result.items()):
        raise ValueError("configuration exceeds the bounded Solidity runtime")
    if result["dim"] % result["heads"] or (result["dim"] // result["heads"]) % 2:
        raise ValueError("Solidity head width must be even")
    return result


def shard_initcode(payload):
    if not 1 <= len(payload) <= MAX_SHARD_BYTES:
        raise ValueError("shard payload must contain 1..23000 bytes")
    runtime = b"\x00" + payload
    length = len(runtime).to_bytes(2, "big")
    # PUSH2 length, PUSH1 14, PUSH1 0, CODECOPY, PUSH2 length, PUSH1 0, RETURN.
    return b"\x61" + length + b"\x60\x0e\x60\x00\x39\x61" + length + b"\x60\x00\xf3" + runtime


def _manifest_preimage(manifest):
    core = {key: value for key, value in manifest.items() if key not in ("manifestHash", "constructor")}
    core["shards"] = [{key: value for key, value in shard.items() if key != "initCodeHex"}
                      for shard in core["shards"]]
    return json.dumps(core, sort_keys=True, separators=(",", ":")).encode()


def build_export(model, output, shard_bytes=MAX_SHARD_BYTES):
    """Write deterministic shards for one validated IntegerModel; return model.json."""
    if type(shard_bytes) is not int or not 1 <= shard_bytes <= MAX_SHARD_BYTES:
        raise ValueError("shard_bytes must lie in 1..23000")
    model._validate()
    config = solidity_config(model)
    root = Path(output)
    if root.exists() and any(root.iterdir()):
        raise ValueError("output must be a new or empty directory")
    source = model.source_checkpoint_sha256
    if source is not None and not re.fullmatch(r"[0-9a-f]{64}", source):
        raise ValueError("source checkpoint must have a lowercase SHA-256 digest")
    payload = bytearray()
    entries = []
    for index, name in enumerate(ordered_names(config["layers"])):
        array = np.asarray(model.arrays[name], dtype=np.int8 if name.endswith(".q") else "<i8")
        raw = array.tobytes(order="C")
        entries.append({"id": index, "name": name, "shape": list(array.shape),
                        "dtype": array.dtype.str, "offset": len(payload),
                        "nbytes": len(raw), "sha256": sha256(raw)})
        payload.extend(raw)
    raw = bytes(payload)
    root.mkdir(parents=True, exist_ok=True)
    (root / "payload.bin").write_bytes(raw)
    shards = []
    for index, start in enumerate(range(0, len(raw), shard_bytes)):
        part = raw[start:start + shard_bytes]
        name = f"shard-{index:03d}.bin"
        (root / name).write_bytes(part)
        init = shard_initcode(part)
        shards.append({"index": index, "path": name, "offset": start,
                       "payloadBytes": len(part), "payloadSha256": sha256(part),
                       "runtimeBytes": len(part) + 1,
                       "runtimeKeccak256": keccak256(b"\x00" + part),
                       "initCodeKeccak256": keccak256(init), "initCodeHex": "0x" + init.hex()})
    domain_hash = None if model.tokenizer_spec is None else "0x" + model.tokenizer_spec["domain_sha256"]
    manifest = {"format": FORMAT, "integerReferenceFormat": INTEGER_FORMAT,
                "config": config, "integerConfig": model.config,
                "sourceCheckpoint": "0x" + (source or "0" * 64),
                "tokenizerDomainSha256": domain_hash,
                "numericRules": {"activationFractionBits": 14, "weightScaleFractionBits": 24,
                                 "activationLimit": (1 << 20) - 1,
                                 "nonWeightCellEncoding": "little-endian signed int64",
                                 "rounding": "nearest; exact ties away from zero"},
                "payload": {"path": "payload.bin", "nbytes": len(raw), "sha256": sha256(raw)},
                "shardBytes": shard_bytes, "tensors": entries, "shards": shards,
                "scope": "Solidity integer inference model bytes; no public-chain deployment asserted"}
    manifest["manifestHash"] = keccak256(_manifest_preimage(manifest))
    manifest["constructor"] = {"config": config, "sourceCheckpoint": manifest["sourceCheckpoint"],
                               "manifestHash": manifest["manifestHash"], "shardBytes": shard_bytes}
    (root / "model.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def verify_export(source):
    """Check bytes, schemas and deployment hashes; return the verified manifest."""
    root = Path(source)
    manifest = json.loads((root / "model.json").read_text())
    if manifest.get("format") != FORMAT or manifest.get("integerReferenceFormat") != INTEGER_FORMAT:
        raise ValueError("unsupported Solidity bundle format")
    if manifest.get("manifestHash") != keccak256(_manifest_preimage(manifest)):
        raise ValueError("Solidity manifest hash mismatch")
    payload = manifest["payload"]
    if payload["path"] != "payload.bin":
        raise ValueError("unexpected payload path")
    raw = (root / "payload.bin").read_bytes()
    if len(raw) != payload["nbytes"] or sha256(raw) != payload["sha256"]:
        raise ValueError("Solidity payload hash or size mismatch")
    names = ordered_names(manifest["config"]["layers"])
    if len(manifest["tensors"]) != len(names):
        raise ValueError("incorrect tensor count")
    arrays, cursor = {}, 0
    for index, entry in enumerate(manifest["tensors"]):
        dtype = "|i1" if entry["name"].endswith(".q") else "<i8"
        if entry["id"] != index or entry["name"] != names[index] or entry["dtype"] != dtype:
            raise ValueError("noncanonical Solidity tensor order or encoding")
        length = entry["nbytes"]
        if type(length) is not int or length <= 0 or entry["offset"] != cursor:
            raise ValueError("invalid Solidity tensor byte layout")
        part = raw[cursor:cursor + length]
        if len(part) != length or sha256(part) != entry["sha256"]:
            raise ValueError("Solidity tensor hash mismatch")
        shape = entry["shape"]
        if not shape or any(type(n) is not int or n <= 0 for n in shape):
            raise ValueError("invalid tensor shape")
        try:
            arrays[entry["name"]] = np.frombuffer(part, dtype=dtype).copy().reshape(shape)
        except ValueError as error:
            raise ValueError("Solidity tensor shape/size mismatch") from error
        cursor += length
    if cursor != len(raw):
        raise ValueError("unreferenced Solidity payload bytes")
    config = manifest["config"]
    model = IntegerModel(manifest["integerConfig"], arrays, eps_q28=config["epsQ28"],
                         attention_scale_q14=config["attentionScaleQ14"])
    if solidity_config(model) != config:
        raise ValueError("Solidity and integer configuration differ")
    size = manifest["shardBytes"]
    if type(size) is not int or not 1 <= size <= MAX_SHARD_BYTES:
        raise ValueError("invalid shard byte size")
    if len(manifest["shards"]) != (len(raw) + size - 1) // size:
        raise ValueError("incorrect shard count")
    reconstructed = bytearray()
    for index, entry in enumerate(manifest["shards"]):
        name = f"shard-{index:03d}.bin"
        if entry["index"] != index or entry["path"] != name or entry["offset"] != index * size:
            raise ValueError("invalid shard ordering or path")
        shard_path = root / name
        if shard_path.is_symlink():
            raise ValueError("symbolic-link shards are not accepted")
        part = shard_path.read_bytes()
        expected = min(size, len(raw) - index * size)
        init = shard_initcode(part)
        if len(part) != expected or entry["payloadBytes"] != expected or entry["runtimeBytes"] != expected + 1:
            raise ValueError("shard byte size mismatch")
        if sha256(part) != entry["payloadSha256"] or entry["runtimeKeccak256"] != keccak256(b"\x00" + part):
            raise ValueError("shard hash mismatch")
        if entry["initCodeKeccak256"] != keccak256(init) or entry["initCodeHex"] != "0x" + init.hex():
            raise ValueError("shard initcode hash or bytes mismatch")
        reconstructed.extend(part)
    if bytes(reconstructed) != raw:
        raise ValueError("shards do not reconstruct the payload")
    expected_constructor = {"config": config, "sourceCheckpoint": manifest["sourceCheckpoint"],
                            "manifestHash": manifest["manifestHash"], "shardBytes": size}
    if manifest["constructor"] != expected_constructor:
        raise ValueError("constructor arguments differ from pinned metadata")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument("--checkpoint")
    sources.add_argument("--bundle")
    sources.add_argument("--fixture", action="store_true", help="small seeded numeric fixture; not trained S0UL-1M")
    sources.add_argument("--verify", help="verify an exported Solidity bundle directory")
    parser.add_argument("--output")
    parser.add_argument("--shard-bytes", type=int, default=MAX_SHARD_BYTES)
    args = parser.parse_args()
    if args.verify:
        manifest = verify_export(args.verify)
    else:
        if not args.output:
            parser.error("--output is required for export")
        if args.fixture:
            import torch
            from .model import ModelConfig, S0ULModel
            torch.manual_seed(27)
            config = ModelConfig(vocab_size=16, dim=8, n_layers=1, n_heads=2,
                                 hidden_dim=16, max_seq_len=12)
            model = S0ULModel(config).eval()
            candidate = IntegerModel.from_state_dict(model.state_dict(), config.to_dict())
        else:
            candidate = IntegerModel.from_checkpoint(args.checkpoint) if args.checkpoint else IntegerModel.load(args.bundle)
        manifest = build_export(candidate, args.output, args.shard_bytes)
    print(json.dumps({"format": manifest["format"], "sourceCheckpoint": manifest["sourceCheckpoint"],
                      "payload": manifest["payload"], "shards": len(manifest["shards"]),
                      "manifestHash": manifest["manifestHash"]}, indent=2))


if __name__ == "__main__":
    main()
