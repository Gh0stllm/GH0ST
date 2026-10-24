# Rolling64 continuity adapter: scoped local review

Reviewed source hashes:

- Model `d9f6cdc02acf6fff54a5ca8524b23a5c13f924f71bc0f8a27c174e56e65ccebb`.
- Hook `78630707918a97768bffabfab136f86dcdb82fe2cb78c2bdf1f3217014d29453`.

This is an implementation review and local integration test, not an external security audit. No production transaction is authorized or performed by these scripts.

## Ownership and context origin

The model stores each story under `keccak256(abi.encode(msg.sender, storyId))`. For pool inference, `msg.sender` is the hook and `storyId` is the canonical PoolId. The ABI contains no setter for another owner's story and accepts no caller-supplied hidden state or KV array. `previewFor` can read another owner's context but cannot update it. The caller-isolation and second-pool tests passed.

KV children are constructed by the model after numeric inference. Each child contains a STOP-prefixed header and per-layer numerical keys/values. On load, the model checks child runtime hash, contiguous absolute positions, count, payload size, and format version. It reads only the suffix needed for the current64-position attention window. Historical children remain append-only. An altered active child is rejected. Expired children are outside active attention; their text and numerical states are not recomputed or reset.

## Quote consistency and rollback

The hook checks both its revision and context hash against96-byte hook data, verifies that the model's stored hash matches, and pins the model runtime hash. The exact caller seed is forwarded unchanged. Both hook preview and swap use the same token policy and decoding settings. All140 tested previews matched actual output and next hash.

The PoolManager authenticates hook callbacks through the immutable manager address and the hook field of the PoolKey. The model namespace cannot be advanced directly by an EOA. A revert anywhere after model inference rolls back the KV child creation, model state, hook state, pool state, and settlement. An actual forced post-settlement router revert demonstrated this at16,296,575 gas, followed by a successful identical starting request.

The hook has no owner, reset, arbitrary-call, withdrawal, or external-state injection function. Permissionless users can choose different seeds and race to advance the same pool. Stale-quote rejection makes this a liveness/UX concern rather than a silent substitution of model output; clients need to handle a fresh quote after contention.

## Resource bounds

The hook pins1,235,968 parameters,4,019 vocabulary entries, hidden128, four layers, maximum two new tokens,64-position attention, and2,048 absolute positions. The configured local call budget is29.25M and each transaction is limited to32M. The model reads at most the recent64-position suffix and emits one or two numeric KV positions per successful call. The hook's EIP150 reserve is checked before entering inference.

In the140-swap path, whole transactions consumed10.914M–26.513M gas. After the attention window filled, gas stayed25.144M–25.388M through absolute position154. This is measured evidence on this trajectory, not proof of the worst possible activation/seed path or target-chain gas schedule.

## Deliberate deployment blockers

1. The hook constructor is local-only (`block.chainid == 31337`). A production variant needs explicit target-chain review.
2. At2,048 processed positions, `ContextExhausted` rejects future pool swaps. The model also enforces its own `ContextLimit`. This was reviewed in source, not reached by fabricating a history or running2,048 live swaps. A production pool needs a reviewed continuation or lifecycle policy.
3. The64-position window is a model behavior change from full-context attention. Broad quality evaluation and many independently seeded stories remain necessary before making quality or uniqueness claims.

These blockers do not invalidate the local result. They prevent treating this research pass as authorization to deploy an indefinite, production story pool.
