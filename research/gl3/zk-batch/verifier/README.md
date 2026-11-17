# GL3 · real SP1 Solidity verifier

**Compilation passed on Runpod. Actual proof verification and gas measurements are pending.** This is the unchanged upstream Groth16 verifier, not a mock.

| Item | Measured or pinned value |
| :--- | :--- |
| Source | `succinctlabs/sp1-contracts` commit `512b5e029abc27f6e46a3c7eba220dac83ecc306`, tag v5.0.0 |
| License | MIT |
| Compiler | Solidity `0.8.30+commit.73712a01.Emscripten.clang` |
| Settings | Optimizer 200 runs, London EVM, metadata bytecode hash disabled |
| Actual compiler-process result | Exit 0, 1.961 seconds, kernel maximum RSS 371,332 KiB |
| Creation / deployed code | 6,291 / 6,260 bytes |
| Deployed-code Keccak | `0xb3f9675d216042c6847cc54900be951525384faf4b95f60efc894083b524ec43` |
| Expected circuit verifier hash | `0xa4594c59bbc142f3b81c3ecb7f50a7c34bc9af7c4c444b5d48b795427e285913` |

The next job must use the newly generated full EVM proof, its actual program verification-key hash and public values. It must mine a successful verifier transaction on a private official Nitro parent, then mine reverts for a changed proof body, changed public values and changed program key. The actual receipt gas and batch-data publication cost will be reported separately. Compilation alone supplies neither a proof nor a gas result.

No public deployment, wallet or real funds are used. A successful single-batch benchmark would still leave production state coordination, bridge/withdrawal integration and operational security to build and review.

[Source lock](source-lock.json) · [Compiler](compile-verifier.cjs) · [Compiled artifact](evidence/verifier-artifact.json) · [Actual process measurements](evidence/compile-result.json) · [Compiler output](evidence/compile.log)
