# GL3 · full checkpoint guest profile

**A matching checkpoint machine has been generated, and a genuine private A15 Begin-block capture passes. The first bounded real-WAVM progress replay is RUNNING_NOT_ACCEPTED; no guest replay result is accepted yet.** The selected865 machine and candidate03 lifecycle remain untouched.

This profile promotes the existing full-memory A15 checkpoint implementation into a separately compiled native/Go-Wasm pair. It retains the exact original C companion, full NNUE network, 24-million-node search policy, TT, history, globals and VM image. It adds one explicit admission change: after a completed decision, another search requires an exact finalized checkpoint of that generation. A new game may start from its authenticated initial seed.

## Measured Runpod result

| Check | Actual result |
| --- | --- |
| Guest compile / canonicalize | Exit0 / 18.499 s; real `gl3aot.execute` import retained |
| Native profile test ELF compile | Exit0 / 22.374 s |
| Native no-search tests | Exit0 / 29.369 s; 6 top-level tests +50 subtests |
| Full completed image | 466,157,568 memory bytes; exact root and 163,085,439 canonical bytes |
| Active checkpoint ancestry | 2,464 prior deltas →64 pieces / 162,059,912 body bytes |
| Next-move guard | Real EVM denies skipped checkpoint; exact finalized metadata admits; strict mutation/owner/job/generation/count checks pass |
| Native test maximum RSS | 6,420,784 KiB; includes fixture historical-code reconstruction |
| Owned allocated scratch | 384,970,752 bytes after tests; no copied raw VM/DB |
| Matching machine | Generated root `0x2a423e3e…cb9e608`; no production pairing acceptance |
| Real WAVM progress-block replay / OSP | First bounded interpreter trial running / no OSP acceptance |

Guest SHA256 is `fc5645ec7536ca7191c4eaa1db0fa381a67dafb46cdf844eb6403298516fed5d`;
native test ELF is `dfb1a15d32acb34aae992d27a3d7e3fc86b6d5cca8729bc006ce80606508940f`.
These are separately built candidates, not production binaries. The first Go-list
preflight failed on a template string before compilation; its actual failure is
preserved in `attempts/01-go-list-template/` and corrected independently.

[Native/candidate manifest](evidence/result.json) · [actual test exit](evidence/native-tests-exit.json) · [full-state receipt](evidence/completed-native.json) · [static guest import inventory](evidence/guest-imports.json) · [sealed source/evidence archive](archive-receipt.json).

## Matching machine and genuine progress input

New root is `0x2a423e3e57903ae5bcb7385608d05387201b5cde24a7d4138d5b7ec09cb9e608`,
with machine SHA256 `9f5ce0c06b01debaf3077c95559d38af11d2d7925f02721742acacfcfb944752`.
Generation exits0 /35.704s with the exact guest, unchanged B481 companion,
eight pinned standard libraries and existing cc5…ab27 counter tool. Only normal
machine construction/initialization occurs at this stage; no recorded input is
replayed by machine generation.

The real private Nitro child imports only the authenticated seed, 64 checkpoint
pieces and A15 metadata. Its actual state cold-restores the complete first-decision
image and exact canonical TT/history before a signed Begin transaction runs
**four original engine quanta**. The decision remains pending. The receipt/block5
gas is **12,789,178**, block hash `0x3193c0de99e4fc258343976b0a85e939ea15b6073130f6619e6f54532c50c048`;
the captured expected end is Batch6/Pos0. Capture exits0 /44.899s, maxRSS7,723,292KiB.
The actual600,010,302-byte input is independently hash-verified:
`d346eb13ca7edec142088db8e51118f58240310d8d55147bffb1fb1bca56d940`.
It stays on Runpod. This is a new progress-block input, not a renamed b8c6 result
or terminal-block proof.

[Exact ready manifest](ready-for-review.json) · [machine identities](machine-generation/machine-manifest.json) · [native capture](capture/evidence/capture-manifest.json) · [actual capture exit](capture/evidence/capture-exit.json) · [full actual-child canonical check](capture/evidence/before-begin-canonical.json) · [compact capture/source archive](capture-archive-receipt.json).

The initial native helper checked memory size after canonical serialization;
that isolated serialization may grow the VM. The failed observation is preserved,
then corrected to measure memory/root before serialization and close the clone.
A later attempt correctly stopped at the3GiB scratch guard before Begin. The
cause was private Geth's default4096MiB cache creating four295MB preallocated
WALs with little logical data. Only the private test launcher's init/run cache
was changed to16MiB; exact Geth binary and consensus/engine sources are unchanged.
Root-approved cleanup removed only inventoried, unready failed-fixture scratch,
with no live descriptors and no accepted Begin/input. The full corrected capture
passed the resource guard. A separate narrow startup probe observes4KiB of open
WAL allocation; it is not a full-load storage bound.

## First bounded interpreter trial

