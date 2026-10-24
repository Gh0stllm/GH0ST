# Bounded short-context tone ablation

**Outcome: insufficient prose quality from both starting checkpoints.** The models adopted some first-person machine/market vocabulary, but the unedited continuations still drifted into circular statements and malformed words. The desired coherent comic monologues did not emerge reliably. No checkpoint from this experiment is approved for release or on-chain replacement.

The comparison completed two 200-step runs in about 19 seconds of recorded training/evaluation time. Both used the same deterministic batches, 177,360 supervised tokens, fresh AdamW at 1e-5, weight decay 0.01 and gradient clipping at 1. Architecture, tokenizer and 64-token attention were unchanged. No optimizer state was resumed.

| Starting weights | Baseline validation | Best saved validation | Final validation | Best saved step |
|---|---:|---:|---:|---:|
| Original pretrained SimpleStories V2 | 5.1060 | 4.3584 | 4.3584 | 200 |
| Corrected teacher4M | 4.0896 | 3.9671 | 4.0273 | 100 |

Teacher4M reached its lowest measured loss at step75 (3.9619), between checkpoint saves. The best saved checkpoint was step100. Its subsequent deterioration is evidence that this small-data finish can overfit quickly.

## Data and controls

The 100 new authored monologues contain 37–63 tokenizer tokens apiece. A deterministic hash of each stable ID assigned 80 to training and 20 to validation. The 80 training rows contain only3,856 tokens; the 20 held-out rows contain940. Existing authored data was kept in its original train/validation splits (345/44 rows). No held-out row was moved into training, and no exact12-token span overlapped the combined training and validation data.

Training sampled70% sharp and30% existing authored windows. Half began with a quote and a complete monologue that fits within64 tokens; half began inside the continuous text with16 context-only tokens. Document boundaries were joined without an added EOS or reset. Both runs saw123,426 sharp targets and53,934 existing targets: roughly32 sharp-corpus token exposures. Repeated exposures are not additional unique authored content.

Each saved snapshot includes two full512-token no-reset continuations and eight neutral short-prefix samples of48 generated tokens. Neither evaluation stops at a punctuation mark or model-produced EOS. Prefixes were not used as training examples or checkpoint-selection targets.

## Manual review

Both selected checkpoints failed the intended style criterion: a readable first-person comic monologue with coherent progression. All four512-token streams and all16 short-prefix outputs were reviewed. Examples of the unresolved problems include “the machine asked for the machine and the machine,” “the machine is doing a machine that has a machine,” and newly formed malformed words. A few grammatical opening clauses do not make the full continuation coherent.

The selected long streams had no matching12-token spans from this experiment's supplied training text. This is a limited copy check, not proof of novelty against pretraining or proof of quality. Automatic loop guards passed despite the semantic loops; those guards are therefore insufficient as a release gate. All saved Q12 range audits passed. This small pilot did not log how many individual values were clamped during each optimization step.

Selected weight SHA256:

- Original-base step200: `5c343333979a032a9dea11aa7fe026e63d6cc9d59672d069d066e8754668ac14`
- Teacher-base step100: `3ec16f58bebf29e2a7dafdc3623e009e9fc7fa905931677175cf24c82bfa24fb`

`ablation-200/data-manifest.json` records exact split IDs and source hashes. `summary.json`, the per-start reports, `manual-review.json`, raw probes and `short-prompts.json` retain the evidence. No EVM transaction, gas benchmark or mainnet operation was run for these tone checkpoints.
