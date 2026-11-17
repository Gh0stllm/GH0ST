# Durable boot inventory · static review

**The runtime dependencies resolve, and a fail-closed bootstrap/process supervisor is implemented. A replacement-container or actual production-service boot has not been rehearsed.** The successful [private SIGKILL recovery](../README.md) used the same running host and persistent mount. This follow-up only reads paths, package versions, linker dependencies and service metadata. It starts no chain, reopens no DB and restarts no service or host.

[Exact inventory](static-inventory.json), recorded on BIG `cc91695a75f7` at2026-11-17 10:05UTC; SHA256 `4b4411b8562d2ad432e13e2cd177608e99037768050be3ca4aac06799f0f19db`.

## What survives in the persistent volume

| Required alias or data | Durable target |
| --- | --- |
| `/root/gl3-base-launch/bin` | `/workspace/gl3/durable/bin` · official Nitro and plain test-parent Geth |
| `/root/gl3-base-launch/machines` | `/workspace/gl3/durable/machines` · `latest` resolves to official `c10` |
| `/root/gl3-base-launch/artifact-lock.json` | `/workspace/gl3/durable/artifact-lock.json` |
| `/root/gl3-base-launch/nitro-clean` | `/workspace/gl3/durable/nitro-clean` · SDK and chain-info JSON |
| `/root/dispute` | `/workspace/gl3/durable/neutral/dispute` · pinned Node dependencies and neutral contract artifacts |
| `/root/terminal-acceptance/bin/geth` | `/workspace/gl3/durable/bin/geth` · private test-parent helper |
| Private test databases, exact genesis/config inputs and diagnostic helper | `/workspace/gl3/testnet/withdrawal-recovery/` |

These `/root` alias directories belong to the working container and must be recreated deliberately after replacement. The durable targets and the tested DBs use device93; the working root uses device117. The configured Runpod volume is `hb0wpuifqx`, API quota1,000GB. The filesystem's shared pool size is not that allocation and proves no chain capacity.

The official node remains SHA256 `d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed`, paired with root `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`. The frozen artifact lock lists the exact node and machine-file hashes; a boot procedure must verify them before opening a live DB. The durable chain-info JSON is10,733 bytes, SHA256 `d7e8b87f078b10178a0ef03e809d3dad93a2583f6e181cc50f12368b57e58cdc`.

## Runtime dependencies versus build tools

`ldd` resolves every dependency of official Nitro, plain Geth and the accepted genesis diagnostic. Nitro and the diagnostic need the Linux loader, `libc.so.6`, `libm.so.6` and `libgcc_s.so.1`; plain Geth lists the loader and libc. No missing dynamic library is reported. Installed versions are libc6`2.39-0ubuntu8.7` and libgcc-s1`14.2.0-4ubuntu2~24.04.1`. These system libraries live in the working image, so a replacement needs a pinned compatible image/package closure.

CA certificates (`20240203`) support an HTTPS parent RPC. Node (`18.19.1+dfsg-6ubuntu5`) is currently installed at `/usr/bin/node` on the working disk; it is required by these deployment/test helpers and any future Node-based operator wrapper. The official Nitro daemon itself does not require Node or the fixture's private Geth parent. Python is used by test controllers and inventory tools.

Go, Rust, C/C++ compilers, the full SDK and `libstylus.a` are **build dependencies**. The latter resolves to durable `/workspace/gl3/durable/native/lib/libstylus.a`,637,520,088 bytes, SHA256 `42cc75b003aaab6686620da6ec947bb475fe221b605bd0ac1bf417a171f4546c`; headers resolve to the sibling `include/`. It is statically linked into relevant tools, not an additional `.so` the official daemon must find at startup. Rebuilding tools is separate from restarting a frozen node binary.

The private fixture requires `GL3_PARITY_BASE`, `GL3_PRIVATE_OUTPUT` and `GL3_NODE_PACKAGE`; its successful retry also points `GL3_REUSE_PRIVATE_FIXTURE` at generated test material. **Those fixture settings and keys are not a production boot profile.** A public node needs a reviewed live chain-info/genesis/config tuple, parent RPC reference and operator key references, supplied without embedding secret values in Git.

## Concrete launch gates still open

