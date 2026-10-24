# Optional training-only repetition ablation

This is an isolated copy of the four-source local trainer. It changes the **training objective**, not the model architecture, stored parameter count, inference code, or decoder. No training run is started by preparing these files.

`--unlikelihood-alpha 0` is the default and uses cross-entropy alone. To test the proposed ablation, pass `--unlikelihood-alpha 0.2`. Keep the initial checkpoint, data cache, seeds, and other settings equal to the CE-only comparison. Use a new output directory for each run.

## Objective

For each supervised next-token position, examine the latest 32 observed input tokens, including the current input token and excluding future tokens. A negative candidate must:

1. occur at least twice in that window;
2. be a content word rather than a reserved ID or an explicitly listed function word;
3. differ from the correct next training token.

Each distinct eligible word contributes once at that position:

`UL = -log(1 - P(candidate))`

The batch objective is `(CE_sum + alpha * UL_sum) / supervised_target_count`. Candidates are found by sorting the small context window; the implementation does not create a full batch/position/vocabulary candidate mask or a pairwise window-comparison tensor. It gathers only candidate logits and one normalization scalar per prediction position.

The reserved first 32 IDs and the explicit `FUNCTION_WORDS` list in `unlikelihood.py` are exempt. Short content words such as `box` are not exempt merely because they are short. Alpha greater than zero requires a WordLevel tokenizer so a repeated token corresponds to a whole word. The helper clamps probabilities below one for finite logarithms.

## Validation, saving, and logs

Validation remains the unchanged plain cross-entropy calculation in `common.py`. Unlikelihood is not included in validation loss or perplexity. Every new plain-CE validation minimum is saved immediately, as well as requested periodic/final snapshots. Candidate selection still requires the existing numerical/basic generation guards and subsequent language review.

Training logs report CE, unlikelihood, weighted unlikelihood, combined loss, eligible negative counts, positions containing negatives, gradient norm, and parameter projection counts for the current step. Reports and snapshot metadata include cumulative components and projection counts. Quantization bounds and the original parameter projection remain in place.

## Entry point

Use `train_teacher.py` with the prepared grammar cache and its matching initial checkpoint. The common module's `RESEARCH` path is corrected for this deeper folder. For example, add these flags to the otherwise identical local comparison command:

```sh
--checkpoint experiments/gh0st-voice/large-v3/recovery-v5/prepared-grammar/initial-wordlevel \
--unlikelihood-alpha 0.2 --unlikelihood-window 32
```

The cache and output paths remain required arguments. This folder contains no chain calls, wallet access, or public RPC path.

## Checks and limitations

Run `test_unlikelihood.py` with the local Python environment. Checks cover the gold-token exclusion, function/reserved-word exemptions, two-occurrence threshold, duplicate collapse, no-eligible zero loss, ignored labels, causal/window boundaries, scalar candidate parity, finite gradients, unchanged CE behavior at alpha zero, and plain-CE validation.

This loss may reduce repetition; it does not establish good grammar, factuality, original thought, or improved long-run meaning. Repetition can also be correct, which is why the actual gold next token is never penalized. Report full generations from the ablation and CE-only runs before deciding whether this objective helps.
