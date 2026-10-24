# Continuous-corpus training results

The first pilot appended EOS to every short document. That taught endings that did not match the runtime, which carries the emitted EOS into the next swap. The second pass removes these artificial document endings: it starts each split with one quote and trains on joined text with sliding64 attention. No frozen or on-chain artifact was changed.

## Original-corpus selection sweep

All runs began from the same pretrained checkpoint and used the same fixed original corpus split. Selection used validation loss only.

| Updated parameters | Learning rate | Best step | Validation loss |
| --- | ---: | ---: | ---: |
| all | 1e-05 | 100 | 4.377960 |
| all | 3e-05 | 50 | 4.383842 |
| all | 0.0001 | 25 | 4.428855 |
| top2 | 1e-05 | 175 | 4.392325 |
| top2 | 3e-05 | 75 | 4.384407 |
| top2 | 0.0001 | 25 | 4.409561 |

The baseline continuous validation loss was 4.914206. All-parameter training at 0.00001 won this single split by a small margin. These close results do not establish a statistically robust ranking. All runs stayed within Q12 signed12/signed16 export bounds without any parameter projection. In every top2 run, the19 frozen tensors were verified bit-identical to the base checkpoint.

## Expanded-corpus trial

The selected mode/rate was applied once to the expanded original corpus, again starting from the pretrained base. The run requested800 steps, selected step150 and early-stopped at300. Expanded validation loss improved from4.722887 to4.125254. No weights required projection.

Selected checkpoint: `runs/continuous-expanded-v2-all-lr1e-5/checkpoint-best`. Safetensors SHA256: `c2fa212ca1f75dc8225350fc0a94d1411ca4c2b4a3fa57bcaaa9ac54cbd0e222`.

The original pilot default preprocessing is unchanged, verified at token/label level. Its exact source is preserved in `train_voice_pilot_v1.py`. New flags are `--continuous-corpus` and `--trainable-mode all|top2`.

## Held-out FP32 observations

The expanded selected checkpoint was evaluated only after selection on36 prompts with four seeds each. Baseline versus selected results:

| Measurement | Baseline | Expanded continuous |
| --- | ---: | ---: |
| Unique outputs | 144 | 144 |
| EOS before64-token cap | 24 | 1 |
| Unknown tokens | 0 | 0 |
| Outputs with a4-gram repeated3times | 1 | 2 |
| Test loss | 4.600973 | 4.014716 |

Fewer EOS outputs suit continuing state, but do not establish language quality. Several outputs still contain generic prose, repetition or bad grammar. The model is not a dependable question-answering assistant. These are FP32 observations; exact relative-key Q12 export, long-stream quality and local v4 gas require separate reports.
