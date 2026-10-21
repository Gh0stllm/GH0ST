# Fully on-chain agent: model baselines and feasibility tests

The current candidate is **Falcon-H1-Tiny-90M-Instruct (91,131,072 parameters)**, pinned in `selected-model.json`. Start with `falcon-agent/README.md` for measured weight compression, unchanged pretrained CPU responses, and the new agent controller. This package also preserves the previous FLAN-T5 baseline, earlier LFM smart-contract benchmarks and stopped distillation experiments. It is **not a complete on-chain inference implementation**. No transaction was signed or broadcast on a public network. No model API is used.

## Latest results

The active target is **existing Robinhood Chain**, and the user selected **six-bit weights**. The latest study is `falcon-agent/sixbit-optimization/README.md`: exact packing cuts the complete weight file to **72,045,528 bytes** and modeled weight deployment from **17.305B to 15.649B gas**. Packed arithmetic reduces the four larger local matrix samples by **82.17–82.63%**. All 217 matrices pass exact integer checks, but their synthetic linear pass still costs **2.965B gas** before the rest of inference. The new sub-billion deployment and usage targets are **not achieved**. Full on-chain Falcon inference remains unimplemented. Earlier studies below are historical.

The newest quality-preserving study is `falcon-agent/research-quality/RESEARCH.md`: full-model lossless compression saves **32.38%** of original BF16 bytes, but still implies **24.648 billion code-deposit gas alone**. A Solidity lossless decoder, authenticated-streaming prototype and full-model local genesis experiment passed **78 checks**. Genesis allocation avoids ordinary weight transactions on a **new chain**; it does not make this deployment available for millions on existing Base/RH or solve inference cost. No full inference engine was implemented or publicly deployed.

The latest aggressive optimization study is in `falcon-agent/OPTIMIZATION-AND-DEPLOYMENT.md`. Six custom full-model quantizations were tested without training. The 48,879,392-byte NF4-style export is smaller but loses quality; 2/3-bit exports lose coherence. No variant is accepted for a production agent. A 796-shard deployment manifest and six actual local sample deployments are complete. The estimated total is **10,596,258,549 local Cancun gas for experimental weight data alone**, excluding the engine, tokenizer, index and L1 fees. This is still billions in total, even though each shard fits millions. Full Falcon inference contracts remain missing.

The new controller, factory and first agent cost **2,225,645 local gas**, excluding weights and inference. Additional agent clones cost **162,069 gas**. Its **36 integration checks passed with an explicitly scripted test engine**, not Falcon inference. The complete published Q4_K_M checkpoint losslessly compresses to 56,514,099 bytes, still implying **11.303 billion code-deposit gas alone**. The target of deploying the entire model in millions of gas has **not** been reached. The original Falcon CPU smoke check shows useful basic responses and an incorrect vault-balance answer. No training or fine-tuning was performed.

The historical FLAN-T5-small baseline passed **3/18 narrow scored checks and 0/6 command-format checks**. All 24 original-weight generations matched a second runtime. It is superseded as the current candidate; its tests remain in `FLAN-T5-BASELINE.md` and `flan-t5-baseline/`.

The historical `distillation-pilot/` contains 56.6M and 60.5M student checkpoints. **The user stopped this work; it has not been resumed.** The first pilot completed with poor quality. The second completed training and float32/int8 evaluation but was stopped during int4 evaluation; `distillation-pilot/t5-pilot/run.json` records that interruption. `DISTILLATION-RESULTS.md` describes the completed first pilot. `TEACHER-OPTIONS.md` is earlier research on prospective teachers; neither GPT-OSS nor DeepSeek was used. The LFM contracts and their historical results below are preserved.

Read `COMPILED-WEIGHTS-RESULTS.md` for the historical LFM execution/deployment trade-off. Compiling fixed weights into executable EVM programs reduces the three measured first-block positions to 144–182 million gas, with identical integer outputs. It increases deployment from 356 to 4,559 contracts and from 1.375 billion to 17.893 billion gas. Gas-only break-even is 65 measured block-position executions; monetary break-even is unmeasured. Full-model inference remains unimplemented; the separate new controller is described above.

`OPTIMIZATION-RESULTS.md` covers the earlier 399–437-million-gas version, which remains available with much lower deployment cost. `TEST-RESULTS.md` covers the original full-block and quality study. Reproduction instructions are in `block-benchmark/README.md`.

The October 20 experiments first reduced the third position to 1.023 billion gas with six-lane arithmetic, then to 399 million with wider packed accumulation and atomic batching. This is one block at one token position, not full-model token generation. The original public-node fee comparison remains scoped to the four-lane version. Public-node replay of the latest variant was blocked by automatic approval review; no new public validation or fee quote is claimed.

## What is included

