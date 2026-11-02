# Model selection for short Watch observations

3 November 2026. Local synthetic screening only. For contract auditing, see [the separate recommendation](CONTRACT-AUDIT-MODELS.md).

## Decision

Keep **Qwen3-1.7B Q4_K_M, non-thinking**, as the next ICP benchmark baseline for optional alert wording. Do not switch to 0.6B on these results. Neither model is approved for autonomous vulnerability detection, risk scoring, amount calculation or trigger decisions. Render exact facts directly from validated data; if AI output fails validation, show the factual template.

The official [1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) and [0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) model cards describe Qwen3's thinking/non-thinking modes. This test uses pinned third-party Unsloth Q4_K_M conversions, with SHA-256 checks before loading. File sizes are 1,107,409,472 and 396,705,472 bytes respectively; smaller weight storage does not establish proportional cycle savings.

## What was measured

Eight synthetic, already-matched transfer packets cover integers, exact-threshold equality, decimals and very small amounts. Each model produced one output for each of three prompt variants: 48 generations total. No real contract, wallet, service or paid API was contacted for inference.

Runtime: llama-cpp-python 0.3.36 on Apple M5 / Darwin arm64, CPU layers only (`n_gpu_layers=0`), four threads, context 1,024, batch 64, seed 42, greedy temperature 0, maximum 64 generated tokens. An unmeasured one-token warmup precedes each model; `reset()` prevents prompt-prefix reuse between cases. Timing includes prefill and output generation, excluding model load. Greedy decoding is an experimental control, not a claim to use the model card's preferred sampler. Local libraries and Wasm builds are different.

| Model | Prompt | Mean input tokens | Mean output tokens | Lexical passes / 8 | Local median seconds |
| --- | --- | ---: | ---: | ---: | ---: |
| 1.7B | verbose | 206.75 | 21.50 | 4 | 1.115 |
| 1.7B | compact | 82.75 | 17.38 | 0 | 0.607 |
| 1.7B | compact_v2 | 94.75 | 31.00 | 8 | 0.961 |
| 0.6B | verbose | 206.75 | 26.13 | 1 | 0.532 |
| 0.6B | compact | 82.75 | 5.75 | 0 | 0.166 |
| 0.6B | compact_v2 | 94.75 | 24.13 | 0 | 0.325 |

The lexical check requires literal amount, symbol, sender and recipient; a threshold mention; no listed speculative terms; and completed output. It does not prove semantic correctness, number roles, direction or sentence quality. Faster incomplete outputs are not successful optimizations.

## Manual review and rejected optimization

All 48 raw outputs were inspected. The verbose 1.7B prompt preserved the four factual fields in all eight cases, but omitted the threshold statement in four. The verbose 0.6B prompt mostly produced labeled field lists, not the requested observation. The first compact prompt often caused 1.7B to print literal placeholders such as `sender` and `recipient`; 0.6B usually returned only the amount.

The clearer `compact_v2` fixed that placeholder problem for 1.7B. However, its `tiny` case said **“sent 1 copy of TOKEN”**, then separately gave the correct 0.000001 amount. The extra quantity was unsupported. Thus **7/8 outputs met the requested factual sentence on manual inspection**, even though the lexical guard reported 8/8. Reject the extra-quantity output. No compact_v2 0.6B output contained the complete required payload; several omitted wallets or the token symbol. Comma formatting alone was not treated as evidence of a changed numeric value.

The revision used feedback from these same eight development cases. This is not held-out accuracy, a statistically reliable model ranking, or evidence that the remaining outputs generalize. No adversarial contract text, multilingual case, proxy analysis, DeFi reasoning, reorganization or unknown-token metadata was evaluated.

Input tokens fell **54.2%** for compact_v2 versus verbose, but average output tokens increased for 1.7B. Do not translate this into a 54.2% bill reduction. A larger held-out set, stricter semantic validation and a bounded dedicated ICP benchmark must precede adoption. Preserve the historical $3-5 planning allowance until measured Watch lifecycle costs replace it.

## Reproduce

Use Python 3.11+ and `llama-cpp-python==0.3.36`. Native build options and hardware can change timing and exact output. Model hashes, repositories, immutable revisions, fixtures, prompts, settings and every output are embedded in the JSON files. Model weights are deliberately not committed.

```sh
python benchmark_local.py --model-17 /path/Qwen3-1.7B-Q4_K_M.gguf --model-06 /path/Qwen3-0.6B-Q4_K_M.gguf --output local-results.json
python benchmark_local.py --model-17 /path/Qwen3-1.7B-Q4_K_M.gguf --model-06 /path/Qwen3-0.6B-Q4_K_M.gguf --variants compact_v2 --output local-results-v2.json
python cost_model.py
```

Raw evidence: [initial comparison](local-results.json), [revised prompt](local-results-v2.json), [runner](benchmark_local.py). The runner's lexical guard is deliberately reported with its known false acceptance; it must not be reused as a production safety gate.
