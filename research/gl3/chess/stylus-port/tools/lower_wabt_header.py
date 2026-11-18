#!/usr/bin/env python3
"""Route the reviewed wasm2c guest header through virtual-memory callbacks.

The output still needs a page backend and a portable checkpoint adapter. It
must be used only with the matching translation units audited by prepare_guest.
"""

import argparse
import hashlib
from pathlib import Path
import re


ORIGINAL = "6432157607e6edeff428473c2dda7545985eaeca75593dfa15b1ca51f279e7b5"
PAGING_PROLOGUE = """/* Pinned GH0ST guest uses checked virtual memory on a little-endian host. */
#if WABT_BIG_ENDIAN || WASM_RT_MEMCHECK_GUARD_PAGES
#error GH0ST guest needs little-endian, explicit-bounds memory
#endif
#define WASM_RT_USE_SEGUE_FOR_THIS_MODULE 0
#define WASM_RT_USE_LOCAL_MEMORY_BASE_SIZE_FOR_THIS_MODULE 0
#include "guest_paging.h"
#define wasm_rt_allocate_memory gh0st_guest_allocate
#define wasm_rt_grow_memory gh0st_guest_grow
#define wasm_rt_free_memory gh0st_guest_free

"""


def replace_span(text, start, end, replacement):
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError(f"Expected one reviewed source span around {start!r}")
    first = text.index(start)
    last = text.index(end, first + len(start))
    return text[:first] + replacement + text[last:]


def replace_lines(text, expression, replacement, expected):
    text, count = re.subn(expression, lambda _: replacement, text)
    if count != expected:
        raise ValueError(f"Expected {expected} replacements, found {count} for {expression}")
    return text


def lower(raw):
    if hashlib.sha256(raw).hexdigest() != ORIGINAL:
        raise ValueError("Unreviewed wasm2c module header")
    original = raw.decode("utf-8")
    text = replace_span(original, "// Computes a pointer to an object", "#define TRAP(x)", PAGING_PROLOGUE)
    text = replace_span(text, "#if WASM_RT_USE_SEGUE_FOR_THIS_MODULE && WASM_RT_SANITY_CHECKS",
                        "// MEMCHECK_DEFAULT32", "#define WASM_RT_CHECK_BASE(mem)\n\n")
    text = replace_span(text, "static inline void load_data(", "#define DEF_MEM_CHECKS0",
                        "/* Active segments use reviewed manifest ranges; i is intentionally unused. */\n"
                        "#define LOAD_DATA(m, o, i, s) gh0st_guest_seed(&(m), (o), (s))\n\n")
    for width, value, count in [("t1", "result", 1), ("t", "simd_mem_value", 2)]:
        text = replace_lines(text, rf"wasm_rt_memcpy\(&{value}, MEM_ADDR_MEMOP\(mem, addr, sizeof\({width}\)\),[^\n]*\n +sizeof\({width}\)\);",
                             f"gh0st_guest_read(mem, addr, &{value}, sizeof({width}));", count)
    for width, value, count in [("t1", "wrapped", 1), ("t", "simd_mem_value", 2)]:
        text = replace_lines(text, rf"wasm_rt_memcpy\(MEM_ADDR_MEMOP\(mem, addr, sizeof\({width}\)\), &{value},[^\n]*\n +sizeof\({width}\)\);",
                             f"gh0st_guest_write(mem, addr, &{value}, sizeof({width}));", count)
    text = replace_lines(text, r"memset\(MEM_ADDR\(mem, d, n\), val, n\);",
                         "gh0st_guest_fill(mem, d, (uint8_t)val, n);", 1)
    text = replace_lines(text, r"memmove\(MEM_ADDR\(dest, dest_addr, n\), MEM_ADDR\(src, src_addr, n\), n\);",
                         "gh0st_guest_move(dest, dest_addr, src, src_addr, n);", 1)
    text = replace_lines(text, r"LOAD_DATA\(\(\*dest\), dest_addr, src \+ src_addr, n\);",
                         "gh0st_guest_write(dest, dest_addr, n ? src + src_addr : NULL, n);", 1)
    text = replace_span(text, "// MEM_ADDR_MEMOP maybe", "#define DEFINE_SIMD_LOAD_FUNC", "")

    if re.search(r"\bMEM_ADDR(?:_MEMOP)?\b|\bwasm_rt_local_memory_base\s*\[|__seg_gs|\bwasm_rt_segue_", text):
        raise ValueError("Generated header still exposes a raw guest pointer path")
    original_table = original[original.index("typedef enum { RefFunc"):original.index("#define DEFINE_SIMD_LOAD_FUNC")]
    original_table = original_table[:original_table.index("// MEM_ADDR_MEMOP maybe")]
    if original_table not in text:
        raise ValueError("Indirect function table helpers changed unexpectedly")
    outside_table = text.replace(original_table, "")
    references = re.findall(r"(?:\b\w+\s*)?(?:->|\.)data(?:_end)?\b", outside_table)
    if references != ["table->data", "table.data", "table.data"]:
        raise ValueError("An unreviewed data pointer remains outside the preserved table helpers")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("header", type=Path)
    parser.add_argument("output", type=Path, help="New pathname for the paged header")
    args = parser.parse_args()
    try:
        result = lower(args.header.read_bytes())
        with args.output.open("x", encoding="utf-8") as file:
            file.write(result)
    except (OSError, ValueError) as error:
        parser.exit(1, f"WABT lowering stopped: {error}\n")


if __name__ == "__main__":
    main()
