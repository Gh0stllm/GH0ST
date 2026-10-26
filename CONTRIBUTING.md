# Contributing to GH0ST

GH0ST welcomes code improvements, bug reports, reproducible research, documentation fixes and new ideas. You can contribute without deploying contracts, spending funds or holding the research-support token. The initial publication used individual-file restoration; the [provenance guide](docs/PROVENANCE.md) explains the import history. Consult the [recovery record](docs/recovery/RECOVERY.md) for the documented surviving sources and missing material.

[Suggest an improvement](https://github.com/Gh0stllm/GH0ST/issues/new/choose) · [Browse issues](https://github.com/Gh0stllm/GH0ST/issues) · [Open pull requests](https://github.com/Gh0stllm/GH0ST/pulls) · [Project guide](docs/README.md)

## Ways to help

| Area | Useful contributions |
| --- | --- |
| Solidity inference | Reduce storage writes, continuation overhead and arithmetic costs while checking numerical behavior |
| Weight layout and kernels | Improve packed arithmetic, cross-shard reads and deployment encoding |
| Numerical validation | Broaden reference comparisons, context-length coverage and reproducible regression cases |
| Prepaid execution | Improve budget bounds, accounting tests and executor/client integration |
| Agent integration | Propose a reviewed bridge between the bounded runtime and the controller's typed actions |
| Frontend and tooling | Improve tokenization, confirmed progress display, integration instructions and developer usability |
| Research | Explore alternative execution approaches, including Stylus, with explicit chain prerequisites |
| Documentation | Clarify explanations, repair links and document reproducible results |

Documentation fixes and small reproductions are good first contributions. For a substantial redesign or a change to model behavior, open an improvement or research proposal first so maintainers and other contributors can discuss the approach.

## Suggest an improvement without writing code

1. Search existing issues and pull requests for related work.
2. [Choose an issue form](https://github.com/Gh0stllm/GH0ST/issues/new/choose): bug report, improvement/optimization, or research proposal. A blank issue is also available.
3. Identify the affected file or subsystem, describe the problem and explain your proposed approach.
4. Include a small example, measurements or references where available. An untested idea is welcome when clearly described as a proposal.

Comments on existing issues are also welcome. You do not need collaborator access to make a suggestion.

## Submit a code change

Fork the repository into your own GitHub account, clone your fork and create a branch:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/GH0ST.git
cd GH0ST
git remote add upstream https://github.com/Gh0stllm/GH0ST.git
git switch -c improve/describe-your-change
```

Keep the change focused. Run the checks relevant to the files you changed, then commit and push your branch:

```bash
git add PATHS_YOU_CHANGED
git commit -m "Describe the improvement"
git push -u origin improve/describe-your-change
```

Replace the username and path placeholders with your own values. Open a pull request from your fork's branch to this repository's `main` branch. Describe the problem, resulting behavior, validation and any tradeoffs. Link the related issue using `Refs #NUMBER`, or `Closes #NUMBER` when the PR fully resolves it.

Maintainers review changes before merging. Opening an issue or PR does not grant write access to the repository. Draft pull requests are welcome for work in progress.

## Find the relevant checks

This is a collection of research studies with separate environments and harnesses. There is no single root-level test command covering the entire repository.

| Changed area | Start with |
| --- | --- |
| Bounded runtime and prepaid execution | [Runtime reproduction instructions](falcon-agent/runtime/README.md#reproduce), `validate_evm.py`, `validate_quality.py` and `validate_client.py` |
| Four-bit layout and kernels | [Four-bit reproduction instructions](falcon-agent/fourbit-study/README.md#reproduce), arithmetic/cross-shard checks and applicable full-matrix benchmarks |
| Controller or factory | [Controller study](falcon-agent/README.md), `falcon-agent/test_agent.py` and its scripted-engine tests |
| Earlier experiments | The README and pinned tooling in the affected study directory |
| Documentation or templates | Check links, formatting and consistency with the cited source records |

The Falcon runtime instructions use Solidity 0.8.30, Anvil, the pinned checkpoint/export and prepared reference traces. Follow the linked study's environment and artifact preparation instructions; cloning the repository alone does not supply every model binary. [Recovery and artifact information](docs/recovery/RECOVERY.md).

Run experiments locally using the relevant harness. A contribution does not require a mainnet deployment or paid inference. Source changes do not update immutable contracts that have already been deployed.

If you cannot run a check, state exactly which check was not run and why. Share reproducible commands and useful report excerpts rather than describing an unexecuted check as passing.

## Present optimization evidence clearly

For gas or performance changes, compare the baseline and candidate under the same compiler settings, input, model/export and environment. State:

- The baseline commit and candidate commit, changed files and compiler/optimizer settings.
- Whether measurements are local EVM results, CPU results, modeled estimates or public receipts.
- The exact workload: prompt/output lengths, matrix shapes, batch sizes or other relevant bounds.
- Before/after gas, transaction count, deployment size/cost and numerical agreement where applicable.
- Any quality change, new assumption or extra runtime/deployment cost introduced.

A matrix benchmark is different from complete token generation. A maximum escrow is different from expected consumption. Keep original-model quality comparisons separate from agreement with the same quantized weights. Link to generated reports and pinned artifacts where possible. [Evidence guide](docs/EVIDENCE.md).

A Stylus proposal should state whether it was tested on a chain with the required support, or remains a feasibility estimate. Proposed savings should identify their measured or modeled basis.

## Preserve the research record

Publish related source, tests and results together in focused commits. Batch future file imports and identify their source and verification method in the commit description; do not use one-file upload counts as a development milestone. Preserve existing history and distinguish newly executed experiments from imported reports. A new independent reproduction should record its source commit, commands, environment, output and any differences from the published result.

Keep existing experiment reports, deployment receipts, manifests and upstream notices intact. Add a new dated report or candidate artifact for a new result rather than rewriting a historical measurement. Clearly separate a proposal, local validation and public deployment.

Retain existing attribution and source-file license identifiers. The repository contains source and model artifacts under different terms; consult the relevant files and [upstream model notice](falcon-agent/licenses/NOTICE.md) before reuse or redistribution. These contribution instructions do not replace existing licenses or grant additional rights.

Use respectful, technical discussion. Explain disagreements with evidence, and make it easy for the next contributor to reproduce what you found.
