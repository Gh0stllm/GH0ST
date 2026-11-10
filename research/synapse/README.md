# GH0ST SYNAPSE

A research prototype for composing a tiny neural model from separately deployed Solidity modules. A shared backbone supplies positional embeddings and the language-model head. Two expert contracts process the intermediate activations. An immutable graph combines their outputs and credits module beneficiaries for paid inference.

## Current status

The 894-parameter model is trained on an original synthetic corpus. Its exact integer reference and 63 trace fixtures are available in [model/](model/README.md). The Solidity modules compile with Solidity 0.8.30. Local EVM integration, payment accounting and gas measurements are in progress.

The model and experts are authored by the GH0ST project. Separate deployment accounts will demonstrate different fee recipients. An external contributor integration remains a later milestone.

## Architecture

- [SynapseModules.sol](contracts/SynapseModules.sol) stores signed int16 weights in immutable bytecode shards and runs the Q8 embedding, expert and projection operations.
- [SynapseGraph.sol](contracts/SynapseGraph.sol) composes one backbone and two compatible experts, selects the next token and accounts for exact ERC20 payments.
- [reference.py](model/reference.py) independently computes every intermediate activation and logit with matching signed integer division.

The v1 graph accepts the specific published neural kernels. Contributors can publish new weights against the same backbone representation. Tensor dimensions alone do not demonstrate useful compatibility. Module quality must be measured against the resulting model.

The payment token is fixed when a graph is deployed. Robinhood's GH0ST token is `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`. The local proof uses a mock token. Module prices and recipients are fixed, fees are credited only after successful computation and exact funding, and beneficiaries withdraw their credits separately. Public weights can be copied, so payment accounting applies to use through a paid graph.

## Research scope

This is a small two-token-context neural language model with a 30-token vocabulary. The reported accuracy concerns its synthetic training corpus. A new expert and a new graph can demonstrate a different output while preserving the backbone.

Existing relevant work includes [Microsoft's onchain model training](https://github.com/microsoft/0xDeCA10B), [Zirconium's composable neural proofs](https://ethglobal.com/showcase/zirconium-3632e), [SMART's inference framework](https://huangjunqin.com/assets/pdf/HuangWWW2024Advancing.pdf), and [ML2SC's Solidity neural-network generation](https://arxiv.org/abs/2404.16967). The research question here concerns actual EVM tensor computation across separately published weight modules with atomic payment accounting. Global novelty remains unestablished.
