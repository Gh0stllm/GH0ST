# GH0ST native gas on the base L3

This prepares the ordinary Nitro base chain: Robinhood parent `4663`, standard Rollup data availability, canonical GH0ST `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559` as native child gas. It does not add chess or LLM execution to the chain. ArbOS **61** is explicit: the exact Nitro 3.12.2 production geth supports it, and Chain SDK commit `9a34cbb6e0bb6bde760fab45fd51dfd589c877c4` defaults to 61. Older experimental ArbOS 60 fixtures do not set this chain's version.

Users bridge the parent ERC20 through the canonical native-token bridge and spend native GH0ST on the child. The operator pays **ETH on Robinhood** to post batches and assertions. GH0ST fees do not remove that ETH expense, procure ETH, or turn an ICP balance into parent gas.

## Exact deployment fields

In contracts commit `4341b132cfbdcc980ead03765ca5224ff6cb5d97`, `RollupCreator.RollupDeploymentParams.nativeToken` must be the canonical GH0ST address, and `.feeTokenPricer` must be a real, reviewed contract **on Robinhood**. Chain SDK v3.2 requires a nonzero pricer for custom-token Rollup chains. Its older v2.1 path rejects custom-token Rollups. Set `chainConfig.arbitrum.DataAvailabilityCommittee=false`; use the matching production module root and version from `../node/` and the full deployment configuration from `../deployment/`.

The exact pricer interface is `getExchangeRate() returns (uint256)`. It returns **GH0ST per one ETH, scaled by 10^18**, even if a fee token has different decimals. `SequencerInbox` converts the parent gas price as `parentGasPriceWei * exchangeRate / 10^18`. For illustration only, if one ETH were worth 2,000,000 GH0ST, the pricer would return `2000000000000000000000000`, and a 0.001 ETH posting cost would correspond to 2,000 GH0ST. This is a unit example, not a current GH0ST price.

With a nonzero pricer, `ERC20RollupEventInbox` initializes a converted parent data price. On an Arbitrum parent it includes the parent's own parent-data fee estimate. `SequencerInbox` emits converted batch-spending reports to reimburse the poster from the child's fee pool. With **zero pricer**, the pinned contracts skip reimbursement reports and initialize the parent data price to zero. Generic instructions to disable parent fees for custom gas tokens describe a different configuration; do not apply them to this reimbursed Rollup path. Reimbursements accumulate on the child in GH0ST; converting or withdrawing them takes separate transactions, liquidity, time, and explicit approval. They are not instant ETH top-ups.

`policy.json` intentionally leaves the pricer, market rate, batch poster accounts, and ETH reserve unset. The supplied programs can check a filled policy but cannot deploy, approve, transfer, sign, or broadcast. A missing value remains a visible blocker. An unverified rate or fake contract address is never substituted.

## Read-only checks

From the repository root:

```sh
node research/chess/l3/core/gas/preflight.mjs --write
node --test research/chess/l3/core/gas/test.mjs
node research/chess/l3/core/gas/compile-reference.mjs
```

Use `--policy /absolute/path/to/reviewed-policy.json` to inspect a future actual pricer. Add `--require-gas-ready` to fail when gas configuration is incomplete. A successful basic token check alone does not mean the gas plan or chain is ready.

The endpoint comes from `ROBINHOOD_MAINNET_RPC_URL`, an already mode-0600 and gitignored local `.env.local` containing that key, or the public Robinhood RPC. Reports identify only the source category. They never contain the private URL. RPC methods are allowlisted, errors are sanitized, and simulations use `eth_call` with no persisted state. No state override, token approval transaction, wallet method, or private key is supported.

The preflight samples one block at head minus 12 and rechecks its hash. This gives consistent reads, not a claim of economic finality. It checks runtime identity, metadata, supply, standard proxy slots, executable proxy-opcode heuristics, zero-value ERC20 calls, and a one-base-unit self-transfer if the chosen public probe account holds GH0ST. It also reads parent `ArbSys` chain ID, child-style block number, and encoded ArbOS version (raw value minus 55). Robinhood RPC height is not assumed to equal EVM `block.number` for assertion or challenge timing. Proxy heuristics and simulations are **partial compatibility evidence**, not a full source audit or bridge round-trip proof. `GH0ST_L3_TOKEN_PROBE_ACCOUNT` may identify a funded public probe address without using its key.

## Pricer reference and remaining decisions

`reference/OwnerAdjustableExchangeRatePricer.sol` is the unchanged official manual-pricer example from the exact pinned contracts source. `compile-reference.mjs` compiles it with exact solc `0.8.17+commit.8df45f5f`, London EVM, optimizer 2,000 runs, and metadata hash disabled. Build evidence records every source hash and compiler hash. **The upstream example is explicitly unaudited and not ready for production.** Its rate has no bounds or freshness protection, it allows zero, the initial owner is its deployer, and ownership can be renounced. Its successful local compilation is not a production review. No market oracle or liquidity source has been verified here, so no automatic price source is selected.

A production choice needs a reviewed pricer and owner, a contemporaneous sourced GH0ST/ETH rate, and an operational update policy. If rate reads start reverting, a nonzero-pricer Rollup can also lose the ability to post batches; stale-rate handling must account for chain liveness. The owner can replace the pricer through normal administration. Neither a fresh quote nor this preflight proves solvency or eliminates exchange-rate risk.

The user explicitly removed the old **100 ICP and 0.003 ETH L3 spending caps**. Active policy now uses estimates and review, with no replacement finite cap selected. Prior amounts — `13 ICP` converted, `0.0003 ICP` transfer fees, and `0.000064114367868 ETH` deployment fees — remain historical accounting records, not current limits or wallet balances. A minimum operating reserve and a current full deployment estimate remain unset. The SDK's separate 1 WETH default validator bond is a reference; this gas configuration does not silently lower it or change its asset. Unrelated chess reward/entry amounts remain unchanged. No hosting order, license acceptance, contract deployment, transfer, or auto top-up is performed here.

Official references: [custom gas token Rollup requirements](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/custom-gas-token-rollup), [pinned pricer interface](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/bridge/ISequencerInbox.sol), [pinned batch spending reports](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/bridge/SequencerInbox.sol), [pinned ERC20 initialization](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/rollup/ERC20RollupEventInbox.sol), [upstream pricer warnings](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/test/foundry/fee-token-pricers/README.md), [pinned SDK custom-token guards](https://github.com/OffchainLabs/arbitrum-chain-sdk/blob/9a34cbb6e0bb6bde760fab45fd51dfd589c877c4/src/createRollupPrepareTransactionRequest.ts), [pinned production ArbOS maximum](https://github.com/OffchainLabs/go-ethereum/blob/30456d24d3cff444d3b0f246e9c7609477c7d4a1/params/config_arbitrum.go), and [revenue routing](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/revenue-routing).