1. **Reviewed boot activation.** The implementation below checks the durable closure and can restore aliases only under its explicit install flag. Finalize/review the live profile and runtime image/packages before activation, and verify the approved config paths/hashes/chain identity. Existing DBs must not be silently replaced by a fresh genesis. The implementation checks three Pebble CURRENT/MANIFEST layouts using metadata only, refuses partial layouts and requires separate explicit initial-genesis review for missing/empty state. Production bootstrap belongs to the [launch lane](../../launch/).
2. **Supervision and health.** PID1 currently runs `/bin/bash /start.sh`; systemd is not running, and no GL3/Nitro-named service files were found in the checked systemd, supervisor, cron and local-bin locations. The bounded supervisor below passes dummy-process tests; registering an actual container entrypoint, retaining useful redacted daemon diagnostics and production health monitoring still need acceptance. This is not a requirement to install systemd, nor proof that every possible generic startup hook is absent.
3. **Controlled durable-boot rehearsal.** Recreate the working image/aliases against an approved private persistent DB while checking exact head/root/message/nonce and subsequent progress. No active host or current dispute should be restarted for this. The743ms process-recovery result is a separate, completed gate; pod replacement, host power loss and failover remain untested.
4. **Public protocol/configuration.** Freeze the actual Robinhood-parent deployment, current GH0ST token/pricer configuration, owner/batch-poster/validator roles, RPC access and unsigned funding/gas review. The private snapshot remap, unit-rate pricer and privileged fast confirmer do not establish those settings. Permissionless confirmation and dispute evidence are handled separately in the [dispute lane](../../dispute-readiness/).
5. **Operations and retained data.** Define batch/validator lag, balance, DB growth and backup/restore monitoring for the selected retention mode. The100-transfer storage observation establishes a small workload, not1TB lifetime or historical-proof availability. No uptime or redundant-host acceptance follows from one persisted worker.

No private signing key, user wallet, public transaction, DNS configuration or deployment was inspected or changed by this inventory.

## Implemented bootstrap and bounded supervision

[Bootstrap CLI](operator_bootstrap.py) consumes the launch lane’s `gh0st.gl3.base.operator-profile.v1`; [supervisor core](operator_runtime.py) owns one process group and an exclusive state-directory lease. The unconfigured profile is refused by both `--check` and `--dry-run` with expected exit2, no network calls, no DB opens and no alias changes. Exact official-node/c10 hashes are built into the check. Node/config/genesis mismatch, ephemeral data paths, public binds, inline RPC/key/password values and force-initialization overrides fail closed.

The bootstrap requires selected live roles/chain/settings, three exact bundle hashes, producer review flags and a separate [activation-review receipt](activation-review.example.json) binding the profile and both implementation source hashes. This is an operator-controlled integrity gate, not a cryptographic authorization service. The example remains explicitly unapproved. It neither signs a transaction nor approves spending.

Parent RPC input is an environment/file **reference** and the reviewed template contains only `$GL3_PARENT_RPC`. Check/dry-run inspect reference metadata, not values. A future explicitly approved `--start` resolves it into a0600 temporary config under `/run`, invokes only the pinned Nitro binary with that config pathname, and removes the temporary file afterward. Paid-role keystore paths are metadata-checked without reading key contents; noninteractive unlock can use a reviewed `passwordEnv` reference and `$GL3_WALLET_PASSWORD` placeholder. Final live-keystore/unlock integration has not been exercised.

The supervisor revalidates reviewed inputs before each attempt, allows at most three restarts with bounded exponential backoff, forwards SIGTERM/INT to its owned process group, escalates after a fixed grace period and records actual child exit/signal/resource metadata. No systemd dependency is introduced. A second supervisor cannot own the same state directory. It never deletes an existing DB/genesis or silently replaces an alias.

**Diagnostics limitation:** daemon stdout/stderr are deliberately discarded by default so upstream errors cannot echo RPC/password values into logs. Only structured lifecycle metadata is retained. This does not close production monitoring, redacted error retention, alerting or uptime acceptance.

The separate [dummy-only regression](supervision_regression.py) passes **11 named cases**, actual direct-child exit0 in **2.462s**, on Runpod. It covers incomplete-profile check/dry-run, actual dummy crash/restart exhaustion, graceful termination, ignored TERM→KILL/reap, exclusive ownership, four unsafe-config rejections and missing/empty/partial DB-layout refusal. It launches only small Python dummy processes and leaves none running. No Nitro, network listener, chain, real key, alias installation or host restart is involved.

[Result](evidence/bootstrap/result.json) · [actual wait4 exit](evidence/bootstrap/actual-exit.json) · [named cases](evidence/bootstrap/regression.log) · [source/config provenance](evidence/bootstrap/source-manifest.json) · [actual blocked check](evidence/bootstrap/check.json) · [dry-run](evidence/bootstrap/dry-run.json).

Manual operator commands, **not executed as service actions in this work**:

```sh
python3 operator_bootstrap.py --check --profile /path/to/reviewed/production-profile.json
python3 operator_bootstrap.py --dry-run --profile /path/to/reviewed/production-profile.json
python3 operator_bootstrap.py --install-aliases
python3 operator_bootstrap.py --start --profile /path/to/reviewed/production-profile.json --approval-receipt /path/to/reviewed/activation-review.json
```

The remaining operational action is to complete and approve the producer’s real profile/config/chain-info/genesis and role-secret references, choose/register the reviewed container entrypoint and diagnostics/health policy, then schedule a controlled private persistent boot/replacement rehearsal when other work is safely stopped. No actual production service or replacement boot is accepted by these tests.
