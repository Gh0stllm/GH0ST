# Full decision survived two process crashes

**Passed:** the unchanged 24m-node decision finished after genuine SIGKILLs at
pending cursors64 and2048, each followed by a fresh OS process reopening the same
physical execution, Wasm and consensus Pebble databases.

| Actual measurement | Result |
| --- | --- |
| Named test | `TestGL3TwoCrashFullDecisionRecovery` |
| Build / test exit | 0 / 0 |
| Build / test duration | 14.66s / 427.75s |
| First crash / fresh process | PID92928 → PID92937, cursor64 |
| First recovery plus real next advance | 8.650s |
| Late crash / fresh process | PID92937 → PID92983, cursor2048 |
| Late recovery plus real next advance | 13.896s |
| Completed result | `e7e5`, 24,000,033 nodes, depth38, cursor2464 |
| Cold canonical audit | 163,085,439 bytes, original SHA256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6` |
| Cold audit duration | 9.374s |
| Completed portable image root | `c7831793f32eb194d7cd96411c8588cd9907d1e7d6875b48e9996c4623e948d3` |
| Final worker cleanup | Actual exit0 |

Both crash points preserved the exact acknowledged L2 head, state root, execution
message index, consensus message count, owner nonce and raw chess inspect bytes.
The reopened workers had distinct PIDs/start ticks and the same executable,
genesis import, configuration manifest, custom machine root and physical database
directory paths/device/inodes. All three resolved database sync options were
true. The parent stayed alive across each kill; the old worker and its RPC stopped.
Each recovery then mined a successful, newly signed advance at precisely the next
cursor. No graceful shutdown, cache-drop or pending-game image export preceded
either kill.

The cold final audit creates a separate VM through the authenticated chain-state
restore path. Its complete canonical hash matches the original retained engine
state, including the full network, TT and history. The target remains 24,000,000
nodes, Hash128, Threads1, Skill20 with no strength limit. No engine policy changed.

The fixture uses explicit synchronous Pebble writes, archive mode and zero skipped
state-save blocks/gas. It owns a real external Geth parent through a controller
process. During the long decision the controller seals ordinary empty private
parent blocks every128 compute transactions; no heartbeat runs concurrently with
a kill. This keeps the parent progressing without substituting fake chain data.

The executable is a **system-test node worker using the real execution and
consensus constructors**. It is not the separately built production CLI, a
container/service-manager restart, a host power-loss test or a completed WAVM
fault proof. Acceptance does not extend to the asynchronous database default or
20-game storage/capacity. No public deployment or real spending occurred.

## Frozen evidence

- [Actual full result and both resumed receipts](evidence/attempt-02/run/full-process-recovery.json).
- [Actual named-test process exit](evidence/attempt-02/test-exit.json) and [complete log](evidence/attempt-02/test.log).
- [Cursor64 SIGKILL exit](evidence/attempt-02/run/cursor-64-worker-exit.json), [cursor2048 SIGKILL exit](evidence/attempt-02/run/cursor-2048-worker-exit.json), and [final worker exit](evidence/attempt-02/run/final-worker-exit.json).
- [Before/after source and binary identities](evidence/attempt-02/build-source.json).
- [Post-run portable engine/library/ELF/process inventory](evidence/attempt-02/post-run-inventory.json).

Actual compiled fixture SHA256:
`b59004b488ea87fad38adc62593981dc9fe125aee0dbc6f44b328c1f67e636b1`.
Actual full-test binary SHA256:
`8a63f661edbcf05523e4d11c56374c63c8c640d12a2c83b83b567832f6a233d2`.
The immutable portable engine is102,408,379 bytes with SHA256
`1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc`.

[`gl3_full_process_recovery_test.go`](gl3_full_process_recovery_test.go) contains
the exact cloud-formatted compiled fixture. [`run-full.py`](run-full.py) records
the Go1.25.12 Linux build/run with two build CPUs and a fresh evidence directory.
The isolated native tree was copied from the already frozen short-test tree,
which itself copies selected C native source. It includes the prior short-test
fixture alongside this independent full fixture. Consensus source and binary
hashes were checked before/after; model/runtime inventory is explicitly post-run.
The large genesis import, physical databases and native binaries stay private.

Attempt01 is preserved: it compiled successfully, then exited1 after3.77s before
any chess game because its new isolated machine-locator wrapper directory was
missing. [That failure](evidence/attempt-01/test-exit.json), its log, compiled
fixture and controller are retained. Attempt02 adds the missing read-only machine
wrapper and an explicit selected-root preflight before parent bootstrap. The
selected guest, machine, original proof input and active interpreter were never
changed.

The logs retain harmless fixture notices about the unavailable optional validation
RPC module and parent-wrapper subscription fallback. This test runs no validator;
its optional `target/bin/jit` remains absent, as the inventory states. None of those
auxiliary production-pairing gates is implied accepted by node recovery.
