# Build and pilot deployment

This runbook is prepared, **not executed**. The current checkpoint has a compiled GH0ST coordinator but no deployed ICP infrastructure. Use the operator's funded ICP identity. Keep keys outside this repository; use a dedicated RH relayer account to avoid nonce conflicts. No multisig is required by this prototype.

## 1. Build the coordinator and pinned model runtime

```bash
npm ci
node scripts/build-canister.mjs
bash scripts/prepare-runtime.sh
make -C vendor/llama_cpp_canister docker-build-base
make -C vendor/llama_cpp_canister docker-build-wasm
```

The upstream Docker build requires Docker and its documented build dependencies. The script pins commit `4276f526970b7916cc7105c357ad2f2ed018ed37`; do not substitute a mutable branch. It does not run training.

Download the official GGUF at the pinned revision and verify its hash:

```bash
mkdir -p models
curl --fail --location --continue-at - \
  --output models/Qwen3-1.7B-Q4_K_M.gguf \
  https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf
node scripts/manifest.mjs
```

`manifest.mjs` checks the model's 1,107,409,472-byte size and SHA-256, writes `build/artifact-manifest.json`, and prints the model ID, artifact hash and model Wasm hash. Publish this manifest with eventual deployment evidence. The gateway and coordinator must use these exact values.

## 2. Create and load the model canister

The included `icp.yaml` defines a production environment. Authenticate with the operator's existing ICP CLI identity and ensure it has sufficient cycles before deploying. Inspect the CLI's plan/output and confirm the intended identity and environment.

```bash
icp deploy model -e production
icp canister settings update model --wasm-memory-limit 4026531840 -e production
icp canister status model -e production
```

Upload the GGUF with the pinned runtime's `scripts.upload`, using the explicit deployed model canister ID, `--network production`, `--filetype gguf`, `--canister-filename models/model.gguf`, and the SHA-256 from `model-lock.json`. Follow the pinned upstream instructions to install its Python dependencies; run that uploader from the upstream directory so its imports and Candid path resolve. Supply the absolute path to the downloaded model file. The uploader may initialize the model; explicitly apply the locked settings afterward:

```bash
icp canister call model -e production load_model '(record { args = vec {
  "--model"; "models/model.gguf";
  "--cache-type-k"; "q8_0"; "--cache-type-v"; "q8_0";
  "--no-warmup"; "--batch-size"; "8"; "--ubatch-size"; "8"; "--ctx-size"; "4096"
} })'
icp canister call model -e production set_max_tokens '(record {
  max_tokens_update = 0 : nat64; max_tokens_query = 0 : nat64
})'
icp canister call model -e production uploaded_file_details '(record { filename = "models/model.gguf" })'
```

Require the uploaded hash to match `model-lock.json`, successful `load_model`, and the deployed module hash to match the locally built Wasm. Avoid publicly accessible model endpoints. The default controller-only policy must remain enabled. Test one short non-thinking inference directly before connecting RH.

## 3. Install the coordinator and bind its signer

Generate a worker identity outside the repository, or use an existing compatible exported identity:

```bash
node scripts/create-worker-identity.mjs /absolute/private/path/worker-identity.json
```

The output is its public principal. The file contains a secret and must not be published. Set the coordinator's installation arguments using the generated [Candid interface](coordinator/coordinator.did):

| Field                                          | Value                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `worker`                                       | Worker identity principal                                                                               |
| `model_canister`                               | Deployed model principal                                                                                |
| `model_id`, `artifact_hash`, `model_wasm_hash` | Manifest outputs from step 1                                                                            |
| `chain_id`                                     | `4663 : nat64`                                                                                          |
| `gateway`                                      | `0x0000000000000000000000000000000000000000` initially                                                  |
| `rpc_urls`                                     | `https://rpc.mainnet.chain.robinhood.com` and `https://api.blockvectra.com/v1/robinhood_mainnet/public` |
| `confirmations`                                | `12 : nat64` initially; review against RH finality policy                                               |
| `model_cycle_budget`                           | `2000000000000 : nat`                                                                                   |
| `ecdsa_key_name`                               | `key_1` on ICP production                                                                               |

Use `icp.yaml`'s `init_args` for the coordinator, or the included legacy `dfx.json` with an argument file. Do not deploy the coordinator without its required `Config` argument. The zero gateway is a deliberate bootstrap state and cannot process requests.

After installation:

```bash
icp canister settings update model --add-controller COORDINATOR_PRINCIPAL -e production
icp canister call coordinator -e production signer_address
```

Replace `COORDINATOR_PRINCIPAL` with the actual principal. Both the deployer and coordinator remain controllers during the pilot. The coordinator needs this authority for cycle snapshots and model calls; adding an `AdminUpdate` role alone does not authorize management-canister snapshots.

Deploy `GH0STInferenceGateway` on the verified RH chain with constructor arguments `(owner, returnedSignerAddress, modelId, artifactHash)`. Its owner is a single operator address. Record the source/bytecode, deployment transaction and block. No deployment transaction is built or broadcast by this checkpoint.

Bind its address once:

```bash
icp canister call coordinator -e production bind_gateway '("0xACTUAL_GATEWAY_ADDRESS")'
```

The address cannot subsequently be changed through the application interface. Independently verify the gateway's `icpSigner`, `modelId`, and `artifactHash` against the coordinator. Preserve a record of both canisters' controllers; retaining upgrade authority retains trust in those controllers.

