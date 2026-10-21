# Four-bit RH deployment batches

**The weights/kernel/index stage is complete: 497 four-bit contracts verified, or 499 including the two historical pilots.** The final authorized review batch deployed 121 remaining weight shards and the immutable address index. See the [final report](mainnet/batch-0004.md), [address manifest](mainnet/deployment-manifest.json) and [reconciliation](mainnet/batch-0004-reconciliation.json). No contracts remain in this stage. Full inference remains unimplemented.

`deploy.py` deploys only the pinned `affine64_s12z4` export on Robinhood Chain 4663. It is separate from the historical six-bit runner and state. The stage comprises one `FourBitAffine64` matrix kernel, 495 immutable weight shards and one immutable address index, created last. The two six-bit pilot contracts remain historical; this stage does not reuse them. Full inference is still unimplemented.

The initial review batch contained **25 contracts**: the kernel and weight shards `0000` through `0023`. The user explicitly expanded the second logical review batch to **150 new contracts**, shards `0024` through `0173`, and authorized funding during execution. That stage completed at exactly 175 verified four-bit contracts (25 existing +150 new).

The user subsequently authorized **200 additional contracts**, weight shards `0174` through `0373`, followed by a pause. This separate stage uses baseline 175 and target 375 with new logical-run and report files. Completion of an earlier stage never starts another stage automatically.

## What bundling means

Each full weight shard costs approximately 30 million gas with the lossless constructor. The live RH transaction limit checked before broadcasting was 32 million gas; combining two full shards in one transaction would exceed it. The runner groups up to four independently signed transactions in each HTTP JSON-RPC request, with consecutive wallet nonces. A 25-contract batch therefore uses seven HTTP submission groups. The endpoint rejected the original request containing all 25 payloads with HTTP 413; four fit.

This is **not an atomic on-chain bundle**, does not guarantee one block, and does not reduce intrinsic execution or code-deposit gas. Each transaction has its own receipt and can succeed or fail independently. No factory or extra deployment contract is introduced. The HTTP body limit is separate from the per-transaction size rejection that blocked the weight contracts.

