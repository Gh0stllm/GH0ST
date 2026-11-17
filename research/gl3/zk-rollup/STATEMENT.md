# State and data statement · version 1 proposal

**Implementation proposal; not an accepted production protocol.** The static Solidity ABI is 23 words / 736 bytes. The existing five-word EVM statement is incompatible and must be rejected.

| Words | Field |
| --- | --- |
| 0 | Version = 1 |
| 1 | Deployment and chain domain |
| 2 | Monotonic transition index (`uint64`) |
| 3–4 | Fixed machine root; execution-profile hash |
| 5–10 | Before state: block hash, send root, MEL state/message hashes, inbox position, message position |
| 11–16 | After state: same six fields |
| 17–19 | Sequencer read start/end; authenticated range commitment |
| 20–22 | Delayed read start/end; authenticated range commitment |

All integers are ABI-left-padded. Range ends are exclusive. The coordinator's state equality hash is `keccak256(abi.encode(state))`; it is deliberately not Nitro's legacy GlobalState hash. The guest must retain canonical hashing internally.

The initial profile targets ArbOS 61 without MEL. All MEL fields must be zero; unsupported parent-context access must fail closed until authenticated context is defined. Only canonical `Finished` execution can produce an acceptable transition. Running, errored or `TooFar` outcomes are not success.

## Published data authentication

The registry reads canonical `Bridge.sequencerInboxAccs` and `delayedInboxAccs`. Anyone can submit the actual wire bytes; the registry checks their accumulator equation before storing commitments. Raw bytes remain publicly available in transaction calldata. Registration conveys no publishing or withdrawal authority.

Sequencer wire is the canonical 40-byte header plus batch bytes. The initial profile accepts header-only force inclusion and calldata/Brotli (`0x00`). DAS, blobs, custom and ZeroHeavy formats fail closed. Delayed wire is the canonical 113-byte header plus message data. Its message hash uses the packed 20-byte sender, not the padded wire sender, and a hash of the data. The encoded message index and sender padding are checked.

Range seed:

```
keccak256(abi.encode(rangeDomain, chainDomain, uint64(start), uint64(end)))
```

Sequencer step:

```
keccak256(abi.encode(previous, index, wireHash, beforeAcc, afterAcc,
                    afterDelayedCount, delayedAcc))
```

Delayed step:

```
keccak256(abi.encode(previous, index, wireHash, canonicalMessageHash,
                    beforeAcc, afterAcc))
```

Domain labels are `GH0ST_GL3_SEQ_RANGE_V1` and `GH0ST_GL3_DELAY_RANGE_V1`, each Keccak-hashed. The guest must reconstruct the same commitments from authenticated records and serve only those records to the actual interpreter. No duplicate, omitted, substituted or extra record may be silently accepted. Missing data is not EOF. Delayed reads are tracked independently of the global state's sequencer cursor.

The draft registry caps each call/range at 256 records and each wire at 131,072 bytes. These are bounded research settings; canonical batch limits and adversarial empty-batch/lookahead liveness must be checked before deployment. A limit that makes a real transition unprovable is a launch blocker.

## Proof and bridge acceptance

The proof must bind actual execution, not echo host-supplied roots. Source modules, instrumentation settings, machine identity, preimages and all served inbox records need authenticated identities. Serialized or AOT caches alone are not an execution proof.

Before seal, an atomic bootstrap may initialize a fixed graph of canonical bridge implementations and immutable clones. After seal, there must be no mutable proxy authority, generic administrative forwarder, alternative outbox or root-publishing role. The native child supply begins without unbacked prefunds. Parent escrow credits and releases require exact token balance deltas.

Positive withdrawal acceptance requires a genuine new guest proof, finalized send root, ordered canonical Merkle proof, replay rejection, receipts and reconciled parent/child balances. A unit fixture with a mock verifier or root cannot close that gate.
