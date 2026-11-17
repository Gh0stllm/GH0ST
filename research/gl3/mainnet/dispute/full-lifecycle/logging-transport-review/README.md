# Lifecycle logging and validation transport review

Read-only investigation of the stopped **c03c** private lifecycle run. This is neither a new lifecycle test nor evidence that selected865's validation transport works. No old log, machine, source, database, prover, or other agent's process was changed. All log scanning and inventory execution occurred on the existing Runpod128 machine. No files were deleted.

## Confirmed cause

The original `/root/full-lifecycle/evidence/test.log` is **5,148,013,867 bytes**. A scanner read 1 MiB chunks, retaining at most 200 prefix bytes per line; it never allocated a whole giant line. Of 28,557 lines, exactly two exceed 1 MiB:

| Line | Bytes | Method / call | Actual error |
| --- | ---: | --- | --- |
| 22127 | 2,570,970,862 | `validation_createExecutionRun`, logId 5, attempt 0 | `write tcp 127.0.0.1:43824->127.0.0.1:42441: write: connection reset by peer` |
| 22136 | 2,570,970,862 | `validation_createExecutionRun`, logId 6, attempt 0 | `write tcp 127.0.0.1:48924->127.0.0.1:42441: write: connection reset by peer` |

Together these account for **5,141,941,724 bytes**. The largest remaining line is 681 bytes. A second bounded scan retained only 1,024 prefix and 1,024 suffix bytes per selected line. The suffix hashes and payload-free framing are preserved in `evidence/`; the argument bytes are deliberately not copied here. Both RPC results were zero with an error. These calls provide no successful execution-run creation receipt.

Pinned source in `/root/full-lifecycle/nitro` explains the log expansion:

* `util/rpcclient/rpcclient.go:59-63`: `TestClientConfig` leaves `ArgLogLimit`, `Timeout`, and `Retries` at zero.
* `:116-131`: `limitedMarshal.String()` JSON-marshals the complete value and copies it to a string **before** applying the limit. Zero means unlimited.
* `:139-147`: `limitedArgumentsMarshal.String()` formats each entire argument.
* `:165-208`: requests have a trace argument log; any non-known failure emits an INFO response log containing arguments, result, and possibly error data.

Setting a positive argument limit would reduce saved log size but would still create the complete multi-gigabyte temporary encoding when a payload is formatted.

## Independent transport blocker

The failed upload is more than a logging problem. The server read limit in this exact fixture is **32 MiB**:

* `system_tests/common_test.go:1840-1853`: `createTestValidationNode` copies `node.DefaultConfig`, exposes loopback WebSocket validation, and calls `node.New` without setting `WSReadLimit`.
* `go-ethereum/rpc/websocket.go:41`: `wsDefaultReadLimit = 32 * 1024 * 1024`.
* `go-ethereum/rpc/server.go:63-69`: a new server installs that default.
* `go-ethereum/node/rpcstack.go:372-374`: an override applies only when the configured value is positive.
* `go-ethereum/rpc/websocket.go:294-306`: the connection uses that read limit and `conn.ReadJSON`.
* `validator/client/validation_client.go:148-155`: one `validation_createExecutionRun` request contains module root, the complete typed `ValidationInputToJson(input)`, and the BoLD flag.

The roughly 2.571 GB logged RPC argument is far above this default. The two observed connection resets are consistent with this source-backed gate; this review did **not** recover a separately logged server-side read-limit error and does not claim to have done so.

The client's `WebsocketMessageSizeLimit = 256 MiB` is a **client response read limit** (`rpcclient.go:62,271-273`, `rpc/websocket.go:258-260`); changing it does not raise the server request limit.

