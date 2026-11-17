# Hash-bound private service assembly

This is the ordinary official Nitro 3.12.2 node/backend pair. The chain uses project-operated fast confirmation. The operator can authorize false withdrawal roots; the validity-proof research is not active at launch.

`operator_pair.py` is a private bootstrap adapter, not a public activation switch. It starts the authenticated backend first, checks the exact official module root, then starts the node. Chain-ID and block-zero health must match the reviewed profile. Each peer failure stops both owned groups; at most three pair restarts follow, with all file and runtime hashes checked again. Operator stop terminates both groups. Logs record lifecycle events without private configuration or wallet values.

## Inputs

Copy `service-bundle.example.json` to a private durable location and replace every placeholder with a receipt-derived path/hash. It intentionally fails until those records exist and the public approval explicitly permits private startup. Keep all files under `/workspace/gl3`; effective node/backend configuration and JWT must be regular owner-only files. Root's separately tested renderer creates the effective private configuration; Nitro does not interpolate the template password or parent-URL references itself.

The external approval must bind these exact SHA256 values: `profileSHA256`, `renderReceiptSHA256`, `deploymentManifestSHA256`, `fundingManifestSHA256`, `nodeConfigSHA256`, `backendConfigSHA256`, `chainInfoSHA256`, `genesisSHA256`, `supervisorSourceSHA256`, and `backendProbeSHA256`. It must explicitly set `operatorReviewed`, `privateBootstrapStartApproved`, `licenseConfirmed`, and `boundedFundingApproved` true. `publicActivationApproved` remains false until the separate final chain/bridge checks pass. A receipt with these booleans is evidence of operator review, not a substitute for a license decision or a mined funding/deployment receipt.

The renderer receipt uses schema `gh0st.gl3.operator-config-rendered.v1`; its `nodeEffectiveSHA256` and `backendEffectiveSHA256` bind the effective configuration files. Both deployment and funding manifests must have `passed:true` and be bound by the external approval. The adapter validates their identity/status; the per-action deployment verifier independently checks actual transactions, runtime immutables, mutable factory state, authority and proxy configuration before that approval is issued.

## Run order

1. Complete and verify the isolated 27-action deployment, bounded operator funding and the actual validator stake-token allowance. `auto-increase-allowance:false` deliberately requires a separately reviewed bounded approval; token funding alone is insufficient.
2. Build receipt-derived chain info and render private configuration/JWT/keystores using the root-operated helper. Cold custody stays off-server.
3. Restore the public runtime dependencies/aliases after any container reset. The node/backend/JIT and machine inputs are durable; system Node/Python/libraries need the reviewed reset-runtime bundle or installation. No real service should run during a port-reset window.
4. Hash and review the public approval and service bundle. Run the adapter without `--start` for a private readiness check. This may read the approved effective configuration/JWT metadata but starts no service.
5. Run the same bundle with `--start` only after the explicit private-start review. The CLI takes file paths, never passwords or private keys. Observe `pair_healthy` in the owner-only lifecycle journal. The node initially listens only on loopback.
6. Complete the backed cold child deposit, minimum-first/current-second fee setup with real header/report barriers, treasury assignments and owner renunciation. Verify owners exactly `[0]`, no native minters, native management time zero, final fees and canonical bridge receipts. Public activation remains a separate reviewed step.

```text
/workspace/gl3/same-day-mainnet/ops/infra-prepare/runtime-exec.sh python /workspace/gl3/same-day-mainnet/node/operator_pair.py --bundle /workspace/gl3/mainnet/review/service-bundle.json
/workspace/gl3/same-day-mainnet/ops/infra-prepare/runtime-exec.sh python /workspace/gl3/same-day-mainnet/node/operator_pair.py --bundle /workspace/gl3/mainnet/review/service-bundle.json --start
```

This is a single server with bounded process recovery, not high availability. The seven actual dummy-process tests and two additional generated-bundle schema/pairing checks passed on Runpod; a real production-bundle startup, durable process restart and public RPC acceptance have not yet happened. The schema checks detected and preserved an initial stale-template fee-cap failure before the reviewed template was synchronized. The official authenticated backend had a separate genuine root-capability startup smoke. Private SDK assertion/fast-confirmation and bridge payout were exercised with generated TEST roles, including the disclosed persisted-state restart.

## Timing and custody limits

No fixed normal withdrawal timelock is selected, but the operator and parent processing remain necessary. The current conservative node template checks finalized parent batches; a read at 17:44:25 UTC measured safe about 11m34s and finalized about 18m19s behind Robinhood latest. This is a time-specific observation, not a guaranteed duration. Default delayed-message sequencing uses safe parent finality. Five-second assertion posting does not eliminate these gates. A faster parent policy needs an explicit separate trust/reorg review.

The cold parent UpgradeExecutor authority and manual pricer remain project controlled. Child renunciation removes direct chain fee/mint administration; it does not remove parent proxy-upgrade or fast-confirmation trust. Poster reimbursement accrues in native GH0ST, not automatic ETH replenishment.
