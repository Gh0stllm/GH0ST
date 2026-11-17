# Demo activity v2 — one action at a time

This separate policy was prepared without changing the running v1 worker or any chain service. Root owns the additional 250,000 GH0ST funding, private configuration approval and controlled demo-only stop. Preparation/tests read no production key, journal or private configuration.

After the top-up was canonically confirmed and Root stopped v1, Root explicitly delegated the reviewed audit and single v2 launch. The migration passed in 16.17 seconds: all 2,292 old signed intents/receipts were checked, the original journal prefix remained byte-identical, 10,679.57348 GH0ST of old fees and nonce 2292 were retained, and one missing receipt observation was added to the new copy. The original state was preserved. The approved worker alone reads the dedicated demo key at runtime.

The subsequent saved live audit passed at child block 2573. Its first 60-second activity window contained 44 demo transactions (40 pulses, three test-token transfers and one NFT), each in a separate canonical block, paying 298.72514 GH0ST. Across all 137 checked post-transition receipts there were zero duplicate demo receipt blocks, header timestamp gaps were one to two seconds, and all three contract runtimes/state/event checks passed. Old plus new fees exactly reconciled against cumulative 350,000 GH0ST funding. All four original chain-process IDs and start times stayed unchanged. These are saved observations, not future liveness, settlement or cost guarantees.

## New policy

- Exactly one selected action per tick: NFT on tick 30, 60, …; otherwise test token on tick 10, 20, …; otherwise counter pulse. There are no two/three-action bursts.
- At most one pending transaction. The previous canonical child receipt must be observed before considering another action.
- A monotonic pacer enforces at least one second after the previous accepted submission before preparing the next. It does **not** wait for an independently advancing head, which would deadlock an idle demand-driven chain.
- Any duplicate canonical child block number among **post-transition** demo receipts stops the worker and remains a failure on restart. Historical v1 receipts remain unchanged, including any old bursts.
- Cumulative budget 350,000 native GH0ST includes the original 100,000 and new 250,000, while retaining all already paid fees. A 100 GH0ST reserve, 24-hour wall bound, 100,000 total-intent bound and existing process/disk guards remain. No automatic topup, resend or replacement.

This targets one **demo** transaction per active block. ArbOS/system transactions are distinct. The node's existing 100 ms setting remains unchanged. This is labelled automated activity, not organic adoption or valued token volume.

## Explicit state transition

The original v1 configuration identity anchor remains `1e203f27…ad59`. The approved new configuration has a different hash; an explicit hash-chained `policy-transition` event binds old/new hashes, original 100k/new cumulative 350k budget, canonical funding receipts, original journal hash/length, already-paid fees and the first permitted new nonce.

The Root-run migrator:

1. Requires both old controller and worker PIDs gone, the old controller's actual zero exit/empty remaining-PID receipt, no old lock, and no open writer on the original journal.
2. Verifies the entire original hash chain and exact signed transaction hashes/from/chain/nonces/zero native value, expected contract-creation bytecode and demo call targets/calldata.
3. Rechecks **every** old receipt against the current canonical child block and fee record. All intents must already have successful receipts, and latest/pending nonce must equal the preserved next nonce. It never signs or broadcasts.
4. Authenticates the original 100k and additional 250k Cold-to-demo funding transactions and canonical receipts. Extra unsolicited funds remain outside the finite 350k budget; a deficit fails.
5. Copies the exact original bytes as the prefix of a **new** private state directory, adds any missing receipt observations and the reviewed policy transition. Original journal bytes remain untouched. There is no nonce/spend reset, sweep, uncertain retry or automatic rollback.

The v2 worker rejects missing/wrong transitions and keeps the original identity anchor. An interrupted new-state copy is preserved for review; the migrator refuses an existing destination rather than overwriting or retrying it.

## Root execution sequence

1. Review the v2 source/test freeze and additional funding receipt. Create a new 0600 approved config from the public draft, filling the exact additional funding hash and setting the approval bit. Verify its source/artifact pins and exact byte hash.
2. Before requesting a stop, Root runs `prestop-check.mjs`: three consistent read-only samples require actual latest/pending nonces equal the saved intent count, plus a canonical successful last-owned receipt. The saved worker pending counter may lag already-mined receipts; it is not used as the actual mempool count. At an observed drained interval, request graceful stop of **only the old demo controller**. Never touch node, poster, validator or chain configuration. A transaction already admitted across the stop race is preserved; migration still refuses to proceed until every recorded intent has a canonical receipt.
3. Verify old controller/worker gone, actual exit zero, remaining-owned-PIDs empty and old lock removed. If an accepted transaction is still mining, wait read-only for its existing hash. Never resend or replace it. Preserve the old state and exit receipt.
4. Fill `migration-approval.example.json` into a separate 0600 Root-approved specification, including the exact new config SHA, old exit-receipt path and migrator SHA. Invoke `migrate.mjs` with `GL3_DEMO_MIGRATION_APPROVAL_SHA256` equal to the exact spec hash. It refuses living old processes, writers, pending/unknown receipts or mismatched funding/configuration.
5. Review the sanitized actual migration receipt, including byte-preserved original prefix, retained spend, next nonce and 350k budget. Start the v2 guarded controller once using the exact approved new config hash. Never restart the old worker against the new directory.
6. Observe real post-transition receipts for at least 60 seconds: zero duplicate demo receipt blocks, at most one pending, monotonic submission spacing and matching token/NFT/counter state. Source tests alone do not accept an actual migration or live v2 run.

The node never halts during this demo-only transition. Both old state and all signed intents remain private and preserved; public exports contain only sanitized receipts/hashes/counts.
