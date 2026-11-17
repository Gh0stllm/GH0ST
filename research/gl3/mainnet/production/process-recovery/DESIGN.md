# Separate-process sequencer crash rehearsal

**Static design only. No new fixture has been built or run.**

The accepted earlier fixture closes/reopens real execution and consensus nodes
inside one Go test process. A genuine process-crash test needs a controller and
separate node workers; calling `StopL2ForRestart`, clearing a VM map or loading a
raw engine image would not satisfy this gate.

## Process and parent layout

| Process | Lifetime and responsibility |
| --- | --- |
| Controller | Owns the actual private parent fixture, its external Geth process, deployment addresses, owner transaction sender and evidence. It survives all child crashes. |
| Worker A | Starts the selected native execution **and** consensus node against one persistent Pebble directory. Exposes only loopback RPC; owns no external parent process. |
| Worker B / C | Fresh OS processes using the identical native binary, configuration, parent RPC/deployment and physical database directories after A/B are killed. No inherited Go objects or chess VM cache. |

Use one isolated `system_tests.test` build from selected C native source, with a
new acceptance-only worker test and controller test. The controller launches its
own executable with an exact worker test selector and a mode-0600 manifest. This
uses the actual node constructors while making the OS process boundary explicit.
It is a native-node process rehearsal, not a claim that the production
`cmd/nitro` daemon/container/service supervisor has been tested.

The controller calls `NodeBuilder.BuildL1` once, then keeps the same parent RPC,
chain ID, init message and deployment addresses throughout. Each worker creates
a new RPC client, context, parent header reader and parent-chain object; none is
reused from a stopped node. `buildOnParentChain` already constructs execution and
consensus nodes over this parent connection. The controller sends all chess
transactions through the current worker's loopback RPC.

## Persistent inputs and database settings

Freeze these inputs before worker A starts:

- Selected module root `865168…f086`, native source/binary hashes, full C module,
  full network and unchanged 24m / Hash128 / Threads1 / Skill20 / retained-history
  policy.
- Exact chain config, ArbOS init, parsed init message, deployed parent addresses,
  genesis import and relevant node/execution/stack configuration fields.
- One explicit persistent data directory outside `t.TempDir()` cleanup. Record
  the paths actually returned by the stack for `l2chaindata`, `wasm` and
  `arbitrumdata`; do not guess the directory layout from the binary name.
- Pebble, hash state scheme, archive mode, zero skipped state-saving blocks/gas,
  debug precompiles disabled, 100ms target, existing reviewed gas limits and
  disabled native mint feature. Fresh workers must assert these same values.

Persist the complete genesis account initialization separately from the small
manifest. Hash-scheme `WriteOrTestBlockChain` calls `WriteOrTestGenblock` even when
the database already exists; that path recomputes and checks genesis from the
initialization reader. A minimal empty replacement would be incorrect. Either
reuse the exact complete import through the existing helper, or use the official
existing-database opening path with explicit stored-genesis/config checks. The
first option reuses more of the accepted fixture and is preferable for this test.

The test account helper derives fixture-only keys deterministically from account
names. Workers can regenerate these test identities; no production wallet files
or secrets need to be read, exported or transferred. Re-read transaction nonces
from the live RPC after every restart.

**Durability must be an explicit profile.** Pinned `PebbleConfigDefault.SyncMode`
is false, and its source warns that recent async writes may be lost. For an
exact acknowledged-head acceptance case, set the isolated worker's persistent
Pebble `SyncMode=true` before all three databases are opened and record each
resolved `ExtraOptions.SyncMode`. This maps to
`--persistent.pebble.sync-mode=true` for a real daemon configuration. Do not
silently test synchronous writes and describe the asynchronous default as
accepted. An optional later async-profile test must report any rewind and parent
replay separately.

No manual database flush, graceful close or cache-drop helper is invoked before
the primary kill. This is an abrupt **process** crash with the same kernel and
storage still running; it is not a power-loss or failed-disk rehearsal.

## Test sequence and exact evidence

1. Start the parent, freeze the manifest/import, then start worker A. Record OS
   PID plus start ticks, executable SHA, module/genesis/config identity, actual
   database paths and persistent parent-directory device/inode identifiers.
