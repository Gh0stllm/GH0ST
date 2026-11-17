# Ordinary CLI · cursor64 crash recovery

**The frozen ordinary `cmd/nitro` executable passed a same-host SIGKILL/restart rehearsal.** This extends the earlier [constructor-based process test](../process-recovery/README.md); the node workers here are the actual unmodified CLI, not a test-worker entrypoint. The controller alone uses a test build to own the private parent and send deterministic fixture transactions.

| Check | Actual recorded outcome |
| --- | --- |
| Native CLI | SHA-256 `13ba3c913c260c453628f273cfd8dc86f742f291d87e9a9887531e039d351f38`, identical in both live `/proc/<pid>/exe` checks |
| Worker A | PID 102811, start ticks `218118382`; actual **SIGKILL** at pending chess cursor64 |
| Worker B | PID 102819, start ticks `218119734`; same exact command, configuration and genesis |
| Persisted state | Head hash, state root, block69, head-message index69, owner nonce69 and raw eight-field `inspect` bytes exactly matched |
| Persistent databases | Actual open-file evidence plus identical paths, devices and directory inodes for `l2chaindata`, `wasm`, `arbitrumdata` |
| Resumed operation | Actual successful receipt for `advance(64)`; cursor became65 and remained pending |
| Timing | 4.14134 seconds from crash through restart and first real advance; not a block-time or power-loss measure |
| Named test | Actual exit0 in24.86 seconds; complete `TestGL3Cursor64CLIProcessCrashRecovery` PASS |
| Remaining processes | No observed owned Geth or CLI remained after cleanup |

[Combined summary](evidence/passed/rehearsal-summary.json) · [named test/exit](evidence/passed/test-exit.json) · [controller log](evidence/passed/test.log) · [complete report and receipts](evidence/passed/run/cli64-result.json) · [before](evidence/passed/run/before.json) · [after](evidence/passed/run/after.json) · [actual process identities](evidence/passed/owned-processes.json) · [A exit](evidence/passed/run/cli-a-exit.json) · [B exit](evidence/passed/run/cli-b-exit.json).

Go's `exec.ExitError.ExitCode()` reports `−1` for a signaled child; the controller separately requires `WaitStatus.Signaled()` and `Signal()==SIGKILL`. This is not a successful exit0 or a synthesized timeout code. Worker B's final exit0 is graceful cleanup only. There was no pre-kill SIGSTOP, copied database, manual flush, cache-drop helper or checkpoint serializer.

## Ordinary startup and durable configuration

The actual CLI imports the complete seeded model/image through the official `JsonInitDataReader` descriptor and newline-delimited account stream with `Balance` strings. The controller verifies every imported account before node startup. Exact descriptor, account-stream and chain-info hashes are retained in the [bootstrap manifest](evidence/passed/run/bootstrap-manifest.json); large model/account bytes stay in the isolated cloud artifact, outside Git. The fixed portable program, 98,511,183-byte network and full24m / Hash128 / Threads1 / Skill20 policy are unchanged. This rehearsal stops while the decision is pending.

The CLI itself parses and dumps its complete [effective configuration](evidence/passed/run/effective-config.json). The profile explicitly sets Pebble synchronous writes, hash scheme, archive mode and zero skipped-state-saving blocks/gas. Actual database paths come from the worker's owned data directory and are checked against its open file descriptors, rather than inferred from a name. The same configuration/physical directories are reused on restart; no lock file is removed by the harness. [Requested configuration](evidence/passed/run/node-config.json), [full command/identities](evidence/passed/run/cli-a-ready.json), [restarted worker](evidence/passed/run/cli-b-ready.json).

Sequencing and the real parent reader are enabled. Block validation, staker, batch poster, delayed sequencer, external feeds, version alerts, WebSocket and authenticated network RPC are disabled. HTTP is loopback-only and excludes the internal execution namespace. A private IPC endpoint supplies the existing `nitroexecution_headMessageIndex` getter. Wallet configuration is absent; only deterministic test identities sign private transactions.

**Exact live consensus MessageCount is not exposed by the ordinary CLI RPC used here.** It remains explicitly unavailable, rather than being inferred from the head index. The earlier constructor-based process-recovery fixture's directly observed MessageCount is separate evidence.

## Private-parent scope and preserved startup failures

The actual external Geth process was PID102797, SHA-256 `daec86c874d2f31d70784f4c8e15faf786e8eebd3cd23e77be744c2c42273119`. It remained the controller-owned parent across the child crash. The case uses an isolated Ethereum/calldata **pre-BoLD test parent**, artificial research genesis balances and no real chain funds. It does not establish Robinhood parent semantics, native-token escrow backing, blob data availability, parent finality or a production native/machine/genesis release pairing.

Three earlier attempts are retained with their actual exits/logs:

1. [Missing Beacon URL](evidence/startup-attempt-1/run/cli-a.log): actual startup exit1 before the game. The private calldata fixture then explicitly disabled its unused blob reader.
2. [Missing coordinator allowance](evidence/startup-attempt-2/run/cli-a.log): actual startup exit1 before the game. The single-node private profile then explicitly enabled `node.dangerous.no-sequencer-coordinator`.
3. [Unsupported finalized-deployment wait](evidence/startup-attempt-3/run/cli-a.log): the private Geth has no finalized header. That owned unready CLI received a recorded SIGTERM, and the controller exited1. The final private profile explicitly sets `ensure-rollup-deployment=false`; parent reader and the requested genesis-validation flag remain enabled. The legacy parent path logs that a genesis assertion is not tested.

These fixture-specific settings are not a production configuration recommendation. The final passing logs retain missing-safe/finalized-header warnings and controller HTTP subscription warnings; actual transaction receipts and state equality, rather than those transport errors, establish the accepted recovery checks. No transport error is presented as an EVM rejection.

## Evidence and remaining gates

[Exact controller/native source identities](evidence/passed/source-manifest.json) · [build receipt](evidence/passed/build-exit.json) · [frozen compiled controller](evidence/passed/compiled-fixture.go) · [ordinary CLI help](evidence/cli-help/cli-help.stdout) · [help exit](evidence/cli-help/cli-help-exit.json) · [verified export](evidence/transfer-verification.json).

All builds, initialization and partial engine work ran on the existing Runpod worker, limited to two CPU-affinity slots. Source/controller evidence and the persistent L2 databases use `/root/gl3-cli-recovery/cli64-v1`; the controller-owned external Geth uses its fresh Go-test temporary directory, recorded in the observed process arguments and removed by test cleanup. The frozen native executable, selected source, selected machine and long interpreter were not modified. There were no public RPC/wallet operations, real funds or new pods.

This accepts the declared idle acknowledged-head **same-host process-crash profile only**. It does not accept asynchronous defaults, arbitrary mid-write crashes, host power/disk loss, service/container supervision, a completed full-strength decision, fraud proofs, sustained block cadence, 20 games or hosting capacity. The selected865 interpreter and future geometry/lifecycle remain separate gates.
