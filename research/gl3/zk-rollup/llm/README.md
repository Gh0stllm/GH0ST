# Complete TinyStories ordinary Stylus adapter

This isolated adapter wraps the complete existing TinyStories INT8/Q12 numerical
runtime in an ordinary Solidity ABI. It preserves all 3,745,984 parameters, every
one of eight transformer layers, 16 heads, all 50,257 vocabulary logits and the
existing 64-token context. This is the already selected integer approximation,
not a claim of identity to upstream FP32 or a larger language model.

**Current gate:** actual ordinary Nitro activation and native Stylus execution
passed on Runpod for one-, two- and 64-token prompts, with all 150,771 final
logits, complete canonical checkpoint/KV hashes and stored caller results
matching. Ten rejection/rollback cases passed. Separately, native C++ / the
independent NumPy oracle matched every intermediate logit: 3,367,219 values across
these 67 positions. A 65th native token was rejected without changing the state.
The fixture installs EVM code directly and invokes `vm.Call`; it does not produce
mined deployment/inference receipts. No canonical zkVM execution or complete
model validity proof has passed here.

## Authenticated data and state

`pinned_runtime.cpp` is a byte-identical copy of the existing numerical source,
SHA256 `ca9ba3e41edfcb911537814c6247fce1feecf9bc969b19dcea39e5ad387dc931`.
Its complete existing raw Wasm is 39,300 bytes, SHA256
`d7ebddffb302ab1ffe5a13edc2d06109d8375ab143bfa923d1af9e2c139052c5`.
The ABI adapter produces a separate artifact with its own hash; the raw module
is not mislabeled as a Stylus contract.

The unchanged flat model is 4,401,034 bytes, SHA256
`6dc6dd216d0c4b12b81b0844244423e53bb8d7e4c726b8e6205683708971ef1f`.
It lives in 184 ordinary immutable EVM code-data pages, each at most 24,001 bytes
including a leading STOP byte. `registerPage` authenticates the complete page
against the embedded fixed model manifest before writing its address to ordinary
EVM storage. Validated page addresses cannot be replaced. Inference loads all
pages via genuine Stylus `account_code`, then hashes every concatenated model
byte inside Wasm through `gh_seal_model`. The privileged preverified-model
bootstrap is never used by this adapter.

The full prompt is an ordinary ABI-encoded input of 1–64 token IDs. Each call
reconstructs every preceding position and complete ephemeral KV using the same
numerical runtime. It does not persist a 730,516-byte checkpoint between calls
or claim the performance of an incremental KV cache. Recomputing history changes
cost and speed, not the model's supported context, arithmetic or output.

The contract returns the next token, SHA256 of all logits, SHA256 of the full
canonical checkpoint/KV and all 50,257 logits as 201,028 packed little-endian
int32 bytes. A successful call stores its result and prompt hash under a
model/arithmetic/caller-bound namespace with an expected nonce. Replays and
another caller's nonce fail. The model info ABI returns an explicit arithmetic
identity derived from the exact numerical source and context/layer/logit policy.
This is ordinary contract state, not an external inference signature or a
caller-provided expected checkpoint root.

## Execution and cost boundaries

All builds, inference comparisons and Nitro tests run only on the already
authorized Runpod Big worker. This lane uses two CPU cores and a 512 MiB Go heap
target. It creates no new infrastructure and performs no financial, public-chain
or license-acceptance action. Weights and generated binaries remain ignored.

`build_remote.py` builds with the exact WASI SDK 25 and checked integer flags,
generates the full pinned page manifest, and compares native C++ logits with
the independent NumPy oracle. `GH0STFullStylusLLM_test.go` is a separate actual
Nitro ArbWasm activation and real Geth EVM-call fixture using native Stylus.
There are no mocked vm_hooks or custom model-host precompile in that fixture.

Code-data publication still has a substantial one-time cost. At ordinary EVM
code-deposit pricing, 4,401,218 model/page-prefix bytes alone cost 880,243,600 gas,
before contract creation, initcode, calldata/DA and manifest registration.
This is a formula, not a measured deployment bill. The bounded fixture installs
pages directly as authenticated EVM account code and explicitly does not claim
that those publication transactions were executed. Actual activation/inference
gas and exact test scope belong in the recorded native evidence when available.

The linker selects only required initial memory: 94 pages / 6,160,384 bytes,
with a 128-page / 8 MiB maximum. This avoids unnecessary exponential Stylus
memory gas and does not remove weights, layers, vocabulary, KV capacity or
arithmetic checks.

| Complete prompt | Actual direct-call gas | Private gas allowance | Measured native call time |
| --- | ---: | ---: | ---: |
| 1 token | 31,690,952 | 100,000,000 | 0.091 seconds |
| 2 tokens | 43,965,756 | 100,000,000 | 0.150 seconds |
| 64 tokens | 816,486,330 | 1,000,000,000 | 2.791 seconds |

Actual activation consumed 8,281,894 gas; 184 bounded manifest registrations
consumed 96,975,958 gas altogether. These values reset StateDB transaction
memory/access accounting between calls. They exclude mined transaction
intrinsic/calldata/DA pricing and model page deployment. The final module is
48,801 bytes, SHA256
`69751699e4183d67eab3c226df239d8b0ae3b274a4dae4287cde1ca9988e8183`,
and its Nitro-compressed body is 19,196 bytes.

**Gas policy is an unresolved production gate.** Pinned Nitro defaults are
32,000,000 gas per transaction and block. The complete two- and 64-token calls
exceed that default. A 64-token call actually exhausted its 100,000,000-gas
allowance before succeeding under the explicitly larger private cap; that failed
run is preserved. Production needs reviewed larger limits or a resumable
contract/state design, followed by actual mined receipts and proving tests.
Owner-configurable limits do not establish acceptable block latency or proof
cost. No fee, mainnet latency or production throughput is inferred from these
standalone calls. [Pinned default limits](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/arbos/l2pricing/model.go).

`evidence/native-stylus.json` and `native-test-run.json` record the passing real
execution. The attempted fixture compilations/activation and 100-million-gas
failure remain under `evidence/attempt*`; they are not erased or promoted to
success. Source configuration, Linux target selection and transaction-boundary
accounting were corrected in the test harness without modifying shared Nitro,
the numerical implementation or its weights.

## Remaining validity-proof gate

A successful native Stylus call establishes ordinary execution compatibility,
not canonical zkVM execution or a validity proof. The separate canonical VM
integration must authenticate account code, model pages, prompt/caller/nonce,
prior storage and gas configuration; execute actual Stylus semantics; and bind
the post-state/receipt/output to a genuine EVM-verifiable proof. An Ethereum-only
guest, a tensor kernel proof or a signature cannot substitute for that gate.

The model revision is `roneneldan/TinyStories-1M` at
`77f1b168e219585646439073245fe87e56b3023e`. Public redistribution and production
license review remain separate; this packet does not accept a model or Nitro
production license.
