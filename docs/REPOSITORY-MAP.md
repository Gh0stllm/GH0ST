# Repository map

[Documentation](README.md) · [Research directory](RESEARCH.md) · [Results index](RESULTS-INDEX.md) · [Artifacts](ARTIFACTS.md)

GH0ST is a collection of independently reproducible studies. The recovery staging tree assembles the surviving Falcon research, S0UL model/runtime, website, Genesis and artifacts for the new repository’s `main` branch. Individual-file restoration is in progress; this map describes the prepared local tree, not a completed remote upload. Source files, evidence and executable paths retain their recovered locations. See the [recovery record](recovery/RECOVERY.md) for provenance and missing material.

## Recovered projects and artifacts

| Location | Purpose | Entry point |
| --- | --- | --- |
| `s0ul-1m/` | S0UL-1M model, tokenizer, training, integer reference and full Solidity runtime research | [Model guide](../s0ul-1m/README.md) · [Solidity runtime](../s0ul-1m/FULL-SOLIDITY.md) |
| `s0ul-1m/reports/` | Preserved training, validation, integer comparison and local EVM evidence | [20-lane campaign](../s0ul-1m/reports/hard-max-39630021281/SUMMARY.md) · [build tracker](../s0ul-1m/BUILD-STATUS.md) |
| `website/` | Latest surviving saved Observatory frontend and random-mint-fix package | [Homepage source](../website/index.html) · [mint interface](../website/mint/index.html) |
| `website/qwen/` | Recovered Qwen frontend, tokenizer, model metadata and archive index | [Interface](../website/qwen/index.html) · [publication index](../website/qwen/archive-index.json); original backend/research branch unavailable |
| `genesis/` | Recovered NFT contract project, collection generators, metadata and marketplace assets | [Genesis recovery guide](../genesis/README.md) |
| `artifacts/s0ul/` | Selected 20-lane checkpoint, preceding baseline, integer/mixed exports and frozen v3 dataset | [Saved bundles](../artifacts/s0ul/) |
| `artifacts/genesis/` | Original complete 495-artwork collection package, including PNG and SVG originals | [Collection archive](../artifacts/genesis/GH0ST-Genesis-495.zip) |
| `artifacts/large-files/` | Split original model binaries with complete and per-part hashes | [Reconstruction guide](../artifacts/large-files/README.md) |
| `assets/recovered/` | Saved paper, article, logos, images and animation | [Recovered media](../assets/recovered/) |

## Core Falcon implementation

| Location | Purpose | Entry point |
| --- | --- | --- |
| `falcon-agent/runtime/` | Bounded inference, fixed-point reference, prepaid execution and client integration | [Runtime guide](../falcon-agent/runtime/README.md) |
| `falcon-agent/fourbit-study/` | Selected four-bit export, packed kernels and cross-shard reads | [Format and validation](../falcon-agent/fourbit-study/README.md) |
| `falcon-agent/fourbit-study/mainnet/` | Deployed addresses, receipts and completed batch reports | [Deployment manifest](../falcon-agent/fourbit-study/mainnet/deployment-manifest.json) |
| `falcon-agent/` | Model selection, quality studies and the separate agent-controller prototype | [Controller and model guide](../falcon-agent/README.md) |
| `selected-model.json` | Pinned selected model identity and revision | [Model record](../selected-model.json) |

## Research and benchmarks

| Location | Purpose | Entry point |
| --- | --- | --- |
| `falcon-agent/gas-refinement/` | Exact-weight kernel and metadata experiments | [Gas refinement](../falcon-agent/gas-refinement/README.md) |
| `falcon-agent/sixbit-optimization/` | Earlier six-bit packing and matrix measurements | [Six-bit study](../falcon-agent/sixbit-optimization/README.md) |
| `falcon-agent/fivebit-study/` | Intermediate five-bit encoding and quality study | [Five-bit study](../falcon-agent/fivebit-study/README.md) |
| `falcon-agent/research-quality/` | Compression and quality-preserving alternatives | [Research report](../falcon-agent/research-quality/RESEARCH.md) |
| `falcon-agent/rh-deployment/` | Historical six-bit deployment pilots | [Pilot records](../falcon-agent/rh-deployment/README.md) |
| `contract-benchmark/` | LFM Solidity arithmetic and deployment benchmarks | [Contract benchmarks](../contract-benchmark/README.md) |
| `block-benchmark/` | Full-block kernels, compiled weights and arithmetic variants | [Block benchmarks](../block-benchmark/README.md) |
| `stylus-benchmark/` | Rust/Wasm feasibility, ABI and recorded runtime probes | [Stylus study](../stylus-benchmark/README.md) |
| `flan-t5-baseline/` | Historical FLAN-T5 quality and reference-runtime comparison | [Baseline guide](../flan-t5-baseline/README.md) |
| `distillation-pilot/` | Historical stopped pilots and their recorded outcomes | [Pilot guide](../distillation-pilot/README.md) |

## Evidence, documentation and community

| Location | Purpose |
| --- | --- |
| [Documentation hub](README.md) | Reading routes, architecture, payments and evidence boundaries |
| [Research directory](RESEARCH.md) | Recovered tracks and explicitly unavailable historical Qwen/sub1b branch references |
| [Results index](RESULTS-INDEX.md) | Grouped entry points to machine-readable measurements and logs |
| [Root research reports](../EXPERIMENTS.md) | Historical narrative; root report filenames remain valid |
| [Artifact guide](ARTIFACTS.md) | Historical artifact references; [current recovery record](recovery/RECOVERY.md) describes locally recovered bytes and upload status |
| [Contribution guide](../CONTRIBUTING.md) | Proposals, focused PRs and reproducibility requirements |
| [Security policy](../SECURITY.md) | Reporting sensitive vulnerabilities without exposing exploit details |
| [License guide](LICENSES.md) | Existing upstream notices and terms by component |
| [Known gaps](KNOWN-GAPS.md) | Unavailable records and implementation work still requiring evidence |

## Recovery and branch conventions

The new repository’s target `main` tree brings the recovered projects together; it is not restricted to the former Falcon-only overview. Original branch names and account URLs in historical documents are provenance references. They do not assert that the original remote branches are available or that their complete histories were restored. The [research directory](RESEARCH.md) separates recovered paths from unavailable Qwen/sub1b work.

The 43 surviving pre-recovery commits and both surviving research branch refs are preserved locally. Individual-file publication transfers file contents with new commits, not those original commits or refs. Remote restoration remains in progress until upload and verification records establish completion.

When contributing, keep executable paths, model inputs, checkpoint destinations and report-publisher paths stable. Use an independent checkout and coordinate any future structural migration with the owners of affected experiments.
