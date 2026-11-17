# Proposed ordinary06 full-size transport probe

**Proposal only. No validator process, endpoint or new transport test has been started.** This is a private negative transport test, not a successful execution-creation or production-startup claim. It does not replace the ongoing full dispute.

A successful `validation_createExecutionRun` cannot be called a zero-step probe: `NewExecutionRun` creates `NewMachineCache` immediately, whose background builder advances the real VM eagerly. Closing a returned run immediately or asking only for position zero does not remove that race. The frozen host sources preserve this behavior.

The proposed zero-step alternative uses the actual ordinary06 validator ELF (`dcd26a0e1a751e586413fd9f797ab06a9546331459673e46c6a6f30ff0a27e65`), the selected865 collection and original full-size typed input. Its request supplies the exact module root and unchanged input but intentionally encodes the final `useBoldMachine` parameter as a string. Pinned Geth decodes arguments sequentially, including the complete preceding `InputJSON`, then returns an invalid-argument-2 error before invoking the execution handler. Startup does not preload/step machines. Thus this exercises the ordinary authenticated server and full typed-input decoding without constructing an execution run.

Source boundaries in the frozen source05 base:

| Boundary | Pinned location |
|---|---|
| Sequential parameter decoding | `go-ethereum/rpc/json.go:424–437` |
| Invalid parameters return before callback | `go-ethereum/rpc/handler.go:577–586` |
| No machine preload at spawner creation/start | `validator/server_arb/validator_spawner.go:85–101` |
| Valid creation starts eager cache | `validator/server_arb/execution_run.go:30–44`; `machine_cache.go:66–98` |

The private process would use authenticated loopback only, ephemeral test authentication material, public HTTP/WS and IPC disabled, WARN logging, `validation.use-jit=false`, the 3,221,225,472-byte request cap and the reviewed creation/expiry settings. Its isolated machine collection must advertise the exact865 root and refer only to existing immutable selected machine bytes. No production owner, wallet, parent connection, public listener or financial setting is required.

Before a large request, small authenticated `validation_name` and `validation_wasmModuleRoots` calls must identify the real server and exact865 root. An unauthenticated probe must fail. A declared over-cap HTTP request can verify HTTP413 without generating a multi-gigabyte disk file. The unchanged original input must first match its frozen byte hash and canonical typed identity; any wrapper extraction must be explicit and hash recorded. No request body or giant arguments are logged.

The full-size request body should be streamed from the existing input with small framing buffers, recording its exact wire byte count/SHA. A second phase can send the same input through fragmented authenticated WS. Each must return a small JSON-RPC `-32602` invalid-argument-2 error. The original input's root and canonical identity remain unchanged; only the separate final Boolean parameter is invalid. A returned execution ID is an unexpected failure and requires immediate owned-process shutdown, not a follow-up search.

All work would run on Runpod, subject to the six-billion-byte disk floor and a separately reviewed memory/deadline budget that protects the active proof. No second full input file should be created. Record actual exits, elapsed time, process RSS/high-water, body bytes/hash, binary/source/config identities and small responses. Retain the original input unchanged.

Passing would establish ordinary06 private authentication, the configured large request path and full typed argument decoding. It would **not** establish valid execution creation, canonical server input digest equality, cache readiness, engine output, paired production genesis, public ingress safety or mainnet readiness. Those remain separate gates. A successful real creation requires a separately reviewed positive-step budget or a new explicitly reviewed lazy backend; neither is proposed here.
