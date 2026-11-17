# Ordinary source05 transport configuration review

**Configuration research only. No configuration was activated. The ordinary
source05 binaries do not yet provide a complete accepted production transport
profile.** The current cache03 private lifecycle, its source and all running
services were left untouched.

[profile.json](profile.json) contains the proposed JSON fragments, exact binary
identities, null unknowns, source hashes and excerpts, and actual configuration
parser receipts. All executable checks ran through the existing Runpod dispute
lane. No builds, binds, node startup, engine work, wallet access or network writes
were performed. This is not license or production acceptance.

## What existing configuration covers

| Purpose | Exact existing CLI path / JSON path | Proposed value or boundary |
| --- | --- | --- |
| Interpreter validation | `validation.use-jit` | `false`; compiled default is `true` |
| Authenticated validation namespace | `validation.api-auth`, `validation.api-public` | `true`, `false` |
| Validator auth bind | `auth.addr`, `auth.port`, `auth.api`, `auth.jwtsecret`, `auth.origins` | loopback `127.0.0.1`, validation only; coordinated port and secret-file path remain null |
| Disable separate unauthenticated interfaces on dedicated validator | `http.addr`, `ws.addr`, `ipc.path` | empty strings; authenticated listener is separate |
| Validation client | `node.block-validator.validation-server.url` and `.jwtsecret` | explicit loopback authenticated endpoint and matching secret file; both remain null until selected |
| Client attempt policy | `node.block-validator.validation-server.timeout`, `.retries` | existing knobs; zero timeout and zero retries reproduce the passing fixture policy, but an outer upload deadline remains unresolved |
| Client log fallback | `node.block-validator.validation-server.arg-log-limit` | `2048`; bounds emitted text after full marshal, not allocation |
| Client **response** size limit | `node.block-validator.validation-server.websocket-message-size-limit` | retain `268435456`; does not set server request size |
| WASM collection directory | `validation.wasm.root-path` | null until a valid collection layout is staged |
| Expected module compatibility | `validation.wasm.enable-wasmroots-check`, `.allowed-wasm-module-roots` | `true`, exact selected865 allowlist |
| Node module selection | `node.block-validator.current-module-root`, `.pending-upgrade-module-root` | `current`, empty pending root; do not silently select an unrelated `latest` machine |
| Node retained cache | `node.block-validator.experimental-bold-execution-cache.{enable,max-entries,idle-timeout}` | proposed opt-in `true`, `1`, `4h`; not activated |
| Server run idle eviction | `validation.arbitrator.execution-run-timeout` | `5m`; not an upload deadline |
| Logging threshold | `log-level` | `WARN` on both processes as the existing client-payload suppression option |

Every dotted key above has an identically named `--` flag. The next group is
different: these fields **already exist in source05's JSON/koanf structs but have
no CLI flags**:

```text
validation.arbitrator.experimental-bound-execution-creations = true
validation.arbitrator.execution.cached-challenge-machines = 2
validation.arbitrator.execution.experimental-recorded-hash-stride = 4294967296
validation.arbitrator.execution.experimental-max-recorded-hashes = 4096
validation.arbitrator.execution.experimental-serialize-queries = true
validation.arbitrator.execution.experimental-refine-ranges = true
```

`cached-challenge-machines` also has a CLI flag. The other experimental settings
must be supplied via JSON, not invented flags. A configuration-only invocation
of the exact ordinary node parsed these shared structs successfully, then exited
through `--conf.dump`. That demonstrates typed configuration decoding; it does
not run final `Validate()`, authentication, machine loading or server startup.
Standalone `nitro-val --conf.dump` exits **before** its own typed decode, so a
validator dump alone cannot establish acceptance of arbitrary JSON keys.

The existing server creation gate admits execution creation after the RPC layer
has decoded the request, and can limit retained resident executions. It does not
replace a request-byte cap or a shared client gate before
`ValidationInputToJson`, and does not gate the separate `validation_validate`
method. The frozen client still converts directly in
`ValidationClient.Launch` and `ExecutionClient.CreateExecutionRun`; there is no
existing configuration knob for the fixture's shared before-conversion gate.

## The 3 GiB request cap is a concrete gap

The desired server cap is **3,221,225,472 bytes**. There is no existing CLI/JSON
field that sets it in these binaries:

- Ordinary `nitro-val` hardcodes `HTTPBodyLimit=math.MaxInt` and
  `WSReadLimit=math.MaxInt64` in `cmd/nitro-val/nitro_val.go:51-52`.
- Generic HTTP, WS and auth config structs and their `Apply` methods expose no
  body/read-limit field and do not overwrite those values.
- Ordinary `nitro` leaves the server WS limit at Geth's **32 MiB** default, so
  same-process `self-auth` is not a substitute for the large request cap.
- Geth does support `node.Config.WSReadLimit` and `SetWebsocketReadLimit`, but
  those Go APIs are not exposed by an existing ordinary operator flag here.

