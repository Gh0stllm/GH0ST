#!/usr/bin/env python3
"""Offline batched teacher continuations; save raw output before any filtering."""
import argparse,hashlib,json,os,re,time
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['HF_HUB_DISABLE_TELEMETRY']='1';os.environ['HF_HUB_DISABLE_PROGRESS_BARS']='1';os.environ['TOKENIZERS_PARALLELISM']='false'

FILTER_SCOPE = ('Superficial format, length, generated-ending and exact-duplicate checks only; '
                'not a semantic, coherence, originality or copying-quality pass.')
WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")
ENDING = re.compile(r'''[.!?](?:["'])?(?:\s|$)''')

def batch_count(index, maximum, batch_size):
    return min(batch_size, max(0, maximum-index))

def sha256_file(path):
    digest=hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()

def encode_prompt(tok, prompt):
    # Match SFT's native document boundary, with exactly one leading native token.
    start_id=tok.bos_token_id if tok.bos_token_id is not None else tok.eos_token_id
    if start_id is None:
        raise ValueError('Tokenizer has no native BOS/EOS token')
    ids=tok(prompt,add_special_tokens=False)['input_ids']
    native_ids={x for x in (tok.bos_token_id,tok.eos_token_id) if x is not None}
    if any(token in native_ids for token in ids):
        raise ValueError('Prompt contains a native BOS/EOS token; supply plain prompt text')
    return [start_id]+ids

def validate_prompt_budget(prompts, token_lengths, max_new, context_limit=1024):
    budget = context_limit-max_new
    for row, length in zip(prompts, token_lengths, strict=True):
        if length > budget:
            raise ValueError(f"Prompt {row.get('id', '<unnamed>')!r} has {length} tokens; limit is "
                             f"{budget} with {max_new} new tokens and a {context_limit}-token "
                             'context. No truncation was applied.')
    return budget

def filter_candidate(prompt, continuation, min_generated_words):
    # An ending already present in the prompt cannot qualify generated text.
    ends = list(ENDING.finditer(continuation))
    if not ends:
        return None, {'reason': 'no_generated_ending', 'retained_generated_words': 0}
    retained = continuation[:ends[-1].end()].rstrip()
    generated_words = len(WORD.findall(retained))
    details = {'retained_generated_words': generated_words,
               'retained_generated_characters': len(retained)}
    if generated_words < min_generated_words:
        return None, details | {'reason': 'too_few_generated_words'}
    clean = (prompt+retained).strip()
    if not 40 <= len(clean.split()) <= 220:
        return None, details | {'reason': 'short_or_long'}
    if re.search(r'https?://|www\.|```|\b(?:User|Assistant|System):', clean):
        return None, details | {'reason': 'nonprose'}
    return clean, details | {'reason': 'candidate_pass'}

