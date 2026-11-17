# Actual process crash: cursor64 passed

The selected native execution and consensus node survived a genuine **SIGKILL**
at pending chess cursor64. A fresh executable process reopened the same three
Pebble databases, recovered the exact acknowledged head/root/message position
and raw chess state, then mined the next real advance to cursor65.

This passed for an explicit **synchronous Pebble, archive, save-every-block**
private fixture. The parent was a real external Geth process kept alive by the
controller. No node shutdown, cache-drop helper, manual flush or pending-game
image checkpoint ran before the kill. The kernel and storage remained running.

| Observed check | Result |
| --- | --- |
| Named test | `TestGL3Cursor64ProcessCrashRecovery` |
| Build / full test exit | 0 / 0 |
| Build / test duration | 40.90s / 34.15s |
| Killed worker | PID86880, actual wait status9 / SIGKILL |
| New worker | PID89284, distinct process start ticks |
| Native binary | Same SHA256 `e9a549b96fdc31cddf647e67ac74d8e86520841661f8ce9b1946b8a6223e32df` |
| Selected custom machine | `865168…f086` |
| Genesis | Same `b3005537…bc7851` |
| Recovered L2 head | `cc501720…a0bff`, block69 |
| Recovered state root | `e9480eca…ff76ca` |
| Consensus position | Head message69 / message count70, unchanged |
| Owner nonce / chess cursor | 69 / 64, unchanged |
| Database identity | Same actual paths, directory device/inodes; all three resolved sync options true |
| First resumed transaction | `e546f137…74884`, successful receipt, cursor65 |
| Recovery plus first advance | 8.136s |
| Final new-worker cleanup | Actual exit0 |

[`evidence/run/cursor64-process-recovery.json`](evidence/run/cursor64-process-recovery.json)
contains full identifiers, raw inspect bytes, original/reopened snapshots, parent
head identity and the successful resumed receipt. Actual killed-worker and final
worker exits were persisted separately before later checks. The complete
[test log](evidence/test.log) and [outer process exit](evidence/test-exit.json) are
retained, alongside before/after consensus-source and binary hashes.

[`gl3_process_recovery_test.go`](gl3_process_recovery_test.go) is the exact
cloud-formatted compiled fixture, SHA256
`80ea949f2d4017a43bcc11db9c28725fc3b7b06a8c50fdef6caee61f4074ec6f`.
[`run-short.py`](run-short.py) records the isolated Linux Go build/test procedure
using two build CPUs. All compilation and tests ran on Runpod. The large complete
genesis import, databases and binary remain private on that worker; their
identities are retained in the small public evidence.

The native runtime/library inventory is explicitly **post-run**, rather than an
invented before/after measurement. It records the exact prepared `libstylus.a`
identity and the absence of optional `target/bin/jit`. Logs also retain the
fixture's unavailable optional validation RPC module and parent-wrapper
subscription fallback notices. This run exercised neither a validator nor a
fault proof.

The [full-decision follow-up](full-decision/README.md) separately passed genuine
crashes at64 and2048 and the original final move and complete canonical hash. The
[design](DESIGN.md) explains the process boundary and durability profile.
The asynchronous Pebble default has not gained this acceptance. Power failure,
disk failure, production daemon/container supervision, long-game storage capacity
and the selected guest's ongoing interpreter proof remain separate gates. No
public deployment or real spending occurred.
