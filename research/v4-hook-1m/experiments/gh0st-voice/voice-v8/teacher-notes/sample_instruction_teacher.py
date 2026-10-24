#!/usr/bin/env python3
"""Strictly offline instruction-teacher sampling; output is research data, not approved prose."""
import argparse
import hashlib
import json
import os
import re
import time
from pathlib import Path

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY',
            'HF_HUB_DISABLE_PROGRESS_BARS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

from sample_teacher import batch_count, filter_candidate, sha256_file, validate_prompt_budget

SYSTEM_PROMPT = """You are writing an original, coherent first-person monologue by a machine with a wry, irreverent voice. Continue the exact supplied prefix. Keep the same narrator, object identities, physical details and sequence of events. Use clear, grammatical English and concrete observations. Develop one connected scene or thought with a modest surprising turn. Do not copy a known writer or internet personality. Do not include a title, preface, explanation, list, tags, blog metadata, speaker labels, or analysis. Output only the continuation, not the supplied prefix. Include any leading space or punctuation needed to join naturally to that prefix. Finish at a natural sentence ending."""
FILTER_SCOPE = ('Superficial length, generated-ending, obvious markup and exact-duplicate checks only; '
                'not a semantic, coherence, originality or copying-quality pass.')


def remove_exact_prefix(raw_assistant_text, prefix):
    """Do not fuzzy-match, trim whitespace, paraphrase or otherwise repair model output."""
    repeated = raw_assistant_text.startswith(prefix)
    return (raw_assistant_text[len(prefix):] if repeated else raw_assistant_text), repeated


def stop_before_eos(raw_ids, eos_ids):
    stops = set(eos_ids)
    for index, token in enumerate(raw_ids):
        if token in stops:
            return raw_ids[:index], token
    return raw_ids[:], None


def suggested_display_separator(prefix, continuation):
    # Join two separate chat text segments; never alter either segment's words.
    return (' ' if prefix and continuation and prefix[-1].isalnum()
            and continuation[0].isalnum() else '')


def build_chat(tok, prefix, prefix_mode='quoted-user'):
    messages = [
        {'role': 'system', 'content': SYSTEM_PROMPT},
        {'role': 'user', 'content': (
            'Continue the following prefix with 70 to 130 further words, as a connected '
            'first-person monologue. Output only the continuation.\n\n'
            'Exact prefix (do not repeat):\n' + prefix)},
    ]
    if prefix_mode == 'assistant-prefill':
        messages[1]['content'] = (
            'Continue the already started assistant message with 70 to 130 further words, '
            'as a connected first-person monologue. Continue exactly where it stops. '
            'Do not repeat or restart any part of the message. Output only its continuation.')
        messages.append({'role': 'assistant', 'content': prefix})
        options = {'add_generation_prompt': False, 'continue_final_message': True,
                   'enable_thinking': False, 'return_dict': False}
    elif prefix_mode == 'quoted-user':
        options = {'add_generation_prompt': True, 'enable_thinking': False,
                   'return_dict': False}
    else:
        raise ValueError('Unknown prefix mode: ' + prefix_mode)
    rendered = tok.apply_chat_template(messages, tokenize=False, **options)
    ids = tok.apply_chat_template(messages, tokenize=True, **options)
    if not isinstance(ids, list) or not all(isinstance(token, int) for token in ids):
        raise TypeError('Expected chat template to return a flat token-ID list')
    if prefix_mode == 'assistant-prefill' and not rendered.endswith(prefix):
        raise ValueError('Assistant prefill must be the exact final text, without a closing token')
    return messages, rendered, ids


