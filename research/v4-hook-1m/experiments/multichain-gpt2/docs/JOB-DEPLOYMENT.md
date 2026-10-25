# Whole-model jobs: deployment and operation

A job begins on Robinhood Chain, runs every model operation on one compute chain, and returns one packed result to Robinhood. Robinhood has a router only. The compute chain holds all 77 tensors, the engine, embeddings, transformer blocks, KV state and vocabulary head. Tokenization is local; inference arithmetic stays onchain. This is the existing canonical 124,439,808-parameter GPT-2 export, not a chat-tuned model or a new token.

The toolkit supports Monad by default and an explicit opBNB alternative. These are research implementations and local verification tools. No production deployment or paid public inference is established by an unsigned plan, local benchmark, or provider fee quote.

| Compute selection | Chain / LayerZero EID | Execution profile | Maximum worker transaction gas | Canonical route ID |
| --- | --- | --- | ---: | --- |
| `monad` | 143 / 30390 | Native Monad | 30,000,000 | `0xf5b94dee310f46242db944e8f0ab81c1b3990a30fef940ffa9f5c9c2d8ffea5c` |
| `opbnb` | 204 / 30202 | Ethereum-compatible Cancun | 16,777,216 | `0x453a7f8f39b85f2d93cab49818218515a51803f3016723d96f6ba0ed0a736240` |

Robinhood is chain 4663 / EID 30416. Its worker cap is at most 16,777,216 gas. The route identity pins the selected chains/EIDs, packet version 2, full model identity and ordered tensor hashes. Production engine selection currently allows only `GPT2ShardOptimized`. Other experimental engines are not accepted by these tools.

## Transport modes

`managed` uses a reviewed LayerZero executor service. **The researched direct RH↔opBNB managed executors are unsupported:** their destination configuration had zero receive base gas and fee calls reverted with `Executor_EidNotSupported`. Merely deploying OApps does not fix this. The opBNB plan retains `UNSUPPORTED_IN_RESEARCH_SNAPSHOT` as the managed-service status. Recheck service support before changing this conclusion.

`self-relay` deploys a `GH0STSelfRelayExecutor` on each side, bound immutably to the official send library, local router, remote EID and local chain ID. It accepts only the 384–4,480-byte job packet size range and fixed receive options, quotes zero **executor service fee**, and logs assignments. Operators still pay DVNs, source transactions, destination verification and delivery gas, and any protocol/data fees.

