# Training S0UL-1M within a CPU budget

Research note: 21 October 2026. Recommendations below preserve the current
984,192-parameter architecture. They are proposed experiments, not measured
improvements. No external teacher weights, paid API or GPU service were used
to write this note.

## Immediate recommendation

Prioritize the expanded compositional supervised dataset before adding a
teacher. Our action labels are already generated from explicit rules, so a
teacher cannot make those labels more authoritative. Its useful additional
contribution would be varied natural-language wording, subject to review.

The first pilot's held-out records show a concrete problem: correct action
syntax does not imply the right operation or arguments. Examples include a
request to save `arabic` producing the memorized value `hindi`. The original
test report records zero exact matches for MEM_SET, TASK_ADD and TASK_DONE.
This is a reason to improve compositional interpretation and copying, rather
than to assume that more repeated examples or quantization work solves it.

## Data changes with no extra parameters

1. Train on many distinct requests, not repetitions distinguished only by a
   synthetic block number. Remove incidental context or draw it independently
   from the same distribution across splits.
2. Give copying an explicit curriculum: short identifiers and values first,
   then longer strings, mixed digits and unfamiliar combinations of familiar
   bytes. Hold out complete values and combinations, while exposing their
   constituent characters in training.
3. Preserve contrastive minimal pairs: execute/wait, complete/missing
   argument, own/another user's data, supported/unsupported operation, and
   single/multiple requested actions. The grammar currently supports one
   action, so ambiguous multiple actions need an explicit clarification label.
4. Hold out entire template families and base scenarios. A teacher paraphrase
   and its original request must stay in the same split. Also publish a small,
   independently authored challenge set after checkpoint selection.
5. Keep the tokenizer pinned. It contains whole tokens for several original
   held-out words; those token rows may have no positive training examples.
   A byte-copy curriculum gives a clearer compositional test. Changing the
   dictionary requires a new tokenizer version and retraining; it cannot be
   silently applied to existing checkpoints.

The compositional dataset is still synthetic. A high result would establish
performance on that distribution, not general language understanding or safe
autonomous contract execution.

## Optional offline teacher

The smallest practical first candidate for a bounded CPU paraphrasing trial
is **HuggingFaceTB/SmolLM2-135M-Instruct**. Its official model card documents
CPU use and Apache-2.0 licensing. It also reports limited instruction-following
performance and warns of factual and logical errors; it is not an oracle for
our permission or action rules. A larger optional comparison is
**Qwen/Qwen2.5-0.5B-Instruct**, whose official card also identifies Apache-2.0.
Pin the exact revision and preserve applicable notices before using either.

Do not put either teacher inside every student training step on a CPU. First
run a small, fixed paraphrasing trial; retain the original checked action
target and cache any accepted text. Record the source example, exact teacher
revision, prompt, generation settings, output hash and review outcome. Verify
literal arguments and inspect negation/ownership preservation. Schema checks
alone cannot establish that a paraphrase kept the same meaning.

No teacher importer has been added merely to make a distillation claim. Until
actual teacher outputs are produced and reviewed, the current objective
remains **supervised learning on rule-labelled examples**.

## Why ordinary logit distillation does not fit

Our vocabulary has 512 slots with byte/domain pieces. The proposed teachers
use different vocabularies and token boundaries. Their next-token logits
cannot simply be compared with the student's logits using ordinary KL
divergence. Matching vector lengths by truncation or comparing equal numeric
token IDs would compare unrelated events.

Sequence-level text distillation avoids that direct mismatch: decoded teacher
text can be tokenized by the student. For this project, reviewed paraphrases
with deterministic canonical action targets are the simplest useful version.
Cross-tokenizer logit alignment is possible, but methods such as Universal
Logit Distillation add a separate research problem and do not establish that
it is worthwhile for a 1M-parameter action model.

The GKD work identifies the difference between teacher-forced training
prefixes and student-generated prefixes. A practical lesson here is to inspect
free-running generations and collect additional **training-split** failure
cases. Merely adding such cases is not an implementation of GKD, and final
test failures must not be repeatedly fed back into training while retaining
the same test as an untouched benchmark.

## Selection and integer deployment target

Select checkpoints using a fixed validation protocol that reports full greedy
action-and-argument accuracy per action, along with token loss. Teacher-forced
token accuracy and valid formatting can hide wrong copied values. Record the
number of checks and training tokens; a fixed run is a bounded experiment,
not proof that the model has reached its maximum possible capability.

Measure float versus integer **validation** performance before deciding that
quantization-aware training is the next priority. If their outputs mostly
agree but both misunderstand requests, data/learning remains the bottleneck.
If integer conversion materially reduces quality, test a separate late-stage
QAT experiment. Weight fake quantization alone does not model our integer
RMSNorm, Q14 saturation, rotary tables and approximate softmax. Any experiment
must say exactly which of those effects it simulates and use the final integer
reference for evaluation. The LLM-QAT results motivate testing this approach;
their much larger-model results do not predict S0UL's gain.

## Primary sources

- Kim Y, Rush AM. [Sequence-Level Knowledge Distillation](https://arxiv.org/abs/1606.07947). EMNLP 2016.
- Boizard N, et al. [Towards Cross-Tokenizer Distillation: the Universal Logit Distillation Loss for LLMs](https://arxiv.org/abs/2402.12030). TMLR 2025.
- Agarwal R, et al. [On-Policy Distillation of Language Models: Learning from Self-Generated Mistakes](https://arxiv.org/abs/2306.13649). ICLR 2024.
- Liu Z, et al. [LLM-QAT: Data-Free Quantization Aware Training for Large Language Models](https://arxiv.org/abs/2305.17888). 2023.
- [Official SmolLM2-135M-Instruct model card and license declaration](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct).
- [Official Qwen2.5-0.5B-Instruct model card](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) and [Apache-2.0 license file](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/main/LICENSE).
