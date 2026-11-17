# Official GL3 node and validator pair

The launch pair uses the **unmodified official Nitro3.12.2 image**, not the experimental chess, ZK or host-cache builds. All execution below is on Runpod. Public services have not been started.

| Artifact | SHA256 |
|---|---|
| Nitro node | `d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed` |
| `nitro-val` | `3e95c6e37739b01162a01f1ff82c2646916eecf9ec7286deae9a9fdb67fe150f` |
| `jit` | `ae83e777fc05aad03f6ab929da74444b22839e4000759c30bf82774123967703` |
| `prover` | `7befb9d61622a018df714d28a7e4909cbdf775ac79e5698ac6cce35ca211f6c3` |

OCI digest `sha256:c908f324a08b7332d1fa031b83b071cfa2d9edd8a364c4344d7c34b665bf08e9` binds the separately extracted binaries. `official-validator/` contains the image manifest, exact layer lengths/digests, extraction script and actual version/help results. No local compilation is substituted. Standard module root is `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`.

## Actual backend acceptance

`backend-smoke.py` started the official backend, connected to its JWT-authenticated loopback WebSocket and checked `validation_wasmModuleRoots` supports that exact root. It passed in2.385s, then exited0 on SIGINT with no owned process left. The first connection-refused startup probe is retained. No model or STF transition was executed in this smoke.

## Production templates

`node.proposed.json` uses GL34663001, Robinhood4663, durable Pebble synchronous writes, zero-owner genesis, explicit machine root, block validation and standard MakeNodes staking. It enables operator fast confirmation, minimum assertion age0 in the deployment configuration, and activity-driven5s assertion posting. It uses finalized parent checks rather than the accelerated private-fixture settings.

`validator.proposed.json` exposes validation only through JWT-authenticated loopback. JIT performs normal block validation; the native arbitrator remains available for actual dispute execution. The official standalone server has permissive internal request limits; it must stay off public ingress. This is not the custom source06 transport build.

After receipt-derived chain info, reviewed configuration hashes, operator key references and approval are bound, the two commands are:

```text
/workspace/gl3/same-day-mainnet/node/bin/nitro-val --conf.file /workspace/gl3/mainnet/config/validator.private.json
/workspace/gl3/durable/bin/nitro --conf.file /workspace/gl3/mainnet/config/node.private.json
```

The template parent URL and passwords are references, not usable values. Cold owner custody stays off-server. The previously tested base bootstrap rejects this new profile schema until an explicit adapter and final bundle are reviewed. These commands are not an activation instruction.

## Private end-to-end rehearsal

`validator-private.py` consumes only a held loopback fixture handoff and a generated TEST wallet file under `bridge-rehearsal/`. It starts a separate ordinary follower/staker plus the official validator backend, with the same machine and exact zero-owner genesis. The SDK computes the actual execution state and history commitment; the script never accepts an arbitrary externally supplied withdrawal root for signing.

For operator-fast mode the contract fast confirmer must equal the fixture validator. The official SDK creates an ordinary assertion, then calls `fastConfirmAssertion` using its actual assertion creation information. The bridge consumer independently checks the trace, nonzero history commitment, canonical child header/send root, payout and rejected withdrawal alterations/replays. Private-only latest-parent and short polling settings are disclosed in the receipt; they are not production-finality acceptance.

The producer stops only its own processes after `bridge-payout-complete.json`, records actual exits and descendant cleanup, removes its temporary authentication/config secrets, then writes `validator-evidence.json` and `validator-stopped.json`. Limits are20min,24GiB owned sampled RSS,56GB shared working set and6GB root free space. At this documentation checkpoint the full fast-profile result is still pending; backend acceptance alone is not a bridge or production-launch pass.
