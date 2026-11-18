#!/usr/bin/env python3
"""Audit the pinned chess guest and export its seed bytes without transforming them.

The wasm2c output still uses contiguous guest memory. This utility documents
the lowering surface and rejects unfamiliar inputs. It produces no contract.
"""

import argparse
import hashlib
import json
import mmap
from pathlib import Path


WASM_SHA256 = "1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc"
NNUE_SHA256 = "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2"
NNUE_LENGTH = 98_511_183
NNUE_FILE_OFFSET = 977_458
PAGE_BYTES = 65_536
GENERATOR_SHA256 = {
    "gl3vm-impl.h": "6432157607e6edeff428473c2dda7545985eaeca75593dfa15b1ca51f279e7b5",
    "gl3vm.h": "1fe02862660f74aade49b75be7359f7bd3b542a8667b84bf2d886bedc7e56806",
    "gl3vm_0.c": "cbce60770ef30775253528910a39efb7888d1f67e7ca3e4a4007d0445ff186a0",
    "gl3vm_1.c": "575869c980bbb123b2ecbeeb18741fdb21d6baeb717f5285d6ddab9d8a6e28b4",
    "gl3vm_2.c": "ed3c9bb729ea7745bf249d0b9cccad812b3647394dc8efe7f96ba85443bc4c06",
    "gl3vm_3.c": "00d122bb8943b8091dcfa05e6171c1f15d0a437657ec2ab003e6a7f75b98d551",
    "gl3vm_4.c": "9cca5b37ba9e1c4303480291f76d7c169aefd26c27600d667e4ab924b6b0833b",
    "gl3vm_5.c": "1cc86f6553d456da38f222bfe2d21569c3dda2a7395e4a2d64f124565e85502f",
    "gl3vm_6.c": "cafca41af7ef62d5e7db284a05bf56085ef4e7088859c1818449d884b38ead58",
    "gl3vm_7.c": "d3095082c33c3f53ea4118ee11b68b2c5b410bb74a3d53b0991908097aba2268",
}