- `reference_benchmark.py`: loads the exact public checkpoint in `model-lock.json`, inventories unique parameters, and runs six short chat/action-format smoke prompts. Saves input/output token IDs, replies, timings and narrow checks.
- `rpc_preflight.py`: reads Robinhood's chain ID, latest block and gas price. This proves RPC reachability only; it does not establish Stylus activation or practical execution limits.
- `prompts.json`: the complete test inputs. The action example only generates JSON; it executes no action.
- `model-config.json`, `model-lock.json`, `LFM-LICENSE.txt`: the upstream configuration, pinned revision and original model license.
- `requirements-lock.txt`: the packages used for this run.
- `results/`: actual run records, with unknown on-chain costs explicitly left unset.
- `contract-benchmark/`: compiled Solidity int4/int16 arithmetic, immutable weight shard, a real LFM weight/activation slice, local correctness/gas tests, and unsigned Robinhood RPC simulations. See its README for the distinction between local receipts and RPC estimates.
- `stylus-benchmark/`: the matching Rust/Wasm kernel, seven passing Rust tests, thirty compiled-Wasm checks, and direct runtime probes. Robinhood mainnet and testnet currently report an activation-pause setting; Stylus gas comparisons remain unavailable. See its README for supported alternatives.
- `contract-benchmark/compare_chains.py`: identical-bytecode, read-only Base and Robinhood mainnet simulations. Includes Base's separately queried L1 data and operator fees. `CHAIN-COMPARISON.md` explains the measured results and their limits.

The full checkpoint is downloaded from the public LiquidAI repository and is not bundled. Modified quantized weights for the first block are bundled in `block-benchmark/data/`, with hashes and the upstream license.

## Reproduce the historical LFM tests

Tested with Python 3.12 on Linux, CPU only. From this directory:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install torch==2.14.1+cpu --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -r requirements-lock.txt
.venv/bin/python reference_benchmark.py
.venv/bin/python rpc_preflight.py
```

An internet connection is required for dependencies and the first model download. The default reference uses float32, greedy decoding, four CPU threads, a 256-token prompt-plus-reply budget and at most 32 new tokens. These are prototype settings, not claims about the model's maximum context. Deterministic settings reduce variation; exact floating-point results may still vary between platforms and package versions.

The checkpoint revision is pinned. Remote repository Python execution is disabled. The original model license is included; it is not an Apache or MIT license.

## How to read the results

CPU tokens/second cannot be converted into blockchain gas or reply latency. The ideal packed weight sizes assume every unique parameter uses the stated precision; real deployment adds quantization scales, alignment, tokenizer data, contract code and state. The initial six-prompt run used the original model. The later quantization and complete-block studies are reported separately in `TEST-RESULTS.md`.

The three automatic checks cover exact arithmetic, recall of a supplied project name and one JSON schema. The other three replies require manual review. Six prompts cannot establish reliability, reasoning quality or safety of autonomous actions.

RPC header gas limits are not usable transaction compute budgets. `stylus_activation_verified: false` means this benchmark has not attempted activation.

## Historical LFM implementation gates

1. Use the completed first-block and quality measurements in `TEST-RESULTS.md` to choose an acceptable cost and reliability target.
2. Benchmark an int8 Solidity kernel; its better numerical fidelity has been measured on CPU, but its full-block gas has not.
3. Integrate a complete next-token pass locally: tokenization, embedding lookup, all convolution/attention blocks, persistent caches, final vocabulary projection and decoding. Measure prefill and decode separately.
4. Evaluate and adapt LFM for the actual agent workflow using a larger task-specific dataset. The original model and int8 variant each passed only 7 of 12 exact native calls in this small suite.
5. Add multi-conversation state, cancellation/recovery and a deterministic allowlisted action executor. Validate permissions and arguments independently of generated text.
6. Price a concrete public deployment only after full-token cost and quality are known. New Robinhood Stylus activation remains a separate runtime availability gate; the EVM prototype does not bypass it.

The project uses pretrained weights, so training happens outside the chain. The intended fully on-chain boundary covers runtime tokenization, model arithmetic, persistent memory, decoding and action decisions. A browser or keeper still has to submit transactions; contracts do not wake themselves. Quantization/export is also an offline build step.

## Resources needed

No API key, GPU rental or wallet secret is needed for this CPU reference. A deployment stage needs a wallet controlled by its owner, appropriate testnet gas and an accessible testnet RPC. Keep signing keys outside chat. Mainnet funding should follow a concrete measured deployment estimate.

The useful product inputs now are a development/gas budget ceiling, acceptable wait per reply, and two or three examples of tasks the agent should perform. The number of contracts is an implementation outcome; more contracts do not by themselves create more chain compute capacity.

## Primary references

- Model: https://huggingface.co/LiquidAI/LFM2.5-230M
- Robinhood Chain: https://docs.robinhood.com/chain/
- Robinhood protocol contracts: https://docs.robinhood.com/chain/protocol-contracts/
- Arbitrum Stylus: https://docs.arbitrum.io/stylus/gentle-introduction

Network support and execution limits must be checked again at deployment time.

## Base comparison

Run `.venv/bin/python contract-benchmark/compare_chains.py` using the contract benchmark dependencies. This makes read-only calls to both mainnets and writes `results/comparison-base.json`, `results/comparison-robinhood.json`, and `results/chain-comparison.json`. No wallet, signing key, or ETH is required. Each chain's state is pinned to one block; the gas quote is sampled nearby. If a quote falls below that block's base fee, the script models the base fee instead and records the adjustment.

Base's documented EVM runtime supports this Solidity kernel; it does not supply the Arbitrum Stylus execution path used by the Rust/Wasm port. A lower fee for this computation slice would justify further measurement, not establish full LFM feasibility or resolve Robinhood's Stylus activation setting. The complete first-block gate has now been measured; see `TEST-RESULTS.md`. Full next-token evaluation remains incomplete.