The approved real WAVM trial starts at2026-11-17T07:16:11Z: prover198867,
direct-child collector198865. It uses exactly the new machine/input above, no JIT,
two CPUs with lower scheduling priority, a45-minute wall limit, sparse5-billion-step
proof intervals and configured995-billion-step cap. The pinned CLI checks the cap
between intervals; reserving one interval keeps the authorized upper envelope at
one trillion steps. Own scratch stays below3GiB and disk free above6GB; RSS is
sampled and actual exit is saved through `os.wait4` before optional processing.

Acceptance requires actual exit0, Finished and all four native global-state fields
exact. Even a pass would cover only this progress block: the engine decision is
still pending, and no complete24m move, terminal replay, full dispute, universal
within-search heap bound,20-game capacity or mainnet readiness follows.

## Source and matching artifacts

| Input | Frozen provenance |
| --- | --- |
| Existing A15 implementation | [Native checkpoint profile](../checkpoint-integration/README.md), source SHA256 `0645d3ce0785585115af05a68ab448233addaad5d8aa35620229e05a453d97b9` |
| Selected restore behavior | Read-only `C-combined/{native,guest}` trees: authenticated uncached immutable reads, GC every 64 MiB and before companion allocation |
| C companion | `b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555` |
| Full portable engine | `1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc` |
| New candidate source | [Separate profile](profile/ArbGhostChessCheckpoint.go), [admission rule](profile/cp_guest_policy.go), [strict rule tests](profile/cp_guest_policy_test.go) |
| Build procedure | [Runpod-only overlay controller](prepare-and-build.py) |

Native and guest builds add the same A15 source, ABI and admission helper via Go overlays. The default selected tree is never rewritten. The guest enables `gl3aotproof,gl3_checkpoint_integration`; native uses `gl3_checkpoint_integration`. The compiled machine/root must be new: this candidate cannot be paired with selected865 or the clean upstream root merely because the engine bytes match.

## Admission and state audit

A15 has its own owner/job namespace and ABI at `0xa15`, while A14 remains distinct. Its shared single-game reservation, one-heavy-call-per-block budget, RPC/recording lease and immutable-code rules are retained. Debug-enabled execution is rejected. Begin/Advance/Release remain locked during a checkpoint.

The added next-move predicate requires the same owner/job, nonzero builder nonce, completed cursor, exact generation/root/memory size, verified complete piece count, final piece/head and active metadata head/count. Reconstructing the frozen metadata by undoing exactly Finalize's Head/Deltas switch must reproduce the builder's frozen metadata hash. A stale checkpoint, changed progress/history or skipped compaction cannot authorize another move. The original Begin handler separately rejects pending searches.

Work derives pieces from authenticated VM memory; callers provide no image bytes. It scans at most 7 MiB and writes an ordinary GSD1 piece of at most 8 MiB. Verify authenticates bounded ranges and predecessor links. Finalize changes only Head/Deltas using bounded metadata. It retains the original immutable-writer assumption; it is not a physical storage audit. Research gas remains unaccepted as a production tariff.

## Exact full-state fixture

The native fixture reuses the original hash-verified preimage file and native completed-state export read-only. It reconstructs the accepted first decision without performing a new search, compacts 2,464 active links into 64 pieces, drops live caches, restores all 466,157,568 memory bytes and verifies the image root. Full canonical serialization must still equal 163,085,439 bytes with SHA256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6`. This includes TT/history; a board-only comparison cannot pass.

The earlier unchanged native next decision, b8c6 / 24,000,311 nodes / depth39, is evidence belonging to the original A15 native profile. It is not rerun here and its report is not a terminal input export for this new guest. A genuine new checkpointed engine block capture/replay requires separately reviewed compiled inputs and explicit authorization; it cannot be manufactured by relabeling that native result.

## Bounds and unresolved gates

- Mandatory between-move compaction resets ancestry from older completed searches. Active ancestry becomes checkpoint pieces plus the current search's deltas.
- This does **not** establish a universal within-search heap bound. The inherited delta limit is 2,000,000; only the tested positions have measured operation counts. Mid-search checkpointing would be a further versioned STF change and is not implemented by this candidate.
- Each cold Work still restores the whole frozen source before scanning its 7 MiB range. Piece size does not bound inherited restoration, proof preimages, guest RSS, runtime or gas.
- Old code/accounts remain. Active ancestry reduction is not pruning, historical disk reduction or archival availability acceptance.
- Full-width guest restore, native/guest block equivalence, canonical engine continuation, matching proof-machine generation, inherited OSP and dispute acceptance remain separate gates.

All compilation/tests run on the existing Runpod worker with two CPUs, a 3 GiB owned-scratch limit and a 6,000,000,000-byte free-space floor. Sources are overlaid; raw images, databases and large source trees are not copied. Initial failures remain under `attempts/`; no baseline is repaired in place.
