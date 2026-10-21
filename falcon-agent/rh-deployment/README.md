# Manual six-bit deployment in reviewable batches

**Historical six-bit runner:** the user has selected the [four-bit optimization path](../fourbit-study/README.md) for further work. The existing two-contract pilot remains paused. Do not use this runner with four-bit weights or interpret the old 1,172-contract remainder as the new plan. The four-bit [unsigned deployment draft](../fourbit-study/deployment-plan.json) preserves the requested review pauses but has not been broadcast.

Prepared for GH0ST on Robinhood Chain mainnet (chain ID **4663**). **The two-contract mainnet pilot is deployed and paused.** [Public receipts](mainnet/batch-0001-receipts.json): 14,071,366 gas and 0.000283860789728 ETH paid. There are 1,172 remaining data contracts. This deploys the existing `SixBitFast` matrix kernel and 1,173 immutable data contracts for the selected compact six-bit file: **1,174 contracts total**. The full inference engine, tokenizer, cross-shard reader, address index and agent integration remain unfinished and are outside this package.

Every invocation sends **at most one explicitly sized batch**, then exits. It never automatically starts the next batch. The default pilot is **two contracts: the kernel and the first weight shard**. Review that pilot before choosing a larger batch; ten weight contracts is a reasonable next review interval, adjustable with `--count`.

## What each batch reports

- Contract count completed and remaining, transaction hashes, addresses and verified runtime hashes.
- Actual gas used and ETH fees for the batch and cumulatively, from receipts.
- Current deployer ETH balance and a fresh quote for the next batch.
- Estimated remaining gas and ETH cost, calibrated using sampled live estimates and recent data-shard receipts.
- Suggested next-batch replenishment: `max(0, next_batch_maximum_fee + reserve - wallet_balance)`.

Remaining gas is an estimate of unfinished work, not a prepaid gas balance. The wallet holds ETH. Fee quotes change with execution and L1 posting prices. The report separates actual receipt costs, estimated costs, and buffered maximum fees. Each transaction uses a 20% gas-limit buffer and a 20% gas-price buffer. Unused gas is not charged. A batch fee cap limits the sum of actual fees already paid in that invocation plus the maximum possible fee of its next transaction.

The **modeled** whole package is 15,649,430,315 Cancun gas, including the kernel. The local two-contract pilot used 14,071,366 gas. Neither number is a live Robinhood quote; Robinhood estimates include L1 posting costs that this offline model omits. See the [official connection settings](https://docs.robinhood.com/chain/connecting/) and [fee documentation](https://docs.robinhood.com/chain/gas-and-fees/).

## Quote the pilot

Use Python 3.10+ on Linux with `requirements.txt`, the pinned compact six-bit export, and a working RPC endpoint. A read-only mainnet pilot quote was obtained on 20 October 2026 after the deployer address and an Alchemy endpoint were supplied. Public RPC requests honor the environment’s configured HTTPS route; local Anvil requests stay local. The pilot was subsequently signed and mined. Only public receipts and a recovery snapshot are published here; signing material, provider credentials and private wallet-balance quotes are excluded.

Set `GH0ST_RH_RPC_URL` in the execution environment. Keep any provider API key outside the repository and terminal history. Define the following paths/address in your local environment:

- `GH0ST_WEIGHTS`: the compact six-bit `weights.bin`, SHA-256 `1aca236cbf553bab84bd5aa934a9d5e73d82748113e7c8b8272f4382f41e23fc`.
- `GH0ST_DEPLOYER`: public deployer address.
- `GH0ST_STATE`: durable local receipt-state path, outside the repository.
- `GH0ST_REPORT`: output JSON path; a Markdown report is written beside it.

```bash
python falcon-agent/rh-deployment/manual.py \
  --weights "$GH0ST_WEIGHTS" \
  --sender "$GH0ST_DEPLOYER" \
  --state "$GH0ST_STATE" \
  --report "$GH0ST_REPORT" \
  --count 2
```

This estimates without signing or broadcasting. When a saved transaction is unresolved, the script checks its receipt and can reconcile it into the local state; an unknown/pending hash blocks continuation.

## Send one approved batch, then stop

After reviewing the quote, set `GH0ST_BATCH_CAP_ETH` to the chosen maximum ETH spend for this batch and `GH0ST_RESERVE_ETH` to the balance to retain. Provide a raw key file or encrypted JSON keystore through `GH0ST_KEY_FILE`, outside the repository. A JSON keystore also requires `--password-file` pointing to an external password file. Do not commit signing material or paste it into chat. Only public receipts and reports may be published.

```bash
python falcon-agent/rh-deployment/manual.py \
  --weights "$GH0ST_WEIGHTS" \
  --sender "$GH0ST_DEPLOYER" \
  --state "$GH0ST_STATE" \
  --report "$GH0ST_REPORT" \
  --count 2 \
  --broadcast \
  --key-file "$GH0ST_KEY_FILE" \
  --max-batch-fee-eth "$GH0ST_BATCH_CAP_ETH" \
  --reserve-eth "$GH0ST_RESERVE_ETH"
```

An optional `--max-total-fee-eth` adds a lifetime spending cap over this state's recorded transactions. The initial quote must fit the caps and available balance before the first signature. Each subsequent transaction rechecks the chain, nonce, current estimate, fee cap and reserve. A fee increase can stop a batch early; completed receipts remain saved and count toward cumulative costs.

After the process exits, inspect the JSON/Markdown report and decide whether to replenish the wallet and continue. To prepare the next ten-contract batch, run the quote command with `--count 10`, using the **same state path** and a new report path. Broadcast only that reviewed batch with its chosen cap. No full-model prefunding is required.

Use a dedicated deployer and one canonical state path. The state file lock prevents concurrent use of that path, and nonce checks stop when other transactions interfere. Preserve the state and reports between sessions: deleting the state loses resume knowledge and can cause duplicate deployments. Successful previous contracts are verified on-chain and skipped. Failed deployments or ambiguous broadcasts halt further signing; do not discard or edit the pending record to force continuation. Receipt checks are sequencer-level confirmation, not a claim of L1 finality.

## Local validation

```bash
python falcon-agent/rh-deployment/validate.py \
  --anvil /absolute/path/to/anvil \
  --weights "$GH0ST_WEIGHTS"
```

The harness creates an ephemeral funded account only on local Anvil chain 31337, deletes its key afterward, and never broadcasts publicly. [local-validation.json](local-validation.json) records 14 passing checks: bounded pilot, receipt accounting, exact bytecode, safe resume, cap and reserve rejection, unknown-pending protection, a fee increase between transactions, and wrong-chain rejection. Local tests do not establish live RH prices, funding, availability, or full-model functionality.

GH0ST is built using artificial intelligence technology from the Technology Innovation Institute. See the upstream model terms and modification notice in `../licenses/`.
