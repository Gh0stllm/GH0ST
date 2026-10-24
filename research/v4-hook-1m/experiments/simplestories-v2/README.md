# SimpleStories V2: pretrained quality and local v4 test

**This complete Solidity transformer port does not fit the 32-million-gas swap limit.** One next-token computation took **179,868,525 gas**; a real v4 swap producing that token took **179,967,006 gas** in an explicitly higher-limit local test. Normal-limit attempts failed safely. No mainnet RPC, public-chain transaction or live website change was used. The only public network activity was downloading the public pretrained model.

## Actual pretrained model

- Repository: [SimpleStories/SimpleStories-V2-1.25M](https://huggingface.co/SimpleStories/SimpleStories-V2-1.25M)
- Pinned revision: `2f445183fbfc45753adb1f9444f81bbdddde9b84`
- Actual unique parameters: **1,235,968**.
- Original checkpoint SHA-256: `4d7b846d32e636c70ed3a342ec53775d10d56b404c357865a75eb2dce0b78f94`.
- Four Llama layers, width 128, intermediate width 341, four query heads and two key/value heads, 4,019-token vocabulary, tied input/output embeddings.

Every pretrained tensor participates in the port. It executes RMS normalization, rotary positions, causal grouped-query attention, SwiGLU, residual connections, final normalization and the full vocabulary projection. No synthetic replacement model or matrix-slice proxy is used.

## Quality and samples

The unmodified FP32 checkpoint generated 24 continuations from 12 prompts and two seeds. Every continuation was nonempty and distinct, but all hit the 48-token cap. That cap means story completion was not assessed; it does not mean the model cannot finish a sentence or longer story.

Most short clauses are readable. Character identity, pronouns and plot continuity are unreliable. All six market-prompt continuations drifted into unrelated fiction. Distinct outputs still shared stock phrases. This was a transparent small-sample assistant review, not a blinded or standardized quality benchmark.

An actual excerpt after a prompt about losing a toy:

> they gathered boxes and tools, ready to work together. they worked hard, laughing and sharing ideas.

Another actual continuation introduced a rabbit and boy after a prompt about a bird and a key:

> the rabbit jumped around, feeling the air rush through them. they ran through the trees, past the boy and the other animals.

All 24 unedited outputs are in [samples.md](samples.md), with prompts and seeds. Full observations are in `quality-report.json`.

Three separate Q&A probes produced no correct answers, despite having no unknown input tokens. For example, “What is two plus two?” produced dialogue about a riddle. This model is a story completer, not an instruction-tuned question-answering system. See `qa-probe.json`.

## Gas and v4 integration

| Local test | Result |
|---|---|
| One-token forward, 32M ceiling | Out of gas at 32,000,000 |
| Two-token completion, 32M ceiling | Out of gas at 32,000,000 |
| Required-speech swaps, 6M/26M/28M model budgets | Model inference failed; pool/context/token balances rolled back |
| Full one-token forward, temporary 500M local ceiling | Success: **179,868,525 gas** |
| Full v4 required-speech swap, temporary 500M local ceiling | Success: **179,967,006 gas**; token `307` decoded as `boy` |

The above-cap swap used a fresh isolated local setup after the normal benchmark, and emitted the correct token and full-logit hash, advanced its sequence and settled both tokens. It proves integration only. It does not show feasibility at the target ceiling. The local block ceiling was restored to 32M.

Both one- and two-input-token controls matched the independent integer reference for all 128 final hidden values and the hash of all 4,019 vocabulary logits. The second control exercises causal attention across positions.

All **104** data-shard runtimes were loaded using `hardhat_setCode` and byte/hash verified. Their deployment gas is not measured. The model, hooks and real Uniswap v4 PoolManager/settlement infrastructure were deployed by ordinary local transactions. Contract-size limits stayed enabled. The model deployment used 4,512,525 gas; model/hook runtime sizes are 7,767/5,272 bytes.

## Numerical and adapter limits

Weights use INT16 Q12 fixed point with no clipping. This approximates FP32; it is not bit-exact FP32 execution. Two of three fixture argmax tokens matched FP32, while the one-token `The` fixture changed from `sky` to `boy`. Four separate eight-token greedy sequences matched FP32 on all 32 next-token choices. These checks bound observed numerical differences; they do not guarantee identical generations everywhere.

The research port limits context to 16 tokens and generation to four new tokens per call, recomputing context without a KV cache. The test hook uses a fixed tokenized prompt and emits token IDs, which are decoded outside the EVM. It does not implement user question input or conditioning on swap data.

Use the actual tokenizer's EOS ID **1**, no automatic BOS, and `add_special_tokens=False`. The downloaded model config's EOS ID 2 is inconsistent with the tokenizer: token 2 is `!`. This discrepancy was checked rather than silently using the config.

## Reproduce and inspect

From `research/v4-hook-1m`, using the existing Python environment with PyTorch, Transformers, NumPy and Safetensors, and the installed Node dependencies:

```sh
python experiments/simplestories-v2/download_and_evaluate.py
python experiments/simplestories-v2/integer_reference.py
node experiments/simplestories-v2/run-v4-benchmark.mjs
```

The download uses public HTTPS without credentials. The integer reference and all EVM execution are local. `provenance.json`, `model/manifest.json` and `contracts/protocol.json` pin the sources, tensor layout and exact integer equations. See `result-summary.json`, `v4-benchmark.json`, `integer-reference.json` and `environment.json` for the recorded evidence. Previous experiments and live contracts were not modified.
