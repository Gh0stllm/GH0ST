# Decoder, differential and fixed-image loader

All compilation and execution ran on Runpod. No packet here contains a new STF, Stylus or LLM proof.

| Check | Actual result |
| --- | --- |
| Pinned canonical Brotli inside SP1 | Exit 0; valid decode, empty/truncated/invalid rejection and a 64 KiB round trip with output growth; 2,667,922 instructions, 0.061308 seconds guest execution, 1.272 GB sampled owned RSS |
| Native arithmetic differential | Exit 0; canonical module root and ending machine hash match the earlier SP1 public bytes exactly |
| Official compressed c10 image, native load | Exit 0; 1.667 seconds and 771.5 MB sampled owned RSS; every canonical Merkle rebuilt |
| Original software-hash image guest | Exit 101 at the explicit one-billion-cycle bound, 22.381 seconds; not an accepted load |
| Proof-supported hash-intrinsic image guest | Exit 101 at the same bound, 23.232 seconds; not an accepted load |
| Phase-observable image guest | Exit 101 at the same bound, 23.100 seconds; the full image SHA check passed before the limit was reached inside image construction |

The native arithmetic collector's first expectation split the public hex at the wrong nibble. The VM outputs were unchanged; the preserved first comparison failed, then a comparison using the actual decoded public-byte prefix passed. A sampled zero RSS in that sub-millisecond native case means no sample captured its lifetime, not zero RAM use.

The official compressed image is 9,226,171 bytes, SHA `791073b628dee37ed5faccb43841dc317dc24e21bd0bb0b7d38c08e652cd78a5`. Its recomputed module root is `c10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`; initial machine hash is `e71d0a34e6569b018ad69a561e5412d137b7092fc6d6e71172dcb8f5a99e8a4e`.

SHA and Keccak acceleration uses exact pinned SP1 patches that invoke existing proof-supported RV32 syscalls. It introduces no host hash oracle or new verifier opcode. Module, function and memory Merkle hashing all use `arbutil`/`tiny-keccak`; no alternate `sha3` path was found in these constructors.

The encoder's initial link failed because its allocation-failure path references C `exit`. The separate decoder-test guest maps that fatal exit to a guest panic; it does not replace compression or decompression. All failed attempts are retained. The generic execute-only helper's inherited `scope` text says arithmetic; the tested guest source, its hash and the outer phase identify the Brotli case accurately.

The latest proposal uses a separately fixed-hash **uncompressed copy of the exact same official image**, verified against canonical Brotli natively, and still recomputes every module/code/memory Merkle inside the guest. That optimization and its embedded allocator are a separate new profile. Its results are not included in this frozen packet.

[File identities](manifest.json) · [exact source changes](current-canonical-machine.patch)
