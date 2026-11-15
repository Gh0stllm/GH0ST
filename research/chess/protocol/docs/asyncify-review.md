# Independent review: Stockfish exact-search continuation on ICP

Review status: **design review with a passed independent Wasm stack-mechanism fixture; no passed Stockfish continuation implementation**. Reviewed the synchronous `engine/src/canister.cpp`, `engine/src/gh0st_engine.cpp`, the single-worker patch and the proposed `begin` / `advance` design. The synchronous engine has separate local execution evidence; that evidence does not prove Stockfish Asyncify continuation. Paid entry remains closed.

## Decision

Use a dedicated C/C++ linear-memory stack for the suspended engine job, a separate Asyncify spill buffer, and a tiny explicitly uninstrumented Wasm stack-switch trampoline. Do not resume a suspended search on the ordinary Candid entry stack. Preserve the exact recursive search, NNUE state, transposition table and history across chunks; a fresh smaller search per message is a different algorithm and cannot be described as one fixed-budget search.

Binaryen's Asyncify pass describes saving call indices and Wasm locals into its spill area. That is distinct from C++ address-taken locals and `alloca` storage in linear memory. Its source also requires stopping unwind before ordinary runtime code runs and restarting the same initial function when rewinding. The stack separation below is an engineering consequence for this ICP/Candid runtime, not a claim that Asyncify supplies the separation automatically. [Binaryen Asyncify implementation](https://github.com/WebAssembly/binaryen/blob/main/src/passes/Asyncify.cpp)

## Required memory layout and boundary

Reserve disjoint, permanently live and aligned ranges for:

1. The normal canister/Candid C stack.
2. `ENGINE_STACK`, used only while executing the engine thunk, with guard regions and a measured high-water limit.
3. `ASYNCIFY_STACK`, used only by Binaryen's continuation data, with its own end pointer and guards. Its size is not interchangeable with the engine C-stack size.
4. A job-owned heap/global record containing immutable copied request values, result buffers, stop reason, audit totals, step state and continuation metadata.

The engine stack must be real reserved linear memory, not unallocated addresses above the current memory size or storage that the allocator may reuse. If allocated from the heap, keep the allocation permanently owned through completion/abort. Use 16-byte stack alignment and check that all reserved ranges are non-overlapping and fit the module's memory limits. An arbitrary eight-MiB choice is an initial capacity, not a demonstrated safe bound.

A Wasm trampoline should save the current `__stack_pointer`, set it to the dedicated engine stack's initial top, call the same noinline engine thunk, and restore the host pointer before returning to ordinary C++ Candid code. Implement the pivot in explicit Wasm assembly or a verified equivalent whose disassembly proves it uses Wasm locals rather than C-stack temporaries across the pivot. A C++ function that changes `__stack_pointer` and then accesses its own stack locals is not a safe substitute. Disable inlining/tail-call conversion across this boundary and inspect the final transformed Wasm.

The uninstrumented runtime is the Asyncify boundary. On a yielded return it must stop unwind before any Candid encoding, heap-heavy reply preparation, destructors, `IC_API` activity or `ic0.msg_reply`. Restore the normal stack pointer before those activities. On **begin** the trampoline uses the dedicated stack's initial top. At the yield leaf, save the actual suspended `__stack_pointer` before starting unwind. On **advance**, start rewind and enter the same trampoline/thunk using that **saved suspended stack pointer**, not the initial top. Rewinding skips LLVM's earlier prologue global-stack-pointer writes; setting the initial top caused the independent fixture to corrupt a live frame when deeper recursion resumed. The yield leaf stops rewind at the matching suspended point; normal search then continues. The active engine stack bytes stay untouched by all intervening messages.

## Present synchronous lifetime hazards to remove

`canister.cpp::search()` currently owns `bestmove[8]`, `actual` and `depth` on the ordinary message C stack. `gh0st_stockfish_search_history` receives pointers to them. These pointers cannot be retained across a reply. Store outputs inside the persistent job record, or inside the protected engine stack beneath the thunk, before allowing a yield.

Likewise, decoded `fen`, `moves`, concatenated `history`, and any `.c_str()` / `string_view` passed into the engine must refer to job-owned immutable storage. Do not retain any pointer or reference to an `IC_API`, `CandidArgs`, Candid record, decoder buffer or first-message callback. The synchronous adapter's `std::function` callbacks capture local `best` plus output pointers by reference. They remain safe only if every captured object belongs to the protected engine stack or job record and retains its lifetime until normal completion. Clear those callbacks once on completion/abort; never destroy a captured object on the Pending path.

No `IC_API` wrapper should be part of the captured continuation. The original caller may no longer have a live reply context when a later message resumes. Each `advance` constructs and replies through its own message wrapper after the runtime has fully stopped unwind and restored the normal stack.

## Instrumentation and exactness invariants

