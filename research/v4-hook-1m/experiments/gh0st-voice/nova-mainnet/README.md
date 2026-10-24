# GH0ST N0VA-8M: prepared Robinhood launch

**Prepared and rehearsed locally. No public contracts or liquidity were deployed
by this preparation.** `READINESS.json` records the current result; the immutable
`plan.json` retains its preparation-stage label so its reviewed hash stays fixed.

The user selected the gas-tested model that begins “i found a rumor spreading
through the crowd.” The checkpoint is
`460697a80b25c0dc6e2242be84a9f6ec26f280f07335246bd99f32ef747e2000`.
It has **8,175,493 parameters**. It still fails the longer grammar and continuity
review. This is an experimental release candidate, not a claim of reliable
conversation. Previous research reports remain historical evidence.

## Fixed launch configuration

- Robinhood mainnet, chain 4663, using the previously verified shared PoolManager.
- Exactly **1,000,000 N0VA**, minted once to the vault during construction.
- No external mint, owner, tax, blacklist, pause, upgrade or administrative balance changes.
- Exactly **1 ETH** is required by the final `fundAndInitialize()` call.
- Initial marginal valuation targets **$25,000** using the recorded ETH/USD
  input of **$2,367.48**, or **$0.025 per N0VA** at that snapshot.
- About **999,998.64674714236614344 N0VA** and **1 ETH** enter the position;
  **1.35325285763385656 N0VA** of rounding dust remains locked in the vault.
- Pool fee **0.3%**, tick spacing **1**, immutable price range and exact pool binding.
- LP principal, fees and dust are permanently locked. There is no withdrawal or rescue.
- Each successful swap adds **one to three neural words** to the same recurrent
  state. Sentences can continue across swaps; there is no runtime phrase bank,
  forced punctuation or external inference service.
- Inference failure reverts the entire buy or sell, as requested. No bypass exists.

The dollar valuation is a snapshot scenario, not cash backing or a guaranteed
launch valuation if ETH changes. The initial position contains only 1 ETH for
seller payouts. Buyers can resell immediately. Standard ERC20 transfers remain
unrestricted; other pools can trade N0VA without this hook. The inherited
market-feature weights remain zero, so these results do not establish an AI
reaction to price or trade direction.

## Predicted addresses, not live deployment claims

| Component | Address |
| --- | --- |
| N0VA token | `0xC1a7B8aA902e0EFfd53c1C84D52A6d9a0a29e518` |
| Permanent vault | `0x13779ee0C8Fc7D83D94B248FEFE9E953E66cf04F` |
| Neural model | `0xb1fc0dd4059425c82CFf4756BBA43C9B364f107D` |
| Pool-bound hook | `0xF5b590937caF7b2BA9c39756ba5915f5116e3040` |
| Swap router | `0x1f6CAEF4878ff29e052D6BbE18Bf1E42b8502c83` |

The vault is the first transaction from the confirmed deployment wallet at
nonce **6200**. Its first internal CREATE fixes the token address. CREATE2 fixes
the model, hook and router. A changed wallet nonce before vault deployment
requires rebuilding and rehearsing the plan; silently adjusting it would break
the immutable bindings. **Do not send ETH directly to predicted addresses.**
Funding uses the final verified vault method, after all contracts exist.

## Completed local rehearsal

All **2,660 exact unsigned deployment transactions** were executed on an
unforked local chain with chain ID 4663 and a 32M gas ceiling. Weight data was
deployed through real local CREATE2 transactions, not injected. Only the shared
dependency runtimes were installed from the verified read-only snapshot.

- Total deployment gas: **13,689,026,839**.
- Largest deployment transaction: **12,700,334 gas**.
- Genesis initialization: **342,168 gas**.
- **32** subsequent local buys/sells generated **87** neural words and **10**
  natural sentence endings; maximum swap **23,842,944 gas**.
- Independent scalar replay matched every measured word, all 768 values in each
  final hidden state, and every state hash.
- Regressions covered initializer front-running, incorrect/duplicate funding,
  slippage rollback, insufficient gas, direct callbacks, changed model code and
  the lack of LP withdrawal/management paths.
- Six CLI/package tests cover frozen archive loading, wrong-chain rejection,
  dependency identity, resume code checks and separation of deploy/fund modes.

These finite checks do not constitute an external security audit or prove
10 swaps per second. The only source changes from the tested contracts are the
three constructor chain guards, from 31337 to 4663. The archived compiler input
reproduced all five deployment artifacts exactly.

## Funding estimate

At the recorded fee snapshot, deployment plus initialization is approximately
**0.28262 ETH**, including an uncompressed posting-fee scenario. Adding liquidity
gives **1.28262 ETH**. A 50% fee allowance gives a total budget of **1.42393 ETH**.

The confirmed wallet held **0.31575 ETH** at the snapshot, leaving a budgeted
shortfall of **1.10818 ETH**. This is not a fixed quote: execution and parent-chain
posting prices can change. `cost-estimate.json` contains the arithmetic and
limitations. The CLI estimates each transaction afresh and reserves 1 ETH for
liquidity during deployment.

## User-run CLI

From the existing research checkout, using its installed Node dependencies:

```sh
node experiments/gh0st-voice/nova-mainnet/deploy.mjs
node experiments/gh0st-voice/nova-mainnet/deploy.mjs --broadcast
node experiments/gh0st-voice/nova-mainnet/deploy.mjs --fund
```

The first command is read-only. The second deploys contracts only and requires
the exact `DEPLOY N0VA` phrase. The third verifies every runtime and requires
`LOCK 1 ETH` before the permanent deposit. It is deliberately a separate stage.
The RPC comes from the existing private `.env.local` or the
`ROBINHOOD_MAINNET_RPC_URL` environment variable. The CLI accepts a key only in
an interactive hidden prompt, never in an argument, file or environment variable.

The CLI pins the plan/archive, chain, wallet, dependency hashes, checkpoint,
predicted addresses and every runtime. It records signed-transaction hashes
before submission, increments nonces after confirmed receipts, and refuses
unresolved outcomes rather than blindly resubmitting. `.local/` contains only
receipt/lock state and is excluded from publication.

Submissions are paced using the recorded **7,000,000 gas/second** network
accounting rate. The complete 13.689 billion gas workload corresponds to about
33 minutes at that rate, before additional RPC or confirmation delay; this is
not an instant deployment or a guaranteed completion time. The CLI stops if
the current gas price exceeds 150% of the reviewed snapshot price rather than
automatically accepting a sustained fee spike.

`bundle/transactions.jsonl.gz` contains the complete unsigned deployment data.
`restore-model.mjs` reconstructs all six packed model binaries from that archive
and checks their hashes. `bundle/checkpoint.safetensors.gz` retains the selected
training weights; `bundle/reference.npz.gz` retains the exact integer reference.
`build/standard-input.json` and `verification.json` provide compiler input and
constructor arguments for later explorer verification.

The GitHub distribution stores the three large compressed artifacts as hashed
binary parts under `bundle/parts/`. The CLI automatically reconstructs its
transaction archive if needed. To reconstruct all three files, run
`node experiments/gh0st-voice/nova-mainnet/restore-bundle.mjs`. Every part and
reassembled file is checked against its digest. The downloadable local ZIP
already contains the complete compressed files.

Official network context: [Robinhood connection details](https://docs.robinhood.com/chain/connecting/).
The exact PoolManager and CREATE2 dependency hashes are recorded in
`network-snapshot.json`; they must match again before any signed submission.
