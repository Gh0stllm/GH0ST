# Selected865 kickoff and proof-budget boundary

**Passed:** the real pinned Arbitrator/BoLD wrapper and inherited Solidity OSP
agree on the selected `865168…f086` machine's kickoff and first raw instruction.
This is a tiny initialization/boundary test, not a completed terminal replay,
history bisection, assertion confirmation or full incorrect-result dispute.

| Actual backend position | Observed machine |
| --- | --- |
| Wrapped step0 | Finished, original recorded start global state |
| Wrapped step1 | Running, inner raw step0 |
| Wrapped step2 | Inner raw step1, after one real entry instruction |

The measured kickoff offset is **one**. The pinned wrapper's source reports
`inner.GetStepCount() + 1` after kickoff, so a natural raw halt at `H` corresponds
to wrapped finished state `H + 1`. The long interpreter's eventual exact counter
must still be observed and checked against actual reviewed challenge geometry.

The native probe exited0 in6.62s. Solidity compilation/execution exited0 in33.97s.
Two authentic witnesses confirmed through the inherited EdgeChallengeManager /
OneStepProofEntry path; 14 negative checks rejected corrupt witnesses, wrong
claims/prestates/configuration/history, rival replacement and repeated
confirmation. The manager's ancestors/history siblings/assertion configuration
are explicit fixtures, as the report states.

The pinned raw-machine source limit is `2^43 = 8,796,093,022,208`. Direct Solidity
boundary units placed the same authentic initial running witness at synthetic
indices near that cap:

- At `2^43 - 2`, the instruction executes normally.
- At `2^43 - 1`, the inherited verifier forces an Errored machine with the same
  authenticated global-state hash.

These synthetic indices do not claim an eight-trillion-step execution. The
Solidity branch is a last-slot forced error, **not** an unrestricted step-index
range validator. Challenge geometry must enforce its permitted index range. A
natural raw finish `H` must satisfy `H <= 2^43 - 2` for its wrapped finishing
transition to avoid that forced-error slot; the intended private geometry may be
much smaller and needs separate review.

The [offset/cap receipt](evidence/offset-cap-boundary-receipt.json) binds the exact
selected root, machine, guest, C companion, host counter tool, native backend
library and unchanged original input. It deliberately leaves
`geometryAccepted`, `fullInterpreterAccepted` and `rootAuthorizationGranted`
false, with no invented final counter. Source/report hashes and actual process
exits are retained.

The original input was captured under the older `d453…613b` parent configuration.
It remains unmodified. This test loads the new candidate machine with that
original start state; it does not rewrite the old capture into a claim that its
parent had selected865. Both identities are explicit in the backend receipt.
An additional [direct input binding](evidence/input-start-end-binding.json)
extracts the actual start/end fields from the unchanged input tail and verifies
them against the capture manifest and probe metadata on Runpod.

[`probe.go`](probe.go), [`run-boundary.mjs`](run-boundary.mjs), the unchanged
[fixture harness](TerminalChallengeHarness.sol), and [`run.py`](run.py) reproduce
the tiny Linux-only checks. The source tree and machine copies were isolated;
the selected frozen machine/guest/input and active long interpreter were
untouched. All builds and execution ran on Runpod. No engine search, public
deployment or real spending occurred.

The direct contract checks use pinned nitro-contracts
`4341b132cfbdcc980ead03765ca5224ff6cb5d97`, compiler0.8.17 and source/artifact
hash validation inherited from the earlier regression. The complete
[Solidity report](evidence/boundary-solidity-report.json),
[native backend report](evidence/boundary-backend.json),
[authentic witnesses](evidence/boundary-selected-proofs.json) and before/after
artifact inventories preserve the evidence boundaries.
