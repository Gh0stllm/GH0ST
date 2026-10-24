"""Re-encode unchanged Q12 weights for exact EVM lane multiplication.

The new representation changes no numerical tensor or inference equation.
Run offline from any directory. No RPC, wallets, or public services are used.
"""
from __future__ import annotations

import hashlib
import json
import argparse
from pathlib import Path
import random
import shutil

BASE = Path(__file__).resolve().parents[2]
OUT = BASE / "optimization/kernel/model"
MASK256 = (1 << 256) - 1


def pack_weights(values, lanes=5, bits=51, bias=32768):
    return sum((int(w) + bias) << (bits * i) for i, w in enumerate(values))


def packed_dot(weights, inputs, lanes=5, bits=51, wbias=32768, xbias=1 << 31):
    """Emulate unsigned EVM MUL modulo 2**256, then recover signed dot."""
    n = ((len(weights) + lanes - 1) // lanes) * lanes
    ws = list(weights) + [0] * (n - len(weights))
    xs = list(inputs) + [0] * (n - len(inputs))
    total = 0
    for off in range(0, n, lanes):
        a = pack_weights(ws[off:off + lanes], lanes, bits, wbias)
        x = sum((int(xs[off + lanes - 1 - i]) + xbias) << (bits * i) for i in range(lanes))
        product = (a * x) & MASK256
        total += (product >> ((lanes - 1) * bits)) & ((1 << bits) - 1)
    return total - wbias * sum(inputs) - xbias * sum(weights) - n * wbias * xbias


def proof():
    rng = random.Random(20261024)
    digest = hashlib.sha256()
    count = 0
    for lanes, bits, wbias, xbias in [(5, 51, 32768, 1 << 31), (8, 32, 2048, 65536)]:
        for n in [1, 2, 4, 5, 6, 7, 8, 9, 16, 127, 128, 129, 340, 341]:
            for case in range(64):
                ws = [rng.randrange(-wbias, wbias) for _ in range(n)]
                xs = [rng.randrange(-xbias, xbias) for _ in range(n)]
                if case < 8:
                    ws = [[-wbias, wbias - 1, 0, -1][(i + case) % 4] for i in range(n)]
                    xs = [[-xbias, xbias - 1, 0, -1][(i * 3 + case // 2) % 4] for i in range(n)]
                expected = sum(w * x for w, x in zip(ws, xs))
                actual = packed_dot(ws, xs, lanes, bits, wbias, xbias)
                assert actual == expected, (lanes, n, case, actual, expected)
                digest.update(f"{lanes}:{n}:{case}:{actual}\n".encode())
                count += 1
    return {"cases": count, "passed": count, "sha256": digest.hexdigest(),
            "includes": "padded lengths, signed extremes, random full-range inputs, actual EVM 256-bit multiplication truncation",
            "swar5": {"lanes": 5, "radix_bits": 51, "weight_bias": 32768, "activation_bias": 1 << 31,
                      "maximum_middle_coefficient": 5 * 65535 * ((1 << 32) - 1), "radix": 1 << 51},
            "swar8": {"lanes": 8, "radix_bits": 32, "weight_bias": 2048, "activation_bias": 65536,
                      "maximum_middle_coefficient": 8 * 4095 * 131071, "radix": 1 << 32}}


def main(lanes=5):
    bits, wbias, xbias = (51, 32768, 1 << 31) if lanes == 5 else (32, 2048, 65536)
    out = OUT if lanes == 5 else BASE / "optimization/kernel8/model"
    out.mkdir(parents=True, exist_ok=True)
    source = (BASE / "model/weights.bin").read_bytes()
    original_manifest = json.loads((BASE / "model/manifest.json").read_text())
    protocol = json.loads((BASE / "contracts/protocol.json").read_text())
    entries = protocol["weights"]["tensor_layout"]
    data = bytearray()
    mapping = {"schema_version": 1, "format": f"swar{lanes}", "lanes": lanes, "radix_bits": bits,
               "weight_bias": wbias, "activation_bias": xbias, "matrices": {}, "norms": {}, "layers": []}
    rows_checked = 0
    maximum_weight = 0
    rng = random.Random(2026102401)

    def raw(entry):
        start = entry["byte_offset"]
        return source[start:start + entry["elements"] * 2]

    def matrix(entry):
        nonlocal rows_checked, maximum_weight
        rows, columns = entry["shape"]
        groups = (columns + lanes - 1) // lanes
        stride = (groups + 1) * 32
        start = len(data)
        values = raw(entry)
        for r in range(rows):
            original = [int.from_bytes(values[(r * columns + c) * 2:(r * columns + c) * 2 + 2], "big", signed=True)
                        for c in range(columns)]
            maximum_weight = max(maximum_weight, max(map(abs, original)))
            assert all(-wbias <= w < wbias for w in original)
            padded = original + [0] * (groups * lanes - columns)
            for at in range(0, len(padded), lanes):
                word = pack_weights(padded[at:at + lanes], lanes, bits, wbias)
                data.extend(word.to_bytes(32, "big"))
                recovered = [((word >> (i * bits)) & (2 * wbias - 1)) - wbias for i in range(lanes)]
                assert recovered == padded[at:at + lanes]
            data.extend(sum(original).to_bytes(32, "big", signed=True))
            inputs = [rng.randrange(-xbias, xbias) for _ in range(columns)]
            assert packed_dot(original, inputs, lanes, bits, wbias, xbias) == sum(w * x for w, x in zip(original, inputs))
            rows_checked += 1
        mapping["matrices"][str(entry["byte_offset"])] = {
            "name": entry["name"], "original_offset": entry["byte_offset"], "offset": start,
            "length": len(data) - start, "rows": rows, "columns": columns,
            "groups": groups, "padded_columns": groups * lanes, "row_stride": stride,
            "row_sum_offset": groups * 32,
        }

    embed = entries[0]
    mapping["raw_embedding"] = {"offset": len(data), "length": len(raw(embed)), "rows": 4019, "columns": 128}
    data.extend(raw(embed))
    for layer in range(4):
        start = len(data)
        for entry in entries:
            if not entry["name"].startswith(f"model.layers.{layer}."):
                continue
            if len(entry["shape"]) == 2:
                matrix(entry)
            else:
                mapping["norms"][str(entry["byte_offset"])] = {"name": entry["name"], "offset": len(data), "length": len(raw(entry))}
                data.extend(raw(entry))
        mapping["layers"].append({"layer": layer, "offset": start, "length": len(data) - start})
    final = entries[-1]
    mapping["norms"][str(final["byte_offset"])] = {"name": final["name"], "offset": len(data), "length": len(raw(final))}
    data.extend(raw(final))
    matrix(embed)
    for matrix_info in mapping["matrices"].values():
        for layer in mapping["layers"]:
            if layer["offset"] <= matrix_info["offset"] < layer["offset"] + layer["length"]:
                matrix_info["layer_offset"] = matrix_info["offset"] - layer["offset"]
    for norm in mapping["norms"].values():
        for layer in mapping["layers"]:
            if layer["offset"] <= norm["offset"] < layer["offset"] + layer["length"]:
                norm["layer_offset"] = norm["offset"] - layer["offset"]

    (out / "weights.bin").write_bytes(data)
    shutil.copyfile(BASE / "model/tables.bin", out / "tables.bin")
    mapping["weight_bytes"] = len(data)
    (out / "packed_offsets.json").write_text(json.dumps(mapping, indent=2) + "\n")
    checks = proof()
    checks["actual_weight_rows_recovered_exactly"] = rows_checked
    checks[f"actual_rows_full_int{32 if lanes == 5 else 17}_random_dot_passed"] = rows_checked
    checks["maximum_actual_matrix_weight_absolute"] = maximum_weight
    checks["source_weights_sha256"] = hashlib.sha256(source).hexdigest()
    (BASE / f"optimization/design/packing-proof{'-swar8' if lanes == 8 else ''}.json").write_text(json.dumps(checks, indent=2) + "\n")
    manifest = {**original_manifest,
                "model_hash_domain": f"GH0ST_SIMPLESTORIES_V2_Q12_SWAR{lanes}_CTX16_V1",
                "storage_format": f"{lanes} biased weights in radix-2**{bits} lanes per 256-bit word; signed int256 row sum after each row; raw int16 embeddings and norm vectors",
                "source_weights_sha256": hashlib.sha256(source).hexdigest(),
                "unique_model_parameters": original_manifest["parameters"],
                "packed_duplicate_storage_parameters": "Storage duplication only; every numerical tensor is unchanged",
                "packing_checks": checks,
                "artifacts": {name: {"bytes": (out / name).stat().st_size,
                                     "sha256": hashlib.sha256((out / name).read_bytes()).hexdigest()}
                              for name in ["weights.bin", "tables.bin"]}}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"artifacts": manifest["artifacts"], "rows_checked": rows_checked,
                      "max_matrix_weight_abs": maximum_weight, "proof_cases": checks["cases"],
                      "layers": mapping["layers"], "head": mapping["matrices"]["0"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lanes", type=int, choices=[5, 8], default=5)
    main(parser.parse_args().lanes)