2. Start the unchanged game and advance to a pending committed cursor, initially
   64. Stop sending transactions; require the receipt, RPC head, state root and
   raw `inspect` result to agree. Record transaction nonce and parent head.
3. The controller sends **SIGKILL to this worker PID only** and records its actual
   signaled exit. It must not call node cleanup, `StopL2ForRestart`, VM cache-drop
   helpers or a pre-kill checkpoint serializer. Verify the old process and RPC
   endpoint are gone. Leave the external parent alive.
4. Start worker B against the same physical database directories and frozen
   inputs. Require database locks to be acquired without deleting lock files.
   Require exact persisted L2 head/root, consensus/message position and raw chess
   `inspect` result before sending any new transaction.
5. Send exactly the next expected `advance`. Require a successful receipt and
   the expected increment, with no duplicated/skipped cursor or owner nonce.
   The fresh worker must reconstruct the real retained state from chain bytes.
6. Repeat at cursor 2048 to cover the long immutable delta history, then finish
   the same full-strength decision. Require `e7e5`, 24,000,033 nodes, depth38 and
   the original complete canonical SHA256 `5f9762…f28c6` / 163,085,439 bytes. Cold
   canonical auditing happens after the process-recovery checks, never as their
   replacement.
7. Repeat the strict disabled-mint/backing RPC checks after recovery. Record
   actual execution-revert classifications; transport failures do not count as
   rejected mint attempts.

Acceptance reports include every worker PID/start/exit, parent identity before
and after, exact database/config/binary identities, pre/post head/root/cursor,
first resumed receipts and measured recovery duration. Save any failure before
altering a controller or configuration. Success would cover this selected
native process/storage profile only; broader disk-loss, reorg, container,
supervisor and long-game capacity gates remain separate.

## Verified source basis

Inspection used the read-only selected C native tree on Runpod:

| Source | Relevant behavior |
| --- | --- |
| `system_tests/common_test.go:975–1066` | `buildOnParentChain` opens the real chain DBs, creates a fresh parent reader, execution node and consensus node, then starts both. |
| `system_tests/common_test.go:1319–1374` | Existing restart cancels/closes/reuses builder fields inside one process; it does not implement this crash test. |
| `system_tests/common_test.go:2168–2224` | Persistent options helper; separate `l2chaindata`, `wasm`, `arbitrumdata` database opens; initialization reader passed to chain opening. |
| `system_tests/test_info.go:104–111` | Deterministic fixture identities from account names; production credentials unnecessary. |
| `execution/gethexec/blockchain.go:180–224,292–320` | Hash-scheme startup recreates/checks genesis and stored chain config. |
| `execution/gethexec/blockchain.go:129–160` | Archive/state-save settings map into the actual blockchain config. |
| `cmd/conf/database.go:137–159` | Async default, documented loss caveat, explicit persistent Pebble sync setting. |
| `go-ethereum/ethdb/pebble/pebble.go:297,802+` | Resolved sync setting controls batch `Commit` write options. |
| `go-ethereum/core/blockchain.go:1850–1876` | Archive mode commits each state when both skip limits are zero. |

Source hashes inspected: common test helper
`bebd9a1781f06f5f26736dcf1c335d97f3baa9f0d11c742f5d3dc54cd1410fc0`,
test identities
`67fb7467c8e5fdc65934bff38b658bb38bab32eba81366ff9b12cafffdf643e9`,
chain opening
`1b4e0cc46a4fb8ac77b45f22a932ae1f0505798003d2adee696aea274fd4490e`,
Pebble adapter
`dd7920cf093949cdeb264b3c7deccc1f5c8752203d971be2dcc6d05710f1bfc8`.

## Implementation effort

This is a small process harness plus a real persistent worker bootstrap, rather
than a change to chess or consensus execution. Reusing the accepted system-test
constructors should make it a few hours of implementation/review. The main work
is serializing complete genesis/configuration without live pointers, keeping the
parent independent, proving resolved durability settings and collecting actual
SIGKILL exits. A short cursor64 rehearsal should precede the full two-crash
decision. No duration/cost acceptance is claimed before execution; the previous
399-second graceful full-decision run is only a planning reference.

No build/run is authorized by this design document. The current selected865
interpreter keeps priority, and no new full fixture should be launched until its
result and the parent agent's resource decision permit it.