Runpod negative probes returned actual exit 1 for both an attempted JSON
`ws.read-limit` (`'ws' has invalid keys: read-limit`) and CLI
`--ws.read-limit` (`unknown flag`). The request-cap setting in the proposed
profile is therefore null. Raising the client's response limit does not fix it.
An explicit ordinary-server configuration change or separately accepted
enforcement layer would be needed; neither is implemented or selected here.

The prior [stopped-run review](../../dispute/full-lifecycle/logging-transport-review/README.md)
retains the 5,148,013,867-byte log and the 32 MiB source-backed limit. The reset
was consistent with that limit; it was not a recovered server-side limit error.
The later [full-size preflight](../../dispute/full-lifecycle/large-input-preflight/README.md)
passed with a test-only 3 GiB server cap, shared admission and logging handler.
Its 2,569,360,144-byte request left 651,865,328 bytes of cap margin. Those fixture
helpers are not silently present in the ordinary binaries.

## Which log levels avoid the giant formatting

The actual client calls are `validation_validate` and
`validation_createExecutionRun`. The latter sends the root, complete converted
input and BoLD flag in one call. Proof and hash methods can also return large
results. All use `util/rpcclient.RpcClient.CallContext`.

At `util/rpcclient/rpcclient.go:166` the request log is TRACE. At `:191-208` the
response log is TRACE on success/known errors and INFO on other errors. It
attaches lazy `limitedArgumentsMarshal` / `limitedMarshal` wrappers for `args`,
`result` and `errorData`. Geth's logger checks `Enabled` before creating a log
record (`go-ethereum/log/logger.go:159-173`). Therefore a stable **WARN or ERROR
threshold prevents those client wrappers' String/marshal operations**. This is
an existing configuration answer for the known giant client-error-log path.
Do not enable INFO/DEBUG/TRACE or a more verbose per-module override for that
profile without a payload filter.

`ArgLogLimit=2048` by itself is insufficient: `limitedMarshal.String()` calls
`json.Marshal`, copies the complete result to a string, then slices it. Zero
means unlimited. Rotation, JSON log format and a downstream log shipper also
cannot undo that work.

There is a separate conditional server-side limit to the log-level answer.
Geth `rpc/handler.go:533-538` decodes error data and calls `formatErrorData`
**before** making a WARN log call. The formatter's 1,024-byte output sink does
not bound its encoder allocation: the pinned Go `json.Encoder.Encode` builds
the encoding before writing to that sink. ERROR suppresses the emitted WARN
record but not this eager formatting. A later slog attribute filter cannot undo
an already formatted string. The inspected validation API has no intentional
raw-input `DataError` construction; it returns ordinary conversion/run errors.
This is a generic conditional path, not evidence that the selected validation
fixture emitted a giant server error-data object.

Consequently, WARN can avoid the known client payload wrappers without a new
filter. A production filter is required if INFO/TRACE metadata must remain
available while raw client payloads are always omitted. An unconditional
all-path no-large-formatting claim additionally requires addressing the eager
server callsite before formatting; a fixture-style handler alone is not enough.
No such source change is made by this review.

## Machine and authentication boundaries

The selected root remains
`0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`.
The existing machine file is
`/root/bounded-restore/fast-comparison/C-combined/machine/machine.v2.wavm.br`.
That **machine directory is not a valid collection root** by itself. The
locator scans child directories named `latest` or the exact root, with a
`module-root.txt`; machine loading then expects `machine.v2.wavm.br` and
`until-host-io-state.bin` inside the selected child. A staged production
collection path is not established here, so it stays null. No copy, link or
mutation of the current private run's layout occurred.

`self-auth` only uses an attached same-process stack; it does not discover a
separate `nitro-val`. A two-process profile needs the explicit loopback WS URL
and matching 32-byte-hex secret file paths. They stay null; no secret contents
were read. Use a coordinated port so node and validator defaults do not collide.
Origins are a browser-origin control, not authentication. The auth endpoint
also installs authenticated HTTP; an empty public `http.addr` does not disable
that separate listener. Geth permits IP-literal Host headers even with an empty
auth virtual-host list, so that list is not a no-HTTP guarantee.

Keeping the module compatibility check enabled is useful, but the ordinary
node's startup callsite logs a failed compatibility check and continues
(`cmd/nitro/nitro.go:422-428`). Do not treat that setting alone as fail-closed
proof of the deployed parent root/genesis binding. Independent exact production
binding remains required.

## Result

The existing source05 binaries cover interpreter selection, loopback JWT
authentication, conservative client logging, and the JSON-only server/cache
settings. They do **not** expose the required 3 GiB server cap or shared client
before-conversion admission. Endpoint, secret path, staged machine collection,
and upload deadline remain null. No runnable or activated production config is
claimed. The exact binaries are bound in the JSON packet to
`0724b8cc…8a9e3d` (node) and `e26b0a9f…61c083` (validator).
