"""Exact weight-storage experiments; no training, no remote RPC.

Input is the pinned original BF16 safetensors, not a lossy export. Large binary
outputs stay in --cache and are not included in the distributable project.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import struct
import time
from pathlib import Path

import numpy as np
import zstandard as zstd

ROOT = Path(__file__).resolve().parent
PIN = "199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578"


def original(path):
    data = path.read_bytes()
    assert hashlib.sha256(data).hexdigest() == PIN
    length = int.from_bytes(data[:8], "little")
    header = json.loads(data[8:8+length])
    tensors = {k:v for k,v in header.items() if k != "__metadata__"}
    assert all(v["dtype"] == "BF16" for v in tensors.values())
    return data[8+length:], tensors


def entropy(a, bins):
    counts = np.bincount(a.astype(np.int64), minlength=bins)
    p = counts[counts > 0] / len(a)
    return float(-(p*np.log2(p)).sum())


def split(raw):
    u = np.frombuffer(raw, dtype="<u2")
    exponent = ((u >> 7) & 255).astype(np.uint8)
    sm = (((u >> 8) & 128) | (u & 127)).astype(np.uint8)
    return exponent, sm


def join(exponent, sm):
    return (((sm.astype(np.uint16) & 128) << 8) |
            (exponent.astype(np.uint16) << 7) | (sm & 127)).astype("<u2").tobytes()


def top7_encode(raw):
    """Independent block: count:u32be, book:7B, escapes:u32be, sm, codes, literals.
    Codes are three-bit, most significant bit first; code 7 consumes a literal.
    """
    exponent, sm = split(raw)
    book = np.argsort(-np.bincount(exponent, minlength=256), kind="stable")[:7].astype(np.uint8)
    lookup = np.full(256, 7, dtype=np.uint8)
    lookup[book] = np.arange(7, dtype=np.uint8)
    codes = lookup[exponent]
    packed = np.packbits(((codes[:, None] >> np.array([2,1,0], dtype=np.uint8)) & 1).reshape(-1)).tobytes()
    escapes = exponent[codes == 7].tobytes()
    return struct.pack(">I", len(sm)) + book.tobytes() + struct.pack(">I", len(escapes)) + sm.tobytes() + packed + escapes


def top7_decode(blob):
    n = int.from_bytes(blob[:4], "big")
    book = np.frombuffer(blob[4:11], dtype=np.uint8)
    ne = int.from_bytes(blob[11:15], "big")
    cbytes = (n*3+7)//8
    assert len(blob) == 15+n+cbytes+ne
    sm = np.frombuffer(blob[15:15+n], dtype=np.uint8)
    bits = np.unpackbits(np.frombuffer(blob[15+n:15+n+cbytes], dtype=np.uint8))[:n*3].reshape(n,3)
    codes = bits @ np.array([4,2,1], dtype=np.uint8)
    exponents = np.append(book, np.uint8(0))[codes]
    assert np.count_nonzero(codes == 7) == ne
    exponents[codes == 7] = np.frombuffer(blob[15+n+cbytes:], dtype=np.uint8)
    return join(exponents, sm)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--original", type=Path, required=True)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--reuse-compressed", action="store_true", help="Reverify existing general-codec streams instead of recompressing")
    args = p.parse_args(); args.cache.mkdir(parents=True, exist_ok=True)
    raw, tensors = original(args.original)
    raw_hash=hashlib.sha256(raw).hexdigest()
    assert raw_hash=="95876b28e73b84d94206540f30d58643ab7a45121ebb6ab6356126a25eb25a33"
    u = np.frombuffer(raw, dtype="<u2")
    report = {"model":"tiiuae/Falcon-H1-Tiny-90M-Instruct", "revision":"e6389502a0b12cd8da894b395ba5bf7436873b16",
              "source_sha256":PIN, "tensor_count":len(tensors), "parameters":len(u), "payload_bytes":len(raw),
              "scope":"Only tensor bytes. No tokenizer, runtime, index, L1 data fee or inference cost included.",
              "versions":{k:importlib.metadata.version(k) for k in ["numpy","zstandard","zipnn"]}, "experiments":[]}
    def save(): (ROOT/"lossless-results.json").write_text(json.dumps(report, indent=2)+"\n")
    def record(name, blob, recovered, elapsed, extra=None):
        assert hashlib.sha256(raw).hexdigest()==raw_hash, "Reference buffer was modified"
        assert recovered == raw, name
        (args.cache/(name+".bin")).write_bytes(blob)
        row = {"name":name, "bytes":len(blob), "bits_per_parameter":len(blob)*8/len(u),
               "reduction_percent":100*(1-len(blob)/len(raw)), "code_deposit_gas_only":len(blob)*200,
               "sha256":hashlib.sha256(blob).hexdigest(), "full_payload_byte_exact_roundtrip":True,
               "cpu_compress_and_verify_seconds":round(elapsed,3), **(extra or {})}
        report["experiments"].append(row); save(); print(json.dumps(row), flush=True)
    report["zero_weights"] = int(np.count_nonzero((u&32767)==0))
    report["nonfinite_weights"] = int(np.count_nonzero(((u>>7)&255)==255))
    report["raw_calldata_gas_4_16"] = len(raw)*16-raw.count(0)*12
    ex, sm = split(raw)
    report["entropy"] = {"exponent_bits":entropy(ex,256), "sign_mantissa_bits":entropy(sm,256),
                         "bf16_symbol_bits":entropy(u,65536),
                         "note":"Empirical zero-order entropy; NOT a universal impossibility bound on all algorithms."}
    total_entropy = 0
    for t in tensors.values():
        a,b = t["data_offsets"]
        total_entropy += entropy(np.frombuffer(raw[a:b],dtype="<u2"),65536)*(b-a)/2
    report["entropy"]["tensor_weighted_bf16_symbol_bits"] = total_entropy/len(u)
    # Full-payload dictionary compression, with and without exact BF16 bit shuffle.
    for level in [3,19]:
        name="zstd_raw_"+str(level); cached=args.cache/(name+".bin")
        reused=args.reuse_compressed and cached.exists()
        start=time.monotonic(); blob=cached.read_bytes() if reused else zstd.ZstdCompressor(level=level,threads=4).compress(raw)
        record(name,blob,zstd.ZstdDecompressor().decompress(blob),time.monotonic()-start,{"cache_reused_and_fully_reverified":reused})
    transformed=ex.tobytes()+sm.tobytes()
    cached=args.cache/"split_bf16_zstd_19.bin";reused=args.reuse_compressed and cached.exists()
    start=time.monotonic(); blob=cached.read_bytes() if reused else zstd.ZstdCompressor(level=19,threads=4).compress(transformed)
    dec=zstd.ZstdDecompressor().decompress(blob)
    record("split_bf16_zstd_19",blob,join(np.frombuffer(dec[:len(u)],dtype=np.uint8),np.frombuffer(dec[len(u):],dtype=np.uint8)),time.monotonic()-start,{"cache_reused_and_fully_reverified":reused})
    del transformed, dec
    from zipnn import ZipNN
    report["rejected_codecs"]=[]
    report["integration_hazards"]=[]
    for threads in [4,1]:
        codec=ZipNN(method="huffman",input_format="byte",bytearray_dtype="bfloat16",threads=threads)
        # This ZipNN C build mutates its input buffer, including Python bytes.
        # Never hand it the canonical reference! Use an explicitly owned copy.
        owned=bytearray(raw)
        start=time.monotonic(); blob=codec.compress(owned); dec=codec.decompress(blob)
        report["integration_hazards"].append({"codec":"ZipNN","threads":threads,
            "input_buffer_mutated":hashlib.sha256(owned).hexdigest()!=raw_hash,
            "mitigation":"An isolated copy is supplied; original digest checked before accepting every result."})
        if bytes(dec)==raw:
            record("zipnn_huffman_threads"+str(threads),blob,dec,time.monotonic()-start)
        else:
            failure={"name":"zipnn_full_threads"+str(threads),"bytes":len(blob),"decoded_bytes":len(dec),
                     "reason":"Full-payload byte comparison FAILED in this local build. Excluded from acceptable results.",
                     "first_mismatch":next((i for i,(a,b) in enumerate(zip(raw,dec)) if a!=b),None)}
            report["rejected_codecs"].append(failure);save();print(json.dumps(failure),flush=True)
    # Independent 256 KiB streams avoid accepting any codec with a failed full
    # reconstruction; four-byte lengths are included for every stream.
    codec=ZipNN(method="huffman",input_format="byte",bytearray_dtype="bfloat16",threads=1)
    start=time.monotonic(); packed=bytearray(); recovered=bytearray();failed=None
    for offset in range(0,len(raw),262144):
        part=raw[offset:offset+262144]; enc=codec.compress(bytearray(part)); dec=codec.decompress(enc)
        if bytes(dec)!=part:
            failed=offset;break
        packed.extend(struct.pack(">I",len(enc)));packed.extend(enc);recovered.extend(dec)
    if failed is None:
        record("zipnn_independent256k",bytes(packed),bytes(recovered),time.monotonic()-start)
    else:
        report["rejected_codecs"].append({"name":"zipnn_independent256k","reason":"Byte-exact verification failed", "offset":failed});save()
    # A deliberately simple, implementable EVM codec. Every block is independently
    # decoded and compared, and their reconstructed stream receives the full hash.
    start=time.monotonic(); packed=bytearray(); decoded=hashlib.sha256(); blocks=[]
    for offset in range(0,len(raw),8192):
        block=raw[offset:offset+8192]; enc=top7_encode(block); dec=top7_decode(enc)
        assert dec==block
        decoded.update(dec); blocks.append({"offset":len(packed),"bytes":len(enc)})
        packed.extend(enc)
    assert decoded.hexdigest()==hashlib.sha256(raw).hexdigest()
    # record's full comparison is already checked block by block above.
    record("top7_block4096",bytes(packed),raw,time.monotonic()-start,{"blocks":len(blocks),"block_index_bytes_u32":4*(len(blocks)+1)})
    (args.cache/"top7-index.json").write_text(json.dumps(blocks))
    # Same exact codec can be applied to a lossy export, but cannot repair its quality.
    nf4=args.cache.parent/"quantized-exports/nf4_g128/weights.bin"
    if nf4.exists():
        r=nf4.read_bytes(); start=time.monotonic(); c=zstd.ZstdCompressor(level=19,threads=4).compress(r)
        assert zstd.ZstdDecompressor().decompress(c)==r
        report["lossy_export_extra_compression"]={"original_bytes":len(r),"zstd19_bytes":len(c),"code_deposit_gas_only":200*len(c),"quality":"Existing NF4 regressions remain; no improvement in quality", "exact_roundtrip":True}
    # Local numerical ranks test whether representative pretrained matrices admit
    # an EXACT smaller low-rank representation (numerical test is not a proof).
    import torch
    torch.set_num_threads(4)
    ranks=[]
    names=[k for k,t in tensors.items() if len(t["shape"])==2 and min(t["shape"])>=128]
    for name in [names[1], names[len(names)//2], names[-1]]:
        t=tensors[name]; a,b=t["data_offsets"]
        values=torch.from_numpy(np.frombuffer(raw[a:b],dtype="<u2").copy()).view(torch.bfloat16).double().reshape(t["shape"])
        s=torch.linalg.svdvals(values)
        ranks.append({"tensor":name,"shape":t["shape"],"numerical_rank":int(torch.linalg.matrix_rank(values)),"max_rank":min(t["shape"]),"min_singular_value":float(s[-1])})
    report["rank_samples"]=ranks; report["status"]="completed"; save()
    print(json.dumps({"entropy":report["entropy"],"rank_samples":ranks,"zero_weights":report["zero_weights"],"raw_calldata_gas":report["raw_calldata_gas_4_16"]}),flush=True)


if __name__ == "__main__": main()
