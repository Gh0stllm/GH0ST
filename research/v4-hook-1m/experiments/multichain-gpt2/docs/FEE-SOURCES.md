# Fee research snapshot — 25 October 2026

The captured native-gas price ranking is **Monad, Arc, BNB, Robinhood**, cheapest first. This is a price per each network's own gas unit, not an inference benchmark. The accompanying `research/fee-snapshot.json` retains raw public RPC responses, block identifiers, exact prices, timestamps and provider-component quotes. All calls were read-only; no private RPC, key, model calldata, deployment or state override was used.

## Current native-gas prices

The main snapshot ran from 10:10:47 to 10:10:55 UTC (15:40:47–15:40:55 IST). Every endpoint first passed `eth_chainId`, then returned `eth_gasPrice`, a recent block and fee-history data. Gas-price and block reads were consecutive rather than atomic, so they can describe adjacent blocks. Prices may move immediately.

| Chain | Verified chain ID | Suggested gas price | Native asset USD | Nominal USD per 1M native gas |
| --- | ---: | ---: | ---: | ---: |
| Monad | 143 | 102 MON-gwei | 0.0209865 | 0.002140623 |
| Arc | 5042 | 20.914091501 USDC-gwei | 0.999562 | 0.020904931 |
| BNB | 56 | 0.05 BNB-gwei | 737.44 | 0.036872000 |
| Robinhood | 4663 | 0.020014 ETH-gwei | 2,326.16 | 0.046555766 |

Calculation: `gasPriceWei / 10^18 × nativeAssetUSD × 1,000,000`. All four native gas assets use 18 transaction decimals. Market values came from the [CoinGecko simple-price API](https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin,monad,usd-coin&vs_currencies=usd&include_last_updated_at=true), retrieved at 10:10:55 UTC; asset update timestamps are preserved in JSON.

