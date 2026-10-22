"""Download bounded, revision-pinned metadata and real MXFP4 rows; never full weights."""
import hashlib
import json
import pathlib
import struct
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "evidence"
OUT.mkdir(exist_ok=True)
MODEL = "openai/gpt-oss-20b"


def fetch(url, start=None, end=None, cap=2_000_000):
    headers = {"User-Agent": "GH0ST-bounded-model-research/1.0"}
    if start is not None:
        headers["Range"] = f"bytes={start}-{end}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=45) as response:
        if start is not None:
            assert response.status == 206, "Server ignored range; refusing full checkpoint"
            content_range = response.headers.get("Content-Range", "")
            assert content_range.startswith(f"bytes {start}-{end}/"), content_range
        result = response.read(cap + 1)
        assert len(result) <= cap, "Bounded download exceeded cap"
        if start is not None:
            assert len(result) == end - start + 1
        return result


def save(name, obj):
    (OUT / name).write_text(json.dumps(obj, indent=2) + "\n")


api = json.loads(fetch(f"https://huggingface.co/api/models/{MODEL}"))
revision = api["sha"]
base = f"https://huggingface.co/{MODEL}/resolve/{revision}/"
config = json.loads(fetch(base + "config.json"))
index = json.loads(fetch(base + "model.safetensors.index.json"))
save("config.json", config)
save("index.json", index)
headers = {}
for name in sorted(set(index["weight_map"].values())):
    # Distinct query strings prevent an HTTP intermediary reusing a prior range.
    first = fetch(base + name + "?range=prefix", 0, 7, cap=8)
    length = struct.unpack("<Q", first)[0]
    assert 0 < length < 2_000_000
    raw = fetch(base + name + "?range=header", 8, 7 + length)
    headers[name] = {"header_length": length, "tensors": json.loads(raw),
                     "header_sha256": hashlib.sha256(raw).hexdigest()}
    print(f"Read {name}: {length} header bytes", flush=True)
save("headers.json", headers)

entries = {}
for filename, header in headers.items():
    for key, tensor in header["tensors"].items():
        if key != "__metadata__":
            entries[key] = (filename, tensor)

block_key = next(key for key in sorted(entries)
                 if key.startswith("model.layers.0.") and "gate_up_proj_blocks" in key)
scale_key = block_key.replace("_blocks", "_scales")
filename, blocks = entries[block_key]
scale_filename, scales = entries[scale_key]
assert blocks["shape"][-1] == 16 and blocks["dtype"] == "U8"
assert scales["shape"] == blocks["shape"][:-1] and scales["dtype"] == "U8"
groups = config["hidden_size"] // 32
count = 4 * groups


def tensor_prefix(filename, tensor, size, tag):
    assert tensor["data_offsets"][1] - tensor["data_offsets"][0] >= size
    start = 8 + headers[filename]["header_length"] + tensor["data_offsets"][0]
    return fetch(base + filename + f"?range={tag}", start, start + size - 1, cap=size)


sample_blocks = tensor_prefix(filename, blocks, count * 16, "sample-blocks")
sample_scales = tensor_prefix(scale_filename, scales, count, "sample-scales")
save("sample.json", {"model": MODEL, "revision": revision, "tensor": block_key,
     "scale_tensor": scale_key, "rows": 4, "groups_per_row": groups,
     "block_hex": sample_blocks.hex(), "scale_hex": sample_scales.hex(),
     "block_sha256": hashlib.sha256(sample_blocks).hexdigest(),
     "scale_sha256": hashlib.sha256(sample_scales).hexdigest(),
     "activation_source": "deterministic synthetic signed-int16 vectors; not model activations"})

sizes = {}
for key, (_, tensor) in entries.items():
    kind = "expert_blocks" if key.endswith("_blocks") else "expert_scales" if key.endswith("_scales") else "other"
    sizes[kind] = sizes.get(kind, 0) + tensor["data_offsets"][1] - tensor["data_offsets"][0]
total = sum(sizes.values())
assert total == index["metadata"]["total_size"]
save("inventory.json", {"model": MODEL, "revision": revision, "tensor_count": len(entries),
     "tensor_payload_bytes": total, "payload_categories_bytes": sizes,
     "hypothetical_code_shards_at_24575_data_bytes": (total + 24574) // 24575,
     "code_deposit_gas_only_at_200_per_byte": total * 200,
     "projection_warning": "Conditional EIP-170 size assumption; not measured deployment gas or a Robinhood limit check. Excludes init/transaction overhead.",
     "downloaded_sample_weight_bytes": len(sample_blocks) + len(sample_scales),
     "scale_min": min(sample_scales), "scale_max": max(sample_scales),
     "full_model_loaded": False, "model_quality_evaluated": False})
print(json.dumps({"revision": revision, "payload_bytes": total, "sample_bytes": count * 17,
                  "scale_range": [min(sample_scales), max(sample_scales)]}), flush=True)
