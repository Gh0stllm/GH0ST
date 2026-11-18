# Stockfish guest instruction inventory

This offline tool accepts the two reviewed Asyncify Stockfish guests by SHA-256, validates their WebAssembly, and reports the exact instruction and runtime feature inventory as JSON. It can also write the control and runtime indexes used by a paged interpreter.

From this directory, with the locked Cargo dependencies available locally:

```sh
cargo run --locked --offline -- /path/to/sliced.wasm \
  --control-index /path/to/new-control-index.bin \
  --runtime-index /path/to/new-runtime-index.bin > inventory.json
```

Both index flags are optional. The output paths must be new and distinct.

## Control index

Every row contains three unsigned big-endian 32-bit offsets. The index has no header and is sorted by the first field.

| Field | Meaning |
| --- | --- |
| 1 | Offset of the `block`, `loop`, or `if` opcode |
| 2 | Offset of that instruction's matching `end` opcode |
| 3 | Offset of the first instruction in the `else` body, or `0xffffffff` when absent |

Offsets start at byte zero of the packed ROM. That ROM includes the WebAssembly preamble and original bytes of every section except custom and data sections. The index omits the function's implicit outer block. A consumer must use the control rules and function metadata from WebAssembly to resolve branches and function returns.

| Reviewed guest | Packed ROM bytes | Index rows | Index SHA-256 |
| --- | ---: | ---: | --- |
| SIMD | 870,051 | 24,778 | `270c032fe059003140d043ceeecd933fb4869232a368612f4285301ddb360d1e` |
| Scalar | 874,333 | 24,729 | `373644b4d2c43318529def927966b687dd2c40a8c612f17bf637b8c8f5a23229` |

## Runtime index

Each file starts with the eight ASCII bytes `GL3IR001`, three big-endian 16-bit counts for signatures, table slots, and globals, and two reserved zero bytes. Then it contains these records in module order:

| Records | Encoding |
| --- | --- |
| 67 signatures | Three big-endian 16-bit values per type: parameter count, result count, and canonical type index |
| 473 table slots | One big-endian 16-bit function index per slot, or `0xffff` for a null slot |
| 100 globals | One little-endian 32-bit integer bit pattern per global |

The canonical type index is the first module type with identical ordered parameter and result types. Both guests currently have 67 distinct signatures and one null table slot at index zero. Mutable globals are at indexes 0, 98, and 99. Each index is 1,764 bytes.

| Reviewed guest | Runtime index SHA-256 |
| --- | --- |
| SIMD | `4cb9948f48857c9e03bf6b7818179223444b89a7622099826511eb7eb8ecb4f9` |
| Scalar | `9bdd422478800845deb97e28980ef4df6fee233ef9c3a3062d26b19b7f7bc01b` |

## Instruction inventory

The SIMD guest has 197 distinct opcodes, including 52 SIMD opcodes. The scalar guest has 145 distinct opcodes. Both need bulk memory, sign extension, integer and floating-point operations, direct and indirect functions, and the same 13 WASI imports. The report gives the exact memory and table limits, block results, indirect-call signatures, and memory immediates. It describes the whole module, so a reported instruction or import may be unreachable during a particular move.

The tool performs static checks. Full-move parity, runtime instruction cost, checkpoint state, and deployment evidence require execution on the target runtime.
