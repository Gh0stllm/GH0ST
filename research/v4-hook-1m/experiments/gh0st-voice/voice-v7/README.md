# V7: learned punctuation and continuous recurrent state

**This is a failed language-quality experiment, preserved for reproducibility.**

The two-layer H128 model has 2,364,805 source parameters. It predicts one bare
word and a learned punctuation suffix at every step, keeps both recurrent states
across chunks and swaps, and has no runtime grammar engine. Independent tests
verified the training loss, chunk/state handling and Q10 arithmetic. Random
fixture swaps fit below 32M gas, but trained prose remained grammatically broken.

The initial model received 2,003,831 known-word presentations. The subsequent
curriculum phase reached 14,055,178 known-word presentations before stopping.
Those counts are training presentations, not unique corpus words. Later
checkpoints increasingly overfit the synthetic training families while held-out
loss deteriorated. Longer training was therefore stopped rather than described
as improved language quality.

The new curriculum contains 28,000 generated episodes and approximately three
million words from 40 authored causal families. Its 320 paired-stage patterns
produce 640 sentence constructions. Training, validation and test families are
separate; held-out object/context combinations are also supplied. This is
synthetic compositional material, not three million independently authored words.

The active vocabulary was fitted only on the combined training sources. It
contains 8,192 bare words; unknown words remain input positions and still receive
punctuation supervision. V7's final quality screens, raw generations, diagnostic
measurements and unsuccessful decoder comparisons are retained in `evaluation`.

V8 follows this experiment with a larger neural model and an exact packed EVM
kernel. V7 itself is not approved for deployment. All new work here was local;
no mainnet changes were made.
