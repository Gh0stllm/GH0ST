# SYNAPSE domain V2 candidate

This candidate is a trained, narrow-domain next-token network with 128 word tokens, four input tokens, hidden width 32, two compatible parallel experts, and a shared head. It has 22,720 scalar parameters, versus 894 in the preserved initial demo. It is designed for short GH0ST mechanics and evidence-related continuations, not arbitrary questions or general reasoning.

The original AI-assisted synthetic corpus is CC0-1.0 and stored in `corpus.json`. It has 159 distinct training sentences and 31 distinct held-out sentences: 12 hand-authored recombinations and 19 withheld clause pairings. None of the held-out sentences is in training. Training contains 1,599 next-token examples; held-out evaluation contains 307, including 49 contexts never observed during training. The grammar and vocabulary are shared across splits, so this tests narrow recombination. It is not a broad independent language benchmark. After an initial run, core training facts were given five additional exposures to fix a rare arithmetic phrase; this development history is retained here rather than implying a fully blind final benchmark.

Base training uses fixed-seed PyTorch AdamW on CPU for 2,500 full-batch steps. The backbone is `ReLU(sum(position-specific token embeddings))`; each expert is an independent 32×32 affine layer and ReLU; activations are averaged, then passed to the 128×32 output head. Quantization is nearest-even at scale 256. Integer inference sums each dot product before signed division toward zero, adds the bias, clips backbone/expert activations to 0..32767, and returns the largest head logit with the lowest-index tie rule. The head has no activation.

`embeddings` in `model.json` is a flat array ordered by position, token ID, then hidden channel, with 16,384 entries. Experts have flat output-major `weights` and `bias`, and `headWeights` is output-major. The shared backbone/head data occupies 41,216 bytes at signed 16-bit precision; each expert occupies 2,112 bytes. This exceeds a single EIP-170 code-data chunk, requiring multiple chunks or another weight storage layout. Matrix inference costs 6,144 MACs per token, plus embedding/activation/dispatch work. These are operation counts, not measured gas or mainnet costs.

Measured quantized results:

| Evaluation | Correct / examples | Accuracy |
| --- | --- | --- |
| Training, each distinct sentence once | 1169 / 1599 | 73.11% |
| Held-out sentence compositions | 188 / 307 | 61.24% |
| Held-out contexts absent from training | 20 / 49 | 40.82% |

Float held-out perplexity is 12.78; float/integer token agreement is 98.05%. Ambiguous contexts and distribution shift limit accuracy. A four-word window cannot recover all sentence context. The model can still make unsupported or malformed continuations: the held-out prompt `icp runs inference and` incorrectly continues `ghost`. The measured failures remain in `results.json` alongside successful examples.

Actual integer completions include:

```text
a source receipt does → not prove delivery
a queued job is → not a completed job
check the destination receipt → before claiming delivery
integer division → rounds toward zero
robinhood is → home for ghost
```

The alternate expert was trained by the same project, with all exported embeddings, expert 0, and head frozen. It changes `<bos> the expert reads` from `context` (token 25) to `tokens` (112). This demonstrates compatible replacement, not independent contributor training or a general quality improvement. The `alternate-expert.json` artifact binds compatibility to the exact base-model SHA-256.

Reproduce with the existing PyTorch 2.14.1 environment, or a compatible CPU PyTorch/NumPy installation:

```sh
python train.py
python3 reference.py
python3 -m unittest test_reference.py
```

The runtime reference and tests need only Python's standard library. `reference.py` checks dimensions, manifest hashes, alternate compatibility, and 52 full base/alternate integer traces. Tests independently cover hand-calculated four-position indexing, clipping, signed rounding, odd means, ties, and replacement. `manifest.json` records corpus/model/alternate/fixture SHA-256 values. These artifacts capture one fixed-seed training run. Other PyTorch or platform versions can change regenerated floating-point training results.

Recommended use: the next on-chain prototype, clearly presented as a limited domain model with example prompts and verifiable output. The candidate has coherent observed domain completions and a straightforward integer architecture, but should not be represented as an open-ended assistant.