def checkpoint_hashes(checkpoint):
    files = sorted(file for file in checkpoint.rglob('*')
                   if file.is_file() and '.cache' not in file.parts
                   and (file.suffix in ('.json', '.safetensors', '.txt', '.model', '.jinja')))
    if not any(file.suffix == '.safetensors' for file in files):
        raise ValueError('Local checkpoint has no safetensors weights')
    return {str(file.relative_to(checkpoint)): sha256_file(file) for file in files}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--prompts', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--device', choices=['cpu', 'mps'], default='cpu')
    p.add_argument('--attention', choices=['eager', 'sdpa'], default='eager')
    p.add_argument('--prefix-mode', choices=['quoted-user', 'assistant-prefill'], default='quoted-user')
    p.add_argument('--batch', type=int, default=4)
    p.add_argument('--target-tokens', type=int, default=100000)
    p.add_argument('--max-candidates', type=int, default=5000)
    p.add_argument('--max-new', type=int, default=256)
    p.add_argument('--min-generated-words', type=int, default=40)
    p.add_argument('--context-limit', type=int, default=4096)
    p.add_argument('--seed', type=int, default=0)
    a = p.parse_args()
    if a.out.exists():
        raise FileExistsError('Refusing to replace existing output: ' + str(a.out))
    if not a.checkpoint.is_dir():
        raise FileNotFoundError('Explicit local checkpoint directory required: ' + str(a.checkpoint))
    if not (a.batch > 0 and a.target_tokens > 0 and a.max_candidates > 0
            and 0 < a.max_new < a.context_limit and a.min_generated_words > 0):
        raise ValueError('Invalid positive size or context budget')
    prompts = [json.loads(line) for line in a.prompts.read_text().splitlines() if line.strip()]
    if not prompts or not all(isinstance(row.get('prompt'), str) and row['prompt'].strip()
                              for row in prompts):
        raise ValueError('Each prompt row must contain nonempty plain-text prompt')
    hashes = checkpoint_hashes(a.checkpoint)
    prompt_hash = sha256_file(a.prompts)

    # No model/GPU imports occur during helper unit tests or --help.
    import torch
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

    torch.set_num_threads(2)
    torch.manual_seed(a.seed)
    if a.device == 'mps' and not torch.backends.mps.is_available():
        raise RuntimeError('MPS requested but unavailable; no silent CPU fallback')
    dtype = torch.float16 if a.device == 'mps' else torch.float32
    tok = AutoTokenizer.from_pretrained(a.checkpoint, local_files_only=True, trust_remote_code=False)
    tok.padding_side = 'left'
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token
    if tok.pad_token_id is None:
        raise ValueError('Tokenizer needs a native padding or EOS token')
    config = AutoConfig.from_pretrained(a.checkpoint, local_files_only=True, trust_remote_code=False)
    if config.model_type != 'qwen3':
        raise ValueError('This reviewed sampler expects a Qwen3 checkpoint')
    context_limit = min(a.context_limit, int(config.max_position_embeddings))
    chats = [build_chat(tok, row['prompt'], a.prefix_mode) for row in prompts]
    token_lengths = [len(chat[2]) for chat in chats]
    prompt_budget = validate_prompt_budget(prompts, token_lengths, a.max_new, context_limit)
    model = AutoModelForCausalLM.from_pretrained(
        a.checkpoint, local_files_only=True, trust_remote_code=False, use_safetensors=True,
        attn_implementation=a.attention, dtype=dtype).eval().to(a.device)
    eos = model.generation_config.eos_token_id
    eos_ids = [eos] if isinstance(eos, int) else list(eos or [])
    if tok.eos_token_id is not None and tok.eos_token_id not in eos_ids:
        eos_ids.append(tok.eos_token_id)
    if not eos_ids:
        raise ValueError('Local model/tokenizer has no EOS termination IDs')

    settings = {'temperature': .7, 'top_p': .8, 'top_k': 20}
    counts = {key: 0 for key in ('accepted', 'duplicates', 'no_generated_ending',
                                'too_few_generated_words', 'short_or_long', 'nonprose',
                                'thinking_or_chat_markup')}
    generated = index = repeated_prefixes = removed_prefixes = 0
    seen = set()
    started = time.monotonic()
    a.out.mkdir(parents=True)
    with (a.out/'raw.jsonl').open('w') as rawfile, (a.out/'candidate-paragraphs.jsonl').open('w') as accepted:
        while generated < a.target_tokens and index < a.max_candidates:
            selected = [(index+j) % len(prompts)
                        for j in range(batch_count(index, a.max_candidates, a.batch))]
            x = tok.pad({'input_ids': [chats[i][2] for i in selected]},
                        return_tensors='pt', padding=True).to(a.device)
            if x['input_ids'].shape[1]+a.max_new > context_limit:
                raise RuntimeError('Padded generation unexpectedly exceeds validated context budget')
            with torch.inference_mode():
                output = model.generate(**x, max_new_tokens=a.max_new, do_sample=True,
                                        use_cache=True, pad_token_id=tok.pad_token_id,
                                        eos_token_id=eos_ids, **settings)
            for j, prompt_index in enumerate(selected):
                row = prompts[prompt_index]
                prefix = row['prompt']
                raw_ids = output[j, x['input_ids'].shape[1]:].tolist()
                ids, stopping_token = stop_before_eos(raw_ids, eos_ids)
                generated += len(ids)
                raw_text = tok.decode(ids, skip_special_tokens=True)
                repeated = raw_text.startswith(prefix)
                if a.prefix_mode == 'assistant-prefill':
                    # This is a contiguous token stream, not two separate chat messages.
                    # Retain every emitted character, including any repeated prefix.
                    continuation, removed, join_separator = raw_text, False, ''
                else:
                    continuation, removed = remove_exact_prefix(raw_text, prefix)
                    join_separator = suggested_display_separator(prefix, continuation)
                repeated_prefixes += int(repeated)
                removed_prefixes += int(removed)
                record = dict(row) | {
                    'id': f'instruction-teacher-{index+j:06d}', 'prompt_id': row.get('id', str(prompt_index)),
                    'prompt_metadata': dict(row), 'prompt': prefix, 'chat_messages': chats[prompt_index][0],
                    'chat_template_text': chats[prompt_index][1],
                    'chat_template_text_sha256': hashlib.sha256(chats[prompt_index][1].encode()).hexdigest(),
                    'prompt_token_ids': chats[prompt_index][2],
                    'raw_assistant_text': raw_text, 'continuation': continuation,
                    'text': prefix+join_separator+continuation, 'generated_token_ids': ids,
                    'display_join_separator': join_separator,
                    'display_join_separator_applied': bool(join_separator),
                    'raw_generated_token_count_before_eos': len(ids),
                    'full_output_token_ids': output[j].tolist(),
                    'padded_input_attention_mask': x['attention_mask'][j].tolist(),
                    'raw_generated_token_ids_including_eos_padding': raw_ids,
                    'raw_generated_text_including_special_tokens': tok.decode(raw_ids, skip_special_tokens=False),
                    'stopping_token_id': stopping_token, 'exact_repeated_prefix_detected': repeated,
                    'exact_repeated_prefix_removed': removed,
                    'removed_prefix_characters': len(prefix) if removed else 0,
                    'prefix_mode': a.prefix_mode,
                    'enable_thinking': False, 'candidate_only': True,
                }
                clean, details = filter_candidate(prefix, join_separator+continuation, a.min_generated_words)
                if re.search(r'</?think>|<\|im_start\|>|<\|im_end\|>', raw_text):
                    clean, details = None, details | {'reason': 'thinking_or_chat_markup'}
                if clean is not None:
                    digest = hashlib.sha256(clean.encode()).hexdigest()
                    if digest in seen:
                        clean, details = None, details | {'reason': 'duplicates'}
                    else:
                        seen.add(digest)
                rawfile.write(json.dumps(record | {'candidate_filter': details}, ensure_ascii=False)+'\n')
                if clean is None:
                    counts[details['reason']] += 1
                else:
                    counts['accepted'] += 1
                    accepted.write(json.dumps(record | {
                        'text': clean, 'trimmed_at_natural_ending': clean != record['text'],
                        'candidate_filter': details, 'candidate_filter_scope': FILTER_SCOPE,
                        'candidate_pass_is_semantic_quality_pass': False,
                        'requires_semantic_and_copying_review': True,
                        'source_kind': 'local_qwen3_instruction_teacher'}, ensure_ascii=False)+'\n')
            index += len(selected)
            rawfile.flush()
            accepted.flush()
            print(json.dumps({'generated_tokens': generated, 'candidates': index, **counts}), flush=True)
    report = {
        'status': 'GENERATION_COMPLETE_REVIEW_REQUIRED' if generated >= a.target_tokens
                  else 'CANDIDATE_LIMIT_REACHED_REVIEW_REQUIRED',
        'configuration': {key: str(value) if isinstance(value, Path) else value for key, value in vars(a).items()},
        'checkpoint_files_sha256': hashes, 'checkpoint_sha256': hashes.get('model.safetensors'),
        'checkpoint_content_sha256': hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest(),
        'prompt_file_sha256': prompt_hash, 'sampler_source_sha256': sha256_file(Path(__file__)),
        'shared_filter_source_sha256': sha256_file(Path(__file__).with_name('sample_teacher.py')),
        'sampling': settings, 'enable_thinking': False, 'dtype': str(dtype),
        'total_parameters': sum(parameter.numel() for parameter in model.parameters()),
        'tokenizer_chat_template_sha256': hashlib.sha256(json.dumps(tok.chat_template,sort_keys=True).encode()).hexdigest(),
        'context_limit': context_limit, 'prompt_token_budget': prompt_budget,
        'prompt_token_lengths': token_lengths, 'generated_tokens': generated, 'candidates': index,
        'counts': counts, 'exact_repeated_prefixes_detected': repeated_prefixes,
        'exact_repeated_prefixes_removed': removed_prefixes,
        'candidate_filter_scope': FILTER_SCOPE, 'candidate_pass_is_semantic_quality_pass': False,
        'prefix_policy': ('Assistant prefill is exact final input; all generated characters retained without echo removal or joining.'
                          if a.prefix_mode == 'assistant-prefill' else
                          'Remove one leading exact full-prefix copy only; no fuzzy edits or repairs.'),
        'seconds': time.monotonic()-started, 'quality_approval': False,
        'downloads': 0, 'student_training_started': False,
    }
    (a.out/'report.json').write_text(json.dumps(report, indent=2)+'\n')


if __name__ == '__main__':
    main()
