# Trained H384 validation harness

`run-final.mjs` is prepared and syntax-checked. It has not been run against a selected trained H384 checkpoint yet. The random-weight feasibility artifacts remain separate.

It accepts an explicit exported model path, integer seed, temperature, inference budget, caller count and number of primary swaps. Defaults are seed42, temperature512/1024,26M model budget, two callers and256 primary swaps. Four secondary-pool swaps are additional. Every transaction and block stays at32M gas on isolated chain31337.

From the research root:

```sh
node experiments/gh0st-voice/voice-v8/evm/run-final.mjs --model-dir=experiments/gh0st-voice/voice-v8/exports/SELECTED --turns=256 --callers=2 --seed=42 --temperature=512 --model-budget=26000000 --label=SELECTED
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v8/evm/validate-final.py --model-dir experiments/gh0st-voice/voice-v8/exports/SELECTED --report experiments/gh0st-voice/voice-v8/evm/SELECTED-local.json --out experiments/gh0st-voice/voice-v8/evm/SELECTED-reference.json
```

The runner samples every lexical word and punctuation class inside the model. It uses off-chain vocabulary only to check emitted bytes; it does not choose or replace outputs. The verifier runs afterward and cannot change the transactions.

Checks include all state components and197 logits, persistent previous punctuation, two callers, separate-pool state, elapsed/tick feature clamps, input-only UNK rejection, punctuation/state/feature/temperature bounds, first/last/BOS input rows, extreme hidden inputs, entropy-block boundaries, independently forged state hashes, stale sequence, malformed input lengths, low-gas and post-inference rollback, modified-model rejection, unauthorized callback and uint64 sequence-overflow rollback.

Language quality is a separate gate. No technical validation status implies fluent or useful text.
