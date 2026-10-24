# V7 diagnosis and acceptance plan

V6's failure is not a reason to repeat a longer run of the same training objective. Its selected model can prefer the grammatical member of a short minimal pair, while still generating incoherent paragraphs. V7 should change the supervised representation and state protocol, then earn a new quality and gas result.

## Confirmed observations

- **Punctuation supervision is disproportionately lost.** V6 attaches punctuation to each word ID. The 8,192-entry vocabulary contains only 7,164 distinct stems, with 1,028 duplicate stem slots. Of 7,130 bare-word entries, 6,147 have no period-attached variant. In training, 45.80% of adult prose sentence-terminal positions are unknown and masked, versus 6.61% of nonterminal positions. In target voice, 28.19% of terminal positions are masked, versus 3.23% of nonterminals. The first 64-word group has no terminal entry. These counts come from the actual frozen encoded data, not an estimate.
- **Training and runtime see different histories.** Every original-voice document is at most 105 words. In measured 50%-voice training batches, state resets every 74.35 positions on average; the median uninterrupted segment is 69. Every batch stops or resets at 128 positions. Runtime preserves state across 1,024+ words. Missing EOS is not inherently wrong: continuous LMs can work. The mismatch is that the model is taught fresh-state paragraphs and then asked to continue indefinitely through their boundaries.
- **Local grammar knowledge does not imply safe generation.** The selected V6 model prefers 15/16 grammatical minimal pairs at its native probability distribution, but 13/16 at temperature 0.5 applied independently to both hierarchical stages. Its generated prose still fails. One native failure is plural `two old chairs` versus `two old chair`.
- **The hierarchy is a probability factorization, not a full-word temperature control.** With P(g,w)=P(g)P(w|g), global temperature requires the group correction Z_g(T)=sum_w P(w|g)^(1/T). Applying T independently to the two softmaxes omits that group correction. This is a calibration issue, not proof that the learned distribution is otherwise adequate.
- **Correcting that alone did not solve it.** Eight fixed 128-word streams compared the old hierarchical decoder, exact full-vocabulary joint sampling at T1/T0.5, and top-two-group joint sampling at T0.5. All eight fail grammar/coherence. Top-two-group sampling retains only38.6% mean untempered probability mass and produces more `small thing` loops. Its candidate restriction must not be called exact global decoding.
- **Integer or hook bugs do not explain the observed language failure.** Prior V6 verification compared every hidden value and evaluated logit on 260 real local swaps and passed, while both FP32 and Q10 prose failed. The observed maximum was 27,901,073 whole-swap gas. This is an execution result, not a language-quality result.

The measurements above identify plausible causes and invariants. They do not prove that punctuation, state carry or depth individually causes the full failure; the next experiment needs controlled comparisons.

## Recommended neural experiment

Use bare-word IDs and predict a five-way punctuation suffix separately, conditioned on the current hidden state and the selected word. Emit the word plus its suffix together on every swap. Feed the previous suffix back as a small embedding, preserving learned boundary information without a silent EOS step or automatic reset. Supervise punctuation even when a word target is unknown. Train state-carry windows from genuine continuous stories, keeping both hidden layers across adjacent windows and detaching only the gradient. Reset only at an explicit training-story boundary. Do not join random unrelated monologues and claim continuous narrative training.

A two-layer GRU128 is a testable alternate representation, not a promised cure. With the first input projection precomputed, its recurrent matrices require 147,456 MACs per word. A 128+64 word head adds24,576, first-layer six features add 2,304, and five punctuation logits add 640: **174,976 MACs** before minor boundary inputs. V6 performs 197,568 in its comparable main kernels. V7 has more nonlinear gates (768 vs 672), two sequential layers and 256 stored hidden values, so lower MAC count does not prove lower gas. Measure the complete swap under 32M before claiming feasibility.

A pretrained tiny transformer remains a useful language baseline, but the existing 1.24M SimpleStories relative-window port already costs up to 28,423,709 gas for one subword token. Multiple subwords may be needed for one visible word; one token can be punctuation or an internal fragment. Its children's-story pretraining also does not supply the requested adult persona. A new transformer is more implementation and training work without a demonstrated per-word advantage.

The user has explicitly rejected a hybrid. The following assessed option is therefore excluded from V7 implementation: a typed grammar plus neural lexical/planning choices could guarantee some local syntax and explicit entity state under a bounded runtime. It would be a hybrid system with an authored grammar and limited realizable meanings, not an unconstrained model that learned all language. Grammar alone cannot guarantee an interesting or truthful thought. Keep it separate from the neural-only test and label it honestly if pursued.

## Quality gate

[v7-gates.json](v7-gates.json) is frozen before V7 training (SHA256 7cf6d14014f0ddefae8d08fa39c1022d73a4e288e18ad8cc5cc9aaab97414b1b). It contains 16 development minimal pairs and eight new human-authored first-person continuation prompts excluded from training. Final evaluation requires 32 seeds ×256 words, two uninterrupted 1,024-word streams, all new prompts with two seeds, and matched-seed fact-change controls. Every unsupported prefix must be reported; no test-driven vocabulary changes or silent word substitution.

The release criterion is mostly fluent, coherent adult first-person prose, not low validation loss or a large count of distinct strings. Human review must score grammar, continuity, voice and repetition, keep every failure, and distinguish exact training overlap from semantic novelty. Exact integer-reference parity and whole-swap gas are separate mandatory gates. No successful swap may hide a planning-only step or insert a stored finished phrase.

Small learned language models can produce coherent text in a narrow domain, as demonstrated by [TinyStories](https://arxiv.org/abs/2305.07759). That result does not establish that our2–4M recurrent model can produce reliable adult long-form prose. [Word-level recurrent language modeling](https://arxiv.org/abs/1708.02182) and [adaptive softmax](https://arxiv.org/abs/1609.04309) support the general approach, but neither supplies a quality guarantee at our gas budget.

## Evidence

- [Measured vocabulary, masking and reset counts](v6-diagnostic-measurements.json)
- [All minimal-pair probabilities](baseline-v6-grammar.json)
- [All decoder comparison text](v6-joint-decoder-screen/raw-outputs.txt)
- [Decoder comparison human review](v6-joint-decoder-screen/human-review.json)
- [Previous complete quality review](../../voice-v6/evaluation/FINAL-QUALITY-REVIEW.md)

All work is local, with frozen V6 artifacts unchanged. No V7 training or transaction was performed by this evaluation lane.
