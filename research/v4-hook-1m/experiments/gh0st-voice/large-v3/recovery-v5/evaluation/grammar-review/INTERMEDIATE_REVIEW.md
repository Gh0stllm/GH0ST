# Grammar replay: intermediate independent review

This review covers completed CE and unlikelihood checkpoints at steps500 and1,000. The parent training runs continued; these findings are not a final comparison of all later weights. No training checkpoint or model configuration was modified.

## Data audit

The prepared corpus passed independent checks for nonempty source groups, zero cross-split source-group leaks and zero exact normalized text duplicates. Replay retained91.75% of training source stories,91.14% of validation stories and91.73% of test stories. It produced61,530 training chunks and2,131,579 training tokens.

New original voice coverage was190/190 training documents but only18/30 validation and18/30 test documents. The retained style evaluation is therefore vocabulary-filtered. Counts of derived chunks must not be presented as counts of independent source stories. Details are in `preparation-audit.json`.

Replay comes from the upstream dataset's training split, which may already have been seen by the pretrained model. Its local held-out split is separated from this new training stage; it is not a claim of unseen-pretraining generalization.

## Blind output review

The prompt file and rubric were fixed before reviewing generated text. The eight causal/voice prefixes contain no unknown tokens and have no exact full-prefix match in the prepared training text. For each model, the review read two full256-token quote-conditioned streams and eight48-token continuations, without stopping at EOS. At step1,000 it also read two128-token single-token `i` streams both with and without the specified repetition controls.

**No confident CE/UL quality winner emerged at either checkpoint.** At step1,000 both models produced locally grammatical passages mixed with malformed clauses, drifting references and repeated narrative themes. The ice prompt plausibly continued with the ice being gone, but glass, cold-air and rain prompts did not establish the expected causal response. Grades were saved before reading the label mapping.

Single-token `i` conditioning reliably gives a first-person start, but does not repair grammar or logical continuity. The optional top-k16/temperature0.7/content penalty1.15/recent-word cap2 controls did not resolve the problem. The original pretrained WordPiece model is more grammatical under the same `i` control but treats it as dialogue and returns to third-person children's stories; it does not supply the requested voice by itself.

## Per-source validation

Fixed64 validation windows per source used64-token blocks,16-token context warmup and40% quote starts. Lower cross-entropy is better. CE/UL differences were approximately1e-4, so rounded rows are the same here.

| Checkpoint | Authored | Composition | Public-domain | Licensed teacher/replay |
|---|---:|---:|---:|---:|
| Remapped initial | 5.4384 | 6.6687 | 6.1048 | 2.9924 |
| CE500 | 4.3149 | 4.8412 | 5.2065 | 2.9012 |
| CE1,000 | 4.5761 | 4.9302 | 5.2427 | 2.9024 |
| UL500 | 4.3149 | 4.8414 | 5.2064 | 2.9012 |
| UL1,000 | 4.5760 | 4.9304 | 5.2426 | 2.9024 |

The aggregate rise after500 is not masking clear improvement in another source: all four strata were flat or worse at1,000. This provides no independent justification for more identical-objective training from loss alone. Full quality and exact on-chain tests remain separate requirements.

All raw outputs, fixed prompts, overlap checks, mappings, rubric, blind reviews and per-source results are preserved in this folder. No phrase bank, output rewriting, mainnet operation or gas claim was used.
