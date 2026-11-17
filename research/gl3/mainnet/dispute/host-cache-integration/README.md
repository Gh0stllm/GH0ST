# Independent host-cache integration

**Candidate 01 passed the independent bounded correctness suite and the authentic selected-machine 200M-step prefix.** This is host-side validation infrastructure. The engine, model, guest, selected module root and full-strength search policy were unchanged. The full challenge lifecycle is still a separate acceptance gate.

All compilation and execution ran on the existing Runpod worker. No full replay, lifecycle, public transaction or new pod was started in this lane.

| Evidence | Actual result | What it establishes |
|---|---|---|
| [Corrected normal suite](evidence/attempt-03/results.json) | Server exit 0 / 0.049 s; client exit 0 / 0.037 s | 16 top-level tests and 14 subtests passed. The separately gated prefix was skipped here. |
| [Same suite with Go race detection](evidence/race-01/results.json) | Server exit 0 / 1.071 s; client exit 0 / 1.064 s | Same 30 named passes. Go instrumentation does not cover native Rust/C data races. |
| [Actual selected input prefix](evidence/actual-prefix-01/exit.json) | Exit 0 / 17.972 s; kernel maximum RSS 8,573,356 KiB | Genuine selected865 execution matched the frozen raw 0, 100M and 200M hashes. It stopped while Running. |
| [Tiny actual WASM differential](evidence/attempt-03/tiny-actual-machine.json) | Legacy and experimental hashes/proofs match | Actual native interpreter, wrapper offset, Finished padding, range refinement and returned-output isolation. This fixture is a trivial raw seven-step program. |
| [Actual tiny work accounting](evidence/attempt-03/tiny-actual-work-accounting.json) | Three aligned memo lists added **0** recorded interpreter steps | A completed memo avoids repeated aligned work in the actual tiny interpreter. It is not a selected-engine cost benchmark. |
| [Independent bounded model accounting](evidence/attempt-03/model-work-accounting.json) | Underlying steps remained **31 → 31** over three lists | Independently counts actual interface Step work, rather than inferring reuse from factory calls. |

## Exact candidate and input binding

The eight frozen owner files were copied as ordinary files, then checked against the producer's [candidate manifest](evidence/attempt-03/candidate-source-manifest.json). The selected source versions include client pool `513d22ae3641745eb330ffbc52749595f31eb3d6132395c17b21e211734d891a` and canonical identity `d674b66890d9f6047ab45fa1f38dadb9b77b73b43d9a318b8e014b8eb3cac6ec`. The independent [test-source manifest](evidence/attempt-03/integration-source-manifest.json) identifies the exact formatted tests compiled on Runpod.

The original input is 2,574,999,906 bytes, SHA-256 `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`. The actual prefix rechecked its bytes, decoded canonical V2 identity `0x08973daea4ae4bc44f95f1b17101780ff0efb51876e6205f258e3ce3a9293db2`, and resolved module root `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`.

[Reference extraction](evidence/reference-v1/prefix-reference.json) binds sample indices to the immutable full-proof file and CLI trace. [Actual prefix output](evidence/actual-prefix-01/actual-prefix-result.json) records all three matching hashes at wrapped indices 1, 100,000,001 and 200,000,001. The real recording helper executed 200,000,001 wrapped steps across five Step calls. It refused to serve an unfinished coarse history, returned an independent snapshot map, and released the input resolver reference on explicit Destroy (0 → 1 → 0).

The prefix never constructed `NewMachineCache`, never called `CommitFinal`, and never manufactured a Finished state. It does not measure retained full-run or refined-range performance across the 1.444 trillion-step terminal execution.

## Correctness covered

The tests call the actual cache, execution-run, BoLD wrapper and client-pool code. The server interface model uses clearly labeled opaque hashes and synthetic proof bytes; the separate tiny fixture and original-input prefix use real native machines.

The suite checks exact early-Finished list lengths and padding; raw-to-wrapped offset; backward and refined queries; immutable returned lists, step results and proofs; canonical map-order reuse and changed-field/module-root separation; owned input snapshots; factory error and retry; explicit nonzero root policy; queued borrower cancellation; active-entry capacity; idle eviction; exactly-once Close invocation; and error, canceled-owner and last-machine clone cleanup. A canceled Await cannot let a second server callback use the same machine while the first callback is still working. Memo exhaustion falls back to real exact stepping; arithmetic overflow rejects before work.

## Acceptance boundaries

- Candidate 01 is frozen. A separately reviewed health-cancellation replacement is being prepared by the source owner; these receipts do not silently accept that later source.
- Client cache limits bound known logical entries and pending creations. Close counts are invocations, not acknowledgments of remote physical memory reclamation. An allocation whose create response is lost needs server-side orphan/idle cleanup evidence.
- Close is asynchronous. The canceled-owner tests use a cooperative builder; they do not promise bounded completion for an uncooperative callback.
- Aligned completed memo reuse is measured here. Full-input key-copy cost, refined-range replays, all snapshots' physical memory, server orphan lifetime and the complete dispute's repeated-work budget need their own receipts.
- No full bisection, assertion confirmation, exact edge-collateral refund, assertion-stake withdrawal, storage/20-game capacity, production artifact pairing or public deployment is accepted by this packet.

## Reproduction and preserved attempts

[run-isolated.py](run-isolated.py), [run-race.py](run-race.py), and [run-prefix.py](run-prefix.py) are **Runpod-only controllers**. The frozen remote SDK for this packet is `/root/gl3-host-cache-integration/attempt-03/nitro`; normal and race binaries/logs are in `attempt-03/` and `race-01/`. The actual prefix used the already compiled attempt-02 server binary, SHA-256 `e471752551e6225fc7c7a55ef0411353e2db631b96aae73682dc0e201750eba5`, and its own explicit environment and output directory.

Attempt 01's compilation failed because this independent copier omitted the native header directory. Attempt 02 compiled; all ordinary behavioral tests passed, but the regular suite also invoked a prefix-only guard that used Fatal without its explicit environment. The test now skips that separately gated mode in the regular suite. Both failures remain in [preserved evidence](evidence/); neither was a production-source regression. The explicit original-input prefix subsequently passed using that same attempt-02 binary.

The [archive receipt](evidence/archive-receipt.json), [per-file manifest](evidence/evidence-manifest.json), and [test counts](evidence/test-counts.json) accompany the raw logs and exact source hashes. The archived packet is 28,211 bytes, SHA-256 `fb0ab35a568312a7b3e7def6a9b74d9feed6ec53464c258b4e7b5e34d93026e5`.
