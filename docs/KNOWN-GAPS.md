# Known gaps and evidence boundaries

[Documentation](README.md) · [Research directory](RESEARCH.md) · [Artifacts](ARTIFACTS.md) · [Contributing](../CONTRIBUTING.md)

This is a documentation audit of `main` at [`0c82d527`](https://github.com/8tk8m2kv9f-lang/GH0ST/commit/0c82d527564dc6c081f16f7d05898c5b33b655cf), dated 21 October 2026. It is not a new training evaluation or a live service-status report.

## Documentation gaps addressed

| Gap | Added route |
| --- | --- |
| Newer work was difficult to discover from `main` | [Research directory](RESEARCH.md) with branch-specific entry points |
| No unified first-visit and environment orientation | [Getting started](GETTING-STARTED.md) and [FAQ](FAQ.md) |
| Source, results and historical reports were interleaved without a full map | [Repository map](REPOSITORY-MAP.md) and [results index](RESULTS-INDEX.md) |
| Archive availability and model prerequisites were scattered | [Artifact guide](ARTIFACTS.md), linked to the existing release and manifests |
| No dedicated sensitive-vulnerability reporting guide | [Security policy](../SECURITY.md) |
| Upstream licensing references were difficult to navigate | [License guide](LICENSES.md), preserving original notices |

The scan found no zero-byte tracked files on the audited `main` snapshot and no empty substantive project-authored documentation sections. Intentional exception handlers and unsupported test-harness hooks are not unimplemented product features.

## Gaps requiring original evidence or engineering

| Area | Remaining boundary | What would close it |
| --- | --- | --- |
| Historical recovery | Later six-bit rounds and the final 50-experiment series are absent | Recover original source and raw results; see [recovery status](../RECOVERY-STATUS.md) |
| Falcon paid public inference | The dated main-branch record includes local inference and public deployment, not a completed paid mainnet chat | A complete public session with receipts, output verification and reconciled charges; see [evidence](EVIDENCE.md) |
| Falcon controller integration | Controller fixtures use a scripted engine; the bounded runtime has a different interface | Reviewed integration and end-to-end evidence; see [architecture](ARCHITECTURE.md#how-the-agent-controller-fits) |
| S0UL capability and full on-chain execution | Training and evaluation evolve on a separate branch | Read the [build tracker](https://github.com/8tk8m2kv9f-lang/GH0ST/blob/research/GH0ST-S0UL-1M/s0ul-1m/BUILD-STATUS.md); a documentation edit cannot establish new capability or deployment |
| Cross-branch completeness | A branch or partial report is not a completed experiment | Verify the branch's run status, pinned artifacts and final report before making a completion claim |
| Upstream notice links | Some preserved model cards and the Stylus copyright notice contain unresolved links | Use [the license map](LICENSES.md); preserve upstream wording and do not invent missing license/DCO text |

These entries document the gaps; they do not mark them resolved. The organization changes do not add a new inference runtime, reconstruct unavailable results or alter training.
