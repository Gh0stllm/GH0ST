# GL3 · Linux acceptance notebook

[GL3 overview](../README.md) · [Sequential history](../HISTORY.md) · [Remaining gates](../ROADMAP.md)

**Research passed several new gates. Robinhood mainnet is not deployed.** All execution, compilation, replay and contract tests in this milestone ran on disposable Runpod CPU machines. The Mac handled editing, evidence transfers and publication.

| Verified result | Measurement | Boundary |
| --- | --- | --- |
| Complete first lazy-machine block replay | 2,712.72 seconds; 298.2–298.3 billion interpreter steps | One compute block, not a complete chess move or game |
| Actual Solidity one-step verification | Five distinct witnesses; damaged witnesses/prestates rejected | Sampled witnesses, not an entire chess-result dispute |
| Full native EVM decision | 24,000,033 nodes; e7e5; depth 38; every canonical state byte matched | Fixed original engine policy, one decision |
| Actual mined decision with ordinary traffic | 2,464 compute operations and 2,464 ordinary transfers | Private parent/child network, no public settlement |
| Ordinary transfer confirmations during that decision | 141.60 ms median; 160.91 ms p95 | Receipt latency under a 100 ms block target; not a guaranteed block interval |
| Rebuild from disk in a separate process | 8.63 seconds; all 163,085,439 canonical bytes matched | One terminal decision, not a complete sequencer restart or long history |
| Real-token fork transfer checks | GH0ST transfer, self-transfer, approval and transferFrom | Read-only public RPC; all mutations stayed inside a private fork |
| ERC20Bridge / ERC20Outbox unit round trip | Exactly 4 GH0ST returned; unknown roots and replay rejected | Test rollup supplies the confirmed root; child burn/assertion not covered |
| Native ETH withdrawal baseline | Upstream fast-confirmation withdrawal passed in 6.52 seconds | ETH, privileged fast confirmer; not GH0ST native-gas withdrawals |
| Standard inbox BoLD challenge | Both recorder cases passed; honest validator won | Standard inbox dispute, not an incorrect Stockfish result |

## Strength stays fixed

Stockfish commit, the complete 98,511,183-byte network, 24 million search nodes, Hash 128 MiB, one search thread, Skill 20, disabled strength limiting, and retained per-game state remain fixed. The engine is split into bounded continuations so ordinary transactions can progress between operations. Four continuations share each computing transaction, with one computing transaction admitted per block.

This decision used 2,464 computing transactions. At the 100 ms target the schedule alone requires at least 246.4 seconds. The full mined test fixture took 365.91 seconds including setup, recording and cleanup. Neither number is a claim of a 100 ms chess move.

## Failed experiments remain visible

Two simultaneous full proof jobs exceeded the 64 GB pod's memory limit. The eager baseline was killed at about 264.3 billion steps; the lazy job continued and completed. Consequently there is no completed paired Linux timing comparison. Removing three redundant memory copies reduces copying by 1,398,472,704 bytes per operation; that is not a 75% proof-speed claim.

The next consecutive recorded block also completed independently on a 128 GB cloud worker. All four expected global-state fields match; five distinct actual Solidity witnesses pass and corrupted states/witnesses reject. Its completed interval is 300.0–300.1 billion steps. This establishes two consecutive captured blocks, rather than relying on the first cold block alone. It is not a complete 24-million-node move in the interpreter or an incorrect chess-result BoLD dispute.

This isolated proof worker peaked at 39,053,127,680 bytes of cgroup memory, with no out-of-memory event. Kernel process high-water RSS was 37,034,960 KiB. The current proof path therefore has not met the preferred 24 GB server target. Nor is this a hard-limit 64 GB or production node/prover coexistence test. The first monitoring launcher failed after starting the prover; an attached monitor observed the same continuing process. Its operating-system exit code was unavailable, so the report retains null; completion is evidenced by the finished-machine log, all four matching fields and actual Solidity checks. No restart or fabricated exit code is claimed.

All disposable cloud workers for this milestone were removed after their reports and proof outputs were saved. No production hosting order or mainnet launch occurred.

## Recovery and storage

The first complete decision generated 1,617,883,940 bytes of raw delta payload. The isolated disk fixture measured about 577 MB initially, 3.216 GB at terminal commit/close and 1.586 GB after background compaction/reopen. These measurements describe that fixture and its compaction timing; they do not establish steady-state growth.

A simple payload projection for 20 games with 80 Black decisions each exceeds 2.5 TB before overhead. It is an extrapolation, not a measured rate across games. A 1 TB drive therefore cannot yet be accepted for that workload. Long-history recovery, bounded retention and challenge-safe reclamation remain required.

## Remaining mainnet gates

- Complete native GH0ST deposit → child spending/burn → confirmed assertion → parent withdrawal, including invalid-root and repeated-withdrawal rejection.
- Complete a deliberately incorrect engine-result dispute through the actual challenge protocol.
- Verify long-history recovery, storage bounds, sequencer restart and resource exhaustion behavior.
- Accept a production Linux image and its matching module root, genesis, validator and upgrade controls. The custom native A14 client must not be paired with an unrelated official standard machine root.
- Remove the legacy embedded-network object's executable-stack linker warning before accepting the production artifact. The current research build is not a released production image.
- Review fee pricing, parent ETH reserves, production hosting, parent compatibility and the applicable license path.

## Evidence and reproduction

[Linux builder](native-cloud.py) · [real-token/fork checks](token-preflight.mjs) · [first-block replay](evidence/cloud-lazy-wavm-replay.json) · [next-block replay](evidence/cloud-next-wavm-replay.json) · [next-block Solidity checks](evidence/cloud-next-complete-solidity-steps.json) · [five Solidity witnesses](evidence/cloud-lazy-complete-solidity-steps.json) · [OOM failure](evidence/cloud-baseline-comparison-failed.json) · [full mined decision](evidence/linux-full-mined-summary.json) · [disk recovery](evidence/disk-probe-20261117-recovery.json) · [real-token bridge unit](evidence/bridge-withdrawal-unit.json)

The builder expects the pinned patched source tree, generated contract bindings, Rust libraries and portable engine module documented by the existing sliced/AOT build instructions. It is a Linux acceptance recipe, not a one-command mainnet deployment. Test-only source fixtures and the full standard inbox dispute log accompany this milestone. Raw high-volume receipt rows are gzip-compressed; their summary files retain raw SHA-256 digests.
