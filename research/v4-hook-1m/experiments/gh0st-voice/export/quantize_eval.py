"""Export a local GH0ST voice checkpoint and evaluate exact Relative64 Q12.

No network, chain, wallet, or training calls. The unchanged tokenizer and tensor
layout are checked before export. Fixed-point arithmetic is implemented here,
independently of the Solidity implementation and the previous Python reference.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

os.environ["TOKENIZERS_PARALLELISM"] = "false"
import numpy as np
from safetensors.numpy import load_file
from transformers import AutoTokenizer

HERE = Path(__file__).resolve().parent
VOICE = HERE.parent
BASE = VOICE.parent / "simplestories-v2"
RESEARCH = BASE.parents[1]
NODE = os.environ.get("NODE_BINARY", "/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
Q = 4096
WINDOW = 64
TERMINALS = {1, 2, 15, 30}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")


def load_helper(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def export_checkpoint(checkpoint, out):
    """Nearest-even Q12; reject overflow rather than silently clipping."""
    checkpoint = Path(checkpoint).resolve()
    source = checkpoint / "model.safetensors"
    raw = load_file(str(source))
    config = json.loads((checkpoint / "config.json").read_text())
    for name, expected in {"vocab_size": 4019, "hidden_size": 128, "intermediate_size": 341,
                           "num_hidden_layers": 4, "num_attention_heads": 4,
                           "num_key_value_heads": 2, "head_dim": 32}.items():
        assert config.get(name, expected) == expected, (name, config.get(name), expected)
    assert config.get("tie_word_embeddings") is True
    tokenizer = AutoTokenizer.from_pretrained(checkpoint, local_files_only=True, trust_remote_code=False)
    original = AutoTokenizer.from_pretrained(BASE / "model-cache", local_files_only=True, trust_remote_code=False)
    assert tokenizer.get_vocab() == original.get_vocab(), "Changed token mapping is not supported"
    assert tokenizer.encode('"', add_special_tokens=False) == [3]
    protocol = json.loads((BASE / "contracts/protocol.json").read_text())
    tensors, binary, per_tensor = {}, bytearray(), []
    for entry in protocol["weights"]["tensor_layout"]:
        name = entry["name"]
        values = raw[name].astype(np.float64)
        assert list(values.shape) == entry["shape"]
        assert np.isfinite(values).all(), f"Nonfinite checkpoint tensor: {name}"
        quantized = np.rint(values * Q).astype(np.int64)
        assert quantized.min() >= -32768 and quantized.max() <= 32767, f"Q12 int16 overflow: {name}"
        assert len(binary) == entry["byte_offset"]
        binary.extend(quantized.astype(">i2").tobytes())
        tensors[name] = quantized
        matrix = len(entry["shape"]) == 2
        per_tensor.append({"name": name, "shape": entry["shape"], "q12_min": int(quantized.min()),
                           "q12_max": int(quantized.max()), "matrix": matrix,
                           "swar8_signed12_compatible": not matrix or bool(quantized.min() >= -2048 and quantized.max() <= 2047),
                           "maximum_absolute_weight_error": float(np.max(np.abs(quantized / Q - values)))})
    assert len(binary) == 2471936
    original_blob = (BASE / "model/weights.bin").read_bytes()
    original_q12 = np.frombuffer(original_blob, dtype=">i2")
    current_q12 = np.frombuffer(binary, dtype=">i2")
    model_out = out / "model"
    model_out.mkdir(parents=True, exist_ok=True)
    (model_out / "weights.bin").write_bytes(binary)
    report = {"schema_version": 1, "scope": "Local checkpoint Q12 export; no clipping, inference, or chain calls",
              "checkpoint": str(checkpoint), "checkpoint_sha256": sha(source.read_bytes()),
              "parameters": 1235968, "weights_bytes": len(binary), "weights_sha256": sha(binary),
              "original_weights_sha256": sha(original_blob), "changed_q12_parameters": int(np.count_nonzero(original_q12 != current_q12)),
              "tokenizer_vocab_unchanged": True, "initial_prompt_ids": [3], "eos_token_id": 1,
              "rounding": "nearest-even Q12; no clipping", "weight_scale": Q,
              "swar8_signed12_compatible": all(row["swar8_signed12_compatible"] for row in per_tensor),
              "clipped_parameters": 0, "per_tensor": per_tensor}
    write_json(out / "quantization-report.json", report)
    return tensors, tokenizer, report


def tables():
    cosine = np.asarray([[round(math.cos(age * 10000 ** (-j / 16)) * Q) for j in range(16)] for age in range(WINDOW)], dtype=np.int64)
    sine = np.asarray([[round(math.sin(age * 10000 ** (-j / 16)) * Q) for j in range(16)] for age in range(WINDOW)], dtype=np.int64)
    sigmoid = np.asarray([round(65536 / (1 + math.exp(-i / 16))) for i in range(257)], dtype=np.int64)
    exponential = np.asarray([round(math.exp(-i / 16) * 1048576) for i in range(257)], dtype=np.int64)
    return cosine, sine, sigmoid, exponential


class Relative64:
    def __init__(self, tensors):
        self.tensors = tensors
        self.cosine, self.sine, self.sigmoid, self.exp = tables()
        self.keys = [[] for _ in range(4)]
        self.values = [[] for _ in range(4)]
        self.tokens = []
        self.maximum_activation = 0
        self.maximum_linear_input = 0
        self.linear_input_bound_violations = 0
        self.maximum_dot_bound = 0

    @staticmethod
    def div(values, denominator):
        values = np.asarray(values, dtype=np.int64)
        return np.sign(values) * (np.abs(values) // denominator)

    def checked(self, values):
        values = np.asarray(values, dtype=np.int64)
        assert values.min() >= -(2 ** 31) and values.max() < 2 ** 31, "Signed int32 activation overflow"
        self.maximum_activation = max(self.maximum_activation, int(np.abs(values).max()))
        return values

    def linear(self, x, weights):
        maximum = int(np.abs(x).max())
        self.maximum_linear_input = max(self.maximum_linear_input, maximum)
        self.linear_input_bound_violations += int(x.min() < -65536 or x.max() > 65535)
        bound = maximum * int(np.abs(weights).max()) * x.shape[-1]
        self.maximum_dot_bound = max(self.maximum_dot_bound, bound)
        assert bound < 2 ** 63, "Reference int64 multiplication bound exceeded"
        return self.checked(self.div(x @ weights.T, Q))

    def rms(self, x, weights):
        assert int(np.abs(x).max()) ** 2 * x.shape[-1] < 2 ** 63
        denominator = np.asarray([math.isqrt(int((row * row).sum()) // 128 + 17) for row in x], dtype=np.int64)
        return self.checked(self.div(self.div(x * Q, denominator[:, None]) * weights, Q))

    @staticmethod
    def interpolate(table, magnitude, saturated):
        index, remainder = np.divmod(np.asarray(magnitude, dtype=np.int64) * 16, Q)
        limited = np.minimum(index, 255)
        result = (table[limited] * (Q - remainder) + table[limited + 1] * remainder) // Q
        return np.where(index >= 256, saturated, result)

    def silu(self, values):
        positive = self.interpolate(self.sigmoid, np.abs(values), 65536)
        probability = np.where(values >= 0, positive, 65536 - positive)
        return self.checked(self.div(values * probability, 65536))

    def append(self, token):
        assert 0 <= token < 4019
        position = len(self.tokens)
        x = self.tensors["model.embed_tokens.weight"][[token]].copy()
        for layer in range(4):
            prefix = f"model.layers.{layer}."
            normal = self.rms(x, self.tensors[prefix + "input_layernorm.weight"])
            q = self.linear(normal, self.tensors[prefix + "self_attn.q_proj.weight"]).reshape(4, 32)
            k = self.linear(normal, self.tensors[prefix + "self_attn.k_proj.weight"]).reshape(2, 32)
            v = self.linear(normal, self.tensors[prefix + "self_attn.v_proj.weight"]).reshape(2, 32)
            self.keys[layer].append(k)
            self.values[layer].append(v)
            start = max(0, position + 1 - WINDOW)
            stored = np.asarray(self.keys[layer][start:position + 1])
            ages = np.arange(position - start, -1, -1)
            a, b = stored[:, :, :16], stored[:, :, 16:]
            c, s = self.cosine[ages, None, :], self.sine[ages, None, :]
            relative = self.checked(np.concatenate((self.div(a * c + b * s, Q), self.div(b * c - a * s, Q)), axis=2))
            values = np.asarray(self.values[layer][start:position + 1])
            attended = np.zeros((4, 32), dtype=np.int64)
            for head in range(4):
                scores = self.div(relative[:, head // 2] @ q[head], 23170)
                weights = self.interpolate(self.exp, scores.max() - scores, 0)
                attended[head] = self.div(weights @ values[:, head // 2], int(weights.sum()))
            x = self.checked(x + self.linear(attended.reshape(1, 128), self.tensors[prefix + "self_attn.o_proj.weight"]))
            normal = self.rms(x, self.tensors[prefix + "post_attention_layernorm.weight"])
            gate = self.silu(self.linear(normal, self.tensors[prefix + "mlp.gate_proj.weight"]))
            up = self.linear(normal, self.tensors[prefix + "mlp.up_proj.weight"])
            x = self.checked(x + self.linear(self.checked(self.div(gate * up, Q)), self.tensors[prefix + "mlp.down_proj.weight"]))
        hidden = self.rms(x, self.tensors["model.norm.weight"])
        logits = self.linear(hidden, self.tensors["model.embed_tokens.weight"])[0]
        self.tokens.append(token)
        return logits

    def sample(self, logits, draw, k=8, temperature=800):
        order = np.argsort(-logits, kind="stable")
        order = order[order != 0][:k]
        distance = (logits[order[0]] - logits[order]) * 1000 // temperature
        weights = self.interpolate(self.exp, distance, 0)
        pick = draw % int(weights.sum())
        for token, weight in zip(order, weights):
            if pick < weight:
                return int(token)
            pick -= int(weight)
        raise AssertionError("Sampler did not select a token")


def get_draws(seeds, count):
    script = '''import {AbiCoder,keccak256,toBeHex,zeroPadValue} from "ethers";
const seeds=JSON.parse(process.argv[1]),count=Number(process.argv[2]),c=AbiCoder.defaultAbiCoder();
process.stdout.write(JSON.stringify(seeds.map(n=>Array.from({length:count},(_,i)=>keccak256(c.encode(["string","bytes32","uint256"],["GH0ST_SAMPLE_STEP_V1",zeroPadValue(toBeHex(n),32),i]))))));'''
    raw = subprocess.check_output([NODE, "--input-type=module", "-e", script, json.dumps(seeds), str(count)], cwd=RESEARCH)
    return [[int(x, 16) for x in row] for row in json.loads(raw)]


def logit_hashes(rows):
    """Keccak of full ABI int256[] logits, matching the EVM inspection result."""
    fd, name = tempfile.mkstemp(prefix="gh0st-voice-logits-", suffix=".bin")
    try:
        with os.fdopen(fd, "wb") as handle:
            for row in rows:
                handle.write((32).to_bytes(32, "big") + len(row).to_bytes(32, "big"))
                handle.write(b"".join(int(value).to_bytes(32, "big", signed=True) for value in row))
        script = '''import fs from "node:fs";import {keccak256} from "ethers";
const b=fs.readFileSync(process.argv[1]),r=[];for(let i=0;i<b.length;i+=128672)r.push(keccak256(b.subarray(i,i+128672)));process.stdout.write(JSON.stringify(r));'''
        return json.loads(subprocess.check_output([NODE, "--input-type=module", "-e", script, name], cwd=RESEARCH))
    finally:
        Path(name).unlink(missing_ok=True)


def baseline_tensors():
    raw = (BASE / "model/weights.bin").read_bytes()
    layout = json.loads((BASE / "contracts/protocol.json").read_text())["weights"]["tensor_layout"]
    return {entry["name"]: np.frombuffer(raw, dtype=">i2", count=entry["elements"], offset=entry["byte_offset"]).astype(np.int64).reshape(entry["shape"]) for entry in layout}


def generate(tensors, tokenizer, seed, draws, count, prompt_ids, top_k=8, temperature_milli=800):
    state = Relative64(tensors)
    for token in prompt_ids[:-1]:
        state.append(token)
    pending = prompt_ids[-1]
    generated, turns, logit_rows = [], [], []
    while len(generated) < count:
        maximum = min(2 if len(state.tokens) <= 26 else 1, count - len(generated))
        before, out = len(state.tokens), []
        for _ in range(maximum):
            logits = state.append(pending)
            logit_rows.append(logits.copy())
            pending = state.sample(logits, draws[len(generated)], top_k, temperature_milli)
            out.append(pending)
            generated.append(pending)
            if pending in TERMINALS:
                break
        turns.append({"turn": len(turns) + 1, "processed_before": before, "processed_after": len(state.tokens),
                      "tokens": out, "text": tokenizer.decode(out, skip_special_tokens=True),
                      "ended_eos": pending == 1, "ended_sentence": pending in {2, 15, 30}})
    return {"seed": seed, "prompt_ids": prompt_ids, "prompt_text": tokenizer.decode(prompt_ids, skip_special_tokens=True),
            "generated_tokens": generated, "full_text": tokenizer.decode(prompt_ids + generated, skip_special_tokens=True),
            "turns": turns, "generated_count": count, "turn_count": len(turns),
            "q12_safety": {"maximum_absolute_activation": state.maximum_activation,
                           "maximum_absolute_linear_input": state.maximum_linear_input,
                           "linear_input_signed17_bound_violations": state.linear_input_bound_violations,
                           "maximum_integer_matmul_bound": state.maximum_dot_bound}}, logit_rows


def evm_artifacts(out, report):
    """Repack only when the existing fast path's exact weight bounds hold."""
    if not report["swar8_signed12_compatible"]:
        return {"status": "BLOCKED", "reason": "Some matrix weight does not fit exact SWAR8 signed12 lanes"}
    packer = load_helper("voice_swar_export", BASE / "optimization/design/export_swar.py")
    protocol = json.loads((BASE / "contracts/protocol.json").read_text())
    source = (out / "model/weights.bin").read_bytes()
    packed = out / "packed-swar8"
    packed.mkdir(exist_ok=True)
    data = bytearray()
    mapping = {"schema_version": 1, "format": "swar8", "lanes": 8, "radix_bits": 32,
               "weight_bias": 2048, "activation_bias": 65536, "matrices": {}, "norms": {}, "layers": []}
    rng = np.random.default_rng(20261024)
    rows_checked = 0
    entries = protocol["weights"]["tensor_layout"]
    def raw(entry):
        return source[entry["byte_offset"]:entry["byte_offset"] + entry["elements"] * 2]
    def matrix(entry):
        nonlocal rows_checked
        values = np.frombuffer(raw(entry), dtype=">i2").reshape(entry["shape"])
        rows, columns = entry["shape"]
        groups, begin = (columns + 7) // 8, len(data)
        for row in values:
            weights = row.tolist()
            padded = weights + [0] * (groups * 8 - columns)
            for at in range(0, len(padded), 8):
                word = packer.pack_weights(padded[at:at + 8], 8, 32, 2048)
                data.extend(word.to_bytes(32, "big"))
                assert [((word >> (i * 32)) & 4095) - 2048 for i in range(8)] == padded[at:at + 8]
            data.extend(sum(weights).to_bytes(32, "big", signed=True))
            x = rng.integers(-65536, 65536, size=columns).tolist()
            assert packer.packed_dot(weights, x, 8, 32, 2048, 65536) == sum(a * b for a, b in zip(weights, x))
            rows_checked += 1
        mapping["matrices"][str(entry["byte_offset"])] = {"name": entry["name"], "original_offset": entry["byte_offset"],
            "offset": begin, "length": len(data) - begin, "rows": rows, "columns": columns, "groups": groups,
            "padded_columns": groups * 8, "row_stride": (groups + 1) * 32, "row_sum_offset": groups * 32}
    embed = entries[0]
    mapping["raw_embedding"] = {"offset": 0, "length": len(raw(embed)), "rows": 4019, "columns": 128}
    data.extend(raw(embed))
    for layer in range(4):
        begin = len(data)
        for entry in entries:
            if entry["name"].startswith(f"model.layers.{layer}."):
                if len(entry["shape"]) == 2:
                    matrix(entry)
                else:
                    mapping["norms"][str(entry["byte_offset"])] = {"name": entry["name"], "offset": len(data), "length": len(raw(entry))}
                    data.extend(raw(entry))
        mapping["layers"].append({"layer": layer, "offset": begin, "length": len(data) - begin})
    final = entries[-1]
    mapping["norms"][str(final["byte_offset"])] = {"name": final["name"], "offset": len(data), "length": len(raw(final))}
    data.extend(raw(final))
    matrix(embed)
    for section in [mapping["matrices"], mapping["norms"]]:
        for item in section.values():
            for layer in mapping["layers"]:
                if layer["offset"] <= item["offset"] < layer["offset"] + layer["length"]:
                    item["layer_offset"] = item["offset"] - layer["offset"]
    mapping["weight_bytes"] = len(data)
    (packed / "weights.bin").write_bytes(data)
    (packed / "tables.bin").write_bytes((out / "model/tables-relative64.bin").read_bytes())
    write_json(packed / "packed_offsets.json", mapping)
    packing = {"actual_weight_rows_recovered_exactly": rows_checked, "actual_rows_full_int17_random_dot_passed": rows_checked}
    manifest = {**report, "source_weights_sha256": report["weights_sha256"], "model_hash_domain": "GH0ST_VOICE_Q12_SWAR8_RELATIVE64_LOCAL_V1",
                "packing_checks": packing, "artifacts": {"weights.bin": {"bytes": len(data), "sha256": sha(data)}}}
    write_json(packed / "manifest.json", manifest)
    code = load_helper("voice_code_tiles", BASE / "optimization/full-sentence/codeweights/export_code_tiles.py")
    tile_dir = out / "codeweights"
    (tile_dir / "tiles").mkdir(parents=True, exist_ok=True)
    tile_manifest = {"schema_version": 1, "format": "EVM straight-line exact SWAR8 Q12 matrix tiles", "model_hash_domain": manifest["model_hash_domain"],
        "parameters": 1235968, "source_packed_weights_sha256": sha(data), "source_weights_sha256": report["weights_sha256"],
        "checkpoint_sha256": report["checkpoint_sha256"], "matrices": {}, "code_tiles": []}
    for info in sorted(mapping["matrices"].values(), key=lambda row: row["offset"]):
        first, ids = 0, []
        while first < info["rows"]:
            runtime, count = bytearray(code.prefix(info["groups"])), 0
            while first + count < info["rows"]:
                at = info["offset"] + (first + count) * info["row_stride"]
                candidate = code.row_code(data[at:at + info["row_stride"]], info["groups"], count)
                if len(runtime) + len(candidate) + len(code.suffix(count + 1)) > 24000:
                    break
                runtime.extend(candidate)
                count += 1
            assert count
            runtime.extend(code.suffix(count))
            index = len(tile_manifest["code_tiles"])
            path = f"tiles/tile-{index:04d}.bin"
            (tile_dir / path).write_bytes(runtime)
            tile_manifest["code_tiles"].append({"index": index, "path": path, "bytes": len(runtime), "sha256": sha(runtime),
                "matrix_packed_offset": info["offset"], "matrix_original_offset": info["original_offset"], "matrix_name": info["name"],
                "row_start": first, "row_count": count, "groups": info["groups"], "columns": info["columns"],
                "input_bytes": (info["groups"] + 1) * 32, "return_bytes": count * 32})
            ids.append(index)
            first += count
        tile_manifest["matrices"][str(info["offset"])] = {"name": info["name"], "packed_offset": info["offset"],
            "original_offset": info["original_offset"], "rows": info["rows"], "columns": info["columns"], "groups": info["groups"],
            "tile_indices": ids, "first_tile": ids[0], "tile_count": len(ids)}
    tile_manifest["total_matrix_rows"] = rows_checked
    tile_manifest["total_runtime_bytes"] = sum(row["bytes"] for row in tile_manifest["code_tiles"])
    tile_manifest["tile_count"] = len(tile_manifest["code_tiles"])
    write_json(tile_dir / "tile-manifest.json", tile_manifest)
    script = '''import fs from "node:fs";import path from "node:path";import {keccak256,AbiCoder,ZeroHash} from "ethers";
const dir=process.argv[1],file=path.join(dir,"tile-manifest.json"),m=JSON.parse(fs.readFileSync(file));let root=ZeroHash;
for(const t of m.code_tiles){t.keccak256=keccak256(fs.readFileSync(path.join(dir,t.path)));root=keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32","bytes32"],[root,t.keccak256]));}
m.code_commitment=root;fs.writeFileSync(file,JSON.stringify(m,null,2)+"\\n");'''
    subprocess.run([NODE, "--input-type=module", "-e", script, str(tile_dir)], cwd=RESEARCH, check=True)
    consolidated = export_local_model(out, report, mapping)
    return {"status": "EXPORTED_NOT_EVM_TESTED", "packed_bytes": len(data), "packed_sha256": sha(data),
            "rows_checked": rows_checked, "tile_count": tile_manifest["tile_count"], "runtime_bytes": tile_manifest["total_runtime_bytes"],
            "model_manifest": consolidated,
            "limitations": "Exact weight packing verified; no local EVM parity or gas test performed by this exporter"}


