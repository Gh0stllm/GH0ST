# GH0ST S0UL-1M

**S0UL — Specialised On-chain Understanding Layer**

An experimental **984,192-parameter causal language model** for short instructions and typed agent proposals targeting Robinhood Chain. The first implementation, supervised training pilot, integer reference and local EVM arithmetic tests are available.

**Pilot-001 result: 85/270 exact held-out actions (31.48%). The first pilot is not ready for autonomous use. No full S0UL inference runtime has been deployed to Robinhood Chain.**

[Build status](BUILD-STATUS.md) · [First research report](REPORT-001.md) · [Original proposal](PROPOSAL.md) · [Training evidence](reports/training-pilot-001.json) · [Raw held-out outputs](reports/test-pilot-001.json)

## Complete Solidity runtime research

The separate runtime branch implements full integer transformer inference, on-chain tokenization, immutable weight shards, causal KV caching and bounded continuation transactions. It targets the validation-selected checkpoint from the completed 20-lane campaign. The model registry binds the exact checkpoint and export manifest; continuation callers supply no activations or logits. Generated outputs remain proposals.

[Runtime design, deployment commands and evidence](FULL-SOLIDITY.md) · [Pinned trained checkpoint](reports/solidity-source-model.json) · [Runtime branch](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/GH0ST-S0UL-Solidity). The original pilot documentation and measured limitations below remain part of the research record. Public Robinhood Chain deployment is separate from this local implementation.

## Campaign-002: three parallel one-hour training lanes

The next campaign runs two fresh initializations and one pilot warm start for 3,600 seconds each on separate CPU runners. It uses 28,800 unique training requests and 900 validation requests, with broader instruction coverage, argument copying, negation, clarification and ownership checks. Checkpoints and optimizer state are preserved throughout each lane. All three lanes must finish their full duration before final comparison.

Selection uses validation data only. After the winner is frozen, a separate 360-request challenge measures the selected float model, the original CI baseline and the selected integer export. The workflow publishes measured results to the [build tracker](BUILD-STATUS.md) and retains checkpoint artifacts for 30 days. A finite experiment does not establish a model's maximum attainable capability.

[Campaign protocol](TRAINING-PLAN-002.md) · [Dataset design](DATA-V2.md) · [Duration training and resume](TRAINING.md) · [Final evaluation protocol](FINAL-EVAL-V2.md) · [Distillation research](DISTILLATION.md) · [Workflow](../.github/workflows/s0ul-hour.yml)

## Implemented

| Component | Current implementation |
| --- | --- |
| Language model | Four bias-free decoder blocks, hidden width 128, four attention heads, ReLU feed-forward width 640, RMSNorm and fixed RoPE |
| Parameter budget | Exactly 984,192, including the tied 512×128 embedding/output matrix |
| Context | 128 tokens; overlong examples rejected without silent truncation |
| Tokenizer | Fixed 512-slot byte/domain vocabulary with lossless UTF-8 fallback and a pinned specification |
| Tasks | Balance-read requests, memory proposals, task proposals, clarification, refusal and waiting |
| Training | Response-only supervised cross entropy, deterministic CPU settings, validation-only checkpoint selection |
| Evaluation | Strict action/argument correctness, visible invalid control tokens, raw generations and disjoint request templates |
| Initial INT8 export | Hash-verified payload/shards; scales and norms remain FP32 in this format |
| Complete integer reference | Integer forward/generation with Q14 activations, Q24 scales, integer RMSNorm and pinned RoPE/softmax tables |
| Solidity primitives | Caller-owned bounded memory, typed proposal checks, balance reads and INT8 row-dot kernels |
| Complete Solidity runtime | Immutable selected model, exact integer-v1 transformer, tokenizer, KV cache, greedy output and bounded continuation; [runtime guide](FULL-SOLIDITY.md) |

The floating training model and complete integer reference share the architecture. Integer conversion introduces numerical approximations; it is evaluated separately. The initial mixed-precision export is not a complete integer runtime. [Numeric formats](NUMERICS.md) · [Integer specification](INTEGER-SPEC.md).

