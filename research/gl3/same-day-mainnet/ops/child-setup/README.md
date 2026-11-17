# Cold-wallet child setup — prepared, not executed

This is an additive Mac-local phase-2 review. It does not deploy contracts, alter the running node, accept license terms, activate public services, read a cold key on Runpod, or automatically fund anything. The root deployment operator owns launch execution. The user's updated 1,000,000 GH0ST bridge instruction replaces the earlier 100 GH0ST setup deposit; it is not 1,000,100 GH0ST.

The owner is `0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6`. Child chain ID is `4663001`, parent is Robinhood `4663`, and the exact production child genesis is `0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483`.

## Exact review

One unlock permits just-in-time signing of these nine actions, in order. No group of transactions is pre-signed across fee transitions.

1. On RH, approve **exactly 1,000,000 GH0ST** to the Inbox derived from the actual successful `RollupCreated` receipt.
2. On RH, `depositERC20(1000000e18)` to that same Inbox, with zero ETH value.
3. Child nonce0: `setMinimumL2BaseFee(1e13)`.
4. Wait for a genuine later child header with header base fee, direct `eth_gasPrice`, and minimum fee all exactly `1e13`; child nonce1: `setL2BaseFee(1e13)`.
5. Wait for that same genuine barrier after the current-fee setter; child nonce2: `setNetworkFeeAccount(coldTreasury)`.
6. Child nonce3: `setInfraFeeAccount(coldTreasury)`.
7. Child nonce4: `setL1PricingRewardRecipient(coldTreasury)`.
8. Child nonce5: `addChainOwner(address(0))`.
9. Child nonce6: `removeChainOwner(coldTreasury)`.

The same cold EOA receives exactly1,000,000 native GH0ST on GL3 after the genuine parent deposit credit. The latest explicit user instruction is **“no cap use market gas.”** The active plan therefore uses `feeMode: fresh-market` and `aggregateFeeCeilings: null`. It has no aggregate ETH/GH0ST fee ceiling and no legacy cap fields. Each signature uses a fresh full market estimate and displays its estimated fee and exact signed maximum; the signed maximum is still enforced, with30-second quote expiry. Exact principal and token allowance remain1,000,000 GH0ST. There are no automatic top-ups, extra heartbeat deposits, nonce changes, replacements or ambiguous rebroadcasts. The earlier capped packets and evidence remain preserved under `actual/ready-packet.capped-6478/` and `actual/ready-packet.before-headroom-6476/`.

The existing RH safe/finalized checks stay enabled. Parent deposit credit and genuine report/header barriers can take roughly 11–18 minutes each. The helper waits; it does not change finality, forge headers, force mining or add a zero deposit. A wait is not a failed transaction or a reason to retry.

## Fee and receipt rules

Every signed transaction is ordinary EIP-1559 with `maxFeePerGas = 2 × fresh direct eth_gasPrice`, priority0. The fresh quote is queried after estimating. Quotes expire after 30 seconds and are checked again before the sole send.

Child full-gas limit follows the actual V4 rehearsal implementation:

```
computeMargin = isolatedCompute / 5 + 10000
fullFloor = max(ordinaryFullEstimate, NodeInterfaceL1Component + isolatedCompute)
gasLimit = fullFloor + computeMargin + NodeInterfaceL1Component / 5
isolatedCompute + computeMargin <= 16777216
```

The total gas limit can legitimately be billions: it includes parent-data gas. Only computation is compared to the unchanged 16,777,216 compute limit. The ordinary estimate retains full charging. `skipL1Charging:true` appears solely on supported read-only compute estimation and, during the first two setters, read-only view calls. It is never a signed field.

Actual RH chain ID, child chain ID/genesis, the successful canonical creation receipt, its unique token-specific `RollupCreated` event, receipt-derived contract addresses, deployed code, backing token code/decimals, rollup chain ID and fast confirmer are read before signing. All prior receipts are rechecked canonically before another action. Child authority/mint/upgrade state, exact nonces, balance and per-signature fee bounds are checked. Final readback requires owners exactly`[0]`, minters`[]`, managementFrom0, upgrade`[0,0]`, all three cold treasury recipients and calibrated fees.

## Prepare the actual plan