Self-relay does not replace authentication. The destination's configured two required DVNs must attest before `ReceiveUln302.commitVerification` succeeds. `EndpointV2.lzReceive` can then execute only the exact verified payload. The relay never calls a DVN's verification method or manufactures attestations. Provider availability and finality policy remain external requirements. [LayerZero receive library](https://github.com/LayerZero-Labs/LayerZero-v2/blob/main/packages/layerzero-v2/evm/messagelib/contracts/uln/uln302/ReceiveUln302.sol), [EndpointV2](https://github.com/LayerZero-Labs/LayerZero-v2/blob/main/packages/layerzero-v2/evm/protocol/contracts/EndpointV2.sol).

## Prepare without signing

From this package directory, install the pinned dependencies and produce the canonical export with the existing model tools if it is not already available. The model files are intentionally excluded from the source package. Activate the Python virtual environment first when using `npm run model:fetch` and `npm run model:export`, or run `.venv/bin/python model/fetch.py` and `.venv/bin/python model/export.py` directly; `--output` selects the export directory when needed.

```sh
npm run plan:job -- --data=data --compute=opbnb --out=reports/job-plan.json
```

Supply actual pending deployment nonces in a JSON object whose keys exactly match the selected route, for example `robinhood` and `opbnb`. Nonces must be nonnegative integers. Both contract deployment and wiring transactions consume these nonces.

Start with a summary-only plan in a new directory:

```sh
npm run prepare:job -- \
  --compute=opbnb --executor-mode=self-relay \
  --admin="$ADMIN" --requester="$REQUESTER" \
  --session-id="$SESSION_ID" --deadline="$DEADLINE" \
  --nonces=deployments/nonces.json --data=data \
  --out=deployments/job-summary --summary-only
```

`ADMIN` and `REQUESTER` are nonzero EOA addresses; `SESSION_ID` is a fresh nonzero bytes32 value; `DEADLINE` is a future Unix timestamp shared by both routers. These are configuration values, not signing keys. The planner performs no RPC reads, so pending nonces, EOA status and chain state require separate live review.

A summary computes all exact creation inputs, hashes and predicted addresses but omits raw transaction bodies. Remove `--summary-only` and select another new output directory to generate the deployable unsigned JSONL files. The output must remain under this project's ignored `deployments/` or `reports/` directories; existing outputs are never overwritten.

All transactions are sequential per chain. In self-relay mode the executor CREATE follows the router CREATE, which changes subsequent addresses compared with managed mode. The full opBNB self-relay plan contains 5,605 transactions: 3 on RH and 5,602 on opBNB. The compute side includes 5,516 weight contracts and 81 catalog contracts. No `sealRoute` transaction is included. Gas limits and fee fields remain null until reviewed against the target network.

There is deliberately no broadcaster in the preparation tool. A separately reviewed deployment process must submit the exact unsigned sequence, preserve nonce order, estimate every target transaction and record its successful receipt. If the admin nonce changes, discard the plan and prepare again. An unsigned JSONL file is not a public deployment.

## Configure and verify

Use the generated `manifest.json` as the populated starting point for the runtime configuration; `config/job.runtime.example.json` documents the disabled default. Fill the actual router/engine/executor deployment transaction hashes, earliest deployment block, gas budgets and receipt confirmation counts. The home engine, root and engine deployment transaction must remain null.

Before sealing a self-relay route, independently review and configure:

1. The exact official send and receive libraries on both endpoints.
2. Two **required** DVNs: LayerZero Labs and Horizen, in sorted address order. No optional DVNs or reduced threshold are accepted by this relay.
3. A positive, reviewed `dvnConfirmations` policy. The current relay requires the same value on both chains. This differs from the worker's `confirmations`, which controls its own receipt wait.
4. The source send library's executor configuration, pointing to the local `selfRelayExecutor`, with maximum message size at least 4,480 bytes.
5. Bidirectional peers, endpoint support for the remote EID, quoted DVN fees and provider availability.

Only then should a separately reviewed action seal the routers. Sealing fixes the OApp's peers; it does not freeze all endpoint/delegate security settings. Protect those administrative authorities.

```sh
npm run verify:job -- --config=deployments/job/manifest.json --data=data
```

The verifier checks chain IDs, canonical route/model, immutable constructor arguments, successful audited CREATE transactions and exact deployed runtime through discarded constructor replay. It reads every weight shard and catalog, reconstructs each tensor hash, and checks the full 77-tensor coverage. In self-relay mode it also verifies the executor's exact audited creation/runtime and immutable binding. It checks live job/engine sequence and common deadline. RPC snapshots are trusted inputs; this is not a light client.

A report with `PASS_VERIFIED_JOB_DEPLOYMENT` confirms code/model provenance. It deliberately retains `messagingReady:false`: this report alone does not certify provider service, finality, endpoint configuration or delivery. Failed reverification replaces the previous success report rather than leaving a stale PASS.

## Worker and relay

Both commands default to read-only. The worker reports the next job action. The relay scans only the configured source endpoints' `PacketSent` events, checks exact header/GUID/message bytes against this job, inspects the actual ULN settings and reports whether it is waiting for DVNs, ready to commit, ready to deliver or already delivered.

```sh
npm run worker:job -- --config=deployments/job/manifest.json --data=data \
  --prompt-tokens=15496,11 --generate=32
npm run relay:job -- --config=deployments/job/manifest.json --data=data
```

The prompt uses GPT-2 token IDs, packed as four-byte big-endian values. Tokens are not words. The limit is `promptLength + maxNewTokens - 1 <= 1024`. A one-token prompt can therefore generate 1,024 outputs; longer prompts reduce the bound. One to eight IDs fit a 416-byte packet; 32 fit 512 bytes; 64 fit 640 bytes. Generation is greedy and uses the complete vocabulary head.

Paid mode additionally requires `--execute`, `enabled:true`, `messagingReviewed:true`, valid positive fee budgets, a future deadline, and a correctly configured local signing key. Keep signing keys and credential-bearing RPC URLs out of JSON, source control and logs. Runtime JSON holds environment-variable names such as `RH_RPC_URL`, `OPBNB_RPC_URL`, `GH0ST_WORKER_KEY` and `GH0ST_RELAYER_KEY`; it must not contain their secret values.

Use different funded EOAs for concurrently running worker and relay processes. Each process has its own nonce manager. Sharing an EOA concurrently can create nonce conflicts; use serial execution if sharing an account is intentional. Self-relay prepared manifests use `relayKeyEnv: GH0ST_RELAYER_KEY` separately from `keyEnv: GH0ST_WORKER_KEY`.

After the deployment and transport have been reviewed, append `--execute --watch` to operate continuously, or `--execute --once` to perform at most one next action. The worker requests the job once, imports the authenticated prompt on the compute chain, advances the engine, consumes completed positions locally with `continueJob`, and dispatches one final result. The separate relay commits verification and delivers each direction after the real quorum is ready. Running only the worker cannot supply cross-chain delivery in self-relay mode.

For a specific source receipt, the relay accepts `--source=opbnb --tx=0xTRANSACTION_HASH`; `--guid=0xGUID` filters a packet. Hash placeholders must be replaced by actual source transaction/GUID values. No arbitrary user-supplied message bytes are accepted.

## Fees and limitations

`maxTransactionGas` caps each transaction. `maxFeePerGasWei` caps the execution gas price. `maxMessageFeeWei` caps the worker's source LayerZero quote. These are different budgets. opBNB and RH parent-chain posting fees are additional components and must be included in deployment/inference cost analysis; an execution gas-price cap alone is not a total native-fee cap.

Monad charges the declared gas limit. Its worker estimates the exact current call, applies a 1% margin plus 1,000 gas within the ceiling, and simulates at that precise limit. Heavy phases use direct bounded row advances; small phases can batch. Other chains keep the existing margin and headroom. [Monad fee accounting](https://docs.monad.xyz/developer-essentials/gas-pricing).

opBNB normally uses current provider fee suggestions. An operator may explicitly set its chain entry's `gasPriceWei`, bounded by `maxFeePerGasWei`. Every send checks this bid against the latest base fee plus a conservative 1,001-wei priority allowance. This is an operator policy, not a claim about the minimum accepted by every sequencer. The template leaves it unset. A low valid bid may wait longer for inclusion; it is never chosen automatically. All send paths repeat deadline/fee checks after exact-call gas preflight.

Managed opBNB delivery remains unsupported in the captured research. The self-relay implementation has local packet/quorum/fee tests and source-side fork evidence; this does not prove that the external DVNs will attest a production job or that destination delivery has occurred. Local inference and gas measurements do not establish model usefulness, guaranteed public inclusion or paid production savings. Keep the deployment disabled until its actual transport and budget review is complete.

For reproducible data-fee research, `npm run posting:opbnb` validates the saved benchmark offline. Adding `-- --run` starts a disposable local GPO fork, forwards only validated public state reads, and compares three fixed synthetic patterns. Workload calls stay on localhost. It writes new evidence under `reports/opbnb-posting/` and never replaces the canonical price snapshot. See `-- --help` for a pinned historical block; an archive-capable source is required.
