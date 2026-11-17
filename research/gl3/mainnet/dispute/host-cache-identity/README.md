# Canonical identity for a retained host execution

**Ready for independent integration review.** This package identifies decoded validation inputs for a host-side retained-run cache. It does not implement that cache, start a backend, replay a machine, authorize a lifecycle, or change selected865/Stockfish.

Actual Runpod result: **104 named tests/subtests passed**, exit 0, 25.430677106 seconds, maximum process RSS 6,743,964 KiB. The run includes a digest-only decode of the unchanged 2.575 GB original artifact; it does not execute that input. Tests ran with two Go CPUs. Earlier passing v1 is preserved; v2 strengthens alias checks after each mutation so repeated XORs cannot accidentally hide a shared buffer.

| Frozen source | SHA-256 |
| --- | --- |
| `identity.go` | `d674b66890d9f6047ab45fa1f38dadb9b77b73b43d9a318b8e014b8eb3cac6ec` |
| Final test source | `d07dd4ba5406a58cc3edacd7b8eb6669db3ec26da33398017164c43a8d22f925` |
| Final Runpod controller | `0897fb4a8f726ef855606bc5cb2258fa08615ba4ce77042297d4c31aea640817` |

## API and ownership

The package is staged as `github.com/offchainlabs/nitro/validator/hostcacheidentity` in its isolated Runpod tree. It exposes:

* `Digest(input)`: streaming SHA-256 of every decoded execution-input field. It reads caller data and does not copy or seal it.
* `KeyOwnedDecoded(moduleRoot, input, useBoldMachine)`: no-copy path for a **freshly decoded request whose exclusive ownership transfers to a private retained-run entry**. The server must expose no mutable aliases afterward. A digest cannot enforce immutability.
* `CloneAndKey(moduleRoot, input, useBoldMachine)`: deep copy of all maps, nested groups, byte slices and batch entries, then identity of the owned snapshot. Generic callers must prevent mutation during the copy. The recipient must keep the resulting pointer private and immutable; it is not a language-enforced immutable type.

`Key` has three separate comparable fields: `ModuleRoot`, `UseBoldMachine`, and `InputSHA256`. The root must already be the **resolved concrete root**. This helper has no locator and does not resolve a zero/default sentinel. Resolve it before lookup; otherwise a default changing from A to B could incorrectly reuse a root-zero entry.

## Exact encoding and coverage

Schema `GL3_DECODED_VALIDATION_INPUT_V2` uses domain/field/type tags, unsigned 64-bit collection counts, sorted map keys, and unsigned 64-bit length-delimited byte strings. Scalars have explicit unsigned/bool encodings. No JSON serialization or RPC wire hash participates.

| Decoded field | Encoding |
| --- | --- |
| ID, delayed-message flag/number, debug flag | Named typed scalars |
| Start state | Named four-field structure: block hash, send root, batch, position |
| Preimages | Group count; sorted type; per-group entry count; sorted hash and exact bytes |
| Batches | Ordered list count; numbered two-field structures and exact data bytes |
| Delayed message | Named length-delimited bytes, including when the flag is false |
| User WASMs | Target-group count; sorted exact target bytes; entry counts; sorted module hashes and exact bytes |

A runtime schema-field check rejects a change in the field sets of `ValidationInput`, `GoGlobalState`, or `BatchInfo` instead of silently ignoring a new field. All nine current decoded input fields are covered, including nonempty nested WASM maps and targets.

Nil and empty maps/slices/bytes normalize by length. A **present empty nested group** remains distinct from an absent group. This is conservative cache separation even when execution would treat both as unavailable. Empty group maps and nil group maps at the same existing group key normalize equally. Deep copying preserves the original nil/empty representation even where hashing normalizes it.

Tests cover 64 insertion-order permutations, 27 individual field mutations, root/wrapper separation, nil/empty behavior, six collection/field boundary cases, and ownership against changes to every nested byte/map class, including one source buffer shared across preimages/WASMs/batches/delayed data. Recipient mutation remains visible and is explicitly outside the immutable ownership contract.

## Original input key

For original artifact SHA `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`:

* Input SHA-256: `0x08973daea4ae4bc44f95f1b17101780ff0efb51876e6205f258e3ce3a9293db2`.
* Separate module: `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`.
* Separate wrapper mode: `true`.
* Decoded preimages: 402,818 / 1,911,582,985 bytes.

This V2 digest intentionally differs from the older transport-only fingerprint. The actual RPC wire hash is also a different identity; pinned JSON preimage-map order is unstable.

## Boundaries the cache owner must enforce

`InputJSON.ExpectedEndState`, decode-size/decompression hints, transport limits and claims are outside `validator.ValidationInput`. Decoding/limits must succeed **before** caching; expected end state and every claim must be checked separately. Never cache an acceptance boolean across claims.

This key neither authenticates the truth of supplied preimages nor validates an arbitrary WASM module. The unchanged backend/proof machinery must perform those checks. A cryptographic identity also does not establish cancellation, reference counts, query-output copying, state-range correctness, cache lifetime, memory bounds, sentinel resolution or proof acceptance. Those belong to the producer and independent integration tests.

Evidence is under `evidence/v2/`, including actual source, input key, process/exits, test log and source manifest. No selected source, replay artifact, engine policy, wallet, public chain or Git publication was changed by this lane.
