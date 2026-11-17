# Bounded historical restoration

The old terminal WAVM replay hit WASM32's 4 GiB guest heap while restoring sealed historical deltas. It was not a 128 GB host-memory failure. This candidate removes clean historical code retention in account objects and adds a separately tracked, guest-only 3 GiB soft memory limit. The engine, NNUE, search policy, authenticated reads and consensus gas remain unchanged.

**Status: native regressions passed; the new guarded terminal WAVM replay failed with another WASM32 guest heap exhaustion.** This directory does not claim a completed BoLD dispute or mainnet readiness.

| Check | Verified result |
| --- | --- |
| Historical account cache | 128 committed/reopened accounts; zero code bytes retained per account after optional reads, against 3,145,728 bytes in ordinary reads; identical root |
| Actual terminal account cache | Same 171,813 accounts: retained code drops from 1,913,501,851 to 294,624,363 bytes; dirty code remains 6,282 bytes |
| Cached and dirty code | Exact bytes, empty-code semantics, copied state and snapshot/revert preserved |
| Witness and errors | Hook forwards the accessor, witness receives the same bytes, missing code produces the same StateDB error |
| Recorder | Actual tip recorder preserves code-hash and account-preimage sets |
| Delta validation | 768 committed historical deltas match the fallback path; payload, prefix, length, missing-code and misaligned-cell corruption reject |
| Exact terminal replay | Original 2,574,999,906-byte input; all four end-state fields match; actual exit 0 |
| Consensus gas | Baseline, cache-fixed and guarded native executions each use **12,306,935 gas**, with identical block/state/receipt hashes |
| Full canonical engine state | Cold reconstruction of 2,464 deltas yields 163,085,439 bytes, SHA-256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6` |
| New proof root | Guarded root generated; terminal replay failed after 3,575.36 s. The guest could not allocate 4 MiB with 4,227,235,840 bytes in use; no successful terminal/engine witness export |

## What changes

`StateDB.GetCodeUncached` is an optional extension: it reaches the same account lookup, authenticated code reader, preimage recording, witness and error paths. It only avoids assigning clean historical bytes to the account's `code` cache. Already cached or dirty bytes remain authoritative. The tracing wrapper forwards it without changing the main `vm.StateDB` interface.

Only sealed delta restoration opts in. General EVM reads, delta writes, seed reads, validation rules and gas formulas retain their existing paths. A small private hint materializes prior code if a later real write needs the original cached bytes for journaling; copied states preserve that hint. No code bytes, account fields or roots are modified by the read itself.

The delta walk already streams newest first using a bounded seen-word bitset. There is no new ordering or validation algorithm.

The pinned replay guest uses `GOGC=1000`. Its native diagnostic left about 392 MB after subtracting native-only input payload, giving an architecture-dependent heap target near the WASM32 limit. That is not an exact guest measurement. The separate [GC decision](evidence/gc-guard-decision.json) records why a guest-only soft memory limit was added after fixing the actual retention bug. It changes collection scheduling, never search strength, hashes or verification math.

## Artifact identities

- Guarded module root: `0xc03cf6f44fe1ca3c0826064ba7e5a3c134dc0013a9b994f3355f2ba185116c00`
- Guarded machine SHA-256: `e06a72c92c91b7969a0bd6fa668ef301c0110f7206404bbe207ea444f3f60da6`
- Cache-only reference root: `0x70f2954895a54120f0aaff6eafdfdb382d9ab7fcea110d6fb295626e11fd5ce7`; generated and preserved, deliberately not long-replayed.
- Original terminal input SHA-256: `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`
- Unchanged C companion SHA-256: `b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555`
- Base Nitro: `v3.12.2`; base Geth: `30456d24d3cff444d3b0f246e9c7609477c7d4a1`; Linux Go `1.25.12`.

The [failed guarded replay](evidence/guarded-replay-failure/replay-result.json) preserves the actual exit, unchanged input identity, guest failure and partial proof-file hash. The new accessor was reached, but the 3 GiB soft limit did not prevent exhaustion. It is not a mainnet-ready fix.

The [source/build manifest](evidence/build-source-manifest.json), [numeric header comparison](evidence/native-header-comparison.json), [canonical reconstruction](evidence/native-canonical-result.json), [cache-only build](evidence/machine-build-result.json) and [guarded build](evidence/guard-machine-build-result.json) contain the full identities. Original failed fixture-development attempts are preserved in the scripts directory/logs and are not treated as accepted tests.

## Reproduction boundary

All builds, tests and engine/proof executions ran on the owned Runpod Linux workers. The Mac was used for source editing, inspection and transfer only. Scripts intentionally target the isolated `/root/bounded-restore` tree, require authenticated baseline artifacts, and preserve the real child exit before optional metrics. They do not deploy or contact a public chain.

The [formatted code patch](bounded-code-cache.formatted.patch) applies to the four SHA-guarded baseline files in [source-before.json](source-before.json); the separate [guest memory guard](guest-memory-guard.patch) applies only to `cmd/replay/wasm.go`. The original draft patch is retained for provenance. New native/guest binaries must be paired with their matching module root; neither new root is the official standard Nitro root.

Stockfish commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`, the original 98,511,183-byte NNUE, 24,000,000-node target, 128 MiB hash, one search thread, Skill 20 and retained TT/history are unchanged. No mainnet transactions or token movements were performed.
