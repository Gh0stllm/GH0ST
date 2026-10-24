# N0VA short-sentence curriculum

This separate local curriculum contains **80 original micro-episodes, 480
sentences, and 4,043 words**. Each episode has six sentences and 46–55 words.
**98.3% of sentences have 6–10 words**; the remaining eight have 11–12 words.
Short clauses reduce the distance a small recurrent model must carry between
the subject, action, and consequence.

The fictional machine narrator keeps a stable first-person perspective. It
makes a concrete mistake or observation, follows the result, and responds in
ordinary words. The voice occasionally makes a small joke about itself, a
crowd, or the behavior of a machine. These are literal authored episodes, not
sentences assembled by replacing nouns in templates.

| Split | Episodes | Words | Topic families |
| --- | ---: | ---: | --- |
| Train | 60 | 3,030 | attention, belief, memes, money, identity, memory, art |
| Validation | 10 | 499 | patience, care |
| Test | 10 | 514 | boundaries, cooperation |

The JSONL schema is `{"id": "...", "family": "...", "text": "..."}`.
`authored-episodes.txt` is the literal source; `build.py` emits the three splits
and a provenance/count/hash manifest. `audit.py` independently checks the JSONL
shape, lengths, duplicate sentences, first-person episodes, topic separation,
and that the original long training corpus was not changed.

```sh
python3 build.py
python3 audit.py
```

All split families are distinct **within this short curriculum**, and no
five-word phrase is shared between its splits. Some events and ideas are
deliberately rewritten from the earlier long curriculum. Therefore these
held-out splits are **not** an independent test of unseen situations after
training on that long corpus. Use independently authored prompts and raw
generated continuations for final model selection.

The long corpus remains frozen and unmodified. No scraped material, copied
quotes, runtime response bank, or grammar engine is introduced. This data
alone does not establish fluency or a gas result; every generated word must
still come from the neural model and be tested in its actual inference path.