The upstream Nitro sequencer defaults to a 95,000-byte transaction limit and returns `oversized data` when that limit is exceeded ([source](https://github.com/OffchainLabs/nitro/blob/master/execution/gethexec/sequencer.go)). This is consistent with the observed RH rejection; the exact RH configured boundary has not been measured. RH's 96 KiB runtime-code limit and 32 million gas limit do not imply that a raw deployment transaction of that size will be accepted. The runner now applies a conservative 95,000-byte signed-transaction guard to the entire batch before signing. Local Anvil does not reproduce this sequencer admission limit.

The creation-only canonical Huffman decoder is 544 bytes. Each payload carries the expected runtime Keccak hash; the constructor returns the original STOP-prefixed weight bytes only when that hash matches. The signed inputs are pinned and locally executed before use. The decoder is not deployed, so model precision, inference gas, shard addresses and the 499-contract stage budget stay unchanged.

All 495 payloads were deployed on local Cancun Anvil and their full runtime bytes compared. The largest conservative signed transaction is **94,998 bytes**, just below the 95,000-byte guard. The highest local creation cost is **30,221,500 gas**. Current lossless weight deployment costs **14,805,972,433 local gas**, versus **10,550,551,050** for the rejected raw creation payloads. This is a size/admission fix with deployment-gas overhead, not a new gas saving. Live gas and serialized size must still pass for every batch. See [creation-validation.json](creation-validation.json).

The original rejected journal can only be superseded through `--replace-rejected-encoding`: it requires the one verified kernel, the exact original 25-entry journal, absence of all 24 remaining hashes from both receipt and transaction queries, clean latest/pending nonce 3, and a replacement cap that preserves the original aggregate cap. The archived journal remains in state. This one-time migration finishes only the remaining 24 contracts.

## Spending and recovery

- Quotes are unsigned by default. A broadcast requires an explicit count, a hard ETH batch cap and the matching signer file outside the repository, readable only by its owner.
- Every selected deployment is estimated live. Gas limits retain a 3% unit buffer; unused units are not charged. The default price ceiling has a 2% buffer. `--gas-price-ceiling-wei` instead fixes an explicit ceiling with no added price buffer or automatic escalation. The sum of signed maximum fees must fit the batch cap and wallet balance after the requested reserve.
- Transactions have zero ETH value and only create pinned contracts. Their fixed signed limits bound spending even if prices move during submission.
- Every funded submission group's hashes, consecutive nonces, runtime hashes, creation-code hashes and fee bounds are saved with file and directory `fsync` before its first broadcast. The older 25-contract runner journals its full selected batch upfront. Private keys and raw signed transactions are not written to deployment state or reports.
- Receipt verification checks the hash, sender, deterministic deployment address, status, gas/price limits and every deployed runtime byte. Existing receipts are checked before continuation and again after the batch.
- HTTP errors may leave a submission ambiguous. Recovery queries the original hashes. An out-of-order nonce gap can be repaired at most once per second for an explicit fee ceiling, or once per five seconds otherwise, within the receipt timeout by resending the **identical signed bytes**, only when the hash is absent and both live wallet nonces identify that gap. It never raises fees or substitutes a new nonce.
- If a group remains unresolved, broadcasting stops and preserves the active journal. A new batch is blocked. `--resume-bundle` finishes only the original journaled transactions, using identical signatures/hashes; it does not allocate another batch.
- The address index is available for deployment only after all 495 shard receipts and runtimes have been verified. Keep the state file; reconstructing it is a separate reconciliation task.

`deployment-validation.json` records 18 local checks with 37 real local contract deployments, including the complete initial 25-contract batch, partial rejection, timeout-after-acceptance, interrupted-bundle resume, fee/reserve guards, an unrelated pending nonce, and both passing lossless/rejected raw RH submission-size checks. Local deployment success does not establish RH submission acceptance. These tests send no public transactions.

## Invocation

Set `GH0ST_RH_RPC_URL` privately and supply the same durable state file on every invocation. Never put credentials in the command history, repository or reports.

```bash
python falcon-agent/fourbit-study/deploy.py \
  --weights "$GH0ST_FOURBIT_WEIGHTS" \
  --creation-cache "$GH0ST_CREATION_CACHE" \
  --sender "$GH0ST_DEPLOYER_ADDRESS" \
  --state "$GH0ST_FOURBIT_STATE" \
  --report "$GH0ST_BATCH_REPORT" \
  --count 25 --reserve-eth 0.002
```

This only quotes. Build the cache with `validate_creation.py --weights <weights.bin> --cache <cache-directory> --anvil <anvil-path>`; it checks all output bytes and writes the pinned validation artifact. An explicitly authorized batch uses `--broadcast --key-file "$GH0ST_KEY_FILE" --max-batch-fee-eth <reviewed-cap>`. The original first batch has a 0.016 ETH aggregate cap and 0.002 ETH reserve. Its kernel already spent 0.000023870883 ETH, leaving at most 0.015976129117 ETH for its remaining 24 deployments. Remove the ephemeral signing file after each invocation. Interrupted-bundle recovery uses `--resume-bundle` and the original signed limits; it never changes signatures or fees. If an explicit ceiling is supplied during resume, it must equal every original signed price.

## Reporting

The JSON and Markdown reports show actual receipt gas and ETH fees, the wallet balance, verified and remaining contract counts, an estimate of remaining deployment gas/cost, and the next batch's maximum fee/top-up estimate. Remaining gas is a workload estimate, not a wallet balance. Estimates change with RH execution/posting prices; final index calldata depends on the real shard addresses. RH receipt verification is not a claim of Ethereum finality.

Reference: [RH network configuration](https://docs.robinhood.com/chain/connecting/), [RH gas and fees](https://docs.robinhood.com/chain/gas-and-fees/), [Alchemy batch request semantics](https://www.alchemy.com/docs/reference/batch-requests). Live transaction limits are also queried directly through ArbGasInfo before each invocation.

## Low-fee execution

The initial attempt to start the second review batch used an explicit legacy gas-price ceiling chosen from low observed live base-fee quotes, with no 2% price buffer. That rejected low-fee policy was superseded after the user authorized immediate deployment and expanded the batch to150. RH's configured minimum was 20,000,000 wei/gas (0.020 gwei); that price was rejected during preflight because the current base fee was higher. The configured floor is therefore not an immediately executable quote. A fixed low ceiling may wait through congestion; retries use identical bytes and never increase prices. Future minimums, posting prices and network load can change, so this policy does not claim the lowest fee at every future moment. The selected samples, cap and actual receipt prices are published with the batch report.

## Separate execution and parent posting gas

RH's 32,000,000 gas computation limit excludes the parent-chain posting charge. `--nitro-components` obtains total gas and parent posting gas from `NodeInterface.gasEstimateComponents`; the difference is execution gas. The runner requires the execution estimate plus 3% headroom to fit the live compute limit, then budgets total gas including posting. It does not clamp the total transaction gas to 32 million. The exact creation must also pass live simulation before this deployment mode is used.

During batch 2 preparation the parent posting price moved between zero and a nonzero value, adding roughly 11 million estimated gas per weight transaction. `--l1-gas-reserve 12000000` retains a budget for that observed posting charge even when the latest estimate returns zero. The signed limit has 3% total headroom; unused units are returned. Actual receipt `gasUsedForL1` and execution gas are recorded separately for component-mode deployments. The selected fixed price ceiling still applies to every charged gas unit. That initial attempt had a 0.023 ETH cap and 0.002 ETH reserve. The later explicit immediate-deployment instruction permitted a fresh market ceiling; the user then expanded the logical batch to150 and funded the wallet. The funded stage controller retains 0.002 ETH and bounds every funded group by its fresh wallet balance rather than requiring the entire logical stage to be prefunded.

Primary implementation references: [Nitro posting-gas deduction and computation cap](https://github.com/OffchainLabs/nitro/blob/master/arbos/tx_processor.go#L644-L678), [NodeInterface component estimator](https://github.com/OffchainLabs/nitro/blob/master/execution/nodeinterface/node_interface.go#L506-L563), [Arbitrum gas and fee accounting](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/gas-and-fees). Local execution gas alone is not a complete ETH fee quote when posting charges are nonzero.

The early fee-override approval block is historical. The user subsequently authorized immediate execution of150 new contracts and funded the wallet. Rejected hashes were reconciled and archived before replacement. See [batch 2](mainnet/batch-0002.md) for that historical run; [batch 3](mainnet/batch-0003.md) is the current completed checkpoint.

## Funded deployment stage controller

`deploy_funded.py` implements one explicitly bounded logical stage. Its defaults preserve baseline 25 and target 175; `--baseline-contracts` and `--target-contracts` select a separately authorized stage. The completed third batch used `--baseline-contracts 175 --target-contracts 375`. It uses groups of up to four, quotes each at fresh market plus a 20% fixed per-gas ceiling, and signs only the affordable contiguous prefix. Every group is durably journaled before broadcast. Incoming funding is accepted without interpreting balance increases as negative fees. If needed, it prints the deployer address and top-up amount and polls for funding; it does not deploy beyond the target or silently replace an existing signature.

The run identity pins chain 4663, the sender, the model digest, baseline receipt hashes, baseline and target. A new stage requires a new run file: changing either boundary on an existing run is rejected. `funded-validation.json` records 14 offline checks, preserving the original nine and adding exact 175-to-375 stopping, the 200-shard range, completed-stage resume, and old/new run identity rejection. The receipt verifier uses batched reads for speed while checking each receipt and full runtime exactly. It was also exercised against actual saved mainnet receipts.

```bash
python falcon-agent/fourbit-study/deploy_funded.py \
  --weights "$GH0ST_FOURBIT_WEIGHTS" --creation-cache "$GH0ST_CREATION_CACHE" \
  --sender "$GH0ST_DEPLOYER_ADDRESS" --state "$GH0ST_FOURBIT_STATE" \
  --run "$GH0ST_LOGICAL_RUN" --report "$GH0ST_BATCH_REPORT" \
  --baseline-contracts 175 --target-contracts 375 \
  --key-file "$GH0ST_KEY_FILE" --reserve-eth 0.002
```

This records the execution command for the completed 200-contract stage; each separately authorized stage requires its own run/report paths. The signer file stays outside the repository with mode 600 and is removed by the invoking wrapper after completion. Reusing a completed logical run file at its configured target performs no new deployment. The earlier 25-to-175 run remains compatible with the default flags.

Run the offline controller audit with `python -B falcon-agent/fourbit-study/validate_funded.py`. It uses synthetic jobs, a throwaway local key and mock RPC responses, and sends no public transactions.

The third review batch stopped at exactly 375 verified four-bit contracts, with clean latest/pending nonce 377/377. All 375 receipts and complete runtimes were rechecked after completion. There are 122 stage contracts left: 121 weights and the final index. See [batch 3](mainnet/batch-0003.md) and its immutable logical run journal for the completed 200-contract authorization. No fourth review batch starts automatically.

The target must be available in the pinned job list at startup. The final index is a separate deployment step after all 495 weight runtimes have been verified; the current controller does not include it while any weights are missing.

## Completed final stage

The user authorized all 122 remaining contracts after reviewing the remaining gas estimate. The funded controller first ran with baseline 375 and target 496 for weight shards 0374–0494. The final index then used a separate logical run with baseline 496 and target 497. Both runs retained the 0.002 ETH wallet reserve and used the existing funded-group fee policy.

Before the final mainnet transaction, the index was deployed locally using all 495 actual shard addresses. Seven checks verified the complete 9,949-byte runtime, binary header, file digest, address order, constructor copying, missing-shard gate, transaction-size bound and address-specific local gas. The controller reverified every weight receipt and runtime before making the index available. All 497 stage receipts and full runtime bytes were rechecked after completion; latest/pending nonce was 499/499 with no active bundle.

The final index is `0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0`, runtime Keccak `0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307`. Its actual local creation cost was 2,204,416 gas; the mainnet receipt used 2,799,104 gas including parent posting. Actual final-batch gas/fees and complete stage totals are in [batch 4](mainnet/batch-0004.md). This concludes the weights/kernel/index deployment only; tokenizer, attention/Mamba, nonlinear runtime, state and sampling remain unimplemented.
