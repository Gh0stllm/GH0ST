# GH0ST S0UL-1M

**S0UL — Specialised On-chain Understanding Layer**

Research opened: **21 October 2026**  
Branch: `research/GH0ST-S0UL-1M`

## Research status

This directory starts the research proposal for a purpose-trained, approximately
one-million-parameter language model targeting Robinhood Chain. No S0UL model
has been trained, benchmarked or deployed by this proposal. Its specifications,
capabilities and costs remain to be validated.

## Objective

Build a small language model for short user instructions and a defined set of
agent operations, with accessible on-chain weights, deterministic fixed-point
inference, persistent contract memory and independently checked actions.
Training and teacher inference take place offline. A requester or keeper
submits transactions; contracts do not wake or execute themselves.

## Proposed use cases

- Interpret short requests and select a supported operation.
- Request real balances or other supported contract state through typed reads.
- Save and retrieve a small set of user-authorized memory fields.
- Propose permitted contract actions with bounded arguments.
- Ask for missing information, reject unsupported requests and choose to wait.

The model selects actions. Contract logic resolves supported addresses, reads
actual state, performs exact arithmetic and enforces authorization and limits.
These are research targets, not demonstrated abilities or a trading strategy.

## Initial candidate

| Component | Proposed specification |
| --- | --- |
| Architecture | Bias-free causal decoder transformer |
| Decoder blocks | 4 |
| Hidden width | 128 |
| Attention heads | 4 |
| Feed-forward width | 640 |
| Feed-forward activation | ReLU |
| Vocabulary | 512 domain/byte tokens |
| Initial context | 128 tokens |
| Normalization | Two learned RMSNorm gains per block and one final RMSNorm |
| Position encoding | Fixed RoPE; no learned position table |
| Embedding/output matrix | Shared |
| Total trainable parameters | **984,192**, including the shared embedding matrix |
| First numeric target | INT8 weights with fully specified integer/fixed-point operations |
| Further precision study | INT4 only if measured task quality supports it |

Parameter count, with V=512, d=128, L=4 and m=640:

`V*d + L*(4*d*d + 2*d*m + 2*d) + d = 984,192`

An all-INT8 scalar payload would occupy 984,192 bytes; an all-INT4 payload
492,096 bytes. Actual exports also need scales, metadata and potentially
higher-precision parameters. Neither payload size is a gas estimate.

## Training approach

Adapt an existing open training implementation, retaining its license and
notices, and train a new student. Use verified synthetic chain states, checked
action labels and suitable teacher-generated examples. Pin any teacher,
dataset, tokenizer and code revisions, and review their reuse terms.

Keep training, validation and final tests separate by scenario and language
template, with held-out values and state combinations. Include negation,
missing arguments, unsupported actions, conflicting instructions and memory
ownership. Compare supervised training against distillation so improvements
can be attributed to the correct method.

Quantization changes numerical precision, not the parameter count. A small
adapter attached to a larger model does not meet this total-model size target.

## Execution approach

Store the final weights in contract-readable bytecode shards. Specify and
validate tokenization, normalization, attention, activation, decoding and
continuation state against an independent fixed-point reference. Historical
transaction calldata alone is not directly readable by contracts in later
transactions and is not the proposed persistent weight store.

Use bounded context/output and deterministic decoding. Reuse GH0ST's
continuation and requester-funded execution patterns where appropriate.
Evaluate a Solidity implementation first; any Stylus path requires separate
confirmation of Robinhood Chain support and its own benchmarks.

## Evidence required before deployment

1. Reproducible training configuration, data provenance and exact parameter count.
2. Held-out action/argument correctness, clarification behavior and reviewed failures.
3. Quantization sensitivity and exact agreement with the specified numeric reference.
4. Complete prompt-to-action gas, including prefill, decode, tokenization and state writes.
5. Weight deployment size, shard count and measured deployment costs.
6. Independently enforced ownership, action allowlists, argument bounds and stale-state checks.

Record model-quality results, local gas measurements, cost estimates and public
receipts as separate evidence. Do not infer inference costs from parameter
ratios or advertise proposed capabilities as completed results.

## Existing project foundations

- [GH0ST project overview](../README.md)
- [Previous distillation pilot](../distillation-pilot/README.md)
- [Resumable runtime research](../falcon-agent/runtime/README.md)
- [Contribution guidelines](../CONTRIBUTING.md)
