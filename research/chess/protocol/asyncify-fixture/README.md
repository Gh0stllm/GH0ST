# Independent Asyncify exact-stack fixture

This is an isolated C++/WebAssembly mechanism experiment. It is not Stockfish, a canister, a paid game or a production build. It changes no engine baseline or production authority settings.

Build/run from `research/chess` using the sibling engine lane's existing pinned WASI SDK 25 and Binaryen 116 environment:

```sh
engine/.cache/venv/bin/python protocol/asyncify-fixture/build.py
node protocol/asyncify-fixture/verify.mjs
```

`fixture.cpp` recurses through address-taken volatile arrays, indirect callbacks holding references to those arrays, and C++ RAII objects. `stack-switch.s` pivots the LLVM linear-memory stack using Wasm locals. The transformed module has no remaining imports. The runner compares uninterrupted execution with nine continuation runs, churning 16 KiB of ordinary C stack between exported calls and checking guards around both the dedicated engine stack and Asyncify spill buffer. The unsafe shared-stack control must fail.

Two necessary details were found experimentally:

* Binaryen 116 takes `asyncify-removelist`; `asyncify-remove` is ignored and leaves the trampoline instrumented.
* Begin uses the dedicated stack's initial top; advance uses the **saved suspended linear-memory stack pointer** captured at the yield leaf. Rewinding skips LLVM's earlier stack-prologue writes, so restarting from the initial top corrupts preserved recursive frames.

Passed evidence is in `evidence.json`. The maximum-yield runs each span 1,093 separate exported Wasm calls, with exactly one root start, 364 constructors/destructors and 1,092 callback checks, matching the uninterrupted result. This supports the stack scheme; it does not prove Candid/IC reply behavior, whole-Stockfish continuation correctness, real ICP instruction/cycle limits or a higher paid search budget. See [the full review](../docs/asyncify-review.md).
