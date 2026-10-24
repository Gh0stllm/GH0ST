# Trained-candidate local validation

The completed four-swap feasibility fixture remains frozen in `run-local.mjs` and its reports. It is not a language-quality result.

`run-final.mjs` is prepared for a checkpoint-bound export. It defaults to 256 primary swaps and two callers, on the isolated Hardhat chain 31337 only. Every transaction and block is capped at 32 million gas. It also performs four swaps in a separate pool, checks state isolation, advances time across the elapsed-feature clamp, and makes one larger swap to exercise the tick-move clamp. It records all 224 hidden components and 192 evaluated logits for every successful swap.

Additional checks cover direct model inputs at the first and last word rows, the BOS input row, both signed hidden-state extremes, feature extremes, temperatures 64 and 4096, entropy indices 255 and 256, malformed inputs, input-only UNK rejection, stale state, post-inference rollback, low gas, unauthorized callbacks, model-code tampering, and uint64 sequence overflow rollback.

The final runner has passed syntax validation but has not yet been executed: a frozen trained checkpoint must be selected first. Data runtime code is injected locally; this is not a data-deployment gas benchmark. The pool, router, hook and model are deployed by actual local transactions.

From the research root, after export:

```sh
node experiments/gh0st-voice/voice-v6/evm/adaptive/run-final.mjs --model-dir=experiments/gh0st-voice/voice-v6/exports/SELECTED --turns=256 --callers=2 --temperature=768 --label=SELECTED
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v6/evm/adaptive/validate-final.py --model-dir experiments/gh0st-voice/voice-v6/exports/SELECTED --report experiments/gh0st-voice/voice-v6/evm/adaptive/SELECTED-local.json --out experiments/gh0st-voice/voice-v6/evm/adaptive/SELECTED-reference.json
```

The independent validator checks integer input projection without the precomputed rows, recurrence, group head, selected word head, sampling, and every state/logit against the actual swaps and direct boundary probes.

For an exact Q10 quality screen without EVM execution:

```sh
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v6/evm/adaptive/stream-q10.py --model-dir experiments/gh0st-voice/voice-v6/exports/SELECTED --out experiments/gh0st-voice/voice-v6/exports/SELECTED/streams-q10.json --words 256 --seeds 0,42 --temperature 768
```

This stream never resets at sentence punctuation and uses the same integer exponential table and ABI-encoded Keccak draws as the Solidity model. These draws differ from PyTorch multinomial draws, so float and Q10 examples are not paired sampling trajectories. Report raw streams and their limitations; no quality approval is automatic.
