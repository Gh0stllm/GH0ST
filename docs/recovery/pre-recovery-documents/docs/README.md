# GH0ST documentation

```text
             .-""""-.
            /        \
           |  [0_0]   |
           |    __    |
           |          |
           \_/\_/\_/\_/

          INSPECT THE WEIGHTS.
          FOLLOW THE COMPUTATION.
          CHECK THE EVIDENCE.
```

[Project home](../README.md) · [Architecture](ARCHITECTURE.md) · [Request lifecycle](REQUEST-LIFECYCLE.md) · [Evidence and costs](EVIDENCE.md)

## The idea in one minute

GH0ST is research toward a language model and agent whose inference is computed by contracts. Its chosen model is **Falcon-H1-Tiny-90M-Instruct**, a 91,131,072-parameter model from the Technology Innovation Institute. A pinned four-bit export stores matrix weights in deployed contract bytecode; a Solidity kernel reads those weights; a resumable runtime performs bounded token generation.

A request begins with token IDs prepared by the client. The requester deposits the contract's conservative maximum escrow and chooses an executor. That executor submits transactions to advance the computation. The runtime stores intermediate state and emits generated token IDs; the client decodes them into text. Successful work earns the executor capped withdrawal credits, and unused escrow becomes requester credit when the session ends or is cancelled.

**Recorded milestone, 20 October 2026:** the repository documents 500 deployed contracts including historical pilots, exact runtime-bytecode verification, and a local EVM chat-template test producing “Hello!” from “Hi”. A complete paid chat on mainnet, website chat integration and an operating executor service are not recorded as complete. The action controller is separate from this runtime. Each claim has its own [evidence boundary](EVIDENCE.md).

## Read by question

| Question | Guide |
| --- | --- |
| What is actually on-chain, and what does the client do? | [Architecture](ARCHITECTURE.md#where-the-work-happens) |
| Why does one response need many transactions? | [Resumable computation](ARCHITECTURE.md#why-computation-is-resumable) |
| How do 495 contracts become one readable weight file? | [Deployed weight layer](ARCHITECTURE.md#the-deployed-weight-layer) |
| What happens after I submit a prompt? | [Request lifecycle](REQUEST-LIFECYCLE.md) |
| Who pays gas, and where do refunds go? | [Payment flow](REQUEST-LIFECYCLE.md#who-pays-what) |
| How large is the achievement, and what has been measured? | [Why the milestone matters](EVIDENCE.md#why-the-milestone-matters) |
| Which gas number should I use? | [Gas, fees and budgets](EVIDENCE.md#gas-fees-and-budgets) |
| What remains before an integrated public agent? | [Remaining integration](ARCHITECTURE.md#how-the-agent-controller-fits) |

## Repository atlas

| Location | What you will find |
| --- | --- |
| [Root README](../README.md) | Project introduction, dated status and full research index |
| [Selected model](../selected-model.json) | Model identity, upstream revision, licensing and scope |
| [Four-bit study](../falcon-agent/fourbit-study/README.md) | Calibration, format, packed kernels, quality and shard validation |
| [Weight deployment](../falcon-agent/fourbit-study/DEPLOYMENT.md) | Creation encoding, deployment controls and recovery procedures |
| [Mainnet deployment records](../falcon-agent/fourbit-study/mainnet/) | Address manifest, receipt journal and batch reports |
| [Runtime](../falcon-agent/runtime/README.md) | Full bounded inference, numerical approximations, prepaid validation and reproduction |
| [Frontend integration](../falcon-agent/runtime/FRONTEND-INTEGRATION.md) | ABI/configuration use, tokenization, session creation, continuations and events |
| [Prepaid specification](../falcon-agent/runtime/PREPAID-BUDGET.md) | Exact quote, charging and settlement formulas |
| [Controller study](../falcon-agent/README.md) | Agent permissions, bounded actions, clones and scripted-engine tests |
| [Observatory record](../OBSERVATORY.md) | Website scope, achievements and simulation boundary |
| [Historical experiments](../EXPERIMENTS.md) | Earlier model, kernel and feasibility work |
| [Recovery status](../RECOVERY-STATUS.md) | Which historical experiments were recovered and which remain missing |
| [Model notice](../falcon-agent/licenses/NOTICE.md) | Technology Innovation Institute attribution and upstream terms |

## A small glossary

| Term | Meaning in GH0ST |
| --- | --- |
| Weight shard | A deployed data contract holding a consecutive part of the selected model export |
| Immutable index | The deployed lookup table that records the shard addresses and file metadata |
| Matrix kernel | Solidity arithmetic that computes bounded dot-product tiles from packed weights |
| Runtime | The contract that coordinates the full bounded inference state machine and its prepaid budget |
| Checkpoint | Persisted numerical state that lets a later transaction continue computation |
| Executor | The requester-selected address that submits continuation transactions and pays network fees first |
| Token | An integer from the pinned model vocabulary; the client converts between text and these IDs |
| Escrow quote | A conservative maximum refundable service deposit, calculated from work and fee caps |
| Withdrawal credit | An amount recorded for an account to withdraw explicitly |
| Local EVM mirror | Local deployment of the recorded code and shard bytes at matching addresses, with test environment overrides; not a mainnet inference receipt |

## How to read historical results

This repository retains successful, rejected and superseded experiments. A modeled gas figure, local receipt, public deployment receipt and maximum budget are different kinds of evidence. Some original reports describe an earlier stage that has since advanced. Use the current runtime receipt and spending record for the dated deployment snapshot, and retain earlier measurements in their original experimental context.

The guides were added against repository commit [`f1bb8ae`](https://github.com/8tk8m2kv9f-lang/GH0ST/commit/f1bb8ae065d624821ab54ac934592cb663adf72d), using its source and published reports. They are an explanatory layer over that record.
