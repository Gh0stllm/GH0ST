# Foundation 8M: early local quality screen

**Not a language-quality pass. No EVM or mainnet actions were performed for this checkpoint.**

Frozen source: `training/runs/foundation-40m/checkpoint-008007187`, trained through 8,007,187 known target words. Its safetensors SHA256 is `99546b1bf3ac6ca5d1d2d963ccbebb903e69445dbcbfea4c93802b21d6689837`. Metadata reported balanced validation NLL 5.0889 and zero weight projections. The larger training run was still active when this early screen was taken.

The 4,014,560-parameter checkpoint exported into the fixed-domain-0 Q10 runtime format without weight clipping or integer overflow. The input-only UNK row stays off-chain. The derived Q20 input values range from -5,220,512 to 5,907,314, safely inside signed40.

## Raw output assessment

`streams-q10-t512.json` contains all tokens for seeds 0 and 42, 256 new words per seed at temperature512/1024. Both streams preserve state throughout and use the exact Solidity integer sampling method. Each produced ten natural sentence endings. Nothing forces punctuation or resets at a sentence boundary.

Both streams frequently use first person and the intended machine/market vocabulary. However, agreement errors, broken idioms and unrelated clauses remain common. These are not coherent long monologues.

Seed 0 includes: “i have not a small box. i am trying to be a poor picture of the world.” It later joins repeated abstract constructions about things, plans, machines and ideas without a stable concrete subject.

Seed 42 starts: “i have been a little afternoon but i asked me to remember...” It later produces “i can rather be a smaller more than a story of it.” These failures are grammar and meaning failures, not just unusual style.

Repeated four-gram fractions are 0.40% and 2.37%. Those low exact-repeat rates should not be mistaken for good prose: the streams still reuse similar clause patterns and generic nouns.

## Quantization comparison

The float comparison drives both arithmetic implementations with the same Q10-generated token history and fixed features. This isolates numerical drift from diverging sampled text. Over each 256-word history:

| Metric | Seed 0 | Seed 42 |
|---|---:|---:|
| Mean hidden-state absolute error | 0.004442 | 0.004377 |
| Maximum hidden-state error | 0.050645 | 0.048634 |
| Mean logit absolute error | 0.005491 | 0.005317 |
| Maximum logit error | 0.051314 | 0.045516 |
| Group argmax agreement | 99.61% | 100% |
| Word argmax agreement within selected group | 98.44% | 100% |

The independently generated native float32 samples at temperature0.5 are also grammatically weak. For example, they include “the first part of the evening asked the same time to sit” and “i was a bad picture of a place of the table.” The main language failure is already present in the trained float model; these results do not support blaming it primarily on Q10 arithmetic.

Native float samples use PyTorch multinomial, whereas the Q10 samples use Keccak stage draws. Their full sampled texts are not paired random trajectories. All numerical drift statistics above use matched token histories instead.

Full raw text, token IDs, final states and per-step metrics remain in the two JSON reports. This is an early training diagnostic, not a final release recommendation.
