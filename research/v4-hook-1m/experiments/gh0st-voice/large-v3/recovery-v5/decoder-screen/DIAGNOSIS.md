# Decoder recovery screen

No setting reliably recovered coherent, varied first-person comic paragraphs from the fine-tuned checkpoints. This is a failed decoder-only recovery attempt. All64 unedited128-token outputs are in `all-outputs.txt`; token IDs, settings, weight hashes and controls are in `results.json`.

Four checkpoints were tested with two seeds and eight decoding settings: greedy, top-k8/temperature0.8, k8/0.5, k32/0.7, and variants with a recent content-token penalty, token3-gram blocking or a recent complete-word limit. Every stream began with the existing quote token3. The64-token attention window was preserved, and generation did not stop or reset at EOS. No training, phrase bank, external inference or chain action was used.

## What changed

- Pretrained greedy prose remained substantially grammatical within its children's-story domain. Its two outputs were identical because greedy decoding ignores the random seed.
- Fine-tuned greedy decoding was trapped in loops: repeated4-gram fractions were41.6% for teacher4M,64.8% for tone-teacher and49.6% for tone-original. Lowering the sampling temperature made those learned loops more likely.
- Penalties and n-gram blocking mostly removed repeated4-grams, but did not recover dependable syntax, meaning or comic progression. A low repetition count is not a quality certificate.
- The most promising **exploratory**, unapproved setting was teacher4M with top-k16, temperature0.7, content-token penalty1.15 and a limit of two occurrences of a recent complete content word. Seed42 was more readable; seed0 still began with malformed language. It is not a release candidate.

The word control only limits complete alphabetic vocabulary entries and exempts function words. WordPiece continuations can still create unseen words. The token penalty covers the last64 generated tokens; the word limit covers the last32 reconstructed words. These Python experiments do not prove their implementation or gas cost on the EVM.

## Diagnosis: evidence versus inference

**Measured:** the grammar loss is already present in FP32 on the same local implementation. Q12 rounding is therefore not required to cause it, although numerical equivalence still needs its own tests. The pretrained checkpoint remains more grammatical under the same screen, while the fine-tuned checkpoints fail even under greedy decoding. This points to learned distributions as well as sampling, rather than sampling alone.

**Measured:** the fixed4,019-token WordPiece vocabulary fragments the adult teacher data more heavily than the original-style authored data. Teacher text uses1.82 tokens per lexical word including punctuation, versus1.36 for authored text. Continuation pieces occupy31.1% of teacher tokens versus17.8% of authored tokens. Consequently, a64-token attention window contains roughly35 teacher words, not64. ZeroUNK does not imply low fragmentation or reliable whole-word generation. Exact counts are in `tokenizer-fertility.json`.

**Measured:** prior training reports show substantial repeated exposure to a small authored core and to compositional sentence patterns. The initial8M run's validation degraded well after its early best checkpoint. The short tone finish exposed3,856 sharp training tokens roughly32 times by200 steps and also began overfitting. Dominant content tokens include room/machine/person; see `corpus-anchors.json`. Those token counts are descriptive, not a causal proof.

**Likely contributors, not isolated causal findings:** full fine-tuning changes the tied embedding/output matrix and the entire small transformer; narrow style gradients can overwrite previously useful grammar. Randomly adjoining unrelated paragraphs without a reset teaches abrupt transitions rather than one sustained story. Ordinary next-token loss on supplied text does not directly penalize semantic loops in the model's own generated history. Removing artificial EOS boundaries solves a runtime mismatch but does not itself teach stable endless narration.

Changing only the decoder is therefore insufficient here. A follow-up should preserve or relearn a sound lexical representation, use coherent multi-sentence trajectories, and evaluate the model's own long continuations during selection. Grammar-preserving replay or separate embedding/body learning rates are reasonable ablations, not proven fixes. The next vocabulary experiment should report held-out coverage and preserve source-group split boundaries.
