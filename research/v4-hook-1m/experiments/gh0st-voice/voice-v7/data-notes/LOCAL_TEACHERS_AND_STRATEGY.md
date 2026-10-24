# Local teachers and V7 strategy

This is a read-only review of research artifacts already present locally. No
weights were downloaded and no teacher sampling or training was launched for
this review. The V7 evaluation directory was not inspected.

## Usable local teacher

`experiments/gpt2/model-cache/model.safetensors` is the only substantial
pretrained language model found in the explicit local model caches reviewed.
Its recorded upstream source is `openai-community/gpt2`, revision
`607a30d783dfa663caf39e06633721c8d4cfcd7e`, with MIT licensing recorded in
`experiments/gpt2/checkpoint-source.json`. The recorded checkpoint SHA-256 is
`248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707`.

The model has 124,439,808 learned parameters: 12 transformer layers, width768,
12 attention heads, inner width3072, a 50,257-piece BPE vocabulary, and a
1,024-position context. The safetensors file also stores 12,582,912 causal-mask
buffer entries; counting all stored values as parameters would incorrectly
report 137,022,720. The inventory records these separately. A representative
layer has QKV weight `[768,2304]`, attention output `[768,768]`, and feedforward
weights `[768,3072]` and `[3072,768]`. Token and position embeddings are
`[50257,768]` and `[1024,768]`.

The existing `experiments/gpt2/reference-report.json` contains four local
32-token continuations. They are more grammatical than the failed tiny-model
free runs, but they include unsupported market statements and an invented
GH0ST pricing claim. This is a base completion model, not a reliable instruction
teacher or fact source. Its old short samples do not establish that it can
produce the desired voice or a coherent long episode.

GPT-2 could be screened later as an **offline sequence teacher**. It should not
be inserted into the on-chain path or represented as meeting the swap budget.

## Other local pretrained caches

| Model | Learned parameters | Core shape | Practical teacher limitation |
|---|---:|---|---|
| SimpleStoriesV2 | 1,235,968 | Four layers, width128, inner341, 4 query/2 KV heads, 4,019-piece vocabulary | Story-language prior; previous adult-voice adaptation failed |
| Atto | 1,574,016 | Four layers, width128, inner512, 4 attention heads, 4,096 vocabulary | Existing local question tests were poor |
| TinyQwen3 | 1,836,544 | Two layers, width256, inner768, 4 query/2 KV heads, 1,024 vocabulary | Experimental base model with a small vocabulary and short configured context |
| StoryTOM | 1,515,904 | Five layers, width128, four heads, inner512, 4,096 vocabulary | Some story grammar; local role/object continuity weaknesses |
| Cinnabar | 1,508,480 | Four layers, width128, inner128, untied 4,096 vocabulary | Existing local answer samples were fragmentary/repetitive |

The remaining reviewed caches range from656,000 to985,728 parameters. Several
paths contain the same853,120-parameter story model. A second folder is not a
second independent teacher. Full paths, configurations, and all tensor shapes
are in `local-model-inventory.json`; these values were read from local artifacts.

## Why changing only the corpus size was insufficient

The V6 review identified three interacting limitations rather than a failure of
gas optimization:

1. Joining a lexical word and its terminal punctuation in one output ID wasted
   scarce vocabulary slots. The independent V6 review found roughly46% of adult
   terminal-word targets were masked, despite a much smaller overall OOV rate.
2. Most original voice paragraphs ended within about105 words, while runtime
   generation continued for hundreds of words. Random training windows with
   zeroed recurrent state did not reproduce sustained state across a long event.
3. Historical adult prose supplies syntax but also human characters, long
   clauses, and a different voice. More of that material does not automatically
   produce a stable first-person machine narrator.

These observations support V7's selected two-layerGRU128 with a bare lexical
vocabulary and a learned five-way punctuation head. Predicting punctuation
with the network is still neural generation. A decoder that forces grammatical
words or chooses ready-made sentences would be a separate hybrid mechanism and
must not be substituted silently.

## Recommended controlled experiment

Use independent original prose and broad grammar as the baseline. Add the
separately labeled typed curriculum at a measured mixture weight. Its complete
four-stage episodes provide explicit local causes and consequences, with
continuous recurrent state during training. Do not switch semantic objects
halfway through a training sequence. Report both lexical and punctuation loss,
per-source loss, OOV target masking, and recurrent saturation.

The curriculum is authored offline and expanded before training; inference
must use only the learned network and the agreed sampler. Its family-held-out
and object/context-held-out splits measure different things and should remain
separate. Repeated training patterns are not evidence of novel generalization.

If that comparison still lacks grammar, a later GPT-2 sequence-distillation
trial is more defensible than recycling the weakest tiny generators. Use
explicitly framed first-person episodes, retain whole connected paragraphs,
and review complete samples for contradiction, narrator changes, unsupported
facts, and quotation overlap before adding them. Do not treat GPT-2's invented
claims as training facts. Direct logit distillation is not plug-and-play: its
BPE pieces do not align with the student's words and punctuation, so it would
need an explicit word-level probability mapping. Sequence distillation avoids
claiming such an alignment.

No teacher corpus has been generated under this proposal. No result here is a
language-quality or gas pass.
