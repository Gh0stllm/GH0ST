# Host execution-cache integration · acceptance plan

**In progress, not accepted.** The cache and canonical identity have separate
source owners. This integration lane will freeze both revisions before copying
them into a new isolated Runpod source tree. It changes no selected machine,
guest, C companion, engine policy or published 150-minute reference.

## Required binding

An execution entry must bind the **resolved module root**, `useBoldMachine`
flag and canonical identity of the complete validated decoded
`validator.ValidationInput`. Wire JSON order, a message number, module root or
history heights alone do not identify an execution. Every typed field and map
group boundary must be covered. Capture-only expected-end metadata is separate:
reusing an execution must never reuse acceptance of a different asserted result.

Identity calculation and use must share an immutable input ownership contract.
The key must not describe old bytes while a resolver later reads a caller-mutated
map or slice. Query outputs also need isolation: mutating a returned proof,
hash-list slice or result pointer must not affect another borrower or a later
identical query.

## Differential matrix

| Area | Required independent checks |
| --- | --- |
| Canonical identity | Reordered map insertion and equivalent wire order; each typed-field mutation; root/flag separation; nested group boundaries; documented nil/empty semantics; expected-end claim checked separately |
| Ownership | Caller mutation after admission; returned proof/hash/result mutation; query output remains valid after borrower Close and eviction |
| Shared lifetime | Two borrowers share one input-specific run; one Close/cancel cannot close the other's active query; final eviction/Close happens once; failed construction and expired entries cannot become successful hits |
| Cancellation/error | Canceled waiter and canceled creator; underlying query failure; failed refinement; retry uses a valid entry or cold construction, never partial hashes/proofs |
| Serialization | Concurrent range/hash/proof/result requests produce reference-identical outputs; whole mutating query ownership spans stepping and result capture |
| Range and integers | Empty/reversed/overflowed ranges, zero stride/count, boundary indices, maximum sentinel versus ordinary positions, prepare-range before/after queries and overlapping refinements |
| Finished | Actual tiny-machine halt, exact end result, absorbing hash/proof padding beyond Finished, and the BoLD kickoff offset; no artificial claim that a sampled Running state is H−1 |
| Repeated work | Factory count, actual stepped-instruction count and retained/refined snapshots across coarse list → narrower list → proof → repeated list; distinguish first work from later reuse |
| Original selected input | Bounded actual prefix at raw0/100M/200M, comparing frozen full-proof reference hashes and reviewed wrapped+1 indices; selected artifact hashes before/after |

The default pinned `NewMachineCache` eagerly executes to Finished before its
build lock opens. Calling an apparently small fresh hash query through that
constructor can therefore trigger the full 150-minute terminal execution. The
real-prefix check must use a reviewed genuinely bounded construction path or an
explicit bounded host-interface adapter. It must stop after raw200M without
changing the guest or representing the bounded endpoint as an authentic halt.

Tiny real-machine tests and faithful bounded interface models will establish
lifetime/error/range behavior separately from the selected original-input
prefix. A model's synthetic hash/proof must never be labeled an authentic
selected865 witness.

## Evidence and claims

All compilation, syntax checks, tests and machine execution run on the existing
Runpod worker in a new isolated prefix. Every executed source, binary, input and
selected-machine identity, actual process exit and named test result will be
retained. The source owners' working trees and active jobs remain untouched.

No performance claim follows from retaining a remote run ID alone. The review
must show whether coarse recording avoids a second full hash walk, whether
refinement retains useful genuine snapshots, and how much actual work repeated
queries perform. Memory/latency observations are bounded to their measured
workloads; neither a four-hour full lifecycle, production storage/hosting nor
mainnet readiness follows from these tests.
