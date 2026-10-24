"""Independent restricted-EVM simulation of every emitted matrix tile.

Compares emitted opcodes directly with original signed-int16 matrix arithmetic.
It neither imports the exporter nor contacts any network.
"""
import hashlib
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
MASK = (1 << 256) - 1


def signed(x):
    return x - (1 << 256) if x >= (1 << 255) else x


def simulate(code, calldata):
    stack, memory = [], bytearray(4096)
    pc = 0
    while pc < len(code):
        op = code[pc]
        pc += 1
        if op == 0x5F:
            stack.append(0)
        elif 0x60 <= op <= 0x7F:
            n = op - 0x5F
            stack.append(int.from_bytes(code[pc:pc+n], "big"))
            pc += n
        elif op == 0x36:
            stack.append(len(calldata))
        elif op == 0x35:
            offset = stack.pop()
            stack.append(int.from_bytes(calldata[offset:offset+32].ljust(32, b"\0"), "big"))
        elif op == 0x14:
            a, b = stack.pop(), stack.pop()
            stack.append(int(a == b))
        elif op == 0x57:
            dest, cond = stack.pop(), stack.pop()
            if cond:
                assert code[dest] == 0x5B
                pc = dest
        elif op == 0x5B:
            pass
        elif op == 0xFD:
            raise ValueError("EVM revert")
        elif op == 0x90:
            stack[-1], stack[-2] = stack[-2], stack[-1]
        elif op in (0x01, 0x02, 0x03, 0x05, 0x1C):
            a, b = stack.pop(), stack.pop()
            if op == 0x01:
                v = a + b
            elif op == 0x02:
                v = a * b
            elif op == 0x03:
                v = a - b
            elif op == 0x05:
                a, b = signed(a), signed(b)
                v = (abs(a)//abs(b)) * (-1 if (a < 0) != (b < 0) else 1) if b else 0
            else:
                v = b >> a if a < 256 else 0
            stack.append(v & MASK)
        elif op == 0x52:
            offset, value = stack.pop(), stack.pop()
            assert offset + 32 <= len(memory)
            memory[offset:offset+32] = value.to_bytes(32, "big")
        elif op == 0xF3:
            offset, length = stack.pop(), stack.pop()
            assert not stack
            return bytes(memory[offset:offset+length])
        else:
            raise AssertionError(f"Unexpected opcode {op:02x}")
    raise AssertionError("Missing return")


def main():
    manifest_bytes = (OUT / "tile-manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    weights = (ROOT / "model/weights.bin").read_bytes()
    assert hashlib.sha256(weights).hexdigest() == manifest["source_weights_sha256"]
    rng = np.random.default_rng(20261024)
    rows_verified, outputs_verified, tile_count = 0, 0, 0
    for tile in manifest["code_tiles"]:
        code = (OUT / tile["path"]).read_bytes()
        assert hashlib.sha256(code).hexdigest() == tile["sha256"]
        assert len(code) <= 24000
        columns, rows, groups = tile["columns"], tile["row_count"], tile["groups"]
        matrix = np.frombuffer(weights, dtype=">i2", count=rows*columns,
                               offset=tile["matrix_original_offset"]+tile["row_start"]*columns*2).astype(np.int64).reshape(rows, columns)
        vectors = [np.zeros(columns, dtype=np.int64), np.full(columns, 65535, dtype=np.int64),
                   np.full(columns, -65536, dtype=np.int64),
                   np.array([65535 if i % 2 else -65536 for i in range(columns)], dtype=np.int64),
                   rng.integers(-65536, 65536, size=columns, dtype=np.int64)]
        for vector in vectors:
            padded = list(map(int, vector)) + [0]*(groups*8-columns)
            words = [sum((padded[g*8+i]+65536) << (32*(7-i)) for i in range(8)) for g in range(groups)]
            correction = (sum(padded) << 11) + (groups*8 << 27)
            calldata = b"".join((x & MASK).to_bytes(32, "big") for x in words+[correction])
            raw = simulate(code, calldata)
            assert len(raw) == rows*32
            actual = np.array([signed(int.from_bytes(raw[j:j+32], "big")) for j in range(0,len(raw),32)],dtype=np.int64)
            dots = matrix @ vector
            expected = np.sign(dots)*(np.abs(dots)//4096)
            assert np.array_equal(actual, expected), (tile["index"], vector.tolist())
            outputs_verified += rows
        try:
            simulate(code, b"")
            raise AssertionError("Malformed calldata accepted")
        except ValueError:
            pass
        rows_verified += rows
        tile_count += 1
    assert rows_verified == manifest["total_matrix_rows"] == 8795
    assert manifest_bytes == (OUT / "tile-manifest.json").read_bytes()
    report = dict(status="PASS",scope="Offline restricted EVM interpreter vs original signed-int16 NumPy matrices",
                  tile_count=tile_count,matrix_rows=rows_verified,vectors_per_tile=5,outputs_compared=outputs_verified,
                  malformed_input_reverts=tile_count,manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(),
                  weights_sha256=hashlib.sha256(weights).hexdigest(),runtime_bytes=manifest["total_runtime_bytes"],
                  gas_claim="None; actual EVM gas belongs to the separate Anvil benchmarks")
    (OUT / "all-tiles-proof.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
