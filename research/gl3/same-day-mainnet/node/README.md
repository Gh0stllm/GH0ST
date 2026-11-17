# Official GL3 node and validator pair

The launch pair uses the **unmodified official Nitro 3.12.2 image**, not the experimental chess, ZK or host-cache builds. All execution below is on Runpod. Public services have not been started.

| Artifact | SHA256 |
|---|---|
| Nitro node | `d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed` |
| `nitro-val` | `3e95c6e37739b01162a01f1ff82c2646916eecf9ec7286deae9a9fdb67fe150f` |
| `jit` | `ae83e777fc05aad03f6ab929da74444b22839e4000759c30bf82774123967703` |
| `prover` | `7befb9d61622a018df714d28a7e4909cbdf775ac79e5698ac6cce35ca211f6c3` |

OCI digest `sha256:c908f324a08b7332d1fa031b83b071cfa2d9edd8a364c4344d7c34b665bf08e9` binds the separately extracted binaries. `official-validator/` contains the image manifest, exact layer lengths/digests, extraction script and actual version/help results. No local compilation is substituted. Standard module root is `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`.

## Actual backend acceptance

`backend-smoke.py` started the official backend, connected to its JWT-authenticated loopback WebSocket and checked `validation_wasmModuleRoots` supports that exact root. It passed in 2.385s, then exited 0 on SIGINT with no owned process left. The first connection-refused startup probe is retained. No model or STF transition was executed in this smoke.

## Production templates

`node.proposed.json` uses GL3 4663001, Robinhood 4663, durable Pebble synchronous writes, temporary-cold-owner genesis and subsequent configure/renounce policy, explicit machine root, block validation and standard MakeNodes staking. It enables operator fast confirmation, minimum assertion age 0 in the deployment configuration, and activity-driven 5s assertion posting. It uses finalized parent checks rather than the accelerated private-fixture settings.

`validator.proposed.json` exposes validation only through JWT-authenticated loopback. JIT performs normal block validation; the native arbitrator remains available for actual dispute execution. The official standalone server has permissive internal request limits; it must stay off public ingress. This is not the custom source06 transport build.

After receipt-derived chain info, reviewed configuration hashes, operator key references and approval are bound, the two commands are:

```text
/workspace/gl3/same-day-mainnet/node/bin/nitro-val --conf.file /workspace/gl3/mainnet/config/validator.effective.json
/workspace/gl3/durable/bin/nitro --conf.file /workspace/gl3/mainnet/config/node.effective.json
```

The template parent URL and passwords are references, not usable values. Cold owner custody stays off-server. The legacy base bootstrap rejects this new profile schema; the separate same-day adapter below accepts only a hash-bound, explicitly reviewed service bundle. These commands are not an activation instruction.

## Private end-to-end rehearsal

`validator-private.py` consumes only a held loopback fixture handoff and a generated TEST wallet file under `bridge-rehearsal/`. It starts a separate ordinary follower/staker plus the official validator backend, with the same machine and exact temporary-cold-owner genesis and subsequent configure/renounce policy. The SDK computes the actual execution state and history commitment; the script never accepts an arbitrary externally supplied withdrawal root for signing.

For operator-fast mode the contract fast confirmer must equal the fixture validator. The official SDK creates an ordinary assertion, then calls `fastConfirmAssertion` using its actual assertion creation information. The bridge consumer independently checks the trace, nonzero history commitment, canonical child header/send root, payout and rejected withdrawal alterations/replays. Private-only latest-parent and short polling settings are disclosed in the receipt; they are not production-finality acceptance.

The producer stops only its own processes after `bridge-payout-complete.json`, records actual exits and descendant cleanup, removes its temporary authentication/config secrets, then writes `validator-evidence.json` and `validator-stopped.json`. Limits are 20min, 24GiB owned sampled RSS, 56GB shared working set and 6GB root free space. The SDK producer genuinely created and fast-confirmed an existing assertion with nonzero history. Its producer verdict remains cancelled/false after a bridge-tail ABI error. The bridge lane then completed payout and three mined negatives from an exact copied persistent-state restart; this is a combined lifecycle, not an uninterrupted producer pass. No production service was started here.

`operator_pair.py` and `backend-auth-probe.cjs` provide the loopback pair adapter. Seven actual dummy-process lifecycle tests passed in 2.302s: restart bounds, hash gates/drift, peer/operator stop, stop during readiness and approval refusal before private configuration reads. Actual production key import/render is a separate root-operated step. The adapter requires the renderer SHA bindings plus explicit license/funding/private-bootstrap approval, checks exact binaries/machines on restart, authenticates backend before Node and stops peers together. Public activation remains a separate final-owner/fee/bridge gate.

[Private assembly and approval contract](ASSEMBLY.md) documents the receipt schema, runtime restore, exact startup order and remaining real-service acceptance. [service-bundle.example.json](service-bundle.example.json) is deliberately unselected.

Two additional generated-bundle checks passed in 2.940s: the actual renderer schema maps to the adapter, and an otherwise hash-valid mismatched backend endpoint is rejected. The first attempt exposed a stale durable template with the old 1 GH0ST RPC fee cap; that failure is retained, and the reviewed 1000 GH0ST template was synchronized before the passing retry. No real operator configuration or service was used.

## Port-reset runtime binding

The container reset changed the host to `42456c02ced1`. Only the supervisor's host guard changed; the updated source is SHA256 `87c3c6aee1360268e728758107e264afc28f5d3597c6650aa9f8c9876e8d2c03`. Nine focused Python-only cases passed after reset. An initial fixed 0.5-second test readiness assumption failed and is preserved; the repaired test waits for actual readiness with bounded cleanup, without changing production restart policy.

The old Debian Node bundle could print its version but failed JavaScript initialization after reset. Root replaced it with the official standalone Node `v24.22.3`, SHA256 `a7ec1b37e6ff9d187e4198c5b6df9a4eb1c74dd31804fb3bac55cc4ceca1ac01`, and separately verified JavaScript/crypto/ethers execution. Use the reviewed `runtime-exec.sh` environment for the supervisor so its backend probe inherits that runtime. The Python tests do not themselves prove Node availability.

[private-start-draft/](private-start-draft/) contains exact public hashes from the actual renderer receipt and a deliberately unapproved service bundle. `assemble-service-draft.py` reads no effective configuration or secret bytes. The draft binds the standalone Node and wrapper hashes; private startup remains false until root verifies bounded allowance, runtime and explicit approvals.
