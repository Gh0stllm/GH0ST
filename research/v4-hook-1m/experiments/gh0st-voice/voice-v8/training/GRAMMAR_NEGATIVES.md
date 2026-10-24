# Training-only contrastive grammar labels

**Training integration uses only three prefix-invalid rule families:**
`first_person_auxiliary`, `plural_auxiliary`, and `modal_base_verb`.
`build_grammar_pairs.py` excludes article and perfect-participle cases because
their original selection uses future words, which a causal next-token model
cannot see. The full five-rule audit below is retained as historical label
research, not as the training sidecar. Corpus rejects an unfiltered sidecar.

`grammar_negatives.py` implements `negatives(words, punct, index)`, returning
unique `(gold_token_position, bad_word_id)` pairs. Supply gold words as strings
or vocabulary IDs, punctuation suffixes with0 meaning none, and a lowercase
word-to-ID dictionary. Unknown words/IDs and unavailable negative words are
skipped. Positions refer to the supplied sequence; the trainer must align them
explicitly with shifted next-word targets.

These are labels for a neural ranking loss during training. The module does
not mask candidates, enforce a grammar, substitute words, or choose a phrase
at inference. It does not consume model-generated text or held-out prompts.

The rules are deliberately narrow:

- After gold `I am/have/was`, penalize `is/has`. After gold `we/they are/have`,
  penalize `is/has`. There is no `I were` rule: that form can be correct in a
  counterfactual.
- After a pronoun and modal, with an optional adjacent `not`, a gold base verb
  permits negatives from its explicitly listed third-person, past, and `ing`
  forms. Homographic forms equal to the gold word are excluded. No arbitrary
  morphology is guessed.
- A perfect construction requires an adjacent pronoun and `have/has/had`, a
  known gold participle, and a following determiner/object pronoun, or the
  unambiguous participle `been`. This skips nominal/adjectival ambiguities such
  as `I had opened doors`, where replacing `opened` with `open` could still be
  grammatical. Only distinct base/third-person negatives are returned.
- The article rule uses the next gold word to identify a clearly correct `a`
  or `an`, then penalizes the opposite article at the article position. Explicit
  sound exceptions cover words such as `hour`, `honest`, `user`, and `university`.
  Short strings, nonwords, common acronyms, dialect-sensitive examples, and
  already incorrect gold articles are skipped.

All required local word boundaries must be free of punctuation. Five regression
tests cover ordinary examples, boundary rejection, conservative ambiguous cases,
correct article exceptions, subject agreement, input IDs, and unknown handling.

The first count used only the existing V7 encoded training split:23,657 documents,
2,995,087 word positions. It produced127,625 negative labels:99,633 article,
15,344 modal,7,164 first-person auxiliary,2,764 perfect-participle, and2,720 plural
auxiliary labels. Counts and source hashes are in
`grammar-negative-audit-v1/counts.json`.

`grammar-negative-audit-v1/examples-100.json` contains a deterministic stratified
sample of100 negative cases (20 per rule). Each was read and the proposed word
substitution checked. No false positive was observed in this sample; this is
author review, not independent human annotation or proof of the entire corpus.
The complete recorded judgments, number of distinct contexts, sample hash, and
limitations are in `false-positive-review.json`. Historical content itself was
not fact-checked by this grammar review.

Run the unit checks with `python3 test_grammar_negatives.py`. To reproduce counts
into a new folder, run:

```sh
python3 grammar_negatives.py \
  --train ../../voice-v7/training/encoded-curriculum/train.jsonl \
  --vocabulary ../../voice-v7/training/encoded-curriculum/vocabulary.json \
  --out NEW_AUDIT_DIRECTORY
```
