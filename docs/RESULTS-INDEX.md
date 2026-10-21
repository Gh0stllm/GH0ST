# Results and evidence index

[Documentation](README.md) · [Evidence and costs](EVIDENCE.md) · [Project home](../README.md)

Use this index to find the report behind a claim. Records describe their own dated experiments; an older result is not a current network quote or the status of every research branch. The files remain in their original locations so existing scripts, citations and manifests keep working.

## Deployed Falcon weights and runtime

| Question | Source record | Scope |
| --- | --- | --- |
| Which weight contracts were deployed? | [Four-bit address manifest](../falcon-agent/fourbit-study/mainnet/deployment-manifest.json) and [deployment journal](../falcon-agent/fourbit-study/mainnet/deployment-state.json) | Public weight/kernel/index deployment records |
| Where is the final weight-stage reconciliation? | [Batch 4 report](../falcon-agent/fourbit-study/mainnet/batch-0004.md) and [reconciliation](../falcon-agent/fourbit-study/mainnet/batch-0004-reconciliation.json) | Completed four-bit deployment stage; excludes the subsequently deployed runtime |
| What was deployed for token generation? | [Runtime receipt and verification](../falcon-agent/runtime/mainnet-runtime.json) | Runtime creation and bytecode verification; not a paid chat receipt |
| How are deployment costs itemized? | [Accounting and milestone](../falcon-agent/runtime/ACCOUNTING-AND-MILESTONE.md) | Deployment fees, historical pilots and local inference are accounted for separately |
| Which bytes and interfaces identify the runtime? | [Runtime pin](../falcon-agent/runtime/pinned-runtime.json), [frontend ABI](../falcon-agent/runtime/frontend-abi.json) and [frontend configuration](../falcon-agent/runtime/frontend-config.json) | Artifact identity and integration inputs |

## Inference, numerical checks and payments

| Record | What it establishes | Important boundary |
| --- | --- | --- |
| [Prepaid chat validation](../falcon-agent/runtime/prepaid-chat-validation.json) | Local bounded inference, continuation gas and payment/refund behavior | Local EVM mirror with simulated fees; not public execution |
| [Reference validation](../falcon-agent/runtime/reference-validation.json) and [quality validation](../falcon-agent/runtime/quality-validation.json) | Fixed-point reference and short numerical regressions | Numerical agreement on the tested inputs is not general model accuracy |
| [Client validation](../falcon-agent/runtime/client-validation.json) | Quote and unsigned client-call preparation checks | Does not operate a production executor |
| [Payment probe source](../falcon-agent/runtime/tests/PaymentProbe.sol) | Adversarial local caller used for repeated advancement and withdrawal reentry checks | Test fixture; explicitly excluded from deployed runtime bytecode |
| [Historical chat validation](../falcon-agent/runtime/evm-chat-validation.json), [baseline](../falcon-agent/runtime/evm-baseline-validation.json) and [cached variant](../falcon-agent/runtime/evm-cached64-validation.json) | Earlier runtime measurements | Different artifacts and workloads must not be conflated with the prepaid build |
| [Controller tests](../falcon-agent/agent-test-results.json) and [scripted engine](../falcon-agent/fixtures/ScriptedEngine.sol) | Controller permissions, action bounds and state transitions | Scripted outputs are not language-model inference |

The [runtime guide](../falcon-agent/runtime/README.md) defines the workload, reproduction prerequisites and remaining integration work. The [prepaid budget specification](../falcon-agent/runtime/PREPAID-BUDGET.md) separates maximum escrow from measured consumption.

## Weight quality, layouts and optimization

