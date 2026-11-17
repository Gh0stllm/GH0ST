# Guest / parent statement binding

This `no_std` Rust library implements the same 736-byte statement and prefix-range codec as the Solidity coordinator. It authenticates canonical sequencer/delayed wire records and exposes exact statement encoding. Private record fields prevent the range helpers from accepting caller-constructed wire/message hashes directly.

**Runpod tests pass:** actual exit 0 in 3.645 seconds; peak sampled RSS 377,069,568 bytes. Two cross-language tests use vectors exported from the actual Solidity registry/codec run. They check byte-for-byte ABI agreement, integer padding and length rejection, canonical accumulator equations, tampered wire fields/formats, reordered/missing records and prefix seeds. [Actual log](evidence/test.log) · [Result](evidence/result.json) · [Tests](tests/solidity_vectors.rs).

This is a codec and hashing library, not an execution proof. Its caller must authenticate the canonical machine/preimages, execute the actual state transition, track actual inbox reads and derive the resulting GlobalState. Passing host-supplied roots into this type cannot establish a valid transition. No complete guest integrates this library yet.

The locked baseline uses `tiny-keccak` 2.0.2. An isolated SP1 guest can select the separately pinned proof-supported hash implementation through its workspace patch; its exact dependency graph and new guest key must be recorded. No hash rule or security parameter changes are implied.

[Protocol encoding](../STATEMENT.md) · [Solidity results](../contracts/README.md).
