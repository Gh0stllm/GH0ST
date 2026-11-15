# Budget100 exact engine experiments

**No candidate is promoted.** The deployed725dc full Stockfish19 engine and all existing optimized/hybrid sources are unchanged. No mainnet action, funds, conversion or GitHub commit occurs in this lane.

All five test modules contain the complete pinned98,511,183-byte NNUE verbatim in initialized linear memory and retain24m nodes,Hash128,maximum skill and per-game retained state. Prefix tests intentionally stop early and expose test profiling; they are not production modules or complete-search quality proof.

## Controlled actualICP comparison

Three localPocketIC test modules stop at the same two node boundaries:200,374 and400,538nodes. All report209,253NNUE evaluations and matching depths. Each passes21 auth/retry/release/upgrade API checks.

| Variant | Metered instructions through400,538nodes | Relative to32-register reference |
|---|---:|---:|
| Existing32-register shape |15,464,403,090|reference|
|64-register with explicit full loop unrolling |15,160,263,250|1.97% lower|
|32-register with derived i16 threat weights |15,538,594,718|0.48% higher; rejected|

The64-register candidate preserves per-lane integer arithmetic and feature order, but its small prefix gain does not establish full24m equivalence or a universal saving. No full candidate search was run because it did not approach the80–90% reduction required by the100ICP/20normal-game target.

Two additional adaptive28B profile modules tested64-register tiling without forced unrolling. Both are substantial regressions: about0.56Mnodes per56B instructions, versus1.50M in the selected32-register profile. They are rejected. This is consistent with larger C++ temporary arrays failing to scalarize; the explanation is an inference from generated-code behavior and counters, not an independently proved compiler diagnosis.

## What the measurements rule out

On the controlled reference prefix, feature transformation and affine work use about79% of instructions. Even making those NNUE components free would yield only about4.75times total speedup on this prefix. This directional Amdahl-style bound is not a bound over every chess position, and it does not rule out exact whole-state reuse; it shows why tiny integer-kernel changes cannot honestly be advertised as a guaranteed80–90% reduction.

The pinnedPocketIC16.1 source meters Wasm32 `v128.load` and `v128.load8x8_s` equally, at1. The existing threat-weight conversion is already fused into the load. Duplicating all i8 threat weights as i16 increases memory without eliminating that opcode; the actual test confirms no saving. Original parameter hashing/serialization remains based on unchanged i8 weights.

## Reproduce

Use the parent engine's pinned toolchain and dependencies. Example test-only build:

```sh
engine/.cache/venv/bin/python engine/budget100/build.py --profile --expanded-affine --registers 64 --force-unroll --prefix-nodes 200000 --name budget100-prefix64-unroll
engine/.cache/venv/bin/python engine/budget100/test_pocketic.py --quick --profile --artifact budget100-prefix64-unroll
```

Use spaces between flag names and numeric values (`--registers 64`, `--prefix-nodes 200000`). The fixed-node boundary is available only with profiling and retains the28B hard backstop. The published canister policy was not changed.

`evidence/artifacts.json` records every module/options/hash; `evidence/prefix-comparison.json` records exact matched-prefix figures. Individual API/profile transcripts are retained. `evidence/ic-metering-source.json` pins the upstream source URL and hash; it does not assert the current mainnet replica version. Build/model/module caches remain ignored.

A promising future candidate still needs full native-exact retained searches, API/retry checks and instruction-headroom testing before any release. Exact prefix checkpointing is separate work and has cache-hit-dependent economics; it cannot guarantee20 arbitrary games within100ICP.
