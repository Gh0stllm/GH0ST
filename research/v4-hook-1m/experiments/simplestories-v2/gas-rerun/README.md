# SimpleStories V2: fresh local v4 gas measurements

The complete **1,235,968-parameter** SimpleStories V2 model was tested in real Uniswap v4 swaps on an isolated, unforked local Anvil chain. The minimum measured swap cost was **179,978,646 gas** for one input token and one output token. A ten-token question followed by four generated tokens cost **5,443,639,879 gas**.

## Measured swap costs

These are successful transaction receipt gas totals, including the hook, full transformer inference, token event and v4 token settlement. One input token is the prompt `The`. The ten-token prompt is `Question: What color is the sky? Answer:`. Output tokens can be words, word pieces or punctuation.

| Input tokens | Generated tokens | Full v4 swap gas | Generated text |
|---:|---:|---:|---|
| 1 | 1 | **179,978,646** | `boy` |
| 1 | 4 | **1,383,549,242** | `boy had lost his` |
| 10 | 1 | **1,183,909,569** | `"` |
| 10 | 4 | **5,443,639,879** | `" i am not` |

All four cases reached the requested token cap without EOS. The outputs are fragments, not complete sentences or demonstrated correct answers. The question fragment is the beginning of the unrelated cloud dialogue seen in the previous QA probe.

## Application settings and local budgets

The original research hook limits its model-call allowance to **450,000,000 gas**. That is our hook's configured ceiling, not a network rule. To measure longer computations, this experiment compiled a separate [local-only hook](SimpleStoriesV2V4Hook.local-only.sol) whose gas-budget field is widened from `uint32` to `uint64` and whose ceiling is **14,000,000,000 gas**. The local Anvil transaction/block allowance was temporarily **16,000,000,000 gas**. Original hook source and model math were unchanged.

Separately, the **32,000,000-gas local test budget** with a 28,000,000 model-call allowance could not produce even one token. Required-speech swaps reverted and restored balances, pool state and hook context. Optional-speech swaps settled successfully and emitted `TokensSkipped`; they did not run successful inference. The optional low-gas guard settled at 115,993 gas while skipping the model entirely. None of these local settings establishes Robinhood mainnet's current gas limits or deployment feasibility.

The model recomputes its whole accumulated context for each output token, without a KV cache. Longer prompts and more output tokens therefore cost substantially more than the one-token minimum. Raising the hook allowance allows measurement; it does not make the computation cheaper.

## Verification and retained evidence

The checkpoint revision remains `2f445183fbfc45753adb1f9444f81bbdddde9b84`. The weights, tables and all pretrained layers are unchanged. The model commitment matches the previous local test exactly: `0x4e94f870888de2fb00bc66cab543c6b1ab87745fa919425a40b4069d30a9fa6c`. All 13 original artifacts match their saved byte counts and SHA-256 hashes.

Independent Q12 reference parity passed for all 128 final hidden values and the hash of all 4,019 logits on the one-, two- and ten-input-token fixtures. Every emitted output-token sequence and final logit hash matched the reference, and every successful swap settled its tokens. Q12 is an approximation of FP32: the minimal prompt selects `boy` rather than FP32's `sky`; the four-token QA output matches FP32. This is implementation parity, not a language-quality score.

Weights and tables were injected as 104 verified runtime data shards. Their deployment gas is excluded. No public chain was forked or contacted, and no mainnet action occurred. Anvil was stopped, no listener remains on port 18553, and the local gas allowance was restored to 32,000,000 before shutdown.

- [Compact structured results](result-summary.json)
- [Raw gas receipts and checks](gas-benchmark.json)
- [Independent integer fixtures](reference.json)
- [Original artifact hash snapshot](original-artifacts.json)
- [Earlier quality report and model notes](../README.md)

## Reproduce locally

From the research project, run the existing Python environment against `gas-rerun/build_reference.py`, then run `gas-rerun/run-gas-benchmark.mjs --anvil` with the installed Node runtime. The runner accepts no external RPC or wallet key, checks chain ID 31337, and creates and stops its own localhost Anvil instance. This rerun preserves the earlier reports in the parent directory.
