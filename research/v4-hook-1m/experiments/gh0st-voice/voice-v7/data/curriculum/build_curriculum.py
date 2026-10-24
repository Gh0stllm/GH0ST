#!/usr/bin/env python3
"""Instantiate original typed grammar episodes for TRAINING ONLY.

No model, network, runtime response bank, or evaluation prompt is used.
Each selected path takes four ordered, semantically compatible mini-scenes.
"""
from pathlib import Path
from collections import Counter,defaultdict
import hashlib,itertools,json,re,statistics,unicodedata
from frames import FRAMES,CONTEXTS
HERE=Path(__file__).resolve().parent
WORD=re.compile(r"[a-z]+(?:'[a-z]+)*")
STAGES=['observed_problem','adjustment','verification','reflection']
def sha(b):return hashlib.sha256(b).hexdigest()
def words(t):return WORD.findall(unicodedata.normalize('NFKD',t).lower().replace('’',"'"))
def ranked(text):return sha(('voice-v7-curriculum-v1:'+text).encode())
def save(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def main():
 assert len(FRAMES)==40 and len({f['id']for f in FRAMES})==40
 family_order=sorted([f['id']for f in FRAMES],key=ranked)
 split_map={name:('train'if i<32 else'validation'if i<36 else'test')for i,name in enumerate(family_order)}
 all_paths=list(itertools.product(range(2),repeat=4))
 rows=defaultdict(list);counts=Counter();lengths=[];seen=set();family_stats={}
 for frame in FRAMES:
  family=frame['id'];split=split_map[family];contexts=CONTEXTS[frame['context_class']]
  assert len(frame['objects'])==7 and len(contexts)==10
  frame_count=Counter();offset=int(ranked(family)[:8],16)%10
  for oi,item in enumerate(frame['objects']):
   for ci,context in enumerate(contexts):
    use_split='test_combinations'if split=='train'and ci==(oi+offset)%10 else split
    paths=sorted(all_paths,key=lambda bits:ranked(f'{family}:{oi}:{ci}:{bits}'))[:10]
    for bits in paths:
     scenes=[frame['stages'][step][bits[step]].format(item=item,where=context)for step in range(4)]
     text='\n\n'.join(scenes);tokens=words(text)
     assert 100<=len(tokens)<=160,(family,bits,len(tokens))
     assert text.count('.')==8,(family,bits,'must be exactly8sentences')
     assert '{'not in text and '}'not in text
     digest=sha(' '.join(tokens).encode());assert digest not in seen,(family,'duplicate episode');seen.add(digest)
     identity=f'curriculum-v1-{family}-{oi:02d}-{ci:02d}-'+''.join(map(str,bits))
     row={'id':identity,'group_id':'curriculum-v1:frame:'+family,'split':use_split,'source_kind':'original_typed_curriculum','semantic_frame_id':family,'semantic_object':item,'context':context,'action':frame['action'],'expected_result':frame['expected_result'],'stage_order':STAGES,'stage_path':list(bits),'word_count':len(tokens),'text':text}
     rows[use_split].append(row);counts[use_split+'_episodes']+=1;counts[use_split+'_words']+=len(tokens);lengths.append(len(tokens));frame_count[use_split]+=1
  family_stats[family]={'family_split':split,'episodes':dict(frame_count),'context_class':frame['context_class'],'action':frame['action'],'expected_result':frame['expected_result']}
 for split in ['train','validation','test','test_combinations']:
  rows[split].sort(key=lambda r:r['id'])
  (HERE/f'{split}.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n'for r in rows[split]))
 groups={s:{r['semantic_frame_id']for r in rows[s]}for s in ['train','validation','test']}
 assert all(not(groups[a]&groups[b])for a,b in itertools.combinations(groups,2))
 train_bindings={(r['semantic_frame_id'],r['semantic_object'],r['context'])for r in rows['train']}
 combo_bindings={(r['semantic_frame_id'],r['semantic_object'],r['context'])for r in rows['test_combinations']}
 assert not train_bindings&combo_bindings
 for family in groups['train']:
  t=[r for r in rows['train']if r['semantic_frame_id']==family];c=[r for r in rows['test_combinations']if r['semantic_frame_id']==family]
  assert {r['semantic_object']for r in c}<={r['semantic_object']for r in t}
  assert {r['context']for r in c}<={r['context']for r in t}
 save(HERE/'semantic-frames.json',{'stages':STAGES,'contexts':CONTEXTS,'families':FRAMES})
 train_vocab=Counter(w for r in rows['train']for w in words(r['text']))
 save(HERE/'train-word-counts.json',train_vocab.most_common())
 coverage=None;vocab_path=HERE.parents[1]/'training/encoded-base/vocabulary.json'
 if vocab_path.exists():
  vocab=set(json.loads(vocab_path.read_text()));coverage={'vocabulary_path':str(vocab_path),'vocabulary_sha256':sha(vocab_path.read_bytes()),'splits':{}}
  for split,values in rows.items():
   cnt=Counter(w for r in values for w in words(r['text']));total=sum(cnt.values());missing=sum(n for w,n in cnt.items()if w not in vocab)
   coverage['splits'][split]={'words':total,'unknown_words':missing,'known_fraction':1-missing/total,'most_frequent_unknown':[(w,n)for w,n in cnt.most_common()if w not in vocab][:40]}
 report={'status':'PASS_STRUCTURAL_CHECKS_NOT_A_MODEL_RESULT','purpose':'Synthetic original typed grammar curriculum used only as training examples. No templates or sentence bank execute at inference.','episode_construction':'Four consecutive two-sentence stages: observe one problem, complete a matching adjustment, verify its expected effect, reflect on that same result.','authored_semantic_families':len(FRAMES),'authored_paired_stage_patterns':sum(len(s)for f in FRAMES for s in f['stages']),'authored_sentence_patterns':sum(2*len(s)for f in FRAMES for s in f['stages']),'typed_objects_per_family':7,'valid_contexts_per_family':10,'stage_paths_per_binding':10,'counts':dict(counts),'total_episodes':len(seen),'total_paired_mini_scenes':len(seen)*4,'total_words':sum(lengths),'episode_words':{'min':min(lengths),'max':max(lengths),'mean':statistics.mean(lengths)},'exact_normalized_episode_duplicates':0,'cross_split_family_overlap':0,'heldout_combination_overlap':0,'family_split_method':'Hash-ranked32train/4validation/4test semantic families before generation. Within training families, one of10contexts per object is reserved exclusively for test_combinations; all individual objects and contexts remain present in training.','test_combinations_policy':'Separate compositional diagnostic only. It deliberately shares semantic families and sentence constructions with training but uses unseen object/context pairs. Never mix it into train/validation/test.','family_stats':family_stats,'existing_vocabulary_coverage':coverage,'known_limitations':['Instantiated episode counts are not counts of independently authored plots. The source has40 causal families and640 authored sentence patterns.','The curriculum is intentionally narrow and repetition-rich, for syntax/causal consistency. It should complement independent original prose and cannot establish general language ability.','No human has individually reviewed every instantiation; structural typing and sampled review reduce but cannot eliminate awkward phrasing.','No V7 held-out evaluation prompts, no GPT2 outputs, no V6 data mutations and no network or chain actions were used.'],'files':{f'{s}.jsonl':{'sha256':sha((HERE/f'{s}.jsonl').read_bytes()),'bytes':(HERE/f'{s}.jsonl').stat().st_size}for s in ['train','validation','test','test_combinations']},'generator_sha256':sha(Path(__file__).read_bytes()),'frames_sha256':sha((HERE/'frames.py').read_bytes())}
 save(HERE/'report.json',report)
 # One fixed path per family shows complete episodes for manual source review.
 samples=[min([r for values in rows.values()for r in values if r['semantic_frame_id']==f['id']],key=lambda r:ranked(r['id']))for f in FRAMES]
 save(HERE/'review-samples.json',samples)
 print(json.dumps({k:report[k]for k in ['status','counts','total_episodes','total_words','episode_words','existing_vocabulary_coverage']},indent=2))
if __name__=='__main__':main()