def main():
    # Pure filtering tests can import this module without model or GPU imports.
    import torch
    from transformers import AutoModelForCausalLM,AutoTokenizer
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--prompts',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--device',choices=['cpu','mps'],default='cpu');p.add_argument('--batch',type=int,default=8);p.add_argument('--target-tokens',type=int,default=100000);p.add_argument('--max-candidates',type=int,default=5000);p.add_argument('--max-new',type=int,default=160);p.add_argument('--seed',type=int,default=82124)
    p.add_argument('--min-generated-words',type=int,default=40)
    a=p.parse_args();assert not a.out.exists();assert 0<a.max_new<=512
    assert a.batch>0 and a.target_tokens>0 and a.max_candidates>0 and a.min_generated_words>0
    torch.set_num_threads(2);torch.manual_seed(a.seed)
    tok=AutoTokenizer.from_pretrained(a.checkpoint,local_files_only=True,trust_remote_code=False);tok.pad_token=tok.eos_token;tok.padding_side='left'
    model=AutoModelForCausalLM.from_pretrained(a.checkpoint,local_files_only=True,trust_remote_code=False,use_safetensors=True,attn_implementation='eager',dtype=torch.float32).eval().to(a.device)
    prompts=[json.loads(line)for line in a.prompts.open()if line.strip()];assert prompts and all(isinstance(r['prompt'],str)and r['prompt'].strip()for r in prompts)
    context_limit=min(1024,int(model.config.max_position_embeddings))
    encoded_prompts=[encode_prompt(tok,r['prompt'])for r in prompts]
    token_lengths=[len(ids)for ids in encoded_prompts]
    prompt_budget=validate_prompt_budget(prompts,token_lengths,a.max_new,context_limit)
    checkpoint_hashes={f.name:sha256_file(f)for f in sorted(a.checkpoint.iterdir())if f.is_file()and (f.suffix in ('.json','.safetensors','.txt'))}
    a.out.mkdir(parents=True);generated=0;index=0;started=time.monotonic();seen=set();rawfile=(a.out/'raw.jsonl').open('w');accepted=(a.out/'candidate-paragraphs.jsonl').open('w');counts={name:0 for name in ('accepted','duplicates','no_generated_ending','too_few_generated_words','short_or_long','nonprose')};settings={'temperature':.8,'top_p':.9,'top_k':50,'repetition_penalty':1.08,'no_repeat_ngram_size':4}
    while generated<a.target_tokens and index<a.max_candidates:
        selected_indices=[(index+j)%len(prompts)for j in range(batch_count(index,a.max_candidates,a.batch))]
        selected=[prompts[i]for i in selected_indices]
        x=tok.pad({'input_ids':[encoded_prompts[i]for i in selected_indices]},return_tensors='pt',padding=True).to(a.device)
        assert x['input_ids'].shape[1]+a.max_new<=context_limit
        with torch.inference_mode():output=model.generate(**x,max_new_tokens=a.max_new,do_sample=True,use_cache=True,pad_token_id=tok.eos_token_id,**settings)
        for j,row in enumerate(selected):
            raw_ids=output[j,x['input_ids'].shape[1]:].tolist();ids=raw_ids[:raw_ids.index(tok.eos_token_id)]if tok.eos_token_id in raw_ids else raw_ids
            generated+=len(ids);continuation=tok.decode(ids,skip_special_tokens=True);text=(row['prompt']+continuation).strip()
            record=dict(row)|{'id':f'teacher-{index+j:06d}','prompt_id':row.get('id',str((index+j)%len(prompts))),'prompt_metadata':dict(row),'prompt':row['prompt'],'prompt_token_ids':encoded_prompts[selected_indices[j]],'native_start_token_id':encoded_prompts[selected_indices[j]][0],'continuation':continuation,'text':text,'generated_token_ids':ids,'raw_generated_token_ids_including_eos_padding':raw_ids,'candidate_only':True}
            clean,details=filter_candidate(row['prompt'],continuation,a.min_generated_words)
            if clean is not None:
                digest=hashlib.sha256(clean.encode()).hexdigest()
                if digest in seen:clean=None;details['reason']='duplicates'
                else:seen.add(digest)
            # Every attempt retains its complete raw continuation and token IDs.
            rawfile.write(json.dumps(record|{'candidate_filter':details},ensure_ascii=False)+'\n')
            if clean is None:counts[details['reason']]+=1;continue
            counts['accepted']+=1;accepted.write(json.dumps(record|{'text':clean,'trimmed_at_natural_ending':clean!=text,'candidate_filter':details,'candidate_filter_scope':FILTER_SCOPE,'candidate_pass_is_semantic_quality_pass':False,'source_kind':'local_gpt2_teacher','requires_semantic_and_copying_review':True},ensure_ascii=False)+'\n')
        index+=len(selected);rawfile.flush();accepted.flush();print(json.dumps({'generated_tokens':generated,'candidates':index,**counts}),flush=True)
    rawfile.close();accepted.close();report={'status':'GENERATION_COMPLETE_REVIEW_REQUIRED'if generated>=a.target_tokens else 'CANDIDATE_LIMIT_REACHED_REVIEW_REQUIRED','configuration':{k:str(v)if isinstance(v,Path)else v for k,v in vars(a).items()},'checkpoint_sha256':checkpoint_hashes.get('model.safetensors'),'checkpoint_files_sha256':checkpoint_hashes,'prompt_file_sha256':sha256_file(a.prompts),'sampler_source_sha256':sha256_file(Path(__file__)),'sampling':settings,'context_limit':context_limit,'prompt_token_budget':prompt_budget,'prompt_token_lengths':token_lengths,'prompt_format':'Exactly one native BOS/EOS token followed by plain prompt tokens; boundary token excluded from displayed text.','generated_tokens':generated,'candidates':index,'counts':counts,'seconds':time.monotonic()-started,'candidate_filter_scope':FILTER_SCOPE,'candidate_pass_is_semantic_quality_pass':False,'quality_approval':False,'downloads':0,'student_training_started':False}
    (a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
