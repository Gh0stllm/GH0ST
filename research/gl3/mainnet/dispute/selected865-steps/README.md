# Selected865 · authentic terminal witnesses

**Eight authentic witnesses pass the pinned Solidity OSP and inherited
EdgeChallengeManager terminal-proof path, with 56 strict negative checks.**
The final attempt exits **0 / 49.858 seconds** on Runpod. It uses the candidate
hierarchy `[8192,2048,2048,2048,1024]`: three big-step levels at 2,048 and a
small-step height of 1,024, for **2^43 machine steps**.

This is a bounded witness regression. Ancestor edges, assertion configuration
and 43 history siblings are explicit fixtures. It does not execute assertion
creation, full history bisection, target assertion confirmation or collateral
refunds, and grants no production geometry or root authorization.

[Final report](evidence/attempt-02/solidity-report.json) ·
[actual exit](evidence/attempt-02/exit.json) ·
[exact identities before](evidence/attempt-02/identities-before.json) /
[after](evidence/attempt-02/identities-after.json)

## Finished state and index binding

The independent calculation uses the pinned `GlobalStateLib.hash` encoding and
`keccak256("Machine finished:" || globalStateHash)`. It produces:

| Identity | Exact value |
| --- | --- |
| Global-state hash | `0x0505174c5273d566e33af79b1342522d90e58879207b4bd7c1b351ee6b90df2c` |
| Canonical Finished hash | `0xc95f77e1ef8681eb1a95321c3368298240ec3bf65bf3169e91c374fa989259cd` |
| Actual raw terminal count H | `1,444,459,006,817` |
| Wrapped Finished index F = H + 1 | `1,444,459,006,818` |
| Machine-step capacity | `2^43 = 8,796,093,022,208` |

The canonical Finished hash equals the actual frozen CLI `End machine hash`,
the selected Finished witness's before/after hashes, and the pinned OSP
`getMachineHash` result. The end global state is block hash
`0x8d33a6345311761aef5c7ee9e5528350f17beda843d0563cfdd103aeec70d738`,
zero send root, batch **2,470**, position **0**.

Every selected raw index is converted with **BigInt** to `rawStep + 1`, using
the independently tested [kickoff offset of one](../../production/selected865-boundary/evidence/offset-cap-boundary-receipt.json).
The absorbing Finished proof verifies at wrapped **F**, and `F < 2^43` /
`H <= 2^43 - 2` avoids the pinned last-Running-slot forced-error boundary.

The Finished witness is an **absorbing self-transition**, not the natural
preceding Running→Finished instruction. Its proof does not uniquely encode an
absolute counter; the exact index is bound by the frozen CLI selection and
reviewed wrapper offset. The last sampled Running witness is raw
**1,444,400,000,000**, which is **59,006,817 steps before H**, not H−1.

[Independent hash/index receipt](evidence/attempt-02/terminal-hash-binding.json) ·
[actual CLI suffix](evidence/attempt-02/cli-log-excerpt.txt) /
[full-log and excerpt hashes](evidence/attempt-02/cli-log-excerpt.json)

## What the eight witnesses cover

| Raw step | Wrapped step | Authenticated sample |
| --- | --- | --- |
| 18,600,000,000 | 18,600,000,001 | Go historical-restoration frame |
| 102,200,000,000 | 102,200,000,001 | Go authenticated-state hashing frame |
| 1,423,600,000,000 | 1,423,600,000,001 | Unchanged scalar C companion execution |
| 1,423,700,000,000 | 1,423,700,000,001 | C integer-add instruction |
| 1,423,800,000,000 | 1,423,800,000,001 | C memory-store instruction |
| 1,432,200,000,000 | 1,432,200,000,001 | Go frame after the last sampled companion instruction |
| 1,444,400,000,000 | 1,444,400,000,001 | Last sampled Running instruction |
| 1,444,459,006,817 | 1,444,459,006,818 | Absorbing Finished at exact raw H / wrapped F |

The C companion is module 9 and has no function-name section. No individual
Stockfish search or NNUE routine is identified. Metadata is preserved with the
selected proofs; the actual before→after transitions are checked by the real
verifier. No engine/model/search-policy bytes are changed.

For each witness the inherited manager confirms the honest edge, emits its
one-step confirmation event, leaves the incorrect rival pending, and rejects
seven cases: incorrect terminal claim, corrupted witness, wrong prestate,
wrong module configuration, wrong history inclusion, rival replacement after
confirmation, and repeated confirmation. Only actual contract reverts count;
transport or internal errors fail the runner.

## Exact scope and reproducibility

The proof file is **60,352 bytes**, SHA256
`86f5b309042eadf10293f5868305859c26f67bc5edb588a0f660625544a90e18`.
Selected root is
`0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`;
machine SHA256 is
`4bf7fe54c28ad0b6f2620df3ee6b4c6d87452f9ab76ec8be294eb7d4c934770e`.
The runner also hashes the actual selected Go guest, unchanged C companion,
original input and wrapper source before and after. Pinned OSP component
artifacts and imported contract sources are verified against the compilation
manifest for nitro-contracts
`4341b132cfbdcc980ead03765ca5224ff6cb5d97`, using solc 0.8.17.

The earlier **attempt-01** also passes eight witnesses / 56 negatives, actual
exit 0 / 46.578 seconds, but uses a **different** 1,024-big / 8,192-small
hierarchy with the same aggregate capacity. It is retained with its exact
frozen source and scope. **Attempt-02 is the candidate-hierarchy result.**

All compilation and contract execution ran on Runpod in isolated directories.
No full replay was restarted, no lifecycle was launched, no source/model was
modified, and no public deployment or real spending occurred. The completed
terminal interpreter itself is evidence owned by the
[production replay packet](../../production/bounded-restore/scheduling/comparison/C-combined/interpreter/replay-result.json);
this regression does not claim execution of every block of a full 24m-node move.

[`run.py`](run.py), [`run.mjs`](run.mjs), and the seeded
[`TerminalChallengeHarness.sol`](TerminalChallengeHarness.sol) reproduce this
bounded check. Exact executed sources remain frozen separately under each
attempt; [transfer receipt](transfer.json) binds the small archive.
