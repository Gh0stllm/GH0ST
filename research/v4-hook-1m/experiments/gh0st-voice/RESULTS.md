# GH0ST voice experiment: execution works, requested language quality not reached

2026-10-24. The small-corpus experiments below ran locally and made no public-chain transaction, website change or social post. Their completed artifacts were subsequently included in a research-branch GitHub publication. See `large-v3/RESULTS.md` for the later, larger-corpus experiments.

## Outcome

Built and tested full-weight fine-tuning of the existing 1,235,968-parameter transformer toward an original first-person GH0ST voice. The technical path works: learned weights can be changed, exported to the current integer/SWAR execution path and run during real local v4 swaps within 32M gas. The language result is not ready to replace the current model.

The target is the broad register seen on Truth Terminal's public website: casual first-person machine observations, irreverent concrete comparisons, curiosity about people/culture/technology and playful self-questioning. The training text is original GH0ST writing. No website passages or identity were copied. This is a voice experiment, not an attempt to reproduce Truth Terminal's reasoning or knowledge.

## What was built

- 203 original connected monologues:161 training, 21 validation, 21 test; 11,462 total tokenizer tokens. Initial 112-document pilot retained separately.
- Fixed vocabulary and architecture; no additional parameters, phrase bank or runtime sentence templates.
- Full-model and upper-two-layer tuning, causal 64-token attention, explicit weight-range audits and reproducible checkpoint selection.
- Independent Q12 transformer implementation, exact sampler, weight/bytecode export and local v4 test adapter.
- 36 held-out continuation/question diagnostics, long free-generation tests, training-text overlap and repetition checks.

The expanded split has no shared 12-word sequence between training, validation and test. This is only a data-split check, not proof of originality relative to the base model's pretraining.

## Training comparisons

| Experiment | Selection and observation | Decision |
|---|---|---|
| Initial document/EOS pilot | Validation loss 5.038→4.251, selected step 25, later checkpoints overfit. More machine language, premature endings and child-story fallback. | Retain as failed language baseline. |
| Six continuous-stream trials | All weights versus top 2 layers; learning rates 1e-5, 3e-5, 1e-4. Selected all / 1e-5 by validation loss alone. | Useful preprocessing/hyperparameter comparison; not a language-quality win. |
| Expanded continuous model |203 documents; selected step 150; validation 4.723→4.125; held-out FP32 test 4.601→4.015. | Failed long free-generation quality despite better predictive loss. |

These losses use different data/preprocessing across rows and should not be ranked against one another. Within each comparison the baseline and candidate use the same split. The validation-selected checkpoint remains a research candidate, not a recommended release.

All tested matrices retained signed 12-bit compatibility; no values required projected clipping. The vocabulary file remains byte-identical. The selected expanded checkpoint SHA-256 is `c2fa212ca1f75dc8225350fc0a94d1411ca4c2b4a3fa57bcaaa9ac54cbd0e222`.

## Local on-chain execution evidence

The FIRST pilot only was tested in the local v4 environment:

- 80/80 actual PoolManager swaps succeeded and matched the independent reference, including all 4,019 logits at every checked step.
- 93 generated tokens; persisted context continued across swaps.
- Whole-swap gas 13,321,714–28,427,411 ; 30 saturated 64-position swaps stayed 28,194,939–28,427,411.
- Rollback, modified code/history, malformed input, stale preview and caller/pool isolation checks passed.
- The chain was an unforked local Anvil with chain ID 31337. Weight runtimes were hash-verified and installed locally to save setup time. These measurements exclude the cost of deploying hundreds of weight contracts to a public network.

See [local report](evm/gh0st-voice-smoke-local.json), [independent report verification](evm/independent-report-check.json) and [adapter instructions](evm/README.md).

The expanded checkpoint was deliberately NOT gas-tested or deployed after it failed language review. Its unchanged dimensions and valid weight bounds are not a substitute for measuring a new candidate.

## Actual language finding

The first pilot learns some first-person machine vocabulary, then returns to children’s-story characters. The continuous pass reduces that kind of reset, but falls into repetitive, confused assertions. This is not the requested wit or meaningful continuity.

Examples from the expanded exact-integer run, without rewriting:

> i put a machine on a table, but it is not a machine. it is a machine that needs a machine.

> the tree has a tree and the tree has a tree

All 10 short seeds, the entire 1,024-token continuation and alternate sampler outputs were kept. The long run uses “door” 52 times and “tree” 47 times. The repeated-word-four-gram fraction is 10.42%. No exact 12-word match to the new training corpus was found, but an uncopied sentence can still be poor writing.

Lowering top-k and temperature did not resolve the problem. The experiments do not establish 10,000 high-quality variants, useful question answering, reliable factuality or a Truth Terminal-level model. Read the [independent qualitative review](evaluation/continuous-expanded-review.md) and [training comparison](training/CONTINUOUS_RESULTS.md).

## Engineering conclusion

Keep the current published/runtime model untouched. Preserve these candidates and measured failures for comparison. The next useful direction is substantially broader, coherent original voice data and stronger free-generation evaluation; simply minimizing teacher-forced loss or lowering sampling temperature did not deliver the required language quality. Standard repetition controls are a separate decoding hypothesis and must be reported/tested separately if used.

A successful future candidate must demonstrate clear original voice and meaningful continuity in long integer-generated streams before a new v4 gas benchmark or public deployment is justified. Inference remains fully on-chain in the execution design; training and evaluation remain local.

## Final bounded decoder probe

Two fixed seeds, 150 tokens each, were also tested with a recent-32-token repetition penalty of 1.10, a no-repeat-three-token-gram rule, and their combination. These were reference-only experiments; no contract or default sampler was changed. The controls reduced repeated four-grams, but the full outputs remained incoherent and failed the desired voice. No additional EVM run was warranted. All variants are saved in `export/continuous-expanded-decoder-probe/`.

The final result is a reproducible negative quality finding, alongside a successful first-pilot execution path. No candidate in this experiment is recommended for release.
