# GH0ST V8 — final selected model

**Final experimental model selected by the user on 24 October 2026. Local-only.**

This is the exact model behind the accepted [256-swap transcript](experiments/gh0st-voice/voice-v8/evm/actual-transcript.txt): V8 H384, source checkpoint `004014786`. The later replay-training and V9 checkpoints are separate experiments. The selected weights, export, hook and original reports are frozen together by [final-model.json](final-model.json).

## Selected package

| Component | File |
| --- | --- |
| Trained float weights | [model.safetensors.gz](experiments/gh0st-voice/voice-v8/training/selected/model.safetensors.gz) |
| Integer inference weights and vocabulary | [Selected runtime export](experiments/gh0st-voice/voice-v8/exports/selected/) |
| Solidity model | [GRU2SIMDModel.sol](experiments/gh0st-voice/voice-v8/exports/selected/GRU2SIMDModel.sol) |
| Uniswap v4 hook | [GRU2SIMDHook.sol](experiments/gh0st-voice/voice-v8/exports/selected/GRU2SIMDHook.sol) |
| Original output | [Full unedited transcript](experiments/gh0st-voice/voice-v8/evm/actual-transcript.txt) |
| Results | [Technical report](experiments/gh0st-voice/voice-v8/evm/TRAINED-RESULTS.md) · [JSON summary](experiments/gh0st-voice/voice-v8/evm/trained-summary.json) |
| Detailed evidence | [Local swap report, gzip](experiments/gh0st-voice/voice-v8/evm/grammar4m-final256-local.json.gz) · [Independent scalar reference](experiments/gh0st-voice/voice-v8/evm/grammar4m-final256-reference.json) |

## What it does

The 8,175,493-parameter model generates one new word on each successful swap, with punctuation selected by a learned head. Both recurrent layers persist between swaps and across sentence endings. Its runtime has no sentence bank, grammar engine or post-generation text repair.

The saved run completed **256 primary and 4 secondary local swaps**. Maximum whole-swap gas was **23,712,321**, within the **32,000,000** test limit. Every primary swap emitted a word; all 768 recurrent state values and 197 evaluated logits matched the independent scalar reference. The tested settings were seed 42 and temperature 512/1024.

## Acceptance and limits

The user accepted the raw voice as the final experimental baseline. The historical language evaluation remains **FAIL_NOT_APPROVED**: grammar errors, repetition and weak continuity are visible in the transcript. Selection does not establish polished prose, reliable question answering or a faithful reproduction of another agent's voice. Original reports have not been rewritten.

This package is **local-only**. The test injected 66,319,680 static model-data bytes across 2,766 shards with `hardhat_setCode`; public deployment cost was not measured. The swap gas figure excludes that data deployment. Selecting and publishing this model does not deploy it or authorize mainnet transactions.

## Restore and reproduce locally

From the repository root, restore the published compressed artifacts with hash verification:

```sh
python3 research/v4-hook-1m/experiments/gh0st-voice/voice-v8/publication/restore.py --root .
```

With the research project's pinned Node dependencies installed, rerun in its isolated local EVM:

```sh
cd research/v4-hook-1m
node experiments/gh0st-voice/voice-v8/evm/run-final.mjs --model-dir=experiments/gh0st-voice/voice-v8/exports/selected --turns=256 --temperature=512 --seed=42 --label=final-v8-recheck
```

The harness checks local chain 31337 before writes. The supplied frozen reports remain the original evidence; a rerun writes a separate report.

## Identity

- Source checkpoint SHA-256: `904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3`
- Export manifest SHA-256: `20cf84ea9f4406d61e6f143c3c28b477e9ec3f829b96e1fd9ae0569a2437c54a`
- Transcript SHA-256: `5ebe8093588691406c98982af7b21c04c4e28a438ea8ce12a9e0aeae7d979286`

All published file hashes and gzip restoration hashes are listed in [final-model.json](final-model.json). The model bytes were already published in commit `1ff15a66e11797e65e9fd1b4d330af045db78598`; this final selection preserves those exact bytes.
