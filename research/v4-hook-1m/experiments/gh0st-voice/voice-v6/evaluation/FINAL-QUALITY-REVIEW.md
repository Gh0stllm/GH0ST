# V6 independent language-quality review

The selected research checkpoint is **not quality approved**. The larger adult corpus and GPU training changed the vocabulary and subject matter, but did not produce dependable grammar, a coherent paragraph, or meaningful topic retention.

The experimental keeper is `training/runs/style-expanded-4m/checkpoint-001006452` (SHA256 `703be567704c8c899c3fe4d7cb5e3ab206c8f6ed83dde65dfd4208e4adbeec76`). It has the lowest full native-document macro validation NLL, **5.055411**, among the compared foundation and style checkpoints. The later 4M mixed adaptation and 2M voice-only branch still fail. No final test information was used to select it.

## Frozen language test

All **24 generated FP32 streams fail** the predeclared grammar/continuity/voice/repetition gate. The remaining 2 cases use the same unsupported `phone` prefix and were explicitly skipped. Every stream was read; individual scores and passages are in [human-review.json](selected-final-gate/human-review.json), with complete unedited [text](selected-final-gate/raw-outputs.txt).

The three representable counterfactual pairs produce different hidden states and words, but **0/3 preserves the changed fact meaningfully**. Coin ownership/housing, clock repair state and message delivery are abandoned. Different output is not evidence of semantic retention. See [retention review](selected-retention-gate/human-review.json).

Final selected-checkpoint test NLL uses every complete heldout document, one BOS per document, no random crops, fixed nominal features, and retained unknown input positions:

| Domain | Documents | Known targets | NLL |
|---|---:|---:|---:|
| Original voice |84|3,730|4.895920|
| Adult prose |239|66,506|5.275385|

Macro NLL is **5.085652**. Another 7,366 unknown targets are masked, with their input context retained. This likelihood measurement is not a quality pass.

## Exact-Q10 long streams and copying

The independent Q10 reference generated 32 seeds ×256 words and 2 seeds ×1,024 words, **10,240 words** total. No resets or forced punctuation occurred. Arithmetic/state checks pass separately, but all seven manually reviewed representative streams fail language quality. Both complete 1,024-word streams were read; repeated room/machine/thing imagery does not develop into a stable narrative. The short review sample is seeds 0, 7, 15, 23, 31, fixed independently of text quality. See [stress review](selected-q10-stress-human-review.json).

All 34 Q10 streams were compared with every expanded-training document using the exact final normalizer. Longest exact overlap was **7 words**, with no identical complete streams. No exact complete-training-paragraph match was found in these samples. This does not prove semantic originality or absence of memorization. Common syntax can match without copying. Reports: [short](selected-q10-short-32x256-novelty.json), [long](selected-q10-long-2x1024-novelty.json).

## Data and implementation boundary

The training expansion added 120 original monologues and 11,915 normalized words. 1,322 words (11.09%) were outside the fixed vocabulary. Every original row, token position, validation/test file and vocabulary byte is preserved; new groups do not overlap holdouts. See [encoding audit](expansion-encoding-audit.json). The model is still a 4.0M-parameter recurrent model, with a 128×64 adaptive word head. This review does not approve it for release or mainnet. Gas feasibility is a separate result.

Complete unedited Q10 source streams are [short](../exports/style-selected-1m/stress-t512/short-32x256.json) and [long](../exports/style-selected-1m/stress-t512/long-2x1024.json). Their hashes and the other artifact hashes are in [FINAL-QUALITY-REVIEW.json](FINAL-QUALITY-REVIEW.json). No training, mainnet or GitHub mutation was performed by this review.
