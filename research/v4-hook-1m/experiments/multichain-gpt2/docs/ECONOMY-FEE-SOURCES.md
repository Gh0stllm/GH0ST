# Economy route: fresh fee and execution audit

**Recommendation:** keep RH as authorization and result home, place the complete onchain model and its KV state on Monad, and return batches of generated tokens. This removes two compute chains and avoids a message round trip for every output token. It does not eliminate onchain model arithmetic.

This is a read-only architecture and price audit. No public transaction, deployment, model calldata or state override was sent. Raw responses, block hashes, exact component amounts and timestamps are in `research/fee-economy-snapshot.json`.

## Current native-gas price ranking

Captured 25 October 2026, 12:51:33–12:51:44 UTC. Each public endpoint passed its chain-ID check before fee reads. Suggested gas price and block reads were consecutive, not atomic.

| Chain | Chain ID | Suggested native-gwei | Native asset USD | USD / 1M native gas |
| --- | ---: | ---: | ---: | ---: |
| monad | 143 | 102 | 0.02113851 | 0.002156128 |
| arc | 5042 | 25 | 0.999616 | 0.024990400 |
| bsc | 56 | 0.05 | 739.17 | 0.036958500 |
| robinhood | 4663 | 0.02 | 2331.5 | 0.046630000 |