## 4. Run the transport worker

Fill `.env` using [.env.example](.env.example), with `START_BLOCK` equal to the gateway deployment block. The worker does not automatically load `.env`; use Node's env-file flag:

```bash
node --env-file=.env worker/main.mjs
```

Without `RH_RELAYER_PRIVATE_KEY`, completed signed results are persisted for another relayer. With it, `RELAY_MAX_FEE_GWEI` is mandatory; gas is estimated and capped. Transactions are signed and journalled before broadcasting. After a network error the worker reuses the exact raw transaction, rather than consuming a new nonce.

Use one worker process and one nonce stream. The state lock is removed on clean shutdown; after a crash, confirm the old process has stopped and reconcile the journal before removing a stale `.lock` file. Do not delete the journal to resolve a transaction whose status is unknown.

## 5. First measured request

1. Top up both canisters, then stop all top-ups, upgrades and unrelated model requests for the measurement window.
2. Snapshot both canister balances. Submit one authorized `requestInference(prompt, 50, deadline)` on RH, leaving ample time for confirmations and inference.
3. Observe `Verified → Running → ReadyToSign → Complete`, then confirm the RH `InferenceFulfilled` event. A completed ICP job alone is not proof of RH delivery.
4. Confirm the prompt/answer hashes, signer, artifact manifest and token counts. Record the request and callback transaction hashes.
5. Include cache cleanup, snapshot both balances again, and record callback gas from its receipt. Report model and total cycle deltas separately.
6. Repeat for short, maximum-length, expired, cancelled and interrupted requests before opening admission beyond the pilot owner.

Do not announce an observed per-request ICP price or a live route until those receipts and balance measurements exist. The current tests use local EVM execution and deterministic fixtures; they do not invoke a loaded Qwen model or live ICP threshold signing.

Sources: [pinned model runtime](https://github.com/onicai/llama_cpp_canister/tree/4276f526970b7916cc7105c357ad2f2ed018ed37), [ICP deployment guide](https://github.com/dfinity/icp-cli/blob/main/docs/guides/deploying-to-mainnet.md), [threshold ECDSA API](https://docs.internetcomputer.org/references/ic-interface-spec/#ic-ecdsa_public_key).

## Existing-pool observation

This alternative input path requires the updated coordinator and gateway from this branch. The existing trading pools and liquidity are not redeployed.

1. Review [swap-sources.json](swap-sources.json) against the intended RH chain, manager and full PoolKeys. Its sentence-hook and Pons keys are dated records; independently verify the deployed contracts and source pools before enabling them.
2. Add `swap_sources` to the coordinator installation `Config`. It is `opt vec SwapPool`; omitting it keeps swap observation disabled. Generate the Candid value for the saved registry with `node scripts/swap-sources-candid.mjs`, then insert it as `swap_sources = <printed value>` in the Config record. Use the new generated Candid interface. Source configuration changes require a reviewed upgrade.
3. As the RH gateway owner, call `setSwapPool(manager, poolId, true)` for each selected source. This authorizes only the result gateway; it does not modify the trading pool. The worker checks these permissions at startup.
4. Set `WATCH_SWAPS=1` and an explicit `START_BLOCK` for activation or intentional backfill. Start with a recent confirmed activation block for new trades. Choosing an old block intentionally queues historical swaps and incurs inference cost. A different source set needs a separate journal; reconcile previous pending callbacks first.
5. Run the worker normally. It scans at most 250 confirmed blocks per batch, verifies receipts and queues distinct registered swap logs. ICP derives the prompt from independently verified event data. The callback is `fulfillSwapInference(source, result, answer, signature)`.

Direct swap jobs need no separate RH request transaction. Existing hook gas and behavior remain part of the original swap. The worker waits for a canonical confirmed fulfillment event and exact answer/hash before marking delivery complete. Retain its journal and the coordinator's source tombstones. The original 256-job pilot retention limit still applies; review capacity before opening admission at production trading volumes.

The event sender may be a router; it is not proof of a trader wallet. The worker can acknowledge confirmed delivery into character memory and publish the exact thought using the optional X configuration below.

## Voice profile and optional X delivery

The 1.7B Q4_K_M profile replaces the original 0.6B infrastructure default. Rebuild the coordinator after changing the embedded persona and generate a new artifact manifest. Do not reuse a manifest, coordinator Wasm hash or model ID from the 0.6B checkpoint. Set the model cycle budget to the reviewed value in model-lock.json; the 2T cap is a compute ceiling, not a measured price or guarantee that both generation attempts will finish.

After a confirmed RH callback, the worker calls `remember_delivered` with its actual callback transaction and log index. ICP checks the proof independently before adding the bounded memory. Keep the journal so acknowledgements and publication are recoverable.

To enable original posts, configure an OAuth user-context token in the worker secret environment, set `X_EXPECTED_USERNAME=llmgh0st` and then `X_ENABLED=1`. Startup verifies `/2/users/me` matches that account before allowing publication. The default is disabled and produces a reviewable publication plan in the journal instead. Never put the access token in Git or share it in a chat.

The publisher waits for canonical RH confirmation, preserves the committed text, and journals intent before each API attempt. If a post outcome is uncertain, reconcile the account before retrying. Publication authentication/rate limits do not change a completed swap or generate a different thought. See X-PUBLISHER.md for the API boundary and recovery states.
