# Original full-size validation transport

**Passed on Runpod128**, using the unchanged selected865 machine and the original 2,574,999,906-byte input artifact (`bd81988d…08e90`). This is an initialization-only host transport test. It does not run a new engine search, full replay, dispute lifecycle, or public transaction.

| Measured result | Value |
| --- | --- |
| Actual process exit / duration | 0 / 66.714410857 s |
| Upload, initialization observation and close | 43.865702031 s |
| Maximum process RSS | 23,615,612 KiB (about 22.52 GiB) |
| Actual complete JSON-RPC request | 2,569,360,144 bytes |
| Actual streamed request SHA-256 | `6a2ef0b51daf99f4252ad45f4630cf017bc0e3a7ad0dc19c4e2d712ddf4f2e8f` |
| Explicit private server request cap / margin | 3,221,225,472 / 651,865,328 bytes |
| Decoded preimages | 402,818 / 1,911,582,985 bytes |
| Canonical typed-input digest | `d0e345814249c0825732665eb5745d9b1b1480d086887e1b67fa7955dac0aeca` |
| Real RPC execution-run ID | `8991328337855145746` |
| Real wrapped initialization | step 0, Finished, hash `0x16f3ededbb3f088f99d365f857ab1f2cf3a9336f4689fff3047f106551c488aa` |
| Closed-run query | rejected: `run not found` |
| Peak admitted uploads / remaining uploads | 1 / 0 |

The server audits the decoded `validator.ValidationInput`, covering all its fields: ID, delayed-message metadata and bytes, start state, debug flag, sorted typed preimage keys and exact bytes, ordered batch numbers and bytes, and sorted target/module WASM bytes. It separately requires selected865 and `useBoldMachine=true`. Module root and BoLD mode are **not part of the typed-input digest**; a future reuse key must bind both separately. The equality check on this real fixture is not an exhaustive field-mutation regression suite for a general cache key.

A private loopback WebSocket proxy forwards bounded chunks and hashes/counts the actual complete request without parsing or buffering it. The decoded server-side identity matches the original. The wire hash is deliberately separate from the artifact and typed-input hashes: pinned `PreimagesMapJson.MarshalJSON` iterates a Go map, so wire order can change across equivalent encodings.

The real `ExecServer` and `ArbitratorSpawner` create the run, load the real selected module, attach exact input/preimages and expose wrapped step zero. A **transport-test-only machine wrapper** prohibits positive step execution because the normal MachineCache otherwise begins scanning eagerly in the background. In the passing run, close happened before any positive step request: the guard's rejected-call count is zero. This proves transport, decoding, real backend initialization, a valid run response and closure; it does not prove a completed machine cache or normal long-run behavior. The ordinary future lifecycle must use its unguarded backend.

`Timeout=0`, `Retries=0`, and fallback `ArgLogLimit=2048` remain explicit. The preflight has a separate fifteen-minute enclosing context. Four-hour run idle eviction is not an upload timeout. The before-conversion upload gate in this test covers its controlled caller until response/error/cancellation; it does not protect arbitrary bypassing endpoint clients or bound resident execution runs.

The test-scoped logging handler removes raw validation `args`, `result`, and `errorData` attributes before lazy formatting. Twelve method/message/bound-attribute cases prove payload `String()` and `MarshalJSON()` are not invoked, while short errors and call metadata remain. Other tests prove active/waiting cancellation and error release, default 32 MiB rejection of a 33 MiB request, and explicit small cap acceptance/rejection. Small regressions exited zero in 2.039117505 s.

The bounded marker scanner separately passed six Runpod tests. It retains at most 2,048 bytes per line in 64 KiB chunks and accepts only complete short Go test2json-framed markers. It ignores a 128 MiB line and embedded/unframed fake PASS text. Future controller integration must use `-test.v=test2json`; old frozen logs/controllers remain unchanged. Framing distinguishes ordinary payload text within the trusted test process, not a malicious process deliberately forging the same control bytes.

## Preserved attempts and provenance

* `evidence/v1/`: failed API registration before upload because pinned Geth excludes promoted embedded methods. Actual exit 1 retained.
* `evidence/v2/`: transport returned a valid run response, but the test incorrectly required two independent noncanonical wire encodings to hash identically. Actual exit 1 retained; this is not promoted as a pass.
* `evidence/v3/`: final actual pass, exact source, source manifest, build/process/exit receipts, wire observation, typed server receipt, initialization and closure.

Final binary SHA: `e4d42418bdd424c1ffbbcf4bc440665153bb317da64bc4d0dac8c1f20bd88e09`.
Compiled Go test SHA: `2f731c53cce007742690ea61d9bcf8203a9d64320aada2b9e28eb8bab018b298`.
Source manifest binds the unchanged machine, guest, C companion, libstylus, module files and frozen geometry43 baseline. All compilation/testing occurred on Runpod with four Go CPUs; no selected source or old artifact was edited.
