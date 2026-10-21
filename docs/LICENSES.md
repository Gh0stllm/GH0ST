# Licenses and attribution

[Documentation](README.md) · [Contribution guide](../CONTRIBUTING.md) · [Project home](../README.md)

GH0ST contains original source, upstream dependencies, model-derived data and preserved research records. There is no new repository-wide license in this guide. Read the applicable source-file identifiers, bundled notices and upstream terms before reusing or redistributing an artifact.

GH0ST is built using artificial intelligence technology from the Technology Innovation Institute.

## Find the applicable record

| Component | Included license or notice | Reading note |
| --- | --- | --- |
| Falcon model and derived weight representations | [Falcon notice](../falcon-agent/licenses/NOTICE.md), [preserved license](../falcon-agent/licenses/FALCON-LICENSE.html), [acceptable-use policy](../falcon-agent/licenses/FALCON-ACCEPTABLE-USE.txt) | The notice pins the checkpoint and documents modifications. It does not license unrelated GH0ST source. |
| Historical LiquidAI/LFM studies | [LFM Open License](../LFM-LICENSE.txt), [modified model-data notice](../block-benchmark/data/NOTICE.txt), [compiled-weight notice](../block-benchmark/compiled-weight-data/NOTICE.txt) | Changing weight representation does not replace the upstream model terms. |
| FLAN-T5 baseline | [Apache 2.0 text](../flan-t5-baseline/APACHE-2.0.txt), [upstream model card](../flan-t5-baseline/UPSTREAM-MODEL-CARD.md) | Consult the pinned model and provenance in the [baseline guide](../flan-t5-baseline/README.md). |
| Historical distillation pilots | [Apache 2.0 text](../distillation-pilot/APACHE-2.0.txt), [SmolLM2 model card](../distillation-pilot/UPSTREAM-MODEL-CARD.md), [T5 student card](../distillation-pilot/t5-pilot/STUDENT-UPSTREAM-MODEL-CARD.md), [T5 teacher card](../distillation-pilot/t5-pilot/TEACHER-UPSTREAM-MODEL-CARD.md) | These are distinct model and training records; the bundled text is not a blanket grant for every repository artifact. |
| Stylus SDK dependency | [Copyright notice](../stylus-benchmark/licenses/Stylus-SDK-COPYRIGHT.md), [Apache 2.0 text](../stylus-benchmark/licenses/Stylus-SDK-Apache-2.0), [MIT text](../stylus-benchmark/licenses/Stylus-SDK-MIT) | The preserved upstream notice also describes upstream contribution and trademark terms. |
| GH0ST implementation files | License identifiers and notices in the individual source files; [contribution guide](../CONTRIBUTING.md#preserve-the-research-record) | An SPDX identifier on implementation code does not relicense model weights or third-party material. |

The Falcon notice links to the [upstream model terms](https://falconllm.tii.ae/falcon-terms-and-conditions.html). Its bundled policy snapshot was retrieved on 20 October 2026; the notice explains checking upstream policy changes. This index preserves that provenance without asserting that a saved policy is the latest version.

## Preserved Stylus notice: link map

The original [Stylus SDK copyright notice](../stylus-benchmark/licenses/Stylus-SDK-COPYRIGHT.md) uses filenames from the upstream repository. It is preserved unchanged, so three relative links do not resolve inside this renamed bundle:

| Link in the upstream notice | Location in this repository |
| --- | --- |
| `Apache-2.0` | [Stylus-SDK-Apache-2.0](../stylus-benchmark/licenses/Stylus-SDK-Apache-2.0) |
| `MIT` | [Stylus-SDK-MIT](../stylus-benchmark/licenses/Stylus-SDK-MIT) |
| `DCO.txt` | Not included in this snapshot. No substitute DCO or sign-off requirement is introduced here. |

The [Stylus study](../stylus-benchmark/README.md#primary-sources) identifies the inspected SDK source and revision. Refer to that upstream project for its contribution requirements. GH0ST contributions follow the repository's own [contribution guide](../CONTRIBUTING.md).

## Preserve provenance when contributing

- Retain upstream license files, modification notices and source-file identifiers.
- Identify the model, pinned revision and representation when adding model-derived artifacts.
- Keep historical notices intact; add a separately dated clarification when needed.
- Do not infer a license from public availability or from an adjacent file. If applicable terms are absent or unclear, resolve them before reuse or redistribution.

This guide organizes the existing records and grants no additional rights.