def export_local_model(out, report, mapping):
    """Pin tuned bytes and generated tile routing in an isolated local-only model."""
    evm = out / "evm"
    evm.mkdir(exist_ok=True)
    tiles = json.loads((out / "codeweights/tile-manifest.json").read_text())
    script = '''import fs from "node:fs";import path from "node:path";import {keccak256,AbiCoder,ZeroHash} from "ethers";
const dir=process.argv[1],c=AbiCoder.defaultAbiCoder(),out={};
for(const [name,file] of [["weights","packed-swar8/weights.bin"],["tables","model/tables-relative64.bin"]]){
 const b=fs.readFileSync(path.join(dir,file)),hashes=[];let root=ZeroHash;
 for(let i=0;i<b.length;i+=24000){const h=keccak256(Buffer.concat([Buffer.from([0]),b.subarray(i,i+24000)]));hashes.push(h);root=keccak256(c.encode(["bytes32","bytes32"],[root,h]));}
 out[name]={commitment:root,runtime_hashes:hashes,shards:hashes.length};
}process.stdout.write(JSON.stringify(out));'''
    commitments = json.loads(subprocess.check_output([NODE, "--input-type=module", "-e", script, str(out.resolve())], cwd=RESEARCH))
    original = BASE / "optimization/varied-sentence/continuity/kernel/SimpleStoriesV2Relative64Model.sol"
    source = original.read_text()
    source = source.replace("SimpleStoriesV2Relative64Model", "GH0STVoiceRelative64Model")
    source = source.replace("SimpleStoriesV2RelativeData", "GH0STVoiceRelativeData")
    source = source.replace("GH0ST_SIMPLESTORIES_V2_Q12_RELATIVE64_V1", "GH0ST_VOICE_Q12_RELATIVE64_LOCAL_V1")
    constructor = "constructor(address[] memory weights, address[] memory tables, address[] memory tiles, uint16 promptToken_) {"
    assert source.count(constructor) == 1
    source = source.replace(constructor, constructor + "\n        if (block.chainid != 31337) revert InvalidModel(); // Explicitly local-only research artifact.")
    source = source.replace("0x39cbe626c4d73462be6de195674cdd209984295166afe41f183810b838e4f4e1", commitments["weights"]["commitment"])
    source = source.replace("0xaac9d1c1dd09ab974cce813d5d612d3bd2c3d0951f3c9df7ee3e6bce49cfb4af", commitments["tables"]["commitment"])
    source = source.replace("0x12677213f35fafa47dd7ba36ada796d0cff9f67a3a3dd58a2330348da10295ed", tiles["code_commitment"])
    source = source.replace("sources.length != 282", f"sources.length != {tiles['tile_count']}")
    ranges = ["    function _tileRange(uint256 offset) private pure returns (uint256 first, uint256 count) {"]
    for key, matrix in sorted(tiles["matrices"].items(), key=lambda item: int(item[0])):
        assert sum(tiles["code_tiles"][index]["row_count"] for index in matrix["tile_indices"]) == matrix["rows"]
        assert matrix["tile_indices"] == list(range(matrix["first_tile"], matrix["first_tile"] + matrix["tile_count"]))
        ranges.append(f"        if (offset == {key}) return ({matrix['first_tile']}, {matrix['tile_count']});")
    ranges.extend(["        revert InvalidInput();", "    }"])
    counts = ["    function _tileRowCount(uint256 index) private pure returns (uint256) {"]
    rows = [row["row_count"] for row in tiles["code_tiles"]]
    assert all(0 < row < 256 for row in rows)
    for start in range(0, len(rows), 32):
        word = sum(value << (8 * index) for index, value in enumerate(rows[start:start + 32]))
        counts.append(f"        if (index < {start + 32}) return (uint256(0x{word:064x}) >> ((index % 32) * 8)) & 255;")
    counts.extend(["        revert InvalidInput();", "    }"])
    source, replaced = re.subn(r"    function _tileRange\(uint256 offset\).*?(?=    function _executeTiles)",
                               "\n".join(ranges + counts) + "\n", source, count=1, flags=re.S)
    assert replaced == 1
    source = source.replace("/// This preserves learned weights but changes Q12 rounding versus rotating both Q and K.",
                            "/// Uses locally voice-tuned learned weights; Q12 rounding differs from rotating both Q and K.")
    source_file = evm / "GH0STVoiceRelative64Model.sol"
    source_file.write_text(source)
    table_file = out / "model/tables-relative64.bin"
    table_bytes = table_file.read_bytes()
    manifest = {"schema_version": 1, "scope": "LOCAL-ONLY tuned model artifacts; no public chain deployment",
        "allowed_chain_id": 31337, "contract_name": "GH0STVoiceRelative64Model", "model_source": source_file.name,
        "source_sha256": sha(source_file.read_bytes()), "source_template_sha256": sha(original.read_bytes()),
        "checkpoint_sha256": report["checkpoint_sha256"], "parameters": 1235968,
        "initial_prompt_token": 3, "weight_scale": Q,
        "weights_file": "../packed-swar8/weights.bin", "tables_file": "../model/tables-relative64.bin",
        "artifacts": {"weights.bin": {"bytes": mapping["weight_bytes"], "sha256": tiles["source_packed_weights_sha256"]},
                      "tables.bin": {"bytes": len(table_bytes), "sha256": sha(table_bytes)}},
        "expected_weight_commitment": commitments["weights"]["commitment"],
        "expected_table_commitment": commitments["tables"]["commitment"], "expected_tile_commitment": tiles["code_commitment"],
        "weight_runtime_hashes": commitments["weights"]["runtime_hashes"],
        "table_runtime_hashes": commitments["tables"]["runtime_hashes"],
        "executable_tiles": [{**tile, "path": "../codeweights/" + tile["path"]} for tile in tiles["code_tiles"]],
        "tile_partition_check": {"all_matrix_rows_covered_once": True, "all_tile_indices_contiguous_per_matrix": True,
                                 "all_tiles_under_24000_bytes": all(tile["bytes"] <= 24000 for tile in tiles["code_tiles"]),
                                 "total_rows": sum(rows), "tile_count": len(rows)},
        "local_model_changes": ["checkpoint and code commitments", "generated routing and row counts for this checkpoint's exact tile layout",
                                "constructor rejects every chain ID except 31337", "distinct model hash domain"],
        "compiled": False, "limitations": ["Source export only; independent local EVM parity and gas tests still required."]}
    write_json(evm / "model-manifest.json", manifest)
    return str(evm / "model-manifest.json")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=VOICE / "training/checkpoint-final")
    parser.add_argument("--out", type=Path, default=HERE / "selected")
    parser.add_argument("--seeds", default="42,0,1,2,3,4,5,6,7,8")
    parser.add_argument("--tokens", type=int, default=150)
    parser.add_argument("--prompt", default='"')
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--temperature-milli", type=int, default=800)
    parser.add_argument("--skip-baseline", action="store_true")
    parser.add_argument("--skip-evm-artifacts", action="store_true")
    args = parser.parse_args()
    assert args.tokens > 0
    assert 1 <= args.top_k <= 64 and args.temperature_milli > 0
    start = time.monotonic()
    args.out.mkdir(parents=True, exist_ok=True)
    tensors, tokenizer, quantization = export_checkpoint(args.checkpoint, args.out)
    cosine, sine, sigmoid, exponential = tables()
    table_blob = cosine.astype(">i2").tobytes() + sine.astype(">i2").tobytes() + sigmoid.astype(">u4").tobytes() + exponential.astype(">u4").tobytes()
    assert len(table_blob) == 6152
    (args.out / "model/tables-relative64.bin").write_bytes(table_blob)
    seeds = [int(seed) for seed in args.seeds.split(",")]
    assert len(set(seeds)) == len(seeds) and all(0 <= seed < 2 ** 256 for seed in seeds)
    draws = get_draws(seeds, args.tokens)
    prompt = tokenizer.encode(args.prompt, add_special_tokens=False)
    assert prompt
    result = {"schema_version": 1, "scope": "Offline exact Q12 Relative64 comparison; no network or public-chain actions",
              "checkpoint_sha256": quantization["checkpoint_sha256"], "weights_sha256": quantization["weights_sha256"],
              "parameters": 1235968, "window": 64, "top_k": args.top_k, "temperature_milli": args.temperature_milli,
              "initial_prompt_ids": prompt, "token_policy": "2 iff processed <= 26, otherwise 1; natural terminals end chunk; history never reset",
              "runs": [], "limitations": ["Offline integer reference is not an EVM gas measurement.",
                  "A 64-token attention window cannot guarantee long-range coherence.", "Sampled text does not establish 10000 distinct good sentences."]}
    models = [("tuned", tensors)]
    if not args.skip_baseline:
        models.insert(0, ("baseline", baseline_tensors()))
    parity = None
    for model_name, model_tensors in models:
        for seed, seed_draws in zip(seeds, draws):
            row, logits = generate(model_tensors, tokenizer, seed, seed_draws, args.tokens, prompt, args.top_k, args.temperature_milli)
            row["model"] = model_name
            row["every_step_logit_hash"] = logit_hashes(logits)
            result["runs"].append(row)
            if model_name == "baseline" and seed == 42 and prompt == [3] and args.top_k == 8 and args.temperature_milli == 800:
                frozen = json.loads((BASE / "optimization/varied-sentence/continuity/quality/relative64/relative64-policy26-2060turn-reference.json").read_text())
                assert row["generated_tokens"] == frozen["generated_tokens"][:args.tokens], "Independent implementation differs from frozen baseline"
                assert row["every_step_logit_hash"] == frozen["every_step_logit_hash"][:args.tokens], "Independent all4019-logit values differ from frozen baseline"
                parity = {"frozen_reference": "relative64-policy26-2060turn-reference.json", "seed": 42,
                          "generated_token_arrays_equal": True, "all4019_logits_equal_every_step": True, "tokens": args.tokens}
            print(json.dumps({"model": model_name, "seed": seed, "turns": row["turn_count"], "signed17_violations": row["q12_safety"]["linear_input_signed17_bound_violations"], "text": row["full_text"]}), flush=True)
    result["baseline_independent_parity"] = parity
    result["elapsed_seconds"] = round(time.monotonic() - start, 3)
    write_json(args.out / "q12-continuity-comparison.json", result)
    (args.out / "q12-transcripts.txt").write_text("\n\n".join(f"{row['model']} / seed {row['seed']}\n{row['full_text']}" for row in result["runs"]) + "\n")
    artifacts = {"status": "SKIPPED"} if args.skip_evm_artifacts else evm_artifacts(args.out, quantization)
    write_json(args.out / "evm-artifact-report.json", artifacts)
    print(json.dumps({"out": str(args.out), "elapsed_seconds": round(time.monotonic() - start, 3), "swar8_weights": quantization["swar8_signed12_compatible"], "evm_artifacts": artifacts}), flush=True)


if __name__ == "__main__":
    main()