Public endpoint provenance: [Robinhood connection documentation](https://docs.robinhood.com/chain/connecting/), [BNB JSON-RPC endpoints](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/), [Monad mainnet network information](https://docs.monad.xyz/developer-essentials/network-information), and [Arc connection documentation](https://docs.arc.io/arc/references/connect-to-arc). Initial HTTP failures were resolved through documented public providers and a standard user agent; no private endpoint was needed.

## Native execution accounting matters

**Monad:** The chain charges the declared gas limit rather than refunding the difference down to execution gas used. Current documentation lists a 30M transaction limit, 150M block limit and a 100 MON-gwei base-fee floor. A worker that declares excessive gas can therefore overpay even if execution uses less. [Gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing)

Monad's documented current revision is `MONAD_TEN`. Cold account access costs 10,100 gas. Storage warms in pages of 128 slots: first access costs 8,100, then reads in that page cost 100. Writes use page-load, page-write and state-growth accounting instead of Ethereum's ordinary slot formula. Memory expansion is linear at `w / 2`, with `w` measured in 32-byte words and an 8 MiB transaction cap. These changes can materially change this model's memory and weight-read costs. A generic Cancun trace cannot be converted into a native Monad result by merely changing the token price. [Opcode pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing), [current network revision](https://docs.monad.xyz/developer-essentials/network-information)

**Robinhood:** Robinhood identifies itself as an Arbitrum L2 using Ethereum blobs. Arbitrum's fee model combines execution with parent-chain data posting, estimated from compressed transaction size. Its gas estimate incorporates the posting component as gas equivalents. Thus `eth_gasPrice` alone does not price a model transaction, and contract deployment or activation calldata needs a fresh estimate. [Robinhood architecture](https://docs.robinhood.com/chain/connecting/), [Arbitrum gas and fees](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/gas-and-fees), [estimation method](https://docs.arbitrum.io/arbitrum-essentials/how-to-estimate-gas)

A pinned-block `ArbGasInfo.getPricesInWei()` read on Robinhood succeeded at block 97,508,232: the reported parent-data byte price was 15,652,016 wei and total execution price 20,068,000 wei per ArbGas. This diagnoses the pricing components; it is not the compressed size or full charge for any model transaction. [Official interface](https://github.com/OffchainLabs/nitro-precompile-interfaces/blob/main/ArbGasInfo.sol)

**Arc:** Native USDC gas accounting has 18 decimals, while the same asset's ERC-20 interface exposes 6. The documented EIP-1559/EWMA market has a 20-gwei base-fee floor, 20,000-gwei ceiling and 30M gas/block. The current suggested price can include a priority component. [Arc gas and fees](https://docs.arc.io/arc/references/gas-and-fees)

**BNB:** This snapshot is BSC chain 56. Fee or declared-gas rules documented for the separate, unpublished BNB “New L1” must not be applied to BSC. The observed BSC base fee was zero and suggested gas price was 50,000,000 wei. [BSC endpoint identity](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)

## Read-only LayerZero component scenario

All twelve provider calls succeeded at 10:11:33–10:11:35 UTC for **RH → BNB → Arc → Monad → RH**. Each hop quotes LayerZero Labs plus Horizen plus the configured metadata executor, using dummy sender `0x1111111111111111111111111111111111111111`, 20 source confirmations and 500,000 destination receive gas. The first three messages use 3,488 bytes; the final message uses 416. Twenty confirmations is an illustrative input, not a reviewed finality policy.

| Hop | Provider component sum in source native asset | USD translation |
| --- | ---: | ---: |
| RH → BNB | 0.000114523837691696 ETH | 0.266401 |
| BNB → Arc | 0.000350756442822305 BNB | 0.258662 |
| Arc → Monad | 0.252782255449933120 USDC | 0.252672 |
| Monad → RH | 13.035628532255459011 MON | 0.273572 |
| Total | Mixed currencies; sum only in USD | **1.051306** |

These are actual read-only `DVN.getFee` and `Executor.getFee` responses for the stated inputs, **not an exact deployed GH0ST OApp quote**. No inference OApp security configuration exists to quote. Source dispatch execution, treasury fees and future price changes are excluded. Addresses and each component's exact native fee are recorded in JSON, selected from [official LayerZero deployment metadata](https://metadata.layerzero-api.com/v1/metadata). Sender-specific pricing or restrictions can differ for a deployed OApp.

The executor options preserve the worker envelope but remove the leading Type-3 `0x0003` header, matching the installed official `UlnOptions.decode` and `ExecutorOptions` implementations. Destination execution is already included in the executor component; adding the separate 500,000-gas reference again would double-count it. [Message execution options](https://docs.layerzero.network/v2/developers/evm/configuration/options)

For an explicit budget scenario, capping each source dispatch at 16,777,216 native gas and its captured gas price limits the combined source-execution component to $1.786326 if transactions are included within those caps. Adding the unchanged provider-component scenario gives **$2.837632 before treasury fees and model computation**. This is an operator-selected ceiling scenario, not estimated required gas or a guaranteed deliverable price; an inadequate cap can prevent inclusion.

The previous local mock receipts used 3,041,479–3,056,484 gas for activation sends, 495,160–509,460 for final sends, 180,484–216,820 for activation receives, and 116,403–150,591 for final receives. Those ranges diagnose local adapter work only. MockEndpoint stores a payload queue and has no real DVNs; its send gas must not be substituted for LayerZero's production send gas. The JSON also preserves a clearly labeled nominal translation of the older generic-Cancun receipt profile, not a native fee forecast.

## Placement implication

Monad is the strongest candidate for the heavy transformer/head stage at this snapshot's prices. Its nominal gas price is about 9.8× below Arc, 17.2× below BNB and 21.7× below Robinhood in USD terms. Confirm the advantage with the actual Monad opcode schedule, tightly estimated declared gas limits, full vocabulary-head execution and quoted production messaging before claiming a lower total inference fee. This snapshot establishes current prices and provider component responses, not final cost savings.