* Instrument every call path from the engine thunk to `gh0st_yield`, including indirect calls through the synchronous worker's `std::function`. Do not enable ignore-indirect optimizations merely because there is one worker; an indirect call can still be on the suspended stack. A selective instrumentation list needs a final-Wasm call-graph audit and coverage evidence.
* Exclude the runtime/trampoline/Candid boundary from instrumentation. For Binaryen 116 the actual pass argument is **`asyncify-removelist`**; `asyncify-remove` was silently ignored in the fixture and left the trampoline instrumented. Binaryen specially recognizes direct Asyncify runtime calls; verify their final generated functions and exclusions rather than relying on a source attribute alone. Keep a distinct noinline thunk so an optimizer cannot merge application work into an excluded runtime function.
* A Pending return is not an engine completion. The adapter must not execute its ordinary `wait_for_search_finished`, callback cleanup, buffer copy or terminal validation while unwinding. Let transformed engine frames unwind to the explicit runtime boundary first.
* Do not rerun `set_position`, `search_clear`, option changes, or the root `go` initialization on every advance. They run once per job; rewind reconstructs the suspended control path and resumes after the matching yield.
* The original global `limits.nodes` remains the full job budget. A yield is not `threads.stop`, not a smaller node limit and not a clock-based evaluation stop. Preserve accumulated node counts and all engine search state across chunks.
* Stockfish 19's pinned `MAX_PLY` is 246; its completed maximum iterative depth is 245. A legitimate search may stop there below the requested nodes. Final replies must distinguish `node_budget` from `max_depth`. Arbitrary low-node/depth replies are aborts, not weakened successful searches.
* Record total actual work across chunks and per-chunk instruction counts, step count, version/network/configuration, final depth and stop reason. `performance_counter(0)` is per message; simply reporting the last chunk loses the earlier cost. The final depth is not the sum of chunk depths.

Node-quantum yielding is deterministic but does not by itself bound instructions: evaluation cost per node varies, and first-use NNUE/engine initialization can cost substantial instructions before the first yield. Measure cold and warm cases, parsing/allocation overhead and worst-case positions with substantial headroom below ICP's update limit. A trap rolls back the current message to its prior checkpoint; catching a trap in a later client cannot recover progress that never committed.

## Job state, authorization and failure handling

Enforce one active job for the whole engine canister because the Stockfish instance, callbacks and TT are shared. While a job is pending, reject another game/request rather than overwriting it. `begin` and `advance` both authenticate the pinned authority before decoding expensive input. An immutable request digest must include job ID, config, initial FEN and complete moves; a reused ID with different data is rejected.

Store the expected step. The same `(job_id, expected_step)` must return the same previously committed Pending/completion result without advancing twice. A stale/future step never reinitializes or rewinds a second time. Final results stay cached until the authority has durably consumed them, or under a documented bounded retention policy. Query/identity operations must not touch engine/Asyncify globals. Do not permit another asynchronous operation while a job is suspended; Emscripten's runtime guidance explicitly warns about overlapping async operations and mutable-global interleavings. [Emscripten Asyncify runtime guidance](https://emscripten.org/docs/porting/asyncify.html#potential-problems)

An engine upgrade destroys suspended heap/frame state unless an explicit version-compatible serialization exists. The safe initial policy is to disallow upgrades while a job is active, or deliberately abort it to a refundable service fault. Never replay old continuation bytes into a new Wasm code layout. Recovery must reset both Asyncify state and the Stockfish singleton/callback state; freeing only the spill buffer is insufficient.

The Rust authority's current adapter expects one terminal `search` response. A segmented engine requires a corresponding adapter that durably records engine job/step and issues `begin` / `advance` updates. It must keep the accepted human move committed throughout, avoid a multi-minute callback chain, bind each returned step to the original job/configuration, and settle faults as entry refunds. There is no production runtime switch between the synchronous and continuation algorithms in the present authority.

## Evidence required before declaring continuation correct

1. A small C++ recursive fixture with address-taken locals, stack arrays, heap objects and callback references: suspend/resume many times, run normal Candid decode/reply between every step, verify frame/local checksums and exactly-once destructors. Include canaries around both stacks.
2. Exact reference comparisons against the same native single-worker Stockfish configuration for normal openings, tactical positions, mate/max-depth, long repetitions, en passant, castling, promotions and endgames. Compare best move, final nodes, completed depth, stop reason and (where stable) root scores/PV. Matching a single opening move is insufficient.
3. Yield every few nodes to force unwinds from many recursive depths; compare against sparse yielding and a single uninterrupted run. Put an instruction/cycle bound on every chunk, including cold initialization and final reply preparation.
4. Repeated/incorrect step IDs, changed request body, wrong authority, simultaneous second game, query calls between chunks, trapped chunks, reissued calls and completed-result retries must not change the result or move twice.
5. Upgrade attempts/recovery while suspended; documented refund-only behavior when exact continuation cannot survive. Verify no stale callback reference remains after terminal cleanup.

Until these pass for the final module, a compiled Asyncify artifact is experimental and must not open paid entry. The synchronous SIMD artifact's separately measured capabilities remain independent evidence; do not infer continuation correctness or a higher fixed budget from them.

## Independent fixture result

`protocol/asyncify-fixture/` contains the minimal C++ recursion/callback/RAII fixture, explicit Wasm stack-switch assembly, pinned-local-tool build script and Node WebAssembly runner. Nine runs compare three seeds and three yield quanta against uninterrupted reference runs. Each run preserves 364 constructor/destructor pairs, 1,092 indirect stack-reference callback checks, all address-taken local values and both stack guards. The most frequent-yield cases complete across 1,093 separate exported Wasm calls each, with 16 KiB of ordinary host C-stack churn between continuations. An unsafe shared-stack negative control is detected by a trap.

This is actual WebAssembly execution of the exact-stack mechanism, with no remaining imports. It is not ICP consensus execution, a Candid parser/IC reply test, a Stockfish search, a cross-chain game or a paid-strength result. Evidence and the fixture module hash are in `protocol/asyncify-fixture/evidence.json`. The two corrections above were discovered by failing controls before the final fixture passed; the passing code uses both the real removelist option and saved suspended stack pointer.
