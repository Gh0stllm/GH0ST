# Quorum-query research candidate, 2026-11-16

Status: **synthetic local verifier and arithmetic model only**. No Stockfish query engine, public-node routing, certified membership import, canister deployment or funding change exists here. This is not a production-ready or measured 100 ICP solution.

## Candidate

A query chunk could execute the unchanged engine on separate ICP subnet replicas. An untrusted transport collects the same reply from at least9 distinct members of a13-node subnet. A small replicated update verifies all node signatures and atomically commits the authenticated state patches. The transport performs no chess computation and cannot forge a quorum, although it can delay/drop work. This is **custom quorum-attested query execution plus consensus state commits**, not normal ICP replicated execution of the entire engine. Its security depends on the reviewed quorum construction, freshness/membership rules and at most4 Byzantine subnet members.

The official HTTPS specification authenticates each query reply's status, reply bytes, timestamp and request ID with the responding node's key; authenticated `/subnet` certificates carry the node-key set and canister ranges. Nine distinct verified members agreeing on one reply bind the full request and output under that fault assumption. Standard one-node query verification alone does not provide a quorum.

The toy verifier binds the canister, method, engine policy, module epoch, key-set epoch, incoming transition commitment and monotonically increasing nonce. Each patch list is ordered, bounded and non-overlapping. Its post-commitment is a hash chain over the prior commitment and canonical patch list, **not a repeated full hash of163MB engine memory**. Genesis state must first be authenticated and hashed; deterministic patch application then preserves the committed state. Production serialization must capture all mutable engine/search state, not merely the TT or board.

`verifier.mjs` uses real Ed25519 signatures and the ICP representation-independent hashing/domain format. The trusted keys are explicitly synthetic and `allowSynthetic:true` is required. It contains no BLS certificate verifier and cannot accept a production membership assertion. Actual public node responses, DER key parsing and subnet certificate/migration logic remain gates.

## Limits that can defeat the budget

- Official query cap:5B instructions; the cost model leaves1B for query serialization/hash work by using4B for engine work.
- The representative972.184B engine-instruction move would require about244 chunks, not the current35 replicated chunks.
- Official ingress payload cap:2MiB; query responses can be3MiB. Nine signatures share a single reply blob in the proposed commit. The toy JSON encoding is conservative and not the final CBOR/Candid wire format.
- Ingress reception costs2,000cycles per byte. Dirty TT/history/state deltas can erase query-compute savings. We have **no measured delta size**. Table scenarios must not be quoted as achieved costs.
- Query responses are nonpersistent. Each next query must see the exact newly committed engine state, or reject/retry. Do not rely on a private replica process retaining query mutations.
- Need reach9 distinct current subnet nodes; gateway caching or routing the same node is insufficient. A transport-path/availability test remains mandatory.
- Query capacity is best effort and rate limited. Failure must pause/refund the game rather than silently shorten the search or switch to a private CPU.
- Every member's signed reply must bind the same state/config/epoch. Controller upgrades, membership rotation and code epochs need an audited rule; nodes running stale state must never be counted.
- Signature verification, patch capture/restore and real native/Wasm parity need actual canister measurements. Time/chunk determinism must preserve the full24m budget, NNUE, Hash128, Threads1 and every retained state component.

## Reproduce local checks

```
node research/chess/engine/quorum-query-20261116/test.mjs
node research/chess/engine/quorum-query-20261116/cost-model.mjs
```

The tests generate13 local Ed25519 key pairs and cover successful9-signature verification plus rejection of duplicate/unknown identities, too few signatures, wrong request/canister/method/input commitment, wrong module/keyset epochs, stale signatures/requests, corrupted signatures, reply disagreement, inconsistent post-commitment, payload overflow, overlapping/out-of-range patches and replay. No test asserts that the replies were computed by Stockfish or signed by actual ICP nodes.

## Primary sources

- [HTTPS query-response signatures and request binding](https://docs.internetcomputer.org/references/ic-interface-spec/https-interface/#request-query-call)
- [Replicated versus non-replicated execution](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#replicated-and-non-replicated-execution-mode)
- [Current query, message and execution limits](https://docs.internetcomputer.org/references/resource-limits/)
- [Cycle charges, including free query calls and ingress bytes](https://docs.internetcomputer.org/references/cycle-costs/)

The reference rate is the project's saved2026-11-15 certified1ICP=1.6389Tcycles, not a current exchange-rate assertion. The conservative17.99ICP planning allowance already includes initial allocations;13ICP previously converted must not be added again.