`TestClientConfig.Timeout == 0` disables the client's per-response timeout (`rpcclient.go:79,180-188`). Its zero retries produce a single attempt per call. The fixture's four-hour `Arbitrator.ExecutionRunTimeout` is an **idle-run eviction period**, not an upload deadline (`validator/valnode/validation_api.go:112-122`). Creation first decodes the complete input and awaits the spawner before assigning a run ID (`:88-109`). A future upload must therefore have its own measured and bounded request budget, distinct from machine execution and idle eviction.

## Future-only design, not implemented by this review

1. Construct the private loopback validation node with an explicit **3 GiB server request cap**, recorded in its evidence. Keep one admitted large upload at a time. Do not disable all limits or expose this endpoint publicly.
2. Set the future validation client's `ArgLogLimit = 2048` as a fallback for ordinary messages.
3. Install a fixture-scoped log handler before heavy RPC calls. For the known input-bearing methods (`validation_createExecutionRun`, `validation_validate`, and any inspected write-to-file equivalent), remove raw `args`, `result`, and `errorData` attributes **before** passing the record to a formatter. It must never invoke the payload's `String`, `fmt`, or JSON marshal operation for logging. Preserve method, log ID, attempt, level, actual error, and `payloadOmitted=true`.
4. Log the already saved artifact path, SHA-256, byte count, module root, and start/end global-state identities as separate bounded metadata. A saved input artifact hash is not automatically a hash of the RPC wire encoding; preserve that distinction unless actual typed wire identity is measured.
5. Before a fresh lifecycle, test the logger with a sentinel Stringer that fails if called, including error and trace paths, and prove unrelated short errors survive.
6. Run a separate real full-size typed transport preflight on Runpod. A bounded decoder/receipt service should verify exact typed preimages and other fields, module root, flag, start/end, and byte counts, without invoking the chess engine or starting a long proof. First prove default/small-limit rejection, then the explicit cap's successful round trip. Measure elapsed time and peak memory, retain actual exits, and verify an over-cap request rejects. This preflight must precede any lifecycle acceptance claim.

The JSON request and decoded preimages may coexist in several allocations. The 128 GB diagnostic server appears adequate by rough size alone, but actual peak memory and timeout behavior remain **unmeasured**. A higher read limit by itself is not a successful transport test.

## Disk inventory: candidates, no deletion

At inspection, the filesystem had **22,611,189,760 bytes available**. `du` values below are allocated directory totals and can overlap; they are not guaranteed reclaimed-byte estimates.

| Candidate | Allocated bytes | Boundary |
| --- | ---: | --- |
| Failed CLI startup attempt `b763cfd5f3f746078460eb93889fd8f1` | 807,690,240 | Startup failed before readiness; source/config/errors/exits already exported. |
| Failed CLI startup attempt `4e98627af0674f3f84cf3c96a47c5bf2` | 2,141,376,512 | Same boundary; unready child DB. |
| Failed CLI startup attempt `a86875efe07342b1ae4a4c917167a831` | 2,141,376,512 | Same boundary; explicitly stopped unready CLI. |
| Three redundant CLI `accounts.ndjson` copies | 1,224,521,823 logical bytes | Four copies each 408,173,941 bytes share recorded SHA `d225cf819685a4dbb7016dffdb06c2a9cc665532d454a37279cf449a60e87534`; keep one source copy. |
| `/root/.cache/go-build` | 7,406,292,992 | Regenerable task build cache; shared future builds may need it. |
| `/root/gl3-aot-jit/source/target` | 3,855,028,224 | Rust cache explicitly retained for future proof/OSP builds; do not remove without coordinating. |

The three failed CLI directories are under `/root/gl3-cli-recovery/cli64-v1/`. Passed CLI recovery state, selected machine/source/prover/input, active checkpoint integration work, backups, and all historical proof/lifecycle evidence are excluded. The stopped snapshot's **2,781,983,950-byte `test.log.gz` is compressed historical log evidence**, not a second terminal input. No inference was made that ordinary compaction prunes historical disk.

These are review candidates for the root coordinator only. This review did not remove or truncate any artifact and did not restart a lifecycle.
