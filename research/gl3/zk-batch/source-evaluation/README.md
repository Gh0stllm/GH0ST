# Complete EVM proof selection

**The exact sixteen-transaction batch passed a complete real CPU Groth16 proof, SDK verification and actual Solidity acceptance on Runpod.** Selected path: ethrex full EVM batch → SP1 → native Groth16 → Solidity verification. [Final proof and memory evidence](complete16/README.md) · [Solidity acceptance and rejection receipts](../nitro-baseline/verifier/README.md) · [Measured cost comparison](../costs/README.md).

| Component | Exact pin / boundary |
|---|---|
| Workload host | `lambdaclass/ethrex-replay` · `d6687b13f06f39510cf71abafe0e6a5fe2ab3c80` |
| Native EVM source | `lambdaclass/ethrex` · `890efb6bf5dcc09b650cf105b8444d3793dffdf0` · package 15.0.0 |
| Official released guest | ethrex v15 release source `f902422ada4b4004c4e5e0630987d116661a5dd0`; ELF SHA `25270f23…59bbb`. Its source pin differs from the native host. |
| SP1 SDK / prover | **5.0.8**, from the actual replay Cargo.lock |
| Native SNARK wrapper | `sp1-recursion-gnark-ffi` **5.2.4**, circuit **v5.0.0** |
| Solidity verifier family | SP1 **v5.0.0**, to match the wrapper circuit; not a v6 verifier |
| Host Rust | **1.90.0** |
| SP1 toolchain installer | Verified `cargo-prove` **5.0.8** release asset |
| Proof kind | **Groth16**, including core execution proof, recursion and final EVM wrapping |
| Workload | Sixteen ERC20 transfers; one real EVM block/batch, seed 0, one sender. Optional four-transaction screen is execution only. |

The custom generator executes real token setup outside the measured block, folds the resulting account/code/storage state into genesis, signs actual Ethereum transactions, creates blocks and execution witnesses, and invokes the ordinary full EVM guest. Token execution is not replaced by a custom balance ledger. Native-value-only transfers were rejected as the primary workload because they do not exercise contract EVM opcodes. [Generator documentation](https://github.com/lambdaclass/ethrex-replay/blob/d6687b13f06f39510cf71abafe0e6a5fe2ab3c80/docs/custom_blocks.md).

The native generator ran `ethrex-replay custom block --tx erc20-transfer --n-txs 16 --seed 0 --n-senders 1 --no-zkvm`, exported the folded genesis, sixteen signed transactions and archived input, and completed with actual exit 0. The block consumed **833,848 gas**. The 0.2395-second outer measurement includes generation, witness construction and native replay; the native engine's separate logged pipeline time was 1.41 milliseconds. These are native execution results, not proving times. [Actual receipt](cloud-native16/workload16/native-result.json).

The full run uses a small host-only SDK runner that computes the expected public output through the native EVM, then reuses one explicit CPU client and key for guest execution and a single real Groth16 proof. It requires exact equality of the 160 public bytes before proving and again after native verification. The official guest bytes were also located and compared in full inside the runner ELF. The optional four-transaction screen was not used. [Frozen runner and intent](run16/intent.json), [source](run16/runner.rs).

## Compatibility findings that prevent wasted work

The published replay **v7.0.0-rc.0** binary was downloaded and its release digest verified. Its help advertises ERC20 custom blocks, but the matching source contains an unimplemented ERC20 branch. It is not an accepted ERC20 proving path. The current source is required.

The latest ethrex v31 / SP1 v6.9 guest is incompatible with the selected v5 stack. The selected published ethrex v15 guest has a separately recorded release source `f902422…`, different from the native host's locked `890efb6…`. Actual guest execution decoded the exported witness and matched all five native public fields: initial state root, final state root, last block hash, chain ID 9 and transaction count 16. Genuine proof and Solidity acceptance remain required. Identical host and guest source commits are not assumed. [Execution binding](run16/preproof-execution.json).

The replay CLI currently discards its completed proof object. The research runner therefore needs a small host-only evidence-export change retaining the proof, public values, program verification key and timing. The EVM guest and proof-system math remain unchanged.

## No Docker dependency at the final wrapper

The SP1 SDK exposes `native-gnark`, which propagates to the native Go FFI implementation. This avoids a late Docker-in-Docker failure at Groth16 wrapping. The SDK and native wrapper identify their licenses as MIT OR Apache-2.0. [SDK source](https://github.com/succinctlabs/sp1/tree/v5.0.8/crates/sdk), [native wrapper source](https://github.com/succinctlabs/sp1/tree/v5.2.4/crates/recursion/gnark-ffi).

The optional v5 GPU server is `public.ecr.aws/succinct-labs/moongate:v5.0.8`, with the registry manifest pinned separately. An external CUDA server endpoint avoids nested Docker. Its old GPU source carries **BSL 1.1**, with a non-production grant and restricted production use; it must not be represented as a permissive production stack. CPU proving remains the selected permissive path. [GPU license](https://github.com/succinctlabs/sp1-gpu/blob/dev/LICENSE).

## Measurement and comparison contract

Record setup/download/build time separately from witness generation, native execution, key setup, core proof, compression, final Groth16 wrapping and Solidity verification. Measure whole-process-tree RAM and, if a GPU is used, GPU memory. A complete result requires a real proof, correct public outputs, actual Solidity acceptance, and rejection after changing the proof/public values/key.

The matched Nitro lane receives the exact ERC20 runtime, initial token state and signed transaction fixture. Report chain/fork/fee differences explicitly. Nitro's native replay and parent data posting are different operations from a ZK proof. The earlier private BoLD dispute duration is not an apples-to-apples per-batch proving benchmark.

The current 64 GB CPU worker is a guarded build candidate, not proven full-prover capacity. No peak RAM, proof latency or verifier gas result is invented from documentation.

The initial broad dependency fetch was stopped because it included unselected optional backends. The selected SP1 build then compiled the EVM and SP1 dependencies, but its C++ binding generator invoked nested Cargo metadata against the persistent filesystem. A bounded cloud I/O sample measured 100 tiny-file creates at 0.00265 seconds on the worker's fast disk versus 0.837 seconds on the mounted volume. The selected build attempt was preserved with actual exit −15 while only its task-owned Cargo registry was relocated to fast disk; source and proof policy were unchanged. These are setup measurements, not proof performance.
