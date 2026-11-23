#!/usr/bin/env python3
"""Export and verify compact M-P1 weights, and rebuild the author's browser fixtures."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

REVISION = "b0ba29f8994082ab1af89351bcce9f2d86919269"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def pack_codes(values, bits):
    flat = values.astype(np.int16, copy=False).reshape(-1)
    shifted = (flat + (1 << (bits - 1))).astype(np.uint64)
    padded = np.pad(shifted, (0, -len(shifted) % 8))
    words = np.bitwise_or.reduce(padded.reshape(-1, 8) << (bits * np.arange(8, dtype=np.uint64)), axis=1)
    return ((words[:, None] >> (8 * np.arange(bits, dtype=np.uint64))) & 255).astype(np.uint8).tobytes()


def unpack_codes(blob, count, bits):
    bytes_by_word = np.frombuffer(blob, np.uint8, count=((count + 7) // 8) * bits).reshape(-1, bits).astype(np.uint64)
    words = np.bitwise_or.reduce(bytes_by_word << (8 * np.arange(bits, dtype=np.uint64)), axis=1)
    fields = ((words[:, None] >> (bits * np.arange(8, dtype=np.uint64))) & ((1 << bits) - 1)).reshape(-1)[:count]
    return fields.astype(np.int16) - (1 << (bits - 1))


def quantize(matrix, bits, block):
    rows, columns = matrix.shape
    groups_per_row = (columns + block - 1) // block
    groups = np.pad(matrix, ((0, 0), (0, groups_per_row * block - columns))).reshape(-1, block)
    negative = -(1 << (bits - 1))
    positive = (1 << (bits - 1)) - 1
    initial = np.maximum(-groups.min(axis=1) / -negative, groups.max(axis=1) / positive)
    initial = np.maximum(initial, np.finfo(np.float16).tiny)
    best_scales = np.empty(len(groups), np.float16)
    best_codes = np.empty(groups.shape, np.int8)
    minimum = np.full(len(groups), np.inf, np.float32)
    for factor in np.linspace(0.72, 1.08, 19, dtype=np.float32):
        scales = (initial * factor).astype(np.float16)
        f32 = scales.astype(np.float32)
        codes = np.clip(np.rint(groups / f32[:, None]), negative, positive).astype(np.int8)
        error = ((groups - codes * f32[:, None]) ** 2).sum(axis=1)
        improved = error < minimum
        minimum[improved] = error[improved]
        best_codes[improved] = codes[improved]
        best_scales[improved] = scales[improved]
    return best_codes.reshape(rows, -1)[:, :columns], best_scales.reshape(rows, -1).astype("<f2")


def append(blob, value, alignment=1):
    blob.extend(bytes(-len(blob) % alignment))
    offset = len(blob)
    blob.extend(value)
    return offset


def export(source, output, bits, block):
    output.mkdir(parents=True, exist_ok=True)
    meta = json.loads((source / "m-p1.json").read_text())
    upstream_blob = (source / "m-p1.bin").read_bytes()
    assert len(upstream_blob) == meta["bytes"]
    index = {record["name"]: record for record in meta["tensors"]}
    deltas = {}
    blob = bytearray()
    records = []
    for record in meta["tensors"]:
        name, dtype, shape = (record[key] for key in ("name", "dtype", "shape"))
        if name.endswith(".scale"):
            continue
        count = int(np.prod(shape))
        if dtype == "float32":
            value = upstream_blob[record["offset"]:record["offset"] + 4 * count]
            records.append({**record, "offset": append(blob, value, 4)})
            continue
        assert dtype == "int8" and len(shape) == 2
        rows, columns = shape
        scale_record = index[name + ".scale"]
        scales = np.frombuffer(upstream_blob, "<f4", count=rows, offset=scale_record["offset"])
        q8 = np.frombuffer(upstream_blob, np.int8, count=count, offset=record["offset"]).reshape(shape)
        original = q8.astype(np.float32) * scales[:, None]
        group_size = min(block, columns)
        codes, new_scales = quantize(original, bits, group_size)
        packed = pack_codes(codes, bits)
        restored = unpack_codes(packed, count, bits).reshape(shape)
        assert np.array_equal(restored, codes), f"Invalid bitstream for {name}"
        restored = restored * np.repeat(new_scales.astype(np.float32), group_size, axis=1)[:, :columns]
        error = np.linalg.norm(restored - original)
        original_norm = np.linalg.norm(original)
        deltas[name] = float(error / original_norm) if original_norm else 0.0
        records.append({
            "name": name, "shape": shape, "dtype": f"int{bits}",
            "offset": append(blob, packed), "length": len(packed), "group": group_size,
            "scaleOffset": append(blob, new_scales.tobytes(), 2), "scaleCount": int(new_scales.size),
        })

    vocab = json.loads((source / "vocab.json").read_text())
    words = sorted(vocab, key=vocab.__getitem__)
    assert [vocab[word] for word in words] == list(range(3, len(words) + 3))
    assert all("\0" not in word for word in words)
    words_bin = b"\0".join(word.encode() for word in words) + b"\0"
    (output / "vocab.bin").write_bytes(words_bin)
    (output / "palette.bin").write_bytes((source / "palette.bin").read_bytes())
    (output / "m-p1.bin").write_bytes(blob)
    write_json(output / "m-p1.json", {
        **meta, "format": "gh0st-mp1-qpack-v1", "group": block, "bits": bits,
        "bytes": len(blob), "tensors": records, "vocabBaseId": 3,
    })
    components = {
        path.name: {"bytes": path.stat().st_size, "sha256": sha256(path.read_bytes())}
        for path in sorted(output.glob("*")) if path.name in {"m-p1.bin", "m-p1.json", "vocab.bin", "palette.bin"}
    }
    package = sum(entry["bytes"] for entry in components.values())
    assert 2_000_000 <= package <= 3_000_000, f"Package is {package} bytes"
    write_json(output / "manifest.json", {
        "upstream": "https://github.com/AnticPan/mini-pixel-art",
        "revision": REVISION, "checkpoint": meta["source_ckpt"], "step": meta["step"],
        "upstreamWeightBytes": len(upstream_blob), "upstreamWeightSha256": sha256(upstream_blob),
        "runtimePackageBytes": package, "components": components, "format": "gh0st-mp1-qpack-v1",
        "bits": bits, "group": block, "relativeFrobeniusError": deltas,
    })
    print(f"Q{bits} group {block}: {package:,} bytes ({len(blob):,} weight blob)")


def rebuild(source, output):
    models = output / "models"
    models.mkdir(parents=True, exist_ok=True)
    meta = json.loads((source / "m-p1.json").read_text())
    blob = (source / "m-p1.bin").read_bytes()
    assert len(blob) == meta["bytes"]
    rebuilt = bytearray()
    records = []
    for record in meta["tensors"]:
        shape = record["shape"]
        count = int(np.prod(shape))
        offset = record["offset"]
        if record["dtype"] == "float32":
            values = blob[offset:offset + 4 * count]
        else:
            bits = int(record["dtype"][3:])
            rows, columns = shape
            scales = np.frombuffer(blob, "<f2", count=record["scaleCount"], offset=record["scaleOffset"]).reshape(rows, -1)
            codes = unpack_codes(blob[offset:offset + record["length"]], count, bits).reshape(shape)
            row_scale = np.repeat(scales.astype(np.float32), record["group"], axis=1)[:, :columns]
            values = (codes * row_scale).astype("<f4").tobytes()
        records.append({
            "name": record["name"], "dtype": "float32", "shape": shape,
            "offset": append(rebuilt, values, 4),
        })
    (models / "m-p1.bin").write_bytes(rebuilt)
    (models / "palette.bin").write_bytes((source / "palette.bin").read_bytes())
    words = (source / "vocab.bin").read_bytes().removesuffix(b"\0").split(b"\0")
    write_json(models / "vocab.json", {word.decode(): meta["vocabBaseId"] + index for index, word in enumerate(words)})
    write_json(models / "models.json", ["m-p1"])
    write_json(models / "m-p1.json", {**meta, "tensors": records, "bytes": len(rebuilt)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bits", choices=(4, 5), type=int, default=5)
    parser.add_argument("--group", type=int, default=192)
    parser.add_argument("--rebuild", action="store_true")
    args = parser.parse_args()
    if args.rebuild:
        rebuild(args.source, args.output)
    else:
        assert args.group > 0
        export(args.source, args.output, args.bits, args.group)


if __name__ == "__main__":
    main()
