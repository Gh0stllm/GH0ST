"""Derive exact SIMD11 runtime data from accepted immutable Q10 weights.

Local research only. No training, quantization, weight changes, or RPC calls.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[1] / "voice-v8/exports/grammar4m"
OUT = HERE / "simd11"
LANES, BITS, WIDTH = 11, 23, 384
WORDS = (WIDTH + LANES - 1) // LANES
PACKED_BYTES = WORDS * 32
MASK = (1 << BITS) - 1
sha = lambda data: hashlib.sha256(data).hexdigest()


def derive_rows(matrix, bias=None):
    rows = bytearray()
    worst = 0
    for row_index, raw_row in enumerate(matrix):
        row = [int(v) for v in raw_row]
        offset = -min(row)
        assert all(v + offset >= 0 for v in row)
        for start in range(0, WIDTH, LANES):
            chunk = row[start:start + LANES]
            shifted = [v + offset for v in chunk] + [0] * (LANES - len(chunk))
            bound = 2048 * sum(shifted)
            worst = max(worst, bound)
            # Every lower product coefficient is a subset of these nonnegative
            # weights, multiplied by values in [0, 2048]. This also bounds all
            # lower coefficients and therefore forbids carry contamination.
            assert bound < (1 << BITS), (row_index, start, bound)
            packed = sum(v << ((LANES - 1 - i) * BITS) for i, v in enumerate(shifted))
            assert packed < (1 << 256)
            decoded = [(packed >> ((LANES - 1 - i) * BITS)) & MASK for i in range(LANES)]
            assert decoded == shifted
            assert [value - offset for value in decoded[:len(chunk)]] == chunk
            rows.extend(packed.to_bytes(32, "big"))
        rows.extend(sum(row).to_bytes(32, "big", signed=True))
        rows.extend(offset.to_bytes(32, "big", signed=True))
        if bias is not None:
            rows.extend(int(bias[row_index]).to_bytes(32, "big", signed=True))
    return bytes(rows), worst


def packed_dot(row_blob, vector):
    packed_sum = 0
    for i in range(WORDS):
        part = [int(x) + 1024 for x in vector[i * LANES:(i + 1) * LANES]]
        part.extend([0] * (LANES - len(part)))
        values = sum(v << (j * BITS) for j, v in enumerate(part))
        weights = int.from_bytes(row_blob[i * 32:(i + 1) * 32], "big")
        product = (values * weights) & ((1 << 256) - 1)
        packed_sum += (product >> ((LANES - 1) * BITS)) & MASK
    weight_sum = int.from_bytes(row_blob[1120:1152], "big", signed=True)
    offset = int.from_bytes(row_blob[1152:1184], "big", signed=True)
    return packed_sum - offset * sum(int(v) + 1024 for v in vector) - 1024 * weight_sum


def main():
    global SOURCE, OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE if SOURCE.exists() else HERE / "baseline-restored")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    SOURCE, OUT = args.source, args.out
    source_manifest = json.loads((SOURCE / "manifest.json").read_text())
    assert source_manifest["checkpoint_sha256"] == "904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3"
    assert sha((SOURCE / "reference.npz").read_bytes()) == "9e7cfa1b40330a69fbc1b5278fafa51a151d9fcd94e8f12273f385a50b578c0d"
    OUT.mkdir(parents=True, exist_ok=True)
    q = np.load(SOURCE / "reference.npz")
    matrices = {
        "core.bin": (np.concatenate([q["wh1"], q["wx2"], q["wh2"]]), None),
        "groups.bin": (q["groups.weight"], q["group_bias.weight"][:, 0]),
        "words.bin": (q["words.weight"], q["word_bias.weight"][:, 0]),
        "punctuation.bin": (q["punct_head.weight"], q["punct_bias"]),
    }
    report = {"status": "RUNNING", "local_only": True, "mainnet_actions": 0,
              "source_reference_sha256": sha((SOURCE / "reference.npz").read_bytes()),
              "lanes": LANES, "lane_bits": BITS, "words_per_row": WORDS,
              "packed_row_bytes": PACKED_BYTES, "core_stride": 1184, "head_stride": 1216,
              "hidden_inclusive_bounds": [-1024, 1024], "matrices": {}}
    rng = np.random.default_rng(824721)
    vectors = [np.zeros(WIDTH, dtype=np.int64), np.full(WIDTH, -1024, dtype=np.int64),
               np.full(WIDTH, 1024, dtype=np.int64), np.tile([-1024, 1024], WIDTH // 2),
               *[rng.integers(-1024, 1025, WIDTH, dtype=np.int64) for _ in range(4)]]
    for filename, (matrix, bias) in matrices.items():
        matrix = matrix.astype(np.int64)
        data, worst = derive_rows(matrix, bias)
        stride = 1184 if bias is None else 1216
        for vector in vectors:
            expected = matrix @ vector
            for i, value in enumerate(expected):
                actual = packed_dot(data[i * stride:(i + 1) * stride], vector)
                assert actual == int(value), (filename, i, actual, int(value))
        report["matrices"][filename] = {"rows": len(matrix), "minimum": int(matrix.min()),
            "maximum": int(matrix.max()), "max_coefficient_bound": worst,
            "coefficient_limit_exclusive": 1 << BITS, "row_vector_parity_cases": len(matrix) * len(vectors)}
        if filename == "core.bin":
            data += (SOURCE / filename).read_bytes()[5419008:]
        if filename == "punctuation.bin":
            data += (SOURCE / filename).read_bytes()[8000:]
        (OUT / filename).write_bytes(data)
    for name in ["fused.bin", "vocabulary.bin", "vocabulary.json", "sigmoid-delta.bin", "exp-q32.bin", "reference.npz"]:
        shutil.copyfile(SOURCE / name, OUT / name)
    source = (SOURCE / "GRU2SIMDModel.sol").read_text()
    source = source.replace("CORE_BYTES=5435136", "CORE_BYTES=4108032")
    source = source.replace("GROUP_BYTES=204800", "GROUP_BYTES=155648")
    source = source.replace("WORD_BYTES=13107200", "WORD_BYTES=9961472")
    source = source.replace("PUNCTUATION_BYTES=118720", "PUNCTUATION_BYTES=116800")
    source = source.replace("CORE_STRIDE=1568;uint256 constant HEAD_STRIDE=1600;uint256 constant CORE_MATRICES=5419008;uint256 constant PUNCT_FOLD=89920", "CORE_STRIDE=1184;uint256 constant HEAD_STRIDE=1216;uint256 constant CORE_MATRICES=4091904;uint256 constant PUNCT_FOLD=88000")
    source = source.replace('"GH0ST_GRU2_SIMD8_H384_Q10_LOCAL_V1"', '"GH0ST_GRU2_SIMD11_H384_Q10_LOCAL_V1"')
    start = source.index(" function _prepare(")
    end = source.index(" function _headBias(", start)
    source = source[:start] + ''' function _prepare(int16[768] memory v,uint256 offset)private pure returns(bytes memory packedVector,int256 shiftedSum){packedVector=new bytes(1120);
  assembly("memory-safe"){for{let group:=0}lt(group,35){group:=add(group,1)}{let packedValue:=0 for{let j:=0}lt(j,11){j:=add(j,1)}{let i:=add(mul(group,11),j) if lt(i,384){let value:=add(signextend(1,mload(add(v,shl(5,add(offset,i))))),1024) shiftedSum:=add(shiftedSum,value) packedValue:=or(packedValue,shl(mul(j,23),value))}}mstore(add(add(packedVector,32),mul(group,32)),packedValue)}}}
 function _dot(address catalog,uint256 row,uint256 stride,bytes memory buffer,bytes memory vector,int256 shiftedSum)private view returns(int256 sum){_readInto(catalog,row*stride,stride,buffer);
  assembly("memory-safe"){let weights:=add(buffer,32)let values:=add(vector,32)
   for{let at:=0}lt(at,1120){at:=add(at,32)}{sum:=add(sum,and(shr(230,mul(mload(add(values,at)),mload(add(weights,at)))),0x7fffff))}
   sum:=sub(sub(sum,mul(mload(add(weights,1152)),shiftedSum)),mul(1024,mload(add(weights,1120))))}}
''' + source[end:]
    source = source.replace("mload(add(add(d,32),1568))", "mload(add(add(d,32),1184))")
    source = source.replace("_read(punctuationCatalog,8000+uint256(token)*10,10)", "_read(punctuationCatalog,6080+uint256(token)*10,10)")
    (OUT / "GRU2SIMDModel.sol").write_text(source)
    shutil.copyfile(SOURCE / "GRU2SIMDHook.sol", OUT / "GRU2SIMDHook.sol")
    manifest = json.loads((SOURCE / "manifest.json").read_text())
    manifest.update({"scope": "Exact SIMD11 derived runtime; accepted Q10 source weights unchanged; local only", "model_domain": "GH0ST_GRU2_SIMD11_H384_Q10_LOCAL_V1", "source_sha256": sha(source.encode()), "packing": "11 unsigned23 lanes with per-row minimum offset; exact fullsum correction", "reference_sha256": report["source_reference_sha256"]})
    manifest["artifacts"] = {p.name: {"bytes": p.stat().st_size, "sha256": sha(p.read_bytes())} for p in OUT.iterdir() if p.is_file() and p.suffix in [".bin", ".json"] and p.name != "manifest.json"}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    report["status"] = "PASS"
    report["source_model_weights_changed"] = False
    report["total_row_vector_parity_cases"] = sum(x["row_vector_parity_cases"] for x in report["matrices"].values())
    report["max_coefficient_bound"] = max(x["max_coefficient_bound"] for x in report["matrices"].values())
    report["artifacts"] = manifest["artifacts"]
    (HERE / "packing-proof.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ["status", "total_row_vector_parity_cases", "max_coefficient_bound", "source_model_weights_changed"]}))


if __name__ == "__main__":
    main()
