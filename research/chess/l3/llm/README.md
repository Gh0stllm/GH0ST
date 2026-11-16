# Deterministic small language model runtime

This is a working native and generic Wasm implementation of the complete pretrained TinyStories GPT-Neo **INT8/Q12 variant**. It is a local custom-runtime prototype, not an activated Stylus contract, a booted L3, a fraud prover or a large-model cost result.

The model is `roneneldan/TinyStories-1M`, revision `77f1b168e219585646439073245fe87e56b3023e`. Its actual learned parameter count is 3,745,984. Every supported inference position executes all eight width64 transformer blocks, sixteen attention heads, MLP256 and all 50,257 tied vocabulary logits. Context is limited to64. INT8/Q12 approximates the original FP32 model; no FP32 identity or strong reasoning quality is claimed. [Pinned model files](https://huggingface.co/roneneldan/TinyStories-1M/tree/77f1b168e219585646439073245fe87e56b3023e).

## Working implementation

- `runtime.cpp` uses only bounded integer work. It imports no filesystem, network, clock, randomness, external inference, threads or SIMD. Checked signed arithmetic faults instead of returning a token after an overflowing intermediate.
- Model bytes are separate input data, not embedded in Wasm code. `prepare_model.py` checks the pinned complete tensor geometry, every tensor checksum and the independently pinned full flat-data hash. The runtime verifies the complete model SHA256 before accepting a job.
- Inference advances through deterministic phases with a caller-supplied sequence number and bounded output-row budget. It retains all KV state between tokens.
- Canonical checkpoints serialize every future-affecting model/session field explicitly, without ABI padding or process pointers. A fresh instance can resume midway through inference. Restore checks model identity, format/phase bounds and the expected checksum before replacing active state. **The expected root must come from authenticated chain state; a caller-provided checksum is not authorization.**
- The raw module has no Solidity ABI or `user_entrypoint`. It belongs to the proposed custom-runtime path, not ordinary Stylus activation. The separate `../stylus/` contract provides the verified Stylus ABI kernel.

The final Wasm artifact is39,148 bytes, SHA256 `28895202aa3bd64cf956862354905b7055c82ce863dd2528d523e05094f06a88`. Separate model bytes total4,401,034, SHA256 `6dc6dd216d0c4b12b81b0844244423e53bb8d7e4c726b8e6205683708971ef1f`. The module uses8MiB initial memory and32MiB declared maximum; these are this small-model fixture's settings, not a large-model allocation or ordinary Stylus memory guarantee.

## Verification

Six full token positions were compared independently across native C++, Wasm/Wasmtime and the earlier NumPy integer oracle. **All301,542 logits matched exactly**, as did canonical native/Wasm state with the same chunk schedule. The run included restoration into a fresh Wasm instance during the first token. Greedy output was:

```
Once upon a time, there was
```

The fixture records every position's full-logit hash, input/output token IDs, chunk count and checkpoint hash in `test-evidence.json`. Local timing is not public-chain throughput or gas. This comparison covers the tested positions, not every prompt or all64-token contexts.

Nine additional boundary tests cover malformed attention-head/layer/cursor/context states, wrong model binding, checked arithmetic overflow, architecture/layout substitution and a forged matching per-tensor checksum. Wrong weights, invalid tokens/work, stale sequence numbers and corrupt checkpoints are also exercised in the full-model comparison.

`reference_oracle.py` is the independent NumPy implementation from the earlier complete TinyStories port; its provenance hashes are recorded separately. `export_model.py` reproduces the full integer fixture from the exact48.6MB checkpoint without importing Torch. It checks the checkpoint SHA before a restricted data-only unpickler and checks the final flat-data hash after conversion. Arbitrary checkpoints are rejected.

## Reproduce

Use a Python3.13 installation capable of running Wasmtime on the host. On this Mac, the system Python3.9 process was killed when initializing JIT code; the isolated Python3.13 environment succeeds. No server was rented to run these tests.

From this directory:

```sh
python3.13 -m venv .cache/venv
.cache/venv/bin/python -m pip install -r requirements.txt
curl --fail --location 'https://huggingface.co/roneneldan/TinyStories-1M/resolve/77f1b168e219585646439073245fe87e56b3023e/pytorch_model.bin' --output .cache/pytorch_model.bin
.cache/venv/bin/python export_model.py --checkpoint .cache/pytorch_model.bin
curl --fail --location 'https://huggingface.co/roneneldan/TinyStories-1M/resolve/77f1b168e219585646439073245fe87e56b3023e/tokenizer.json' --output .cache/export/tokenizer.json
python3 build.py
.cache/venv/bin/python test_runtime.py --export-dir .cache/export
.cache/venv/bin/python test_boundaries.py --export-dir .cache/export
```

The build requires native Clang and WASI SDK25 at the documented chess engine toolchain path. Weights, tokenizer, checkpoint, native binary and Wasm outputs remain ignored rather than redistributed. Review model licensing before public model publication.

## Remaining chain work

The model registry, Nitro tensor precompile overlay and this full-model runtime are **separate tested components**. The runtime is not yet called by that precompile and does not yet read its weights from the on-chain registry. Integrating them requires an authenticated page reader and job/checkpoint storage, deterministic node/replay/prover equivalence, complete node activation and a real incorrect-result fraud challenge. A host running this module alongside a node is not fully on-chain inference.

The registry's64GiB format bound does not establish that this Wasm module can execute such a model. No7B/70B model, Qwen model or Stockfish engine has been ported or weakened here. Larger architectures, paging costs, finality, gas and the twenty-game/100ICP target remain unverified.
