# Actual Solidity verification · full sixteen-transaction EVM proof

**Private parent verification passed**, including three meaningful mined rejection cases and publication of all sixteen raw signed transactions. The fresh job exited **0 in 41.608 seconds**; an independent read-only audit checked the exact proof/public-value calldata, raw receipts, DA bytes, source identities and process cleanup.

| Actual private Nitro-parent measurement | Gas / bytes |
| --- | ---: |
| Valid SP1 v5 Groth16 verification | **227,263 gas** |
| Verification calldata | 612 bytes |
| Groth16 proof / public values | **260 / 160 bytes** |
| Separate uncompressed transaction DA | **59,152 gas** |
| DA payload / sixteen raw signed transactions | **2,905 / 2,864 bytes** |
| Valid proof + separate DA | **286,415 gas**, two transactions |
| One-time verifier deployment, excluded above | **1,404,856 gas** |
| Invalid proof / public values / program key | 227,281 / 227,269 / 227,269 gas; each mined status 0 |

Both ZK component receipts charged zero `gasUsedForL1` in this private fixture, so their measured compute component is also **286,415 gas**. The matched [Nitro baseline](../README.md) charged **175,613 compute + 3,628 posting = 179,241 total parent gas**. These are actual private component observations with different pricer initialization, not an all-in mainnet fee comparison. No fresh Robinhood fee quote was obtained. The two-transaction ZK total includes an extra transaction base cost; a combined rollup coordinator was not built or priced.

## Exact proof and verifier binding

The actual CPU-generated proof bundle has SHA256 `dea65006b2032b67ab8fc0cefd2c858e88765f2a60f33d043dbebebde1fdd9fe`. Its SDK-verified output commits the native EVM pre-state, post-state, last block hash, chain ID **9** and **16** transactions. All five fields were independently reconstructed into the exact 160 public-value bytes before this job. The proof is from the real full ERC20 EVM batch, not a toy ledger or a mock proof. Source/guest revision differences and cold proving costs remain recorded in the separate [EVM proof packet](../../source-evaluation/README.md).

The deployed verifier is the pinned upstream SP1 v5 source `512b5e029abc27f6e46a3c7eba220dac83ecc306`. The live runner checked its exact runtime bytes, `VERSION() == v5.0.0`, and verifier hash `0xa4594c59bbc142f3b81c3ecb7f50a7c34bc9af7c4c444b5d48b795427e285913`. The actual mined valid transaction's input was independently decoded and matched to the SDK-verified program key, all public values and proof body.

The proof-body negative decodes the eight BN254 words after the four-byte selector and negates **C.y modulo the base field P**, preserving curve membership. The runner verifies both original and changed curve equations, nonzero/changed coordinates, selector, length and all other words. This produces a wrong pairing with valid curve points. The other negatives mutate public values or the program key. All three returned `ProofInvalid` in static checks, then **actually mined reverted transactions**, using approximately 227,000 compute gas under an 8,000,000 gas limit. Gas exhaustion was not accepted as evidence.

## DA and acceptance boundary

A separate data-only transaction to the test signer's own empty-code account published `GL3DA`, version 1, and the lossless RLP list of the exact sixteen signed transaction byte strings. The post-run auditor decoded that payload and matched every byte/hash to the original Rust workload. Its 2,905 bytes are uncompressed; Nitro's measured batch uses its actual compressed format.

This tests genuine proof verification and DA **components** on a private actual Nitro parent. It does not implement proof-bound rollup state acceptance, a coordinator, a bridge, ZK withdrawals or public mainnet deployment. No real funds or user wallets were used. All execution occurred on Runpod; all owned chain processes exited and were confirmed absent.

## Evidence and failures retained

[Final result](parent-evidence/verifier-result.json), [direct exit](parent-evidence/actual-exit.json), [controller acceptance](parent-evidence/controller-result.json), [SDK/native binding](parent-evidence/proof-binding.json), and [independent audit](parent-evidence/independent-audit.json) are readable separately. The [235-member evidence capsule](parent-evidence/verifier-parent-evidence.tar.gz) is **642,683 bytes**, SHA256 `57808abfb8ab4f90a677ed9353013c4b1c5709734389e48eeef504ff121f96de`; every member was round-trip hashed on Runpod. It includes actual receipts and calldata, frozen source, public configuration and both earlier failures, excluding private key/config files and closed databases.

The first attempt exited 1 / 9.620 seconds on Geth's transient “transaction indexing is in progress” receipt lookup. The verifier-only variant adds a read-only retry exclusively for that exact RPC error, bounded to five seconds/200 attempts, with no rebroadcast. The second attempt mined the genuine valid proof and DA but rejected its negative test because blindly corrupting a curve coordinate burned almost all forwarded precompile gas; it exited 1 / 41.041 seconds and was not accepted overall. The final version uses the valid-curve mutation above and passed. The original accepted Nitro baseline source remains unchanged.

The final job retained two CPUs, a five-minute deadline and a 1 GiB owned-file budget. Its kernel `wait4` max RSS of 506,180 KiB is a process/child high-water measurement, not summed pipeline RAM. Shared cgroup memory contains other jobs and caches and is not attributed to this verifier alone.
