# Experimental client retained-run pool

**Frozen for producer integration and independent review.** This subtree contains only the optional client pool and tiny mock tests. SDK enable/routing glue and native server cache/serialization are owned by the producer. No default behavior, selected machine, identity library, engine, proof math, public chain or wallet was changed here.

| Frozen file | SHA-256 |
| --- | --- |
| `experimental_run_cache.go` | `513d22ae3641745eb330ffbc52749595f31eb3d6132395c17b21e211734d891a` |
| `experimental_run_cache_test.go` | `e08be891416c33720c13264f6e2dec182ca5fc975de8b52b0068127997aa1c25` |
| Identity dependency, unchanged | `d674b66890d9f6047ab45fa1f38dadb9b77b73b43d9a318b8e014b8eb3cac6ec` |

## Behavior

`newExperimentalRunCache(ownerCtx, spawner, ExperimentalRunCacheConfig{MaxEntries, IdleTimeout})` returns the private pool or an error. Query methods are `getMachineHashes(ctx, root, input, start, stride, count)` and `getProof(ctx, root, input, position)`; this BoLD pool explicitly keys `useBoldMachine=true`.

* Reject unresolved root zero before lookup. Use the frozen V2 `CloneAndKey` so generic caller maps/bytes cannot alias retained input. The caller must synchronize its original while cloning. A single clone slot bounds simultaneous snapshot work within the pool.
* Retain one master per exact comparable identity/root/wrapper key. Each borrower holds an idempotent lease; releasing it never closes the master. Per-entry query slots serialize actual query calls. Hash/proof results are copied before returning.
* Once underlying query work starts, an uncertain query error or cancellation detaches and closes that master; no partial result is returned or reused. Cancellation while merely waiting for shared creation or a query slot releases that borrower's lease and preserves healthy shared work. Owner cancellation/stop detaches every entry and closes existing masters exactly once.
* Maximum entries, idle TTL and idle LRU eviction bound logical retained entries. Active entries are not evicted for capacity. Saturation returns a capacity error instead of creating more entries or waiters. Idle expiry is checked on lookup as well as by a lightweight periodic sweeper.
* Pending creations retain a charged slot until their promise becomes ready, even after invalidation/stop. With no borrowers, they expire by the same idle TTL. A late master is closed rather than attached to a new entry. This keeps late-result observers bounded by `MaxEntries`.

An uncooperative creation factory/promise can retain its bounded observer/slot indefinitely. `stop()` does not wait for it, and further capacity fails closed. The actual `ExecutionClientRun.Close` initiates nonblocking closure; arbitrary implementations with a blocking `Close` or context-ignoring query `Await` are outside the supported interface contract. `Closes` counts invocations, **not remote close receipts**. Asynchronous remote closure does not prove an instantaneous physical-memory bound.

If a remote server allocates a run but its create response is lost before the client receives an ID/object, the client cannot close that unknown remote run. Server-side request-context/orphan handling or idle eviction must cover that case. This mock-only client suite does not prove such remote cleanup or a physical backend-allocation bound under ambiguous transport failures.

A just-ready creation can briefly retain its pending slot until its observer's completion bookkeeping runs. A capacity miss during that interval is conservative. Neither idle TTL nor this pool changes the native backend's eager scan behavior.

`stats()` returns a copied value: `Creates`, `Hits`, `Closes`, `Invalidations`, `Evictions`, `Entries`, `Leases`, `PendingCreations`, `PeakPendingCreations`. Root, input ownership and claim/decode checks retain the identity library's documented boundaries; expected-end acceptance is never cached here.

## Actual Runpod verification

Both normal and race-instrumented v2 runs passed **12 top-level tests plus 2 subtests**:

| Run | Actual exit | Total including build | Reported test runtime | Max RSS |
| --- | ---: | ---: | ---: | ---: |
| Normal | 0 | 12.330675818 s | 0.043 s | 473,540 KiB |
| Race | 0 | 15.148293141 s | 1.071 s | 514,552 KiB |

Tests cover master reuse, owned caller inputs and root separation, copied outputs/stats, forwarding query parameters, query serialization, in-flight failure/cancellation invalidation, queued cancellation preserving active results and other creation borrowers, active-capacity protection, idempotent lease/owner close, bounded pending creation with idle/late cleanup, creation errors/nil master, idle/LRU eviction, owner context and invalid configuration.

All execution occurred on the existing Runpod with two Go CPUs, using an ordinary copy of the immutable geometry43 SDK baseline plus the frozen identity source. Tests used only tiny mock spawners/runs. **No real backend, original full-size input, chess engine, replay, proof or lifecycle ran.** Integration must independently establish native behavior, prefix hashes, witness correctness and performance before any lifecycle approval.

Current evidence is under `evidence/v2/`; the 9,819-byte v2 export archive SHA is `5d7b4fab09002d286192aeeeddb17f674d31338fc8e34abfa46da5b4b1e4a09b`. Producer and reviewer received exact frozen paths/hashes before integration. No commits or publication were made by this lane.

The earlier `5096a596…f49040` v1 also passed its mock suite, but independent source review found that queued cancellation could unnecessarily abort another healthy owner and restart a long run. That policy was corrected in v2. Its source and raw passes remain in `evidence/v1/` (and the original flat export) as historical evidence, not the integration candidate. The v1 archive was 9,562 bytes with SHA `e8ed6ba8373a1e12248c6c31a2a8d2a676f17b9a38b1458a10f72db805fc7e61`.
