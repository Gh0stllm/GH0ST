# One execution, reusable evidence

> **Private, default-off host optimization.** Candidate 01 compiles on Runpod. Independent behavioral and bounded real-input checks are pending. This is not full BoLD lifecycle or mainnet acceptance.

The selected terminal block already finishes in the WAVM interpreter with the unchanged chess engine. Its 150-minute replay exposed a different problem: the existing BoLD client creates a fresh execution run for each hash-list or proof request, and each native machine cache first executes to the end. A challenge can therefore repeat the same expensive work.

This experiment reuses authentic execution state. It does not substitute a native chess result, change the Go/C guest, alter proof instructions, or modify the verifier.

| Layer | Experimental change | Boundary |
|---|---|---|
| Client | Retain one real execution run per canonical typed input, module root, and BoLD mode | Explicit opt-in after `Start`; unresolved root zero fails closed |
| Ownership | Clone caller-owned input, retain bounded entries/creation observers, serialize queries | Idle eviction and owner stop invoke known-master closure; closure invocation is not a remote acknowledgment |
| Native cache | Record actual machine hashes at an explicit stride during the existing eager execution | Serve only a successfully completed recording; bounded memo overflow falls back to real execution |
| Queries | Reuse aligned hashes; refine actual snapshot ranges for unaligned queries and proofs | Actual Finished padding only; no invented last-running state |
| Cleanup | Release experimental snapshots and abandoned/error clones explicitly | Legacy default ownership remains unchanged |

## Frozen candidate

[`candidate-01/source-manifest.json`](candidate-01/source-manifest.json) binds the eight actual source files and three pristine SDK files. [`candidate-01/sdk-host-only.patch`](candidate-01/sdk-host-only.patch) changes only the client and native host SDK. The cloud file-reconstruction check verifies the patch and helper files reproduce every frozen source hash.

The experimental native configuration requires server query serialization, an even snapshot target from 2 through 16, a positive initial interval, and 2 through 65,536 recorded hashes when recording is enabled. The proposed challenge uses two snapshots, stride `2^32`, and a 4,096-point memo. All new booleans and the recording stride are disabled by default.

The client pool uses the separately tested [canonical identity](../host-cache-identity/README.md), including every decoded input field. Raw JSON is unsuitable as a key because preimage-map serialization order can vary. Expected-end claims are checked outside execution identity. A cached run cannot validate an incorrect claim simply because its execution input matches.

## Verification boundary

Candidate 01's two native packages compile successfully on Runpod; this is compilation only. The initial compile attempt rejected a malformed parallelism flag before compiling, and its receipt is retained. The corrected attempt and final post-cleanup compilation succeeded.

The identity helper passed its independent 104 named cases. The revised pool passed normal and race checks with 14 named cases each. These component tests do not establish SDK integration or a full dispute. The superseded first pool remains recorded because review found that a canceled queued borrower could unnecessarily invalidate another borrower's shared run; candidate 01 contains the revised pool.

Independent integration must still compare legacy and experimental behavior with tiny real machines, count actual stepped work, verify cancellation/error/close ownership, and replay the original terminal input only to raw steps 0, 100 million, and 200 million against the saved authenticated hashes. That prefix must call the bounded recorded-step helper directly: the upstream cache constructor eagerly runs to Finished and would accidentally launch the full replay.

No fresh full lifecycle is authorized by this packet. No claim is made that a complete challenge will fit four hours.

## Reproduce on Runpod

1. Make an isolated ordinary copy of the pinned geometry-43 SDK. Keep the selected guest, companion, machine, input, and library immutable.
2. Run [`apply_overlay.py`](apply_overlay.py) against that copy. It checks pristine host-file hashes, applies the host-only patch, copies the frozen helpers, and checks all resulting source hashes.
3. Compile the affected packages with the pinned Linux Go toolchain and native library. The exact final cloud commands and exit codes are retained under `evidence/`.
4. Add the separately owned independent integration fixtures to an isolated test tree. Run only the bounded profiles before requesting a full lifecycle run.

## Remaining operational limits

The pool bounds known logical entries and unresolved creation observers. If transport fails after the server creates a run but before the client receives its ID, the client cannot close that unknown allocation; server idle expiry or request/orphan cleanup remains necessary. An uncooperative creation promise can retain its charged observer until it resolves. `Close` counts are invocation counts, not acknowledgments. The production retention, server resource policy, replay-time budget, and complete assertion-to-settlement acceptance remain open gates.
