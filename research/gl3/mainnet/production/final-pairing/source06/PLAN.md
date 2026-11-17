# Source06 · production transport

**Approved implementation plan; no activation or ordinary rebuild is authorized by this file.** Source05, the active source03 dispute, the selected machine and the engine stay unchanged. Work uses a separate seven-file Go overlay, two CPUs, a three-billion-byte scratch guard and a six-billion-byte disk floor.

| Host file | Change |
|---|---|
| `validator/valnode/valnode.go` | Add the typed/flagged `validation.rpc-request-max-bytes` setting, default 3,221,225,472 |
| New `validator/valnode/rpc_request_limit.go` | Validate a positive, representable value no greater than 3 GiB; apply HTTP body and WS read caps to a stack configuration without binding it |
| `cmd/nitro-val/nitro_val.go` | Replace unlimited request values; apply the validated cap after generic HTTP/WS/auth configuration and before `node.New` |
| `cmd/nitro/nitro.go` | Apply the cap when embedding validation; ordinary nodes without validation retain their existing limit. Make parent-root compatibility failure fatal only for the enabled operator profile |
| New `validator/client/validation_upload_admission.go` | Promote the tested process-global one-slot gate with context-aware acquisition, cancellation recheck, once-only release and read-only statistics; expose a cold per-client opt-in |
| `validator/client/validation_client.go` | Snapshot the opt-in once per call; gate both `Launch` and execution `CreateExecutionRun` before JSON conversion until the RPC response/error |
| `staker/experimental_execution_cache.go` | Opt every paired RPC client into admission before startup; check every started client's actual `WasmModuleRoots()` support before enabling its BOLD cache |

The standalone validator changes from unlimited HTTP/WS request limits to a finite 3 GiB default even when the cache is disabled. When validation is embedded, the shared stack limits also affect any other HTTP/WS listeners in that stack. An ordinary node without embedded validation keeps its existing limits.

The gate is off by default. All clients participating in the enabled operator profile share one process-global semaphore. It bounds their conversion/upload work; it does not bound typed-key copying, native VM memory, other processes or callers bypassing this client package.

Enabled source06 uses an explicit, nonzero 32-byte hexadecimal value in the existing `node.block-validator.current-module-root`. It does not substitute an unrelated local `latest` root. Every paired RPC client must advertise that exact root. The ordinary startup compatibility check must also bind the actual parent root to it; disabled startup keeps its prior behavior. Source05's owned-resource rollback and repeated-start protection remain.

The production profile selects `WARN`, `validation.use-jit=false`, authenticated loopback validation, the 3 GiB cap and the reviewed cache/creation settings. WARN skips the known client lazy payload formatter. Geth's separate eager error-data formatting remains unchanged, so this plan makes no global allocation/formatting guarantee.

Focused Runpod tests will cover positive/zero/negative/oversized cap validation, effective authenticated HTTP/WS limits including fragmented oversize WS input, actual typed configuration validation, admission shared across both methods, waiting cancellation, errors, idempotent release, captured policy and opt-out, and exact per-client root support including valid non-latest roots. Configuration dumps alone are not validation/startup evidence. No chess search, prover, chain, production secret or public listener is needed.
