# If the GL3 pod stops

GL3 currently has one operator pod. Process supervision can restart its node/backend pair on that machine; it cannot replace a failed machine or recover a Runpod-wide outage. No automatic standby or provider failover is active.

## What users would see

- New transactions stop being sequenced. Transactions that have not reached a posted Robinhood batch may need reconciliation and can be lost during recovery.
- Deposits already locked in the Robinhood bridge remain there. Their GL3 credit can wait for the operator to recover.
- Withdrawals waiting for a batch, assertion or confirmation stop progressing. An already confirmed withdrawal can be claimed on Robinhood with its valid proof while Robinhood remains available.
- An RPC or explorer outage alone does not establish that the chain stopped; check the operator and parent receipts separately.

Funds remaining in escrow does not mean users have an immediate independent exit. This launch uses project-operated fast confirmation and parent upgrade authority. An operator outage can leave funds unavailable until recovery; ZK verification and an automatic emergency withdrawal mechanism are not live.

## Prepared recovery material

Node data, configuration inputs, official binaries and machine files use the persistent `/workspace` volume. Encrypted operator-key backups have matching copies off the pod. A private checkpoint preserves the ephemeral tool environment, and a smaller durable runtime bundle passed dependency checks. Secrets, backup locations and recovery keys must stay outside this repository.

These preparations are not a completed replacement-pod recovery rehearsal. A provider outage, an unavailable volume, a damaged database or missing/unusable recovery credentials can extend the outage.

## Operator recovery order

1. Fence the old instance before using its poster/validator identities elsewhere. Prevent two active operators and reconcile every uncertain parent transaction by its saved hash and nonce.
2. Verify the persistent volume or restore a reviewed backup. Keep the original database and journals; do not erase a pending intent to retry it.
3. Check the exact official runtime, module root, deployment receipts, chain ID and genesis. Restore only reviewed runtime dependencies and aliases.
4. Keep the public RPC disabled. Review the replacement host binding and private configuration hashes, then start the authenticated backend and node through the paired supervisor.
5. Replay parent batches, verify canonical parent receipts and account balances, and reconcile deposits, assertions and withdrawals. Keep the selected Robinhood safe/finalized checks enabled.
6. Re-enable the guarded RPC only after its live chain/genesis and bridge authority checks pass. Check explorer and bridge availability independently.

Private keys must not appear in command arguments, logs, public configuration or Git. A warm standby and independent off-provider state backups would require a separately implemented and tested failover plan.