| Study | Readable report | Machine-readable evidence |
| --- | --- | --- |
| Selected four-bit candidate | [Four-bit study](../falcon-agent/fourbit-study/README.md) | [Selected manifest](../falcon-agent/fourbit-study/selected-manifest.json), [held-out quality](../falcon-agent/fourbit-study/heldout-quality.json), [full matrix results](../falcon-agent/fourbit-study/full-results.json) |
| Lossless creation encoding | [Deployment guide](../falcon-agent/fourbit-study/DEPLOYMENT.md) | [Creation validation](../falcon-agent/fourbit-study/creation-validation.json), [migration validation](../falcon-agent/fourbit-study/creation-migration-validation.json) |
| Five-bit candidate | [Five-bit study](../falcon-agent/fivebit-study/README.md) | [Measurement summary](../falcon-agent/fivebit-study/measurement-summary.json), [quality results](../falcon-agent/fivebit-study/quality-results.json) |
| Six-bit matrix optimization | [Six-bit study](../falcon-agent/sixbit-optimization/README.md) | [Full matrix results](../falcon-agent/sixbit-optimization/full-matrix-results.json), [weight manifest](../falcon-agent/sixbit-optimization/weight-manifest.json) |
| Exact arithmetic and layout refinements | [Gas refinement](../falcon-agent/gas-refinement/README.md) | [Validated candidates](../falcon-agent/gas-refinement/validated-candidates.json), [rejected experiments](../falcon-agent/gas-refinement/rejected-experiments.json), [provenance](../falcon-agent/gas-refinement/provenance.json) |
| Earlier NF4 layout | [Quantization and deployment study](../falcon-agent/OPTIMIZATION-AND-DEPLOYMENT.md) | [Historical deployment model](../falcon-agent/historical-weight-layouts/deployment-manifest.json), [historical weight manifest](../falcon-agent/historical-weight-layouts/selected-weight-manifest.json) |
| Exact compression and architectural alternatives | [Quality-preserving research](../falcon-agent/research-quality/RESEARCH.md) | [Lossless results](../falcon-agent/research-quality/lossless-results.json), [architecture results](../falcon-agent/research-quality/architecture-results.json) |

Matrix benchmarks measure selected arithmetic, not a full token or reply. Historical layout estimates are not deployment receipts. Keep quality comparisons tied to the checkpoint, quantization and evaluation set stated in each report.

## The root `results/` collection

This directory primarily preserves earlier LFM and Stylus studies. Later Falcon reports live beside their implementations above.

| Family | Start with | Supporting records |
| --- | --- | --- |
| CPU reference | [First-run report](../RESULTS.md) | [Reference outputs](../results/reference.json), [RPC snapshot](../results/rpc.json) |
| Solidity slice and chain comparison | [Chain comparison](../CHAIN-COMPARISON.md) | [Local contract results](../results/contract-local.json), [Robinhood simulation](../results/contract-robinhood-simulation.json), [comparison validation](../results/comparison-validation.json) |
| Complete first-block experiments | [Test report](../TEST-RESULTS.md) | [Test summary](../results/test-summary.json), [initial block](../results/block-local.json), [optimized batch 8](../results/block-optimized-batch8-local.json) |
| Kernel optimization | [Optimization report](../OPTIMIZATION-RESULTS.md) | [Optimization summary](../results/optimization-summary.json), [fast six-lane sweep](../results/kernel-sweep-fast6.json), [unrolled sweep](../results/kernel-sweep-unrolled.json) |
| Compiled fixed weights | [Compiled-weight report](../COMPILED-WEIGHTS-RESULTS.md) | [Summary](../results/compiled-weight-summary.json), [kernel results](../results/compiled-weight-kernels.json) |
| Precision and model behavior | [Block study](../block-benchmark/README.md) | [Precision stress](../results/precision-stress.json), [quality sweep](../results/quality-sweep.json), [tool quality](../results/tool-quality.json) |
| Stylus/Wasm feasibility | [Stylus study](../stylus-benchmark/README.md) | [Compiled-Wasm checks](../results/stylus-wasm-tests.json), [native-test log](../results/stylus-native-tests.log), [mainnet parameter snapshot](../results/stylus-runtime.json), [testnet snapshot](../results/stylus-runtime-testnet.json) |

Files named `initial-attempt`, `failure`, `retry` or ending in `.log` preserve failed attempts and diagnostic context. Read them alongside the corresponding final report. Local Wasm tests do not measure Nitro gas; dated chain snapshots do not prove today's activation status.

## Artifact and recovery boundaries

[Binary inventory](../binary-artifacts.json) records omitted binary artifacts and their hashes. [Recovery status](../RECOVERY-STATUS.md) identifies historical rounds that were not recovered. A missing original result cannot be reconstructed by filling in a table; the source artifact or a separately labeled new experiment is required.
