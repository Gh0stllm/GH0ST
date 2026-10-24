"""Local vocabulary remap and corpus preparation. Preserves architecture and reserved IDs."""
from pathlib import Path
import argparse,collections,hashlib,json,re,sys,unicodedata
import numpy as np
import torch
from tokenizers import Tokenizer,Regex,models,pre_tokenizers,normalizers,decoders
from transformers import AutoTokenizer,AutoModelForCausalLM,PreTrainedTokenizerFast
HERE=Path(__file__).resolve().parent;RECOVERY=HERE.parent;V3=RECOVERY.parent;VOICE=V3.parent;RESEARCH=VOICE.parents[1]
WORD=re.compile(r"[a-z]+(?:'[a-z]+)*|[0-9]|[^\w\s]")
def save(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,indent=2)+'\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def norm(s):
 s=unicodedata.normalize('NFKC',s).lower().replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('—','-').replace('–','-')
 return ' '.join(s.strip().strip('"').split())
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=RECOVERY/'prepared-grammar');ap.add_argument('--new-data',type=Path,required=True);ap.add_argument('--replay-data',type=Path,required=True);a=ap.parse_args();out=a.output;out.mkdir(parents=True,exist_ok=False)
 torch.set_num_threads(2);torch.manual_seed(20261024)
 base=RESEARCH/'experiments/simplestories-v2/model-cache';old=AutoTokenizer.from_pretrained(base,local_files_only=True)
 rows=[];sources=[]
 for split in ['train','validation','test']:
  path=V3/'data/mixed-teacher-v4-final'/f'{split}.jsonl';sources.append({'path':str(path),'sha256':sha(path)})
  for line in path.open():
   r=json.loads(line);r['text']=norm(r['text']);rows.append(r)
 for path in [a.new_data/f'{s}.jsonl' for s in ['train','validation','test']]:
  assert path.exists(), 'New corpus must have frozen train/validation/test files'
  sources.append({'path':str(path),'sha256':sha(path)})
  for line in path.open():
   r=json.loads(line)
   if r.get('split') not in ['train','validation','test']:continue
   r['text']=norm(r['text']);r['source_kind']='authored';r['new_original_voice']=True;rows.append(r)
 for path in [a.replay_data/f'{s}.jsonl' for s in ['train','validation','test']]:
  sources.append({'path':str(path),'sha256':sha(path)})
  for line in path.open():
   r=json.loads(line);r['text']=norm(r['text']);r['source_kind']='licensed_teacher';r['grammar_replay']=True;rows.append(r)
 ids_seen=set();group_splits={};input_counts=collections.Counter();input_lexical_tokens=collections.Counter()
 for r in rows:
  assert r['id'] not in ids_seen, 'Duplicate id: '+r['id'];ids_seen.add(r['id'])
  group=r.get('group_id',r.get('family_id',r.get('conversation_id')))
  if group:
   g=(r['source_kind'],str(group));assert g not in group_splits or group_splits[g]==r['split'], 'Group leaks across split: '+str(g);group_splits[g]=r['split']
  input_counts[r['split'],r['source_kind']]+=1;input_lexical_tokens[r['split'],r['source_kind']]+=len(WORD.findall(r['text']))
 train=[r for r in rows if r['split']=='train'];voice=collections.Counter();general=collections.Counter()
 vocab_families=collections.Counter()
 for r in train:
  if r['source_kind']=='compositional':
   family=r.get('family_id','none');vocab_families[family]+=1
   if vocab_families[family]>128:continue
  words=WORD.findall(r['text']);general.update(words)
  if r.get('new_original_voice'):voice.update(words)
 vocab={old.convert_ids_to_tokens(i):i for i in range(32)}
 priority=[w for w,_ in voice.most_common() if re.fullmatch(r"[a-z]+(?:'[a-z]+)*",w)]
 for word in priority+[w for w,_ in general.most_common()]:
  if word not in vocab and len(vocab)<4019:vocab[word]=len(vocab)
 assert len(vocab)==4019
 backend=Tokenizer(models.WordLevel(vocab,unk_token='[UNK]'));backend.normalizer=normalizers.Sequence([normalizers.NFKC(),normalizers.Lowercase(),normalizers.Replace('’',"'"),normalizers.Replace('‘',"'"),normalizers.Replace('“','\"'),normalizers.Replace('”','\"'),normalizers.Replace('—','-'),normalizers.Replace('–','-')]);backend.pre_tokenizer=pre_tokenizers.Sequence([pre_tokenizers.WhitespaceSplit(),pre_tokenizers.Split(Regex(r"[a-z]+(?:'[a-z]+)*|[0-9]|[^\w\s]"),behavior='isolated',invert=True)]);backend.decoder=decoders.WordPiece(prefix='##',cleanup=True)
 tok=PreTrainedTokenizerFast(tokenizer_object=backend,unk_token='[UNK]',eos_token='[EOS]',pad_token='[UNK]',clean_up_tokenization_spaces=True)
 assert len(tok)==4019
 for i in range(32):assert tok.convert_ids_to_tokens(i)==old.convert_ids_to_tokens(i)
 model=AutoModelForCausalLM.from_pretrained(base,local_files_only=True,attn_implementation='eager',torch_dtype=torch.float32)
 matrix=model.model.embed_tokens.weight.detach().clone();remap=[]
 with torch.no_grad():
  target=model.model.embed_tokens.weight
  for word,i in vocab.items():
   pieces=old.encode(word,add_special_tokens=False) if i>=32 else [i]
   assert pieces and (i<32 or 0 not in pieces),(word,pieces)
   vec=matrix[pieces].mean(0)
   # Keep old embedding geometry but avoid shrinking multi-piece words.
   typical=matrix[pieces].norm(dim=1).mean();vec=vec*(typical/vec.norm().clamp_min(1e-9))
   target[i]=vec;remap.append({'id':i,'token':word,'source_ids':pieces})
  initial_clipped=int(((target<-.5)|(target>2047/4096)).sum())
  target.clamp_(-.5,2047/4096)
 model.config.eos_token_id=1;model.config.pad_token_id=0;model.config.bos_token_id=None;model.generation_config.eos_token_id=1;model.generation_config.pad_token_id=0;model.generation_config.bos_token_id=None
 assert model.lm_head.weight.data_ptr()==model.model.embed_tokens.weight.data_ptr()
 assert sum(p.numel() for p in model.parameters())==1235968
 checkpoint=out/'initial-wordlevel';checkpoint.mkdir();model.save_pretrained(checkpoint,safe_serialization=True);tok.save_pretrained(checkpoint)
 save(out/'vocabulary-remap.json',remap)
 handles={s:(out/'corpus'/f'{s}.jsonl') for s in ['train','validation','test']};(out/'corpus').mkdir();accepted=[];counts=collections.Counter();rejected=collections.Counter();seen={};family_counts=collections.Counter()
 for row in rows:
  kind=row['source_kind'];split=row['split'];text=row['text']
  sentences=re.split(r'(?<=[.!?])\s+',text)
  if row.get('grammar_replay'):candidates=[' '.join(sentences[i:i+3]) for i in range(0,len(sentences),3)]
  elif kind in ['licensed_teacher','public_domain']:candidates=sentences
  else:candidates=[text]
  for n,text in enumerate(candidates):
   words=re.findall(r"[a-z]+(?:'[a-z]+)*",text)
   if len(words)<5 or len(words)>90 or not re.search(r'[.!?]$',text):rejected[split+':'+kind+':length_or_ending']+=1;continue
   ids=tok.encode(text,add_special_tokens=False)
   if 0 in ids or 1 in ids:rejected[split+':'+kind+':unknown']+=1;continue
   if kind=='compositional':
    family=str(row.get('family_id',row.get('family',row.get('template_family','none'))));key=(split,family)
    if family_counts[key]>=128:rejected[split+':'+kind+':family_limit']+=1;continue
    family_counts[key]+=1
   key=' '.join(text.split())
   if key in seen:
    if seen[key]!=split:rejected[split+':'+kind+':cross_split_duplicate']+=1
    else:rejected[split+':'+kind+':duplicate']+=1
    continue
   seen[key]=split
   r=dict(row);r['id']=str(row['id'])+':wordlevel:'+str(n);r['parent_text_sha256']=row.get('text_sha256');r['text']=text;r['text_sha256']=hashlib.sha256(text.encode()).hexdigest();r['tokens']=len(ids);r['words']=len(words);r['token_count']=len(ids);accepted.append(r);counts[(split,kind)]+=1
 for split,path in handles.items():path.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in accepted if r['split']==split))
 report={'status':'COMPLETE','parameters':1235968,'vocabulary':4019,'reserved_ids_unchanged':True,'word_level':True,'initial_embedding_values_clipped':initial_clipped,'sources':sources,'tokenizer_sha256':sha(checkpoint/'tokenizer.json'),'weights_sha256':sha(checkpoint/'model.safetensors'),'vocabulary_training_only':True,'authored_vocabulary_priority':'all training words of new original vignettes; remaining vocabulary weighted by capped training source frequencies','vocabulary_word_count':len(vocab),'input_documents':{str(k):v for k,v in input_counts.items()},'input_lexical_tokens':{str(k):v for k,v in input_lexical_tokens.items()},'counts':{s:{k:counts[s,k] for k in ['authored','compositional','public_domain','licensed_teacher']} for s in handles},'rejected':dict(rejected),'corpus_files':{s:{'sha256':sha(p),'bytes':p.stat().st_size} for s,p in handles.items()},'total_documents':len(accepted),'total_tokens':sum(r['token_count'] for r in accepted),'semantics':'Whole words are vocabulary units; new sentences are still autoregressive neural outputs, not selected paragraphs.'}
 save(out/'preparation-report.json',report);print(json.dumps(report,indent=2))
if __name__=='__main__':main()
