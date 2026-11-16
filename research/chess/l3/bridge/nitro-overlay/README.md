# Full-model debug precompile overlay

Copy `ArbGhostLLM.go` and `ArbGhostLLM_test.go` into `precompiles/` in the
exact Nitro source version pinned by `../../nitro/manifest.json`, then apply
`registration.patch`. `GhostLLM.sol` matches the embedded ABI. The nested
`go.mod` is only a module discovery boundary so that ordinary bridge checks do
not treat Nitro overlay source as a standalone bridge package. Dependencies
come from the pinned Nitro build and the exact local bridge replacement.

The actual registry wraps address `0xA12` in Nitro's `debugOnly`. This is a
local integration experiment, with no deployed chain, production tariff or
fraud-proof claim. ArbOS storage charges are real in the fixture; the small
deterministic computation floor is not complete interpreter instruction gas.
The full model therefore must not be enabled for production assets.

`SeedGhostLLMGenesis(backing, moduleBytes, weightsBytes)` is a trusted
initialization hook and is absent from the public ABI. Its caller provides
authenticated genesis input and must revert its StateDB snapshot on error.
The bridge hashes every code/data byte and admits only the reviewed runtime
and TinyStories model. The resulting fixed model ID is stored separately in
`GH0ST_LLM_CONFIG_V1`; missing or mismatching configuration fails closed.
No method reads files, accesses the network, accepts a model upload or accepts
an owner parameter. Actual `Context.caller` scopes every job and result.

The trusted loader hashes all model bytes before copying those exact bytes
into the fresh guest and calling the explicit preverified bootstrap. The raw
guest assertion is privileged host setup, not authentication. The Go loader
and interpreter must be included in the eventual matching replay/proof STF.

Methods are `start`, `advance`, `append`, `inspect` and `logitsHash`. Work is
bounded to 512 rows and 16 chunks per transition. Every call rehydrates from
authoritative ArbOS state. `advance` and `append` require the committed
generation; stale calls fail. The optional native compiler constructor is
for an equivalent local execution backend and does not alter job metadata,
ABI output, checkpoint bytes, storage write set or gas floor. The default is
the pure-Go interpreter, including Go/WASI builds.

`TestGH0STFullLLMNativeABIDispatch` uses real Geth `EVM.Call` and `StaticCall`,
Nitro's ABI dispatcher, real ArbOS storage, and the debug wrapper. Its local
advanced-precompile forwarder mirrors the official `gethhook` forwarder;
using it avoids an import cycle in the precompiles package. The test checks
all 50,257 logits via their independently established SHA256, caller/static
isolation, stale and invalid work, duplicate jobs, append, missing/corrupt
genesis, debug gating, and EVM rollback on a metered failure after writes.
Its 2,000,000,000 per-call gas allowance is an oversized local fixture limit,
not a supported public block budget or transaction fee.

The tests alone read ignored fixtures using `GH0ST_LLM_FIXTURE_DIR`.
`GH0ST_LLM_NATIVE_COMPILER=1` selects the native compiler comparison.
`GH0ST_LLM_ABI_EVIDENCE_PATH` records JSON evidence; elapsed time and backend
names are test diagnostics and never consensus values. Model weights and
compiled binaries remain ignored.

Run `node compile-abi.mjs` to compile the actual `GhostLLM.sol` interface with
the repository's existing locked compiler and compare all five functions to
the embedded Go ABI. The check compares input types, output types, mutability,
signatures and selectors; Solidity's generated method identifiers must match
independently computed selectors for the embedded Go ABI. The saved result is
[`evidence/abi.json`](evidence/abi.json), using Solidity 0.8.30. This check
uses no network or wallet and is separate from the actual EVM execution tests.
