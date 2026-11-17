# Bounded operator actions

**Two root-executed Robinhood actions are confirmed.** The preparation lane signed and submitted nothing. Root reviewed the exact unsigned plans, provided its own deferred signers, executed each once, and retained successful canonical receipt checks with 12 descendants. This does not establish a running GL3 node or public bridge.

| Action | Exact result | Actual network fee |
|---|---|---:|
| Validator allowance | 100,000 GH0ST approved to receipt-derived Rollup `0xeE811A8ee20C03E684ECB5BFd6f7721f85451b01` | 922,218,380,000 wei |
| Isolated deployer refund | 3,371,295,247,024,000 wei returned to cold owner `0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6` | 420,294,000,000 wei |

Approval transaction: `0xf780fef027eb7ca63aa95257f16dc4723a19ad06e2bc5160a35738fa76096e3d`.

Refund transaction: `0x70c4d2b161e3b2167e91315675f5d5c1051031a325b6f6ea2d2d6affc0bd6194`. The deployer retained exactly 591,032,400,000 wei of unused maximum gas reserve. No second dust sweep, retry, replacement or top-up was authorized by this helper.

## Exact plans and evidence

- [Approval plan](plans/validator-approve.json): SHA256 `6cd96acbebdfe4ab4183a1ce9c9a27383eb899440b53dbb1d99094ac5f971fee`; maximum transaction fee 2,225,262,504,000 wei.
- [Refund plan](plans/deployer-refund.json): SHA256 `7706167d06cb0ab11d55cf390192fe04b0a804d8be6aa73b77642f55c69ad927`; maximum transaction fee reserve 1,011,326,400,000 wei.
- [Root approval result](evidence/validator-approve.result.json) and [root refund result](evidence/deployer-refund.result.json) contain sanitized transaction hashes and final accounting, not signatures or authorizations.
- [48-case test report](evidence/test-result.json) and [actual test exit](evidence/test-exit.json): exit 0, 3.670 s, 94,208 KiB kernel process high-water. These are synthetic/unsigned tests, not 48 live transactions.
- [Actual read-only preparation](evidence/actual-drafts.json): both plans prepared successfully in approximately 46 s each, with zero signatures and submissions.
- [Public evidence capsule](evidence/unsigned-helper-evidence.tar.gz), 13,750 bytes, SHA256 `41c0bf2916aeb8cb6710b255e43b6e32ba45f36c1e50abcda75f00b14abceeba`. Its [member manifest](evidence/unsigned-helper-evidence.json) covers the frozen unsigned source, plans and test/preparation evidence. Root execution results are separate, later files.

The first harmless test attempt failed on an incorrect import path before cases ran. Its log and exit remain in `evidence/test-attempt1.*`; the corrected test passed. Tests/builds and read-only preparation ran on Runpod, with core dumps disabled. No local chain simulation or test was used.

## Binding and limits

[actions.mjs](actions.mjs) is frozen at SHA256 `79f09301a830cb2d75bdfddb24de0f5266ff4e973a3ed06e61e71e3be80aebd4`. The plans pin it and the existing reviewed execution library hashes. Each action has an independent 100,000,000,000,000 wei fee ceiling (0.0001 ETH); actual plan ceilings above are smaller.

The helper requires the accepted independent 27-receipt deployment manifest, its corrected audit source, the original funding/consent metadata and fresh canonical 12-descendant receipts. It checks runtime/roles, the exact Rollup creation graph, chain IDs, zero pending-nonce ambiguity, GH0ST code and decimals, finite stake amount, current allowance and exact funding accounting. The approval refuses any existing nonzero allowance. The refund sends the exact recorded balance less its bounded maximum gas reserve; postchecks reconcile the actual fee and remaining reserve.

The original financial deployment runner failed only its final audit after 27 successful transactions. Its source/journal and failure remain unchanged. This lane binds the separately corrected read-only audit: source `e30421790cf86e690aa9a41b63259e4182fda36c9ea4b6cde9da76ddfa98c511`, accepted manifest `150f9bd795903b2e0b03471774771f1e8f7fe7402d2c2611715e2da9fbcf4567`. It does not require an invented `deployment-result.json`.

## Entrypoints and custody

`preparePlan({kind, provider, outputPath})` prepares an unsigned plan. `consentTemplate(planPath)` produces a default `userApproved:false` template; the published examples remain false. Only root may review and create a separate exact authorization.

`executePlan({planPath, authorizationPath, provider, getSigner})` accepts a root-owned deferred signer callback. It contains no wallet loader or private key path. Fresh source, chain, receipt, fee and observation checks run before requesting a signer. The completed plans must not be executed again.

An existing signed journal always refuses execution, including unknown outcomes. `reconcilePlan({planPath, authorizationPath, provider})` is the separate read-only canonical-receipt path; it never rebroadcasts. The wrapper deliberately blocks the legacy executor's possible resume/rebroadcast branch. A stale outer lock is not automatically removed.

Signed journals, raw signatures, actual authorizations, key files and the root-only execution wrapper are intentionally excluded from this public packet. Confirmation results do not prove operational monitoring, ongoing validator behavior or chain uptime; those remain separate launch checks.
