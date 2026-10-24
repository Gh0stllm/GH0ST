---
license: apache-2.0
language:
  - en
  - es
tags:
  - conversational
  - personality
  - anti-sycophancy
  - stem
  - tutor
  - bilingual
  - claude-distillation
  - opus
  - zipf-weighted
  - density-optimized
  - sharegpt
  - fine-tuning
size_categories:
  - 1K<n<10K
task_categories:
  - text-generation
  - conversational
pretty_name: Opus-Candid Training Data
---

# Opus-Candid Training Data

The complete dataset behind the [Opus-Candid model family](https://huggingface.co/Verdugie) — multi-turn conversations distilled from Claude Opus 4.6, designed to train authentic conversational personality and STEM pedagogy into open-weight models.

All files are **ShareGPT format**, directly compatible with TRL, Axolotl, LLaMA-Factory, and most fine-tuning frameworks.

---

## Training Data

| File | Version | Conversations | Purpose |
|------|---------|---------------|---------|
| `v2.1_combined_6771conv.json` | V2.1 | 6,771 | Gravity chain architecture — Zipfian topic drift with overlap node reinforcement. Trained the V2/V2.1 generation. |
| `v3_train_1558conv.json` | V3 | 1,558 | 4D training tensor — topic, response length, psychological register, conversational position. Trained [8B V3](https://huggingface.co/Verdugie/Opus-Candid-8B-V3), [MoE V3](https://huggingface.co/Verdugie/Opus-Candid-MoE-V3), [27B V3](https://huggingface.co/Verdugie/Opus-Candid-27B-V3). |
| `v35_personality_5358conv.json` | V3.5 | 5,358 | 6-dimensional Zipf scoring with parameter-aware density equilibrium. Three generation layers (core + Wave 1 + Wave 2). Trained [27B V3.5](https://huggingface.co/Verdugie/Opus-Candid-27B-V3.5). |
| `stem_oracle_5179conv.json` | STEM-Oracle | 5,179 | Oracle-soul architecture applied to STEM pedagogy — tiered depth, error correction, Socratic method, cross-domain bridges. Trained [STEM-Oracle-27B](https://huggingface.co/Verdugie/STEM-Oracle-27B). |

---

## Architecture Specifications

Detailed methodology papers are available in the `papers/` directory:

| Paper | Covers |
|-------|--------|
| `papers/Opus-Candid-V3-Architecture-Spec.docx` | Research-grounded Zipf-weighted topic distribution, 4D training tensor, demographic overlay, generation protocol |
| `papers/Opus-Candid-V3.5-STEM-Oracle-Architecture-Spec.docx` | 6-dimensional Zipf scoring, parameter-aware density equilibrium, quantization survival architecture, oracle-soul framework |

---

## Format

```json
[
  {
    "conversations": [
      {"from": "human", "value": "user message"},
      {"from": "gpt", "value": "assistant response"},
      {"from": "human", "value": "follow-up"},
      {"from": "gpt", "value": "response"}
    ]
  }
]
```

---

## Models Trained on This Data

| Model | Base | Dataset | Status |
|-------|------|---------|--------|
| [Opus-Candid-8B-V1](https://huggingface.co/Verdugie/Opus-Candid-8B-V1) | Qwen 2.5 7B | V1 | Archived |
| [Opus-Research-8B-V1.5](https://huggingface.co/Verdugie/Opus-Research-8B-V1.5) | Qwen 2.5 7B | V1.5 | Archived |
| [Opus-Candid-14B-V1](https://huggingface.co/Verdugie/Opus-Candid-14B-V1) | Qwen 2.5 14B | V1 | Archived |
| [Opus-Candid-32B-V1](https://huggingface.co/Verdugie/Opus-Candid-32B-V1) | Qwen 2.5 32B | V1 | Archived |
| [Opus-Candid-70B-V1](https://huggingface.co/Verdugie/Opus-Candid-70B-V1) | Qwen 2.5 72B | V1 | Archived |
| [Opus-Candid-Lite-4B](https://huggingface.co/Verdugie/Opus-Candid-Lite-4B) | Qwen 3 4B | V3 | Active |
| [Opus-Candid-8B-V3](https://huggingface.co/Verdugie/Opus-Candid-8B-V3) | Qwen 3 8B | V3 | Active |
| [Opus-Candid-MoE-V3](https://huggingface.co/Verdugie/Opus-Candid-MoE-V3) | Qwen 3 30B-A3B | V3 | Active |
| [Opus-Candid-27B-V3](https://huggingface.co/Verdugie/Opus-Candid-27B-V3) | Qwen 3.5 27B | V3 | Active |
| [Opus-Candid-27B-V3.5](https://huggingface.co/Verdugie/Opus-Candid-27B-V3.5) | Qwen 3.5 27B | V3.5 | Active |
| [STEM-Oracle-27B](https://huggingface.co/Verdugie/STEM-Oracle-27B) | Qwen 3.5 27B | STEM-Oracle | Active |

---

## License

Apache 2.0 — use it however you want.

---

## Citation

```bibtex
@misc{opus-candid-2026,
  title={Opus-Candid Training Data: Zipf-Weighted Conversational Personality Distillation},
  author={Verdugo, Saul},
  year={2026},
  url={https://huggingface.co/datasets/Verdugie/opus-candid-training-data}
}
```

---

*Built by [Saul Verdugo](https://huggingface.co/Verdugie) — independent ML researcher. OpusReasoning@proton.me*
