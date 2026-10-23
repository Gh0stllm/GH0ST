# Sentence model deployment preparation

The user selected Robinhood Chain **mainnet**, chain ID **4663**. The configured public RPC is `https://rpc.mainnet.chain.robinhood.com`. This matches [Robinhood's connection documentation](https://docs.robinhood.com/chain/connecting/). Robinhood's testnet is a different chain, ID 46630, and is not selected here.

[Uniswap's official v4 deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments) lists Robinhood's canonical PoolManager at `0x8366a39cc670b4001a1121b8f6a443a643e40951`. A live read at block 95,994,756 found its 24,009-byte runtime, hash `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626`. The same read confirmed the standard CREATE2 deployment proxy at `0x4e59b44847b379578588920cA78FbF26c0B4956C`, with runtime hash `0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989`.

The repository's earlier [s0ul agent deployment](https://github.com/Gh0stllm/GH0ST/blob/research/v4-hook-1m/s0ul-1m/deployments/robinhood-mainnet-agent.json) and [Falcon deployment state](https://github.com/Gh0stllm/GH0ST/blob/research/v4-hook-1m/falcon-agent/rh-deployment/mainnet/deployment-state.json) also identify chain 4663. Their historical signer is evidence of earlier deployment work, not a selection of the current signing wallet.

## Prepare an unsigned plan

From the research project directory, run:

```sh
node scripts/prepare-v4-deployment.mjs
```

Optional arguments:

```sh
node scripts/prepare-v4-deployment.mjs \
  --config deployment/robinhood-mainnet.json \
  --from 0xYourConfirmedSigningAddress \
  --out deployment/robinhood-mainnet-plan.json
```

`--rpc` overrides the RPC endpoint; `--model` overrides the compatible artifact directory. The configured expected model hash must match the chosen artifacts. No private key, wallet, signature, token approval, or public transaction is used by this script.

The script compiles the app with pinned Solidity 0.8.30, optimizer 200, viaIR, and Cancun. It validates artifact hashes, checks live chain identity and dependency code hashes, and generates stable CREATE2 addresses. It then injects the verified dependency runtimes into an isolated in-process Cancun EVM and executes all **59** deployment transactions there: 57 data shards, the model, and the hook. It verifies every local deployment and checks the corresponding public address for conflicting code. The local dependency injection is constructor validation, not a mainnet fork or a live swap test.

The output plan includes unsigned calldata, transaction order, constructor inputs, salts, expected runtime hashes, model identity, local execution gas, and current public shard gas estimates. `standard-input.json` contains the complete compiler input for verification. The script uses the already deployed CREATE2 proxy, so it does not deploy a new factory or PoolManager. [Uniswap's hook deployment guidance](https://developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment) explains why the hook's address permissions must be mined; this hook requires `0x1040`.

## Signing and funding

The user confirmed `0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6` as the signing wallet, and the configuration now records it. Transactions have no fixed nonce; the wallet supplies the current nonce as each transaction is signed. Run with `--from` to explicitly override or record a wallet's current balance and pending nonce. No unrelated transaction may be treated as part of this deployment.

Submit transactions in the listed order and verify each receipt's success and deployed runtime hash before continuing. Existing matching contracts can be reused; conflicting code is a hard error. Estimate gas immediately before every signature. Model and hook estimates require their predecessor contracts to exist, so their unsigned requests intentionally omit a fixed gas limit and fee bid.

Robinhood is an Arbitrum chain with execution and data-posting costs. The local execution total is a comparison measure, not a complete funding quote. Live shard estimates are more informative but change with network conditions. Do not multiply local execution gas by a historical gas price and call that the final deployment cost.

`wallet-deploy.html` is a local browser-wallet helper for the confirmed wallet and selected model. Serve this directory through localhost, open the helper in a browser with an injected wallet, and click **Load reviewed plan** or choose the generated file. Both paths verify the exact reviewed plan SHA-256 before parsing it. Its bundled ethers 6.13.5 library avoids loading third-party scripts. It checks the chain, sender, dependency code, calldata hashes and predicted addresses; estimates each transaction's gas at signing time with 50% headroom; and verifies deployed runtime hashes after confirmation. Each click requests one wallet signature. Existing contracts with the expected runtime are skipped, and pending transaction hashes are retained in browser storage. If a transaction is dropped or replaced without resulting in the expected code, inspect that transaction before retrying; the helper does not guess at replacements.

The helper pins the current reviewed plan digest `2d4f3d60ef3208c92d0dff3295cc4cc0b89d53d6ebb4da7dd63324cc5b4b7911`. A regenerated plan is deliberately refused until its contents are reviewed and this embedded digest is explicitly updated. Never automatically repin an unreviewed replacement plan.

## Optional user-run CLI

From this research directory, `node scripts/deploy-reviewed-plan.mjs` checks the
reviewed plan and live deployments without signing. To deploy from your own
interactive terminal, run `node scripts/deploy-reviewed-plan.mjs --broadcast`.
It reads the private RPC from `.env.local`, shows the wallet and remaining
contract count, asks you to type `DEPLOY`, then accepts the key without echoing
or storing it. It verifies the key belongs to the confirmed wallet, sends only
the pinned zero-value factory deployments, uses 150% of fresh gas estimates,
and verifies each runtime before continuing. It does not fund the pool.

Receipts and an exclusive process lock are stored in gitignored
`deployment/.local/`. Run the same command to resume. An unresolved submission
or failed receipt stops the script; inspect it before removing journal entries.
Do not put keys on the command line, in the environment, or in repository files.

## Pool funding after deployment

Deploying the model and hook does not initialize a pool or supply liquidity. The user selected the native ETH/GH0ST pair and a $100 budget per side, excluding gas. The private signing page now provides a separate full-range liquidity proposal after contract verification, with a fresh price quote, exact capped approvals and a position NFT minted to the confirmed wallet. See [GHOST-ETH-POOL.md](GHOST-ETH-POOL.md). All deployment and liquidity transactions still require wallet signatures.

The hook supports multiple pools and sets the configured initial LP fee for dynamic-fee pools. Required speech uses hook data `0x53504b31`; otherwise inference is optional and may explicitly skip to preserve a valid swap. See [V4-ADAPTER.md](../swap-speaker-535k/V4-ADAPTER.md) for the tested behavior and remaining trust assumptions.

The compositional sampled release supersedes the previous unsigned plan from commit `229339b760033efb8b5a2d69cb77e9fc7c7b240e`. Its temperature is 0.25 and its model hash includes the decoder version and temperature domain. The old plan has not been broadcast by this task.