Copy the **actual** receipt-derived values into `runtime-fields.template.json`; retain a separate reviewed runtime file. Unknown fields are rejected. `receiptPacketSHA256` and `deploymentAuditSHA256` must bind the passed real27-receipt audit; the Mac review loads both public evidence files and rejects a failed final audit, mismatched event/genesis, or changed hashes. `priorUserConsentSHA256` must hash the actual saved prior launch consent file. The plan generator must never invent addresses or use a rehearsal receipt.

On Runpod, with the existing ethers dependency linked into the source directory:

```
node make-plan.mjs actual-runtime-fields.json /path/to/production/fee-policy.json /private/output/plan.json
python3 build-review.py --plan /private/output/plan.json --policy /path/to/production/fee-policy.json --esbuild /workspace/gl3/same-day-mainnet/ops/review-draft/esbuild --receipt-packet /path/to/passed/packet.json --deployment-audit /path/to/passed/deployment-verified.json --out /private/output/built
```

Use the already verified esbuild 0.25.12 binary, SHA-256 `bab29b2ca7a9e89b67cf720b77b2d743f9f31f5cf0d5bd74ee8c8de30ced7014`. `build-review.py` is Linux-only. Rebuild against the actual complete plan; the fixture bundle is deliberately not a production signing packet.

Move the reviewed source/bundle packet back to a canonical Mac-local0700 directory with0600 files. Make the existing reviewed Mac ethers package available beside it. Do **not** send the cold keystore to Runpod. Parent's local runner supplies these runtime environment references without logging values:

```
GL3_CHILD_REVIEW_DIR
GL3_PRIOR_CONSENT_FILE
GL3_COLD_KEYSTORE
ROBINHOOD_MAINNET_RPC_URL
GL3_CHILD_PRIVATE_RPC_URL
```

Then the root operator, after final review, runs `node review-server.mjs`. It binds only `127.0.0.1`, random port/path; serves no external scripts; checks local origin/Host and same-origin keystore reads; decrypts only in the browser; signs only the currently fresh quote. The password never enters the server or journal. The server verifies exact source/bundle/plan/policy/consent hashes. It does not contact a license service.

## Stop/recovery

The0700/0600 journal uses exclusive locking and atomic fsync writes. A signed intent and its exact transaction hash are durable **before** the sole `eth_sendRawTransaction` call. An unknown response becomes `uncertain`; no retry is sent. Missing receipts for an acknowledged broadcast remain `pending`. A failed/reorged receipt stops the next action. Preserve the private journal and lock after a crash. A root operator must reconcile the saved hash/nonce against the actual chain before clearing an abandoned lock. Never delete an intent to “try again.” Restart can advance only successful, matching canonical receipts; it does not resend raw bytes.

## Actual validation and remaining gates

Runpod CPU tests passed 19 meaningful unsigned/mock-RPC/filesystem/audit-binding checks. All ten JS modules passed Node syntax checks. The actual receipt-bound nine-action browser packet compiled with the exact verified esbuild binary. No cold key or wallet was read, no transaction was signed, no real RPC request was made and no transaction was broadcast by these tests. See `evidence/`.

The actual unsigned packet is now in `actual/ready-packet/`, with plan SHA-256 `36a3e9753bd92663b33e805e24e0cc3412cf23a41523ae71d7aee954428ad85b`. It binds the passed real deployment packet and refreshed cold nonces6478/6479 (observation18:51:34UTC; not reserved). Not yet performed here: Mac browser unlock/CSP end-to-end check, signed transaction send/receipt flow, actual parent deposit, child setup, final activation. Root's genuine V4 bridge rehearsal supplies separate actual-chain semantics evidence, not a claim that this new browser wrapper has executed. Public activation remains gated by root's complete runtime readback and launch review. The bridge is project-run fast confirmation; GH0ST's key confirms withdrawal roots. ZK verification is not live.

Source references: production `deployment-packet/isolated-deployer/fee-policy.json` and `genesis-receipt.json`; actual rehearsal `bridge-rehearsal/adapters/native-factory.cjs` and `run.mjs`; V4 evidence in `/workspace/gl3/same-day-mainnet/bridge-rehearsal/final-fee-profile-v4/evidence/`.
