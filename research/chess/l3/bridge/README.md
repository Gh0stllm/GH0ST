# Full model interpreter and persisted state bridge

This package connects the actual TinyStories integer Wasm runtime to a word-addressed persistent state store. It executes the full reviewed small model, not a mock tensor calculation. It remains a local integration package: no running L3, public precompile activation, parent settlement or fraud-proof challenge is established here.

## Deterministic admission and execution

Only the reviewed runtime SHA256 `d7ebddffb302ab1ffe5a13edc2d06109d8375ab143bfa923d1af9e2c139052c5` and complete model-data SHA256 `6dc6dd216d0c4b12b81b0844244423e53bb8d7e4c726b8e6205683708971ef1f` are admitted. Both are checked **before** interpreting the guest. The code supports the pinned TinyStories INT8/Q12/context64 variant, not arbitrary Wasm or arbitrary LLMs.

Each inference transition reads the weights and previous checkpoint from the supplied `Store`, creates fresh guest memory and restores the exact committed state. It uses wazero 1.12.0 in pure-Go interpreter mode by default. No WASI module, network, filesystem or other host import is installed for the nested guest. The interpreter path also builds for `GOOS=wasip1 GOARCH=wasm`.

The loader verifies SHA256 of **all** committed model bytes against both the pinned identity and stored metadata, copies those exact bytes into guest memory, then calls the explicit `gh_accept_preverified_model` bootstrap with the verified digest. This is a trusted state-transition-loader assertion; it is not user authorization or proof that arbitrary supplied bytes match a digest. The Go loader and its verification must be present in the matching replay/prover implementation. The standalone guest retains `gh_seal_model` for independent complete hashing.

Jobs bind caller identity, job ID, model/runtime identity, token transcript and monotonic generation. The expected checkpoint digest comes from stored job metadata, never a caller's claimed digest. Every chunk's restored phase, position and kernel sequence must match that metadata. Invalid work, stale generations, inconsistent state, guest arithmetic faults and storage failures produce no replacement job state. Successful changes commit the checkpoint and metadata together.

`Store.Commit` must compare its guard and apply all writes atomically. `WordAdapter` translates blobs into deterministic 32-byte keys and values, suitable for an ArbOS-backed adapter. Its compare/read/apply sequence assumes the chain's serialized transaction execution and atomic EVM rollback; it is not a general-purpose concurrent database implementation. Caller identity in the Nitro wrapper comes from actual `Context.caller`, not a user-supplied address.

## Public package API

```go
modelID, err := bridge.Register(store, wasmBytes, modelBytes)
engine, err := bridge.New(store, modelID) // interpreter default
progress, err := engine.Begin(store, caller, jobID, inputToken)
progress, err = engine.Advance(store, caller, jobID, progress.Generation, 512, 16)
// Repeat bounded advances until progress.Done.
logits, err := engine.Logits(store, caller, jobID)
progress, err = engine.Append(store, caller, jobID, progress.Generation, nextToken)
```

An advance accepts 1–512 output rows and 1–16 guest chunks. The pinned runtime makes this a bounded supported-code operation; there is no general-purpose Wasm fuel meter. Arbitrary module admission must stay blocked until deterministic metering/proving is designed and tested. Wall-clock deadlines do not decide consensus results. The execution context is `context.Background()`.

`Register` is a fixture/setup primitive that writes the complete code and model into the provided store. It is not a production public paged-upload protocol. A real deployment still needs bounded model upload, availability, metering, authorization and the authenticated registry/loader connection.

## Verified execution

The word-store integration recreates the host wrapper at every commit and the guest instance inside every operation. It executes two complete model positions and matches all 100,514 vocabulary logits against the independent reference hashes. The first input token 7454 predicts 2402; appending 2402 predicts 257. The test preserves all KV state and persists 36 commits.

Twelve focused tests reject wrong caller, duplicate job, stale generation, invalid budgets/tokens, incomplete-token append, corrupted committed checkpoint/model, compare-and-swap mismatch, unreviewed runtime and failed atomic storage commit. The model corruption check occurs before guest bootstrap. No private off-chain state is needed to resume a job.

`cmd/replaycheck` supplies fixture IO **outside** `bridge.Engine`. Its actual Go/WASI executable also completes one whole model position and matches native Go's full-logit hash and final checkpoint. This is a real nested-interpreter execution cross-check, not merely cross-compilation. The fixture command's WASI file imports are not imports of the model guest and are not part of the proposed state-transition API. See `evidence/wasi-execution.json` for exact binary and results. This executable is not a Nitro prover module.

