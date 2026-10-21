"""Inspect and losslessly compress pinned, publisher-provided GGUF checkpoints.

No training, pruning, inference, transaction submission, or weight redistribution.
Downloaded checkpoint files stay outside the deliverable directory.
"""
import argparse
import bz2
import concurrent.futures
import hashlib
import json
import math
import struct
import time
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = "tiiuae/Falcon-H1-Tiny-90M-Instruct-GGUF"
REVISION = "578d134817c19bc48991ccff9a14709d664261cc"
FILES = {
    "IQ2_M": (12668800, "241bca6aae585d6cd6ad1e0f66807a42114e30d39487840c4eb08f31930043d8"),
    "Q4_K_M": (58600064, "e7d655345a876ecb073ea86f5ce68e412b99090c34a6bde8a2982bc48afb2612"),
    "Q8_0": (98353792, "e60034381f4a0e448a5e6fdab29d7b40768a587c9a56e4cf85285455ba65d476"),
}


def inspect_gguf(blob):
    pos = 0

    def read(fmt):
        nonlocal pos
        out = struct.unpack_from("<" + fmt, blob, pos)
        pos += struct.calcsize("<" + fmt)
        return out[0] if len(out) == 1 else out

    def string():
        nonlocal pos
        n = read("Q")
        if pos + n > len(blob):
            raise ValueError("Truncated GGUF string")
        out = blob[pos:pos+n].decode("utf-8", errors="strict")
        pos += n
        return out

    def value(kind):
        if kind == 8:
            return string()
        if kind == 9:
            typ, n = read("I"), read("Q")
            return [value(typ) for _ in range(n)]
        return read({0:"B", 1:"b", 2:"H", 3:"h", 4:"I", 5:"i", 6:"f", 7:"?", 10:"Q", 11:"q", 12:"d"}[kind])

    if blob[:4] != b"GGUF":
        raise ValueError("Not GGUF")
    pos = 4
    version, n_tensors, n_meta = read("I"), read("Q"), read("Q")
    if version not in (2, 3):
        raise ValueError("Unsupported GGUF version")
    metadata = {}
    for _ in range(n_meta):
        key = string()
        metadata[key] = value(read("I"))
    tensors = []
    for _ in range(n_tensors):
        name, n_dims = string(), read("I")
        shape = [read("Q") for _ in range(n_dims)]
        typ, offset = read("I"), read("Q")
        tensors.append({"name": name, "shape": shape, "elements": math.prod(shape), "type": typ, "offset": offset})
    alignment = metadata.get("general.alignment", 32)
    start = math.ceil(pos/alignment)*alignment
    # Sorted offsets yield physical spans without assuming quantization block sizes.
    ordered = sorted(tensors, key=lambda x:x["offset"])
    for i, tensor in enumerate(ordered):
        end = ordered[i+1]["offset"] if i+1 < len(ordered) else len(blob)-start
        if tensor["offset"] < 0 or end < tensor["offset"] or start+end > len(blob):
            raise ValueError("Invalid tensor offset")
        tensor["physical_span_bytes"] = end - tensor["offset"]
    return {
        "version": version, "tensor_count": n_tensors,
        "tensor_elements": sum(t["elements"] for t in tensors),
        "tensor_data_offset": start, "tensor_data_bytes": len(blob)-start,
        "architecture": metadata.get("general.architecture"),
        "declared_file_type": metadata.get("general.file_type"),
        "vocabulary_entries": len(metadata.get("tokenizer.ggml.tokens", [])),
        "tensors": tensors,
    }


def measure(fmt, cache):
    expected_size, expected_sha = FILES[fmt]
    name = "Falcon-H1-Tiny-90M-Instruct-"+fmt+".gguf"
    path = cache/name
    if not path.exists():
        url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
        tmp = path.with_suffix(".part")
        with urllib.request.urlopen(url, timeout=120) as response, tmp.open("wb") as out:
            while chunk := response.read(1024*1024):
                out.write(chunk)
        tmp.replace(path)
    blob = path.read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    assert len(blob) == expected_size and digest == expected_sha, "Upstream checkpoint integrity mismatch"
    try:
        inventory = inspect_gguf(blob)
    except (ValueError, struct.error, KeyError, UnicodeDecodeError) as exc:
        return {"format":fmt,"repo":REPO,"revision":REVISION,"filename":name,
            "sha256":digest,"bytes":len(blob),"valid_gguf":False,
            "rejection_reason":str(exc),"first_16_bytes_hex":blob[:16].hex(),
            "excluded_from_cost_comparison":True}
    (ROOT/(fmt.lower()+"-inventory.json")).write_text(json.dumps(inventory, indent=2)+"\n")
    complete = inventory["tensor_elements"] == 91131072
    print(json.dumps({"downloaded":fmt,"bytes":len(blob),"tensor_elements":inventory["tensor_elements"],"expected_parameter_count_matches":complete}),flush=True)
    compression = []
    # Tensor payload separately avoids attributing tokenizer/header compression to weights.
    for scope, data in [("full_file", blob), ("tensor_payload",blob[inventory["tensor_data_offset"]:])]:
        for codec, compress, decompress in [("zlib-9", lambda x:zlib.compress(x,9),zlib.decompress), ("bzip2-9",lambda x:bz2.compress(x,compresslevel=9),bz2.decompress)]:
            began = time.monotonic()
            packed = compress(data)
            assert decompress(packed) == data
            compression.append({"scope":scope,"codec":codec,"input_bytes":len(data),"compressed_bytes":len(packed),"ratio":len(packed)/len(data),"code_deposit_gas_only":len(packed)*200,"roundtrip_exact":True,"wall_seconds":time.monotonic()-began})
    return {"format":fmt,"repo":REPO,"revision":REVISION,"filename":name,"sha256":digest,"bytes":len(blob),"valid_gguf":True,"inventory":{k:v for k,v in inventory.items() if k != "tensors"},"expected_parameter_count_matches":complete,"compression":compression}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True, type=Path)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    report = {"status":"running", "model_parameters":91131072,"training_performed":False,"inference_quality_tested":False,"public_transactions_broadcast":0,
        "scope":"Compression measurements and code-storage arithmetic; no EVM decompressor implemented or benchmarked.",
        "code_storage_budget_bytes":{str(gas):gas//200 for gas in [1000000,10000000,100000000,999000000]},"files":[]}
    def save():
        (ROOT/"weight-cost-results.json").write_text(json.dumps(report,indent=2)+"\n")
    save()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pending = {pool.submit(measure,fmt,args.cache):fmt for fmt in FILES}
        for future in concurrent.futures.as_completed(pending):
            try:
                result=future.result()
                report["files"].append(result)
                print(json.dumps({"measured":result["format"],"valid_gguf":result["valid_gguf"],"compression":result.get("compression"),"rejection_reason":result.get("rejection_reason")}),flush=True)
            except Exception as exc:
                report.setdefault("errors",[]).append({"format":pending[future],"error":repr(exc)})
            save()
    report["status"]="completed" if not report.get("errors") else "partial"
    save()


if __name__ == "__main__":
    main()
