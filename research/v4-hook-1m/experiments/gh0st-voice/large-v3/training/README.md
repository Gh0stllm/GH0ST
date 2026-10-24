# Large-corpus GH0ST training pipeline

This directory contains a local training pipeline, not a corpus, deployment plan, or signing tool. It keeps the 1,235,968-parameter architecture and 4,019-token tokenizer unchanged. Packed weights and v4 gas must be tested after a checkpoint is selected.

## Data preparation

`prepare_cache.py` reads supplied JSONL rows containing `id`, `split`, `source_kind` and `text`. Supported source kinds are `authored`, `compositional` and optional `public_domain`. It strips one outer quote pair, tokenizes once, adds no EOS, shuffles document order deterministically within each split/source, and writes uint16 memory-mapped streams plus document offsets.

Normalized text duplicates across splits, compositional family leakage, public-domain group leakage, unknown tokens, tokenizer drift and changed cache checksums are rejected. Same-split duplicate texts are counted and skipped. Original input hashes and all stream sizes are recorded. Corpus token counts describe positions in deduplicated documents; combinatorial samples are never described as independently authored texts.

```sh
python experiments/gh0st-voice/large-v3/training/prepare_cache.py \
  --data experiments/gh0st-voice/large-v3/data/corpus \
  --output experiments/gh0st-voice/large-v3/cache/tokens-v1
```

The default unknown-token allowance is zero. A cache is reused only when its input/configuration fingerprint and artifact hashes match.

## Training distribution

Three-source caches default to 30% authored, 60% compositional and 10% public-domain **block sampling probabilities**. Two-source caches retain 40% authored and 60% compositional. Actual supervised-token shares and effective repeat exposures per source are logged separately.

A quarter of windows start with the real quote token3 followed by a document beginning. Other windows start at random token positions and use their first64 tokens only as context. Paragraph interiors stay contiguous; reaching a document boundary selects another same-source document, without adding EOS or a separator. This avoids memorizing one arbitrary shuffled chain of authored paragraphs. All windows contain128 tokens, use causal sliding64 attention, and have no padding. This trains both the runtime's initial quote and continuation state without artificial EOS boundaries.

Authored material can be oversampled many times even when the combined corpus is large. The report exposes that ratio rather than counting repeated training exposures as new content.

## Initial run

```sh
python experiments/gh0st-voice/large-v3/training/train_large.py \
  --cache experiments/gh0st-voice/large-v3/cache/tokens-v1 \
  --output experiments/gh0st-voice/large-v3/runs/initial-8m \
  --target-tokens 8000000 --learning-rate 0.00003 \
  --batch-size 16 --block-size 128 --context-warmup 64 \
  --authored-fraction 0.3 --public-domain-fraction 0.1 \
  --threads 2 --stop-after-degenerate 0
```

The target counts actual supervised tokens, not padded or context-only positions. At the default mixture of quote and continuation windows, 8M targets should take roughly6–7k optimizer steps. CPU timing is machine dependent. Learning rate warms over the first3% of target tokens, then follows a cosine schedule to10% of its peak. Gradient norm is clipped to1. Explicit matrix/norm range projection protects signed12/signed16 Q12 export; every projected value is counted.

Validation uses a fixed256-window sample from held-out source streams. It runs every250 steps. Every500 steps and at completion, the runner saves a full checkpoint and two512-token, closed-loop continuations from quote seeds0 and42. Their KV caches persist across steps. EOS is recorded and fed into the next step; generation never silently stops or resets. Full token IDs and the last160 tokens are retained.

## Selection and limitations

`best-candidate.json` identifies the lowest-loss saved checkpoint passing explicit checks for severe repetition, constant-token collapse, insufficient vocabulary diversity, EOS storms and excessive copying of authored12-token spans. These checks are limited heuristics, not a grammar or originality certification. Human review of the full continuations is required before export. All snapshots remain available for that review.

The initial8M run disables degeneration-based early exit and preserves every probe for review. An optional nonzero `--stop-after-degenerate` can stop after repeated bad snapshots, only after the configured minimum token count. Weight safety failures always stop. It does not select on held-out question-answer prompts. A corpus-dependent loss improvement does not establish better general reasoning or question answering.

FP32 training uses the real-number equivalent of relative rotary attention. The on-chain Q12 variant has different rounding. New weights require regenerated executable tiles/commitments, exact Q12 comparison, long no-reset generation tests and actual local v4 transactions below32M gas. No mainnet operation is part of this pipeline.

`test_pipeline.py` tests cache reuse, two/three-source sampling, quote-start labels, absence of inserted EOS, and incremental-versus-full sliding attention. It does not train a model.

The best-candidate pointer can name only a fine-tuned snapshot. Baseline step0 is stored separately; if no trained snapshot passes the basic guards, the final report says so explicitly instead of silently selecting unchanged weights.

`evaluate_snapshots.py` provides a separate, fixed held-out validation sample for each source kind. This helps identify whether a mixed validation score hides a regression in authored or public-domain prose. It records checkpoint hashes and does not change training or the candidate pointer. Different training mixtures have different mixed validation distributions, so their aggregate losses must not be compared directly.