## Actual debug Nitro ABI integration

[`nitro-overlay/`](nitro-overlay/) adds the full-model precompile at `0xA12`, wrapped in Nitro's actual `debugOnly` registry. Its five ABI methods use actual `Context.caller`, the pinned model ID from ArbOS state, and bounded work. `SeedGhostLLMGenesis` receives authenticated model/code bytes as trusted initialization input; it is not in the public ABI and reads no files. The initialization owner must revert its StateDB snapshot on any seed error. Missing or mismatched model configuration fails closed.

The real Geth `EVM.Call` and `StaticCall` fixture has executed all 18 persisted commits for one complete model position, matching all 50,257 logits and the same final checkpoint as the native/WASI reference. It passed caller isolation, static-call rejection, stale generations, duplicate jobs, work bounds, append, missing/corrupt genesis, debug gating and metered failure rollback after writes. Actual registered ABI metadata tests also passed.

The interpreter and optional native compiler both passed that fixture with identical checkpoint, logits and measured gas: one advance cost 245,844,125 gas; the complete fixture including failure probes used 10,090,709,081 gas, excluding genesis storage. The tests allow up to 2,000,000,000 gas per call. Storage is genuinely metered, but the computation floor is incomplete, so these are local fixture charges, not a supported public transaction budget or production fee quote. Local elapsed times were 16.129 seconds and 2.206 seconds respectively. See the [interpreter run](../nitro/evidence/llm-abi-dispatch-interpreter.json), [compiler run](../nitro/evidence/llm-abi-dispatch-native-compiler.json) and [backend parity check](../nitro/evidence/llm-abi-backend-parity.json).

The actual `GhostLLM.sol` interface also compiles with Solidity 0.8.30. All five functions' input/output types, mutability, signatures and selectors match the embedded Go ABI; see the [repeatable compiler check](nitro-overlay/compile-abi.mjs) and [bounded ABI evidence](nitro-overlay/evidence/abi.json). This ABI-only check performs no calls or transactions.

## Optional native compiler experiment

`NewWithBackend(store, modelID, NativeCompiler)` is an explicit native benchmark option; the default and Go/WASI replay path remain interpreter mode. It changes no job/model ID, metadata, return value, checkpoint or word-write policy. No mutable guest state is cached. Compiled code is immutable and tied to the pinned module.

The two-token cross-backend test compares every committed checkpoint byte, the complete word-write list at each commit and every final vocabulary logit. Focused input-rejection cases compare errors and unchanged state. These tests do not prove equivalence for every possible program/input. Native code generation uses host compilation facilities; a production native-versus-prover design still requires matched semantics and an actual fraud challenge. No gas reduction is implied because gas pricing has not been implemented here.

The old duplicated in-guest bootstrap hash took 148.778 local seconds for the two-token fixture. With the checked Go loader bootstrap, a run took 28.758 seconds with the same results. Separate native-compiler comparisons are in `evidence/native-compiler-comparison.json`. These are local measurements under the current machine/load, not a server SLA, chain latency, gas price or twenty-game budget.

## Reproduce

First prepare/build the pinned model fixture in `../llm/`. Then, from this directory:

```sh
../nitro/.cache/go/bin/go test -count=1 -v ./...
GOOS=wasip1 GOARCH=wasm ../nitro/.cache/go/bin/go build ./...
../llm/.cache/venv/bin/python run_wasi_check.py
```

The toolchain is the pinned Go 1.25.4 fetched by the Nitro experiment. Dependencies are pinned in `go.mod`/`go.sum`. Weights and generated executables remain ignored. No server, keys, public transaction or paid resource is used.

## Remaining production work

The local debug ABI now reaches the full model through metered ArbOS storage. Production genesis integration and model availability, complete interpreter instruction gas, native/replay/prover integration, a real incorrect-result challenge, bounds/cost analysis and parent escrow/finality tests remain separate requirements. The model is 3,745,984 parameters with 64-token context; no 7B/70B, Qwen or Stockfish port is claimed. The user’s 100 ICP and 0.003 ETH caps are unchanged and no twenty-game launch is established.

Primary runtime sources: [wazero overview](https://wazero.io/), [pinned v1.12.0](https://github.com/wazero/wazero/releases/tag/v1.12.0), [Nitro custom state transition requirements](https://developer.arbitrum.io/launch-arbitrum-chain/extend-the-protocol/stf).