LOWERING_SURFACE = {
    "gl3vm-impl.h": [
        "MEM_ADDR and MEM_ADDR_MEMOP select raw backing addresses, including Segue and local-base fast paths",
        "DEFINE_LOAD, DEFINE_STORE and DEFINE_SIMD_{LOAD_FUNC,LOAD_LANE,STORE,STORE_LANE} directly copy guest bytes",
        "LOAD_DATA / load_data write active data to raw guest addresses",
        "memory_fill, memory_copy and memory_init provide bulk operations",
    ],
    "gl3vm_0.c and other generated translation units": [
        "init_memories reserves contiguous guest memory before applying active segments",
        "Segue wrappers and local memory declarations can cache guest pointers",
        "WABT runtime owns allocate, grow, free and bounds from the memory descriptor",
        "Preserve the fixed indirect function table, type checks and segment initializers",
    ],
    "aot/adapter.c and aot/proof_adapter.c": [
        "gl3aot_memory exports the contiguous native data pointer for checkpoints",
        "proof_adapter bulk checkpoint transfers dereference guest data directly",
        "Retain the three mutable global values and logical memory length on resume",
    ],
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Reader:
    def __init__(self, data, start, end):
        self.data, self.pos, self.end = data, start, end

    def byte(self):
        require(self.pos < self.end, "Unexpected end of guest section")
        value = self.data[self.pos]
        self.pos += 1
        return value

    def integer(self, signed=False):
        value = 0
        for shift in range(0, 35, 7):
            byte = self.byte()
            value |= (byte & 0x7F) << shift
            if not byte & 0x80:
                if signed and byte & 0x40:
                    value -= 1 << (shift + 7)
                require((-2**31 <= value < 2**31) if signed else value < 2**32, "Integer exceeds 32 bits")
                return value
        raise ValueError("Invalid guest LEB128")

    def span(self, size):
        require(size <= self.end - self.pos, "Truncated guest section")
        start = self.pos
        self.pos += size
        return start, self.pos

    def name(self):
        start, end = self.span(self.integer())
        return self.data[start:end].decode("utf-8")

    def i32_const(self):
        require(self.byte() == 0x41, "Unsupported initializer expression")
        value = self.integer(signed=True)
        require(self.byte() == 0x0B, "Initializer did not end")
        return value

    def limits(self):
        require(self.byte() == 1, "Expected ordinary bounded 32-bit limits")
        minimum, maximum = self.integer(), self.integer()
        require(minimum <= maximum, "Invalid declaration limits")
        return minimum, maximum

    def complete(self):
        require(self.pos == self.end, "Unconsumed guest section bytes")


def digest(raw, start=0, end=None):
    with memoryview(raw)[start:end] as view:
        return hashlib.sha256(view).hexdigest()


def inspect_guest(raw):
    require(digest(raw) == WASM_SHA256 and raw[:8] == b"\x00asm\x01\x00\x00\x00", "Unreviewed chess guest")
    module = Reader(raw, 8, len(raw))
    sections = {}
    while module.pos < module.end:
        section = module.byte()
        start, end = module.span(module.integer())
        if section != 0:
            require(section not in sections, "Duplicate core Wasm section")
            sections[section] = Reader(raw, start, end)

    imports_reader = sections[2]
    imports = []
    for _ in range(imports_reader.integer()):
        namespace, name = imports_reader.name(), imports_reader.name()
        require(imports_reader.byte() == 0, "Unsupported non-function import")
        imports.append({"namespace": namespace, "name": name, "typeIndex": imports_reader.integer()})
    imports_reader.complete()

    table = sections[4]
    require(table.integer() == 1 and table.byte() == 0x70, "Unexpected table layout")
    table_limits = table.limits()
    table.complete()
    require(table_limits == (473, 473), "Unexpected table capacity")
    elements = sections[9]
    require(elements.integer() == 1 and elements.integer() == 0, "Unexpected active element layout")
    element_offset = elements.i32_const()
    functions = [elements.integer() for _ in range(elements.integer())]
    elements.complete()
    require(element_offset == 1 and len(functions) == 472, "Unexpected function table layout")

    memory = sections[5]
    require(memory.integer() == 1, "Expected a single memory")
    initial_pages, maximum_pages = memory.limits()
    memory.complete()
    require((initial_pages, maximum_pages) == (2048, 32768), "Unexpected memory capacity")

    exported = sections[7]
    exports = [{"name": exported.name(), "kind": exported.byte(), "index": exported.integer()}
               for _ in range(exported.integer())]
    exported.complete()
    globals_ = [item for item in exports if item["kind"] == 3]
    require([item["index"] for item in globals_] == [0, 98, 99], "Unexpected checkpoint globals")

    data = sections[11]
    segments = []
    for index in range(data.integer()):
        require(data.integer() == 0, "Expected an active data segment for memory 0")
        offset = data.i32_const()
        length = data.integer()
        start, end = data.span(length)
        require(0 <= offset <= offset + length <= initial_pages * PAGE_BYTES, "Data segment exceeds guest memory")
        segments.append({"index": index, "guestOffset": offset, "fileOffset": start, "bytes": length,
                         "sha256": digest(raw, start, end)})
    data.complete()
    require([(entry["guestOffset"], entry["bytes"]) for entry in segments] ==
            [(1024, 98_643_411), (98_644_440, 5468)], "Unexpected initial memory segments")
    first = segments[0]
    require(first["fileOffset"] <= NNUE_FILE_OFFSET and NNUE_FILE_OFFSET + NNUE_LENGTH <= first["fileOffset"] + first["bytes"],
            "Model is not fully nested in the first seed segment")
    require(digest(raw, NNUE_FILE_OFFSET, NNUE_FILE_OFFSET + NNUE_LENGTH) == NNUE_SHA256, "Embedded model mismatch")
    return {
        "artifactSha256": WASM_SHA256, "artifactBytes": len(raw), "imports": imports, "exports": exports,
        "memory": {"pageBytes": PAGE_BYTES, "initialPages": initial_pages, "maximumPages": maximum_pages},
        "functionTable": {"minimum": table_limits[0], "maximum": table_limits[1], "initialOffset": element_offset,
                          "functionIndices": functions},
        "dataSegments": segments,
        "nnue": {"sha256": NNUE_SHA256, "bytes": NNUE_LENGTH, "fileOffset": NNUE_FILE_OFFSET,
                 "guestOffset": first["guestOffset"] + NNUE_FILE_OFFSET - first["fileOffset"]},
        "virtualMemoryLowered": False, "deployableStylusArtifact": False,
    }


def audit_generator(directory):
    require({path.name for path in directory.glob("gl3vm*")} == set(GENERATOR_SHA256), "Unexpected generated guest file set")
    for name, expected in GENERATOR_SHA256.items():
        with (directory / name).open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as raw:
            require(digest(raw) == expected, f"Unreviewed wasm2c output: {name}")
    return {"version": "WABT 1.0.42", "sha256ByFile": GENERATOR_SHA256, "rawAccessPaths": LOWERING_SURFACE}


def export_seeds(directory, raw, manifest):
    directory.mkdir(parents=True, exist_ok=False)
    for segment in manifest["dataSegments"]:
        path = directory / f"segment-{segment['index']}.bin"
        start = segment["fileOffset"]
        with path.open("xb") as file, memoryview(raw)[start:start + segment["bytes"]] as view:
            require(file.write(view) == segment["bytes"], "Incomplete seed write")
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("guest", type=Path)
    parser.add_argument("--generated", type=Path, help="Require an exact match for the audited wasm2c output")
    parser.add_argument("--seed-dir", type=Path, help="Write both unmodified seed segments and manifest to a new directory")
    args = parser.parse_args()
    try:
        with args.guest.open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as raw:
            manifest = inspect_guest(raw)
            if args.generated:
                manifest["wasm2c"] = audit_generator(args.generated)
            if args.seed_dir:
                export_seeds(args.seed_dir, raw, manifest)
            print(json.dumps(manifest, indent=2))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Guest audit stopped: {error}\n")


if __name__ == "__main__":
    main()
