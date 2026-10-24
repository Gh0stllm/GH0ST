# Solidity-only N0VA under 32M gas

The active requirement is to produce as many new neural words as safely fit in each swap, and continue the same saved neural state on subsequent swaps. A swap can end a sentence naturally, but a complete sentence is no longer required on every swap. No words or punctuation are forced. No Stylus, WASM, retraining or reduced precision is used.

The model remains the same 8,175,493-parameter Q10 checkpoint. The selected path batches up to three words into one Solidity inference call, returns every intermediate state and score, validates each one, then commits the state once. The contract chooses a smaller batch before inference when the remaining gas is insufficient. Any attempted inference or validation failure reverts the complete trade; it never accepts the successful prefix of a failed call.

## Measured result

All 32 primary local buys and sells succeeded within the 32M block and transaction limits. They generated 90 words, completing seven sentences naturally. Fragments contained one to three words; maximum full-swap gas was **28,513,802**, mean gas was **26,346,158**, and minimum was **11,740,540** for a shorter terminal fragment. An independent exact-Q10 replay matched all 90 words, every final hidden state and all state commitments.

The selected hook also passed **111 independent adversarial PoolManager checks**. The separate real-model run passed 29 checks, including ordered pending swaps and contract-wallet payout reentrancy. The source is `NovaAdaptiveBatchTextHook.sol` with `batch/GRU2BatchCheckedModel.sol`. The inference cap is 26M, decoder cap is 2.4M and callback reserve is 3.25M gas. These are local engineering tests, not mainnet activity or an external audit.

## Verification

The final real-model test and independent replay must pass before `RESULTS.json` is generated. That file records the exact source hashes, gas limits, measured swap gas and report hashes. Large receipts are published as deterministic gzip files; unpack them before replay. All tests run on an isolated Hardhat chain with a 32M block limit. Weight code is injected as a local test fixture, then every catalog and runtime hash is checked by the model constructor; this is an inference/swap test, not a deployment-cost simulation.

The earlier sequential path is preserved as a comparison. It generated two words per tested swap. Original whole-sentence tests and rejected decoder prototypes remain separate research evidence and are not selected for use.

## Safety properties

- Fixed token supply, pool binding, permanent liquidity ownership and router protections are inherited unchanged.
- The model address, its code hash, the immutable data catalogs and model commitment remain pinned.
- Every returned intermediate hidden value, branch score, token, punctuation and spelling is validated. Unused fixed-array output slots must be zero, and the complete ABI must be canonical.
- The 93,312-byte model return is bounded before decoding. The validator has a finite gas allowance. Memory views are created only after full validation; no memory allocator rewind is used.
- Each neural word advances the sequence and state commitment. Only natural terminal punctuation increments the sentence counter. `TextAdvanced` explicitly marks a fragment as terminal or nonterminal.
- This is internal engineering evidence. An external audit and deployment review remain outstanding.

## Reproduction

From `research/v4-hook-1m`, restore the unchanged data with the parent `prepare-selected.py`. Then run:

```sh
node experiments/gh0st-voice/nova-fast-market/evm32/test-text.mjs --source=evm32/batch/GRU2BatchCheckedModel.sol --hook=evm32/NovaAdaptiveBatchTextHook.sol --budget=26000000 --export=selected --swaps=32 --out=evm32/final-local-test
python experiments/gh0st-voice/nova-fast-market/evm32/verify-text.py --report experiments/gh0st-voice/nova-fast-market/evm32/final-local-test/text-results.json --out experiments/gh0st-voice/nova-fast-market/evm32/final-local-test/independent-reference.json
python experiments/gh0st-voice/nova-fast-market/evm32/summarize.py
```

Use the repository Node dependencies and Python/NumPy environment. Supply the tested explicit 32M transaction gas limit to maximize generated text. Gas estimation may find a cheaper successful path with fewer words. Lower gas and deeper contract-wallet call stacks can select smaller batches. Saved context preserves neural continuity, not a guarantee of grammatical or semantic coherence. Ten swaps per second has not been demonstrated. No public-chain RPC, signature, transaction or deployment was used.
