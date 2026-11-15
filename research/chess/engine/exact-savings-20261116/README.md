# Exact savings research, 16 November 2026

No production change, spend, public deployment, or weaker bot is made. This lane
tests whether additional exact NNUE output reuse is a credible route to twenty
ordinary games within the 100 ICP total cap.

The existing selected engine retains full Stockfish19, the pinned 98,511,183-byte
NNUE, 24m nodes, Hash128, Threads1, maximum skill and per-game TT/history. Existing
actual-IC experiments already cut representative search work by about21%; a
further64-register/full-unroll experiment saved1.97% on a matched short prefix.

## New bounded native measurement

`build_probe.py` copies the cached pinned upstream native source and object files
into this lane's ignored `.cache` directory. It instruments `Network::evaluate`
after feature transformation, while still computing every affine result. A
16,384-entry direct-mapped probe compares **all1,024 transformed input bytes and
the material bucket**, so a hash collision is never accepted as equal input.
Each hit also compares the computed positional result. It is a measurement
probe, not an implemented result-skipping cache.

`test_probe.py` requests400,000 native nodes aftere4 using Hash128, Threads1,
Skill20 and no strength limit. Reference and probe both finish at400,080 nodes,
depth19, bestmovee7e5, scorecp-28 and an identical full PV. The probe sees209,226
NNUE evaluations and only260 identical affine-input hits (**0.12427%**), with
zero differing results. Entries consume16.1875MiB before container/runtime
overhead. This is one bounded native search, not full24m equivalence, IC cost,
or a universal cache hit-rate claim.

Applying that observed reuse fraction to the independent matched IC prefix's
affine work share would save only about0.0394% even if lookup and storage were
free. Actual Wasm hashing/comparison would add work. Native and IC stop boundaries
are different, so this is a directional calculation rather than a metered saving.
A larger or differently indexed cache could have a different hit rate. This
small cache is not a plausible order-of-magnitude breakthrough on this position.

## Why a local kernel improvement is insufficient

The matched actual-IC prefix attributes78.96% of metered instructions to feature
transformation plus affine work. The remaining21.04% already limits the gain
from making those two NNUE parts completely free to4.75times on that prefix.
The previous named Binaryen analysis says the dominant NNUE paths have no
Asyncify state instrumentation; removing a hidden Asyncify check is not an
available large saving there.

`analyze.py` applies that prefix fraction directionally to the saved972.755B
engine-cycle search and69.439B coordinator/relay sample, at the saved certified
1.6389T cycles/ICP rate. For800/1,600 decisions, hypothetical **free NNUE** still
projects133.78/267.57ICP before the saved operating allowance. Making both NNUE
and orchestration free projects99.89/199.77ICP before cold work/storage/reserves.
These mixed-scope projections are **not universal lower bounds**; they show why
the measured kernel lane is far from proving the requested budget.

There is no new verified optimization here that guarantees twenty different
normal games under100ICP. Whole retained-state prefix reuse can help identical
histories but opponents can choose uncached moves. Reducing node counts,
substituting a smaller network, discarding retained histories, or treating
unreplicated query/off-chain execution as consensus inference is not a valid
solution to the stated requirement.

## Native retained-state delta probe

A second measurement investigates the transport requirement of a speculative
query-quorum search design. `build_delta_probe.py` reuses the existing logical
retained-state serializer and runs **test-only**100k/200k searches from a fresh
game. The production24m policy is not changed or replaced by these short probes.
`analyze_delta.py` compares each post-search retained body with the new-game body,
encodes exact changed32-byte blocks with32-bit offsets, and compares zstd level3
compression of that sparse log with compression of the entire XOR delta.

| Requested nodes | Actual nodes | Changed bytes | Smallest measured lossless payload |
|---|---:|---:|---:|
|100,000|100,066|694,328|793,461bytes|
|200,000|200,247|1,177,852|1,443,841bytes|

Both lossless reconstruction paths reproduce every post-state byte. The retained
body is163,086,519bytes. Even the100k measurement is about7.75times a100KiB payload
target. This is not a proof that a smaller encoding is impossible.
Comparing the independently completed100k and200k prefix states changes569,685
bytes and produces an885,666-byte sparse compressed log. This comparison also
is not a genuine uninterrupted mid-search chunk.

These completed-search checkpoints omit recursive/live position state, Asyncify
stack, root move scratch, auth/journals, Merkle/state proofs and query signatures.
They also include end-of-search bookkeeping absent from a genuine paused search
slice. The figures are limited retained-state indicators, **not measured5B
query-chunk payloads or a complete executable continuation format**. A real query
protocol must benchmark exact mid-search state, transport, integrity checks and
consensus/security semantics before a fully-onchain/budget claim.

## Reproduce

```sh
python3 research/chess/engine/exact-savings-20261116/build_probe.py
python3 research/chess/engine/exact-savings-20261116/test_probe.py
python3 research/chess/engine/exact-savings-20261116/analyze.py
python3 research/chess/engine/exact-savings-20261116/build_delta_probe.py
python3 -m pip install --target research/chess/engine/exact-savings-20261116/.cache/pylib zstandard==0.25.0
python3 research/chess/engine/exact-savings-20261116/analyze_delta.py
```

Reviewable evidence is under`evidence/`. Binary/model/derived sources stay ignored.
The delta analysis also requires NumPy; the evidence records its measured version.
No candidate is promoted. Exact cache persistence, target IC-meter cost, complete
consecutive retained searches and game tests would be required before a genuine
optimization could replace the selected engine.
