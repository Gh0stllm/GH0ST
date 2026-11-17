# Proof-stack source review

**Read 17 November 2026; scoped dependency review, not a security certification.** The working portability and earlier EVM references use SP1 5.0.8 and the v5 wrapped Groth16 verifier. The new canonical STF guest has not produced an accepted full proof.

The maintainers' June 2025 Plonky3/Rust-verifier/embedded-allocator advisory lists versions below 5.0.0 as affected and 5.0.0 as patched. [GHSA-6248-228x-mmvh](https://github.com/succinctlabs/sp1/security/advisories/GHSA-6248-228x-mmvh).

The April 2026 recursion row-count advisory explicitly excludes SP1 v5. The October 2026 tensor-length advisory covers v6.0.0–6.8.0 native verification and identifies 6.8.1 as patched; it states that wrapped Groth16/Plonk verification is unaffected by that issue. These advisories do not list our selected v5.0.8 path as affected. [Row-count advisory](https://github.com/succinctlabs/sp1/security/advisories/GHSA-63x8-x938-vx33) · [Tensor-length advisory](https://github.com/succinctlabs/sp1/security/advisories/GHSA-p7v2-jjv3-8p8f).

This is not evidence that every possible issue is excluded. Exact guest/toolchain reproducibility, authenticated machine/preimage/inbox handling, complete execution/proof verification and custom coordinator/bridge review remain required. The isolated Rust 1.93 compiler with the v5 RV32 guest ABI has passed an actual small execution probe; that result does not establish full STF compatibility or compiler correctness for every path.

No advisory-driven version change or proof-security override is applied in this milestone. Before selecting a production release, recheck the maintainers' current advisories and pin the complete source, guest, verifier and circuit identities together.
