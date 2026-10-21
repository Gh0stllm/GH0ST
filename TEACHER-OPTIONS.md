# Teacher choice for a student below 100 million parameters

Research checked 20 October 2026. This comparison concerns **gpt-oss-20b and the DeepSeek-R1 family**, not every OpenAI or DeepSeek model. Neither family has been used in the bundled local pilots.

## Recommendation

Use gpt-oss-20b as the first candidate for generating checked chat replies and structured action examples. This is an engineering choice based on its documented function calling and structured output support, **not a measured claim that it distills better below 100M**. DeepSeek-R1-Distill-Qwen-1.5B is a much smaller teacher to host and a reasonable lower-resource comparator. Full DeepSeek-R1 is a substantially larger hosting task.

| Candidate teacher | Documented size | Implication for this experiment |
|---|---|---|
| gpt-oss-20b | 21B total, 3.6B active | Relevant agent interface; the official Transformers guide describes about 16GB VRAM with supported MXFP4 hardware. |
| DeepSeek-R1 | 671B total, 37B active | Source of published reasoning distills; full self-hosting exceeds this CPU workspace. |
| DeepSeek-R1-Distill-Qwen-1.5B | Nominal 1.5B | A Qwen-derived model already taught by R1; substantially smaller to host. Using it is a second distillation stage, not direct use of the full R1 teacher. |

Teacher hosting size and student quality are different questions. A larger or stronger teacher does not guarantee a stronger tiny student. Capacity-gap research supports testing teacher/student combinations. We found no controlled gpt-oss-versus-DeepSeek comparison establishing a winner for our sub-100M chat/action workload. DeepSeek's official released distills start at 1.5B, well above our target.

## Distillation method

Keep a separate pretrained student under 100M parameters. Generate short, task-specific responses with each teacher offline, check their facts/action arguments against deterministic ground truth, and train the student on the accepted text. Teacher and student tokenizers may differ for this sequence-level method. The bundled logit-KL pilots require aligned vocabulary indices; those scripts cannot directly substitute gpt-oss or DeepSeek logits.

Compare the same student initialization, prompt distribution, accepted training-token budget, optimization settings and held-out cases. Record rejected teacher examples and generation costs as well as student scores. Include an SFT-only control, several seeds, exact arguments, missing arguments, negation, state-dependent requests, conversation quality and output length. Freeze the evaluation set before training and use fresh cases after exploratory tests influence model selection.

Short verified outputs are our initial training design. We have not established that removing reasoning traces improves quality; any reasoning-trace variant needs its own experiment. A sub-100M student should be scoped and measured as a specialist. General GPT-OSS or DeepSeek reasoning capability is not promised.

Only the student would execute on-chain at runtime. Teacher choice does not itself reduce on-chain gas: student architecture, arithmetic, context and generated-token count determine the work. Neither new pilot has a complete on-chain implementation or gas measurement.

## Attribution and practical access

gpt-oss is Apache-2.0. DeepSeek-R1's release is MIT and explicitly permits distillation; its Qwen-derived checkpoints also have upstream Apache-2.0 provenance. Preserve notices and verify the exact chosen checkpoint and any hosting-provider terms before distributing a derivative.

An accurate future description would be “a compact on-chain agent distilled from gpt-oss-20b” only after that teacher has actually been used and runtime inference has actually been implemented on-chain. The current checkpoints derive from SmolLM2 and T5/FLAN-T5. Neither is a GPT-OSS or DeepSeek distill.

## Primary sources

- https://developers.openai.com/api/docs/models/gpt-oss-20b — size, license and agent capabilities.
- https://developers.openai.com/cookbook/articles/gpt-oss/run-transformers — hardware and precision requirements; these vary by runtime.
- https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B — full R1 sizes, released distills, training provenance and licenses.
- https://aclanthology.org/2025.acl-long.1097/ — capacity-gap research; not a GPT-OSS/DeepSeek sub-100M head-to-head.
