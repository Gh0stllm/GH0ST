# Getting started

[Documentation](README.md) · [Architecture](ARCHITECTURE.md) · [FAQ](FAQ.md) · [Contributing](../CONTRIBUTING.md)

Start by inspecting the published records. Reading the source, reports and contract manifests needs no wallet, model download or training run.

## Choose a starting point

| Goal | Read first | Then inspect |
| --- | --- | --- |
| Understand the system | [Architecture](ARCHITECTURE.md) | [Request lifecycle](REQUEST-LIFECYCLE.md) |
| Verify a reported achievement | [Evidence and costs](EVIDENCE.md) | The primary report linked beside the claim |
| Find the deployed Falcon contracts | [Runtime receipt](../falcon-agent/runtime/mainnet-runtime.json) | [Weight address manifest](../falcon-agent/fourbit-study/mainnet/deployment-manifest.json) |
| Explore the original studies | [Experiment guide](../EXPERIMENTS.md) | The README inside the relevant study directory |
| Integrate a client | [Frontend integration](../falcon-agent/runtime/FRONTEND-INTEGRATION.md) | [Configuration](../falcon-agent/runtime/frontend-config.json) and [ABI](../falcon-agent/runtime/frontend-abi.json) |
| Suggest an improvement | [Contribution guide](../CONTRIBUTING.md) | [Issue forms](https://github.com/8tk8m2kv9f-lang/GH0ST/issues/new/choose) |

The main-branch Falcon guides describe a dated research snapshot. Experimental branches can contain newer work with a different model, layout or deployment method. Read the branch's own records before combining results.

## Inspect an independent checkout

Choose a new directory outside any running experiment's checkout:

```bash
git clone --single-branch --branch main https://github.com/8tk8m2kv9f-lang/GH0ST.git GH0ST-review
cd GH0ST-review
git rev-parse HEAD
git status --short
```

Record the commit SHA alongside your notes. It identifies the exact source and documentation you inspected. Browsing this checkout does not require installing dependencies or running repository scripts.

For a contribution, follow the [fork-and-branch instructions](../CONTRIBUTING.md#submit-a-code-change). Keep independent studies in separate checkouts, environments and output directories. Do not repoint a running job's checkout, alter its environment, or reuse its writable checkpoint/cache paths for an unrelated experiment.

## Check artifact availability before reproducing

| Artifact | Where to look | What to verify |
| --- | --- | --- |
| Falcon model identity | [Selected model record](../selected-model.json) | Exact upstream model and revision |
| Selected four-bit export | [Format and pins](../falcon-agent/fourbit-study/README.md#format-and-pins) | Export variant, file hash and expected layout |
| Historical binary inventory | [binary-artifacts.json](../binary-artifacts.json) | Relative filename, size and SHA-256 |
| Recovered archive information | [Archive record](../README.md#complete-recovered-archive) and [releases](https://github.com/8tk8m2kv9f-lang/GH0ST/releases) | Asset availability, archive name and published checksum |
| Unrecovered history | [Recovery status](../RECOVERY-STATUS.md) | Which original source/results are still unavailable |
| Upstream terms | [Falcon notice](../falcon-agent/licenses/NOTICE.md) and the study's included notices | Terms covering the selected model and dependencies |

Cloning Git does not provide every weight file or checkpoint. An inventory entry records an artifact; it does not supply its bytes. If a required archive or export cannot be obtained and verified, document the missing input before attempting that reproduction. Do not replace a missing historical result with a new estimate.

## Reproduce one study at a time

There is no universal repository-wide setup or test command. Use the environment and preparation steps belonging to the selected study:

| Study | Authoritative instructions | Scope |
| --- | --- | --- |
| Falcon bounded inference and escrow | [Runtime reproduction](../falcon-agent/runtime/README.md#reproduce) | Local code mirror, prepared trace/export and numerical/payment checks |
| Four-bit weights and matrix kernels | [Four-bit reproduction](../falcon-agent/fourbit-study/README.md#reproduce) | Pinned checkpoint, local export preparation and loopback EVM benchmarks |
| Earlier model and kernel work | [Historical experiment guide](../EXPERIMENTS.md) | Study-specific environments and original workloads |
| Rust/Wasm kernel | [Stylus reproduction](../stylus-benchmark/README.md#reproduce) | Local Rust/Wasm checks; network probes are separate steps |

The runtime instructions require the prepared checkpoint, selected export, reference trace, Solidity 0.8.30 and Anvil. Follow their exact prerequisites before running commands. Several harnesses generate files or write reports, so direct new work to your isolated checkout and preserve existing published results.

A documentation change needs link and formatting review. It does not need a model benchmark, training run, deployment or funded inference session. For computational changes, record only checks actually completed and keep local measurements distinct from public-chain receipts.

## Report what you found

Include the inspected commit, affected path, expected behavior, observed result and the smallest useful reproduction. Use the [evidence guide](EVIDENCE.md) to label measurements and the [security guide](../SECURITY.md) for potentially exploitable findings.
