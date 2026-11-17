# Independent terminal lifecycle audit

This auditor reads the private parent chain independently of the fixture's broad pass flags. It sends **no transaction**, refund request, approval or other mutation. All execution and hashing run on the owned Runpod Linux worker.

**Current case: stopped, not accepted.** Root stopped the dependent fixture after its matching `c03c` independent guarded replay failed with a 4 GiB guest-memory OOM. The auditor captured the exact assertion pair, verified the actual terminal-input file, and retained 48 level-zero edges. It observed **zero** one-step events, target assertion confirmations or audited refunds. All five owned read-only collector/audit/release/watch processes were then stopped. [Frozen evidence](evidence/stopped-current/stopped-summary.json) and the [raw capture archive](evidence/stopped-current/raw-capture.tar.gz) preserve that incomplete result. The narrow future boundary tests remain valid; they establish no model, proof or mainnet acceptance.

## Standalone runner

```sh
node strict-audit.mjs \
  --fixture-evidence /root/path/to/fresh-fixture-evidence \
  --run-id unique-attempt-id \
  --test-pid 12345 \
  --output-dir /root/path/to/fresh-audit-output
```

The named test must already be running. The runner discovers the single Geth IPC socket among that test's descendants, records both processes' start times, rejects PID reuse, and requires an empty audit output directory. It uses the pinned contract ABIs under `/root/dispute/repo` and ethers from `/root/dispute/package.json`. It begins capturing logs and receipts before the terminal input is available.

The authoritative output is `strict-audit.json`, containing `passed`, `runID`, `terminalInputSHA256`, `terminalInputBytesVerified`, `targetBound`, `refundExact`, `moduleRoot` and `terminalTransitionBinding`. The latter must contain `verified: true` and numeric `terminalBlockNumber`, `startHeight`, `endHeight`, with the exact interval `N−1 → N`. Exit status zero additionally requires a completed strict audit. `PENDING` and errors never grant acceptance. The fixture must remain alive until the read-only auditor finishes; a missed cleanup window stays incomplete. Transfer `terminal-transition.mjs` alongside the standalone runner.

## What passing requires

1. Hash the actual terminal-input file and match its recorded size/SHA-256.
2. Identify exactly one honest/false assertion pair by terminal **content**, not sender: exact true versus bit-flipped global state, same parent, before state, module root and batch context, with different history roots.
3. Bind both block-level root edges to those assertions and their respective history roots; require the same mutual ID.
4. Follow genuine bisection links, cross-check their child IDs against `GetEdge`, and follow subchallenge claim IDs with exact level/origin relationships.
5. Bind the accepted one-step event to a descendant of the exact honest root. Require a successful transaction and confirmed edge state. Its first block-to-machine subchallenge must claim the exact level-zero length-one terminal transition. Verify the receipt-manifest block hash, transaction, batch/message count and genesis-zero offset; require the target's before-state to match its bootstrap predecessor and the actual initial assertion. An unrelated descendant or different interval cannot pass.
6. Require the **exact target honest assertion** to confirm after that proof in block/transaction/log order; the false target must remain unconfirmed.
7. Bind a refunded confirmed edge to the same dispute. Require the exact nonzero ERC20 transfer from the challenge manager to the recorded staker, successful receipt, and both receiver/manager block-level balance changes to reconcile with all token transfer logs in that block.

The result covers exact confirmed-edge collateral refunds. It does **not** claim that rollup assertion bonds were withdrawn, that every losing-stake outcome was audited, that all preceding blocks or the entire 24-million-node move were replayed by an interpreter, or that public deployment passed.

## Current case preservation

`collect.py` and `audit.mjs` are the initial fixed-case collectors. Their worker copies and running processes remain immutable. A frozen earlier version of the parameterized strict auditor was also launched independently for the current case. The collector captures every parent log and its transaction/receipt; that implementation adds owned-process binding, actual terminal-file hashing and `GetEdge` link checks. The current release checker independently enforces the terminal interval. Exact running sources are preserved under `evidence/current-interim/frozen/`.

The future standalone source now makes that terminal interval mandatory inside its own pass result via `terminal-transition.mjs`. This later change does not alter the frozen active processes or retroactively change their reports. It deliberately supports this private genesis-block-zero fixture and rejects a non-genesis start rather than guessing its offset. `terminal-transition.test.mjs` contains pure boundary units; `snapshot-transition-regression.mjs` separately waits for an actual captured one-step path and tests that real positive plus an altered-interval negative. A pending real-path test is not replaced with a synthetic proof.

The frozen current case did not complete its one-step, exact assertion confirmation, terminal-path or refund gates. Its real captured one-step positive regression remains uncompleted; no synthetic positive replaces it.

No source, engine, controller, test chain or main proof worker is changed by these tools.