Calculation: `gasPriceWei × nativeUSD / 10^12` per million gas. The native gas assets all use 18 transaction decimals, including Arc USDC. Market data came from the [CoinGecko simple-price endpoint](https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin,monad,usd-coin&vs_currencies=usd&include_last_updated_at=true); per-asset update times are retained in JSON. Endpoint provenance: [RH](https://docs.robinhood.com/chain/connecting/), [BNB](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/), [Monad](https://docs.monad.xyz/developer-essentials/network-information), [Arc](https://docs.arc.io/arc/references/connect-to-arc).

**The table ranks each network’s own gas unit, not equivalent model work.** Monad bills declared gas limits and uses different account/storage/memory prices. Its documented limits are 30M gas per transaction and 150M per block. Tight limits remain essential. [Monad gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing), [opcode pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing). RH also includes parent-chain data-posting charges in its transaction gas estimates. [RH fees](https://docs.robinhood.com/chain/gas-and-fees/). Arc native gas accounting uses 18 decimals while its ERC-20 interface uses 6. [Arc fees](https://docs.arc.io/arc/references/gas-and-fees).

## Two-hop messaging scenario

All provider reads succeeded at 12:52:10–12:52:11 UTC, pinned per source-chain block. The scenario uses LayerZero Labs plus Horizen DVNs, the metadata executor, dummy sender `0x1111111111111111111111111111111111111111`, 20 source confirmations and 500,000 destination receive gas. Twenty confirmations are illustrative, not a reviewed finality policy.

| Hop | Message bytes | Provider component total | USD |
| --- | ---: | ---: | ---: |
| robinhood → monad | 3488 | 0.000102567571740973 ETH | 0.23913629 |
| monad → robinhood | 416 | 13.035628532255459011 MON | 0.27555376 |
| Both hops | | Mixed native currencies | **0.51469006** |

These are real `DVN.getFee` and `Executor.getFee` view-call responses for the stated inputs, not a deployed GH0ST OApp quote. Source transaction execution, RH data posting, treasury/protocol fees and any application-specific pricing are excluded. The receiver execution budget is already priced by the executor; adding it again would double-count it. Official addresses came from [LayerZero deployment metadata](https://metadata.layerzero-api.com/v1/metadata). The raw executor options retain the worker envelope while removing the leading Type-3 header, matching the official implementations. [Execution options](https://docs.layerzero.network/v2/developers/evm/configuration/options).

A Monad-local job can carry packed prompt token IDs instead of a hidden vector; the requested 3,488-byte activation is therefore a conservative scenario, not a claimed new job ABI size. Requote the actual job payload and deployed receiver before launch.

## Batch results, rather than relay every token

Keep embeddings, all transformer blocks, the output head and KV state on Monad. After each greedy output, use that token as the next local input until the bounded job finishes. RH can authorize the job and accept an ordered batch of token IDs once complete. A streaming variant can send one batch every K tokens instead of waiting until the end.

| Output tokens in one result | Hypothetical result bytes | Both-hop component USD / job | Component USD / output token |
| ---: | ---: | ---: | ---: |
| 32 | 544 | 0.51478658 | 0.01608708 |
| 64 | 672 | 0.51488311 | 0.00804505 |
| 1024 | 4512 | 0.51777893 | 0.00050564 |

These extra return-message quotes also succeeded. Sizes assume a 416-byte envelope plus four bytes per packed token and 32-byte padding; they are size scenarios, not executed batch jobs. A Solidity `uint32[]` uses 32 ABI bytes per token and defeats this packing unless explicitly encoded. The 1,024-token row illustrates payload pricing only: a one-token prompt can generate 1,024 outputs; longer prompts reduce the output bound because `promptLength + maxNewTokens - 1 <= 1024`. BPE tokens are not words.

Batching changes provider-fee amortization; each token still needs the full onchain computation. Authenticate the model, job/session, prompt, policy, output limit, deadline and ordered result range. Reject wrong jobs and replayed batches. Reusing immutable weights across jobs also avoids unnecessary deployment cost; concurrency and KV cleanup require deliberate session isolation. The new receiver’s 500k gas sufficiency must be measured, especially if it stores every token. A hash-only result is not the same as publishing all output tokens onchain.

## Robinhood Stylus: capability exists, new activation is gas-disabled

Read-only RH probes at block **97,599,341** returned `arbOSVersion=116` (ArbOS **61**, after the documented +55 offset), `stylusVersion=3`, `inkPrice=10000`, `pageLimit=128`, and minimum init costs 8,832 gas uncached / 352 cached. RH’s node documentation also identifies ArbOS 61. [RH node documentation](https://docs.robinhood.com/chain/run-a-full-node/), [ArbSys interface](https://github.com/OffchainLabs/nitro-precompile-interfaces/blob/main/ArbSys.sol), [ArbWasm interface](https://github.com/OffchainLabs/nitro-precompile-interfaces/blob/main/ArbWasm.sol).

**Critical follow-up:** at block **97,600,083**, `ArbWasm.activationGas()` returned **18,446,744,073,709,551,615 (`uint64.max`)**. Official Nitro burns this configured charge before attempting activation, then charges its fixed activation work. This makes new activation impractical at the captured setting, despite the exposed Stylus VM. No activation was attempted. [Nitro activation implementation](https://github.com/OffchainLabs/nitro/blob/master/precompiles/ArbWasm.go). The public [pause notice](https://docs.arbitrum.io/notices/stylus-activation-pause-notice) names Arbitrum One/Nova; this RH conclusion instead follows from RH’s own live view.

At captured nominal prices RH gas costs 21.6267× as much as Monad gas. A matching Stylus workload would need more than that gas reduction, plus room for RH posting costs, to win on compute fees alone. No Stylus benchmark or savings factor was measured. Generic claims in [Stylus gas documentation](https://docs.arbitrum.io/stylus/concepts/gas-metering) are not evidence for this model. The observed 128-page WASM limit is 8 MiB, so the full 124M-parameter model cannot be loaded into one program memory at once; computation needs streaming/chunked weight access and state management.

No specialized signed INT8 dot-product or matrix precompile was established. Monad’s official list contains cryptographic/utility precompiles, P256, staking and reserve-balance helpers, not an inference kernel. Modular exponentiation is not a drop-in signed dot product. [Monad precompile list](https://docs.monad.xyz/developer-essentials/precompiles).

## Local benchmark readiness

Rust, cargo, cargo-stylus and Docker were absent from PATH and the conventional user/application install locations checked. No local Stylus devnode was confirmed. Foundry Anvil 1.8.5 exists at the known absolute installation path; that EVM/Monad runtime does not execute Stylus WASM. An honest local WASM benchmark first needs a Rust/WASM toolchain and a matching Nitro/Stylus runtime. No toolchain was installed during this audit.

The practical near-term economy path remains Monad-local onchain jobs with batched RH results. Revisit RH Stylus after the activation gate and local benchmark environment are resolved.

## Exact version-2 job packet quotes

Fresh provider reads at 2026-10-25T13:08:48.119Z–2026-10-25T13:08:48.510Z use the new `GPT2JobOApp` wire format, whose size is `384 + 32 × ceil(tokenCount / 8)` bytes. A two-token prompt and two-token result are both **416 bytes**. Their captured provider totals are **$0.23920775 + $0.27489755 = $0.51410530 per job**, excluding compute, source execution/data and treasury.

| Prompt tokens | Generated tokens | Request / result bytes | Provider components / job | Per generated token |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 32 | 416 / 512 | $0.51417753 | $0.01606805 |
| 2 | 64 | 416 / 640 | $0.51427383 | $0.00803553 |

The earlier 544/672/4,512-byte rows remain explicitly labeled hypothetical old-envelope illustrations. This section uses the new packet format. Both sets are provider fee components for the stated dummy sender and illustrative confirmations, not a deployed application quote. Fresh market timestamps and every native amount are retained in JSON.
