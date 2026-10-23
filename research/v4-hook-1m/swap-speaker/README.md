# SwapSpeaker: one word per swap

A small word-level recurrent language model with persistent pool-scoped state. Each successful `afterSwap` callback runs one complete integer inference step and emits one vocabulary word. Successive swaps can form a sentence.

**Research prototype. Local training and local EVM validation only; no public-chain deployment.**

## Vocabulary and model

| Property | Initial candidate |
| --- | --- |
| Lexical vocabulary | **54 distinct words** when final periods are ignored |
| Output vocabulary | **94 whole-word tokens**, including period-bearing variants |
| Total learned parameters | **4,522** |
| Architecture | Word embedding: 12; recurrent hidden state: 24; swap features: 6 |
| Linear work per output word | **3,264 multiply-accumulates** |
| Numerical format | Signed INT16 weights at Q1024; integer inference with truncation toward zero |
| State bound | Every hidden coordinate is clamped to `[0, 8192]` |
| Decoding | Greedy next-word argmax; lowest token index wins a tie |
| Sentence completion | A generated period-bearing word ends the sentence and resets context for the next swap |
| Length guard | Reset context after 16 words if no period-bearing word was generated |

The special beginning-of-sentence embedding is input-only and is never emitted. Every output token contains one alphabetic word with an optional final period. There are no subword fragments, blank output steps or separately emitted punctuation tokens.

## How sentence state persists

The hook stores the previous token, 24 recurrent hidden values packed into two storage words, and tick-movement context. The next swap supplies new market features and advances that same model state. Memory is shared by the configured pool, rather than belonging to an individual trader.

For example, four successive successful swap callbacks can emit:

| Swap | Emitted word |
| --- | --- |
| 1 | `I` |
| 2 | `see` |
| 3 | `gentle` |
| 4 | `movement.` |

The runtime evaluates learned weights at each step. It contains no stored complete sentences or runtime sentence-template selector. The disclosed training corpus does contain a small synthetic grammar, so the model's scope and vocabulary are deliberately limited. Repeated sentences are possible.

## Contracts and trust boundary

- [SwapSpeakerModel](contracts/SwapSpeakerModel.sol) executes the complete recurrent integer graph. Its immutable data contract holds all weights and vocabulary entries. The model identity binds the vocabulary size and both payload hashes.
- [SwapSpeakerHook](contracts/SwapSpeakerHook.sol) binds one pool and model, checks the PoolManager caller, reads the completed swap's tick, advances inference and emits `WordSpoken` with a sequence, sentence index, word position and input commitment.
- Hook permissions are `afterInitialize` and `afterSwap` (`0x1040`). This prototype uses a static LP fee and requests no custom accounting deltas. It does not change swap fees.

The six numerical features are clipped tick movement, the previous integer EWMA of movement, the change in clipped movement, clipped elapsed time, swap direction and exact-input/exact-output mode. Features, recurrent state and previous word are all inputs to the next-word computation. They do not establish economically useful insight.

There is no model-output publisher, offchain inference dependency or cached-policy consumer in this path. Callers still submit ordinary swap transactions. No swaps means no new words. An outer transaction revert rolls back the word event and memory update. A transaction with multiple swap callbacks can emit multiple successive words in the same block.

## Training and evidence

Training ran locally on CPU with pinned project dependencies. **Do not train models or run model-selection jobs on GitHub Actions or other GitHub-hosted compute.** GitHub is used only to publish source, saved weights and completed results.

The synthetic corpus contains 612 distinct short sentences generated from five grammatical constructions and three adjective groups. Sentence-combination splits contain 459 training, 76 validation and 77 test examples. Every vocabulary token occurs in training. The test is a holdout of combinations within this grammar, not open-domain language evaluation.

The selected checkpoint's held-out teacher-forced next-word accuracy is **46.41%**. This task has many interchangeable adjectives, nouns and openings. That score does not establish robust language ability. Initial greedy integer decoding completed 24/24 short test sequences and matched the disclosed grammar in 24/24 cases. Those checks are narrow; generation can repeat, become incoherent or describe market conditions inaccurately.

[Saved corpus](model/corpus.json) · [Model export](model/integer-speaker.json) · [Training report](reports/model-training.json) · [Generated CPU sentences](reports/generated-sentences.json) · [Python integer fixtures](reports/integer-fixtures.json)

The [local EVM benchmark](../scripts/bench-speaker.mjs) checked **80 recurrent vectors, 7,520/7,520 logits and every hidden state** against independent Python and JavaScript references. It emitted **34 word events**, completed **8 sentences**, and verified two successive word outputs within one transaction/block. Single-callback harness transactions consumed **2,134,135–2,197,972 gas**, including full inference, memory writes, event emission and transaction/harness overhead. These are not full-swap gas measurements or isolated incremental overhead.

Its callback harness uses upstream v4 hook handling and state layout, but does not execute real AMM math, liquidity updates, unlocking or token settlement. Full PoolManager integration, manipulation studies and chain-specific costs remain outstanding. All 16 existing cached-policy hook regression tests also passed after the shared compiler helper was parameterized.

[EVM results and receipts](reports/evm-benchmark.json) · [Every emitted word and feature vector](reports/swap-word-stream.json)

## Reproduce locally

From `research/v4-hook-1m`, with the study's pinned Python environment and Node dependencies:

```bash
python swap-speaker/python/train_speaker.py
npm run bench:speaker
npm run test:evm
```

The original [three-label control](../one-word/README.md), [812,195-parameter forecasting experiment](../README.md) and their reports remain separate. The compact recurrent model is the candidate designed specifically for speech during each swap.