This first experiment trains from scratch on synthetic, rule-labelled examples. It does not use pretrained teacher weights or teacher-generated labels. Distillation remains future research. Existing GH0ST Falcon deployment evidence is separate from S0UL.

## Reproduce locally

Python 3.12 and PyTorch 2.5.1+cpu were used for the recorded pilot. Install the CPU wheel first, then the local package:

```bash
cd s0ul-1m
python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
python -m pip install -e .
python -m unittest discover -s tests -p 'test_*.py' -v
```

```bash
python -m s0ul.data --output data --seed 42
python -m s0ul.train --data data --output runs/pilot-001 --steps 1200 --batch-size 32 --threads 4 --seed 42 --eval-every 100 --learning-rate 0.001
python -m s0ul.evaluate --checkpoint runs/pilot-001/checkpoint.pt --data data --split test --output runs/pilot-001/test-generation.json --threads 4
python -m s0ul.infer --checkpoint runs/pilot-001/checkpoint.pt --prompt 'Check my ETH balance.'
```

The inference CLI displays a proposal and never executes it. The last example exposes an observed wrong-asset response in pilot-001; inspect the output rather than assuming success. Training refuses to overwrite an existing checkpoint unless explicitly requested. Reproduction on different CPUs or dependency versions is not a guarantee of byte-identical weights.

```bash
python -m s0ul.export --checkpoint runs/pilot-001/checkpoint.pt --output exports/pilot-001
python -m s0ul.export --verify exports/pilot-001/manifest.json
python -m s0ul.integer --checkpoint runs/pilot-001/checkpoint.pt --output exports/integer-pilot-001
python -m s0ul.integer --bundle exports/integer-pilot-001 --evaluate-data data/test.jsonl --evaluation-output reports/integer-evaluation-pilot-001.json --compare-checkpoint runs/pilot-001/checkpoint.pt --max-new-tokens 32
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Model checkpoints, generated data and binary exports are excluded from Git history. The research CI regenerates them and uploads its own checkpoint, exports and reports as a 30-day workflow artifact. Those are separate CI-produced artifacts, not a promise of the original local checkpoint hash. [Successful CI run and artifact](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39615161322).

## Evidence and limits

- [Training configuration, hashes and validation curve](reports/training-pilot-001.json)
- [Full float held-out evaluation](reports/test-pilot-001.json)
- [INT8 dequantized float evaluation](reports/int8-test-pilot-001.json)
- [Full integer held-out evaluation](reports/integer-evaluation-pilot-001.md)
- [27 exploratory adversarial requests and raw failures](reports/adversarial-pilot-001.json)
- [Local EVM kernel measurements](reports/evm-kernel.json)

The model proposes a small fixed action grammar. It does not know live balances without contract reads, authenticate callers from prompt text, execute financial transactions, or establish trading competence. Valid syntax is insufficient: all 270 held-out outputs satisfied the grammar, while only 85 matched the requested action and arguments.

At the original pilot milestone, the integer reference executed the complete model in Python while Solidity implemented arithmetic and policy/memory primitives. Full tokenization, transformer execution, continuation, model-provenance enforcement and requester-funded integration were then pending. The separate [complete runtime implementation](FULL-SOLIDITY.md) advances that milestone with real model execution and dedicated parity/gas tests. Kernel gas alone cannot be multiplied into a credible full-inference cost estimate.

## Next research gates

1. Improve language coverage, argument copying, unknown-asset handling, negation and clarification using training/validation data; compare supervised training with a licensed teacher-distillation experiment.
2. Require substantially better independently evaluated intent/argument correctness before integrating actions.
3. Extend complete integer-pipeline parity coverage in the bounded EVM runtime.
4. Measure complete prompt-to-action gas and weight deployment under Robinhood Chain constraints.
5. Integrate requester-funded execution, caller authorization and contract state only after the preceding evidence is adequate.

[Project contribution guide](../CONTRIBUTING.md). This study does not change existing deployed GH0ST contracts or the earlier research record.
