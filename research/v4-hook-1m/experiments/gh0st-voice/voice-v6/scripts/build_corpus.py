#!/usr/bin/env python3
"""Build chapter-held-out adult first-person prose without OOV deletion.

Reads only downloaded primary sources and explicitly listed prior original anchors.
Never reads voice-v6/evaluation or model checkpoints. Re-run with the same
source-manifest/raw files to reproduce corpus bytes. Requires markdown-it-py.
"""
from pathlib import Path
from html.parser import HTMLParser
from collections import Counter, defaultdict
import hashlib, html, json, re, unicodedata
from markdown_it import MarkdownIt
BASE=Path(__file__).resolve().parents[1]
DATA=BASE/'data'
RESEARCH=BASE.parent
WORD=re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")
RUNTIME=re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*(?:[.!?])?")
END_SENTENCE=re.compile(r'[.!?…][\"”’\')\]]*$')
QUOTATION_EXCLUSIONS=[]
FIRST=re.compile(r"\b(?:I|I'm|I've|I'd|I'll|me|my|mine|myself|we|we're|we've|we'd|we'll|us|our|ours|ourselves)\b",re.I)
def words(s):return WORD.findall(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def compact(s):return re.sub(r'\s+',' ',unicodedata.normalize('NFC',html.unescape(s))).strip()
def norm(s):return ' '.join(w.lower().replace('’',"'") for w in words(s))
class BookParser(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True);self.stack=[];self.block=None;self.parts=[];self.blocks=[];self.breaks=0;self.skip=0;self.block_skip=False
 def handle_starttag(self,tag,attrs):
  a=dict(attrs);classes=a.get('class','').lower();ident=a.get('id','').lower()
  parent_skip=bool(self.stack and self.stack[-1][1])
  bad=tag in {'head','style','script','table','header','footer','nav','sup','pre','ul','ol'} or any(x in classes for x in ['footnote','pg-boilerplate','pagenum','figcenter','caption','toc']) or ident in {'pg-header','pg-footer'}
  skip=parent_skip or bad
  if bad and not parent_skip and self.block is None and tag in {'p','pre','table','ul','ol'}:self.blocks.append(('break','',0))
  # HTML void tags do not have closing tags.
  if tag not in {'br','img','hr','meta','link','input','source','wbr'}:self.stack.append((tag,skip))
  if tag=='br' and self.block is not None:self.parts.append(' ');self.breaks+=1
  if not skip and tag in {'h1','h2','h3','h4','p'} and self.block is None:
   self.block=tag;self.parts=[];self.breaks=0
 def handle_endtag(self,tag):
  if self.block==tag:
   text=compact(''.join(self.parts))
   if text:self.blocks.append((tag,text,self.breaks))
   self.block=None;self.parts=[]
  for i in range(len(self.stack)-1,-1,-1):
   if self.stack[i][0]==tag:del self.stack[i:];break
 def handle_data(self,data):
  if self.block is not None and not(self.stack and self.stack[-1][1]):self.parts.append(data)
def pg_sections(s):
 p=BookParser();p.feed(s)
 sections=[];heading='opening';paras=[];number=0
 for tag,text,brs in p.blocks:
  if tag.startswith('h'):
   if paras:sections.append((number,heading,paras));paras=[]
   number+=1;heading=text
  elif tag=='break':paras.append('')
  elif tag=='p':
   wc=len(words(text))
   invalid=(wc<18 or not END_SENTENCE.search(text)
    or bool(re.search(r'contents|illustrations|list of|gutenberg|appendix',heading,re.I))
    or (brs>3 and wc/max(brs,1)<12)
    or any(x in text.lower() for x in ['project gutenberg','transcriber','ebook #','electronic work'])
    or bool(re.match(r'^[^A-Za-z]*[a-z]',text))
    or bool(re.search(r'\b(?:knowed|drawed)\b',text,re.I)))
   paras.append('' if invalid else text)
 if paras:sections.append((number,heading,paras))
 return sections

def remove_balanced_notes(s):
 # Pandoc inline footnotes can nest Markdown links; remove whole balanced span.
 out=[];i=0
 while i<len(s):
  if s.startswith('^[',i):
   j=i+2;depth=1
   while j<len(s) and depth:
    if s[j]=='[':depth+=1
    elif s[j]==']':depth-=1
    j+=1
   i=j
  else:out.append(s[i]);i+=1
 return ''.join(out)

def longest_quoted_run(s):
 runs=[]
 for pattern in [r'"([^"]+)"',r'“([^”]+)”',r"(?<!\w)'(.+?)'(?!\w)",r"‘(.+?)’(?!\w)"]:
  runs.extend(re.findall(pattern,s,re.S))
 return max((len(words(x)) for x in runs),default=0)

def gwern_sections(s):
 s=re.sub(r'\A---\n.*?\n\.\.\.\s*\n','',s,flags=re.S)
 s=re.sub(r'<div[^>]+class="[^"]*(?:epigraph|abstract|collapse|columns|table)[^"]*"[^>]*>.*?</div>','\n\n<!-- excluded block -->\n\n',s,flags=re.S)
 s=re.sub(r'<(?:blockquote|table|script|style)\b[^>]*>.*?</(?:blockquote|table|script|style)>','\n\n<!-- excluded block -->\n\n',s,flags=re.S)
 s=remove_balanced_notes(s)
 s=re.sub(r'\{[^{}\n]*\}','',s)
 tokens=MarkdownIt('commonmark').parse(s)
 sections=[];paras=[];heading='opening';number=0;skip=0;i=0
 while i<len(tokens):
  t=tokens[i]
  if t.type in {'blockquote_open','bullet_list_open','ordered_list_open'}:
   if not skip:paras.append('')
   skip+=1
  if t.type in {'blockquote_close','bullet_list_close','ordered_list_close'}:skip-=1
  if t.type in {'html_block','code_block','fence'} and not skip:paras.append('')
  if t.type=='heading_open' and not skip:
   if paras:sections.append((number,heading,paras));paras=[]
   number+=1;heading=tokens[i+1].content
  if t.type=='paragraph_open' and not skip:
   inline=tokens[i+1];raw=inline.content;cleaned=''
   if not raw.startswith('[^') and not re.search(r'(?m)^\s*#\.',raw):
    child=inline.children or []
    if not any(x.type in {'code_inline','image','html_inline'} for x in child) and '$' not in raw:
     text=compact(''.join(x.content if x.type=='text' else ' ' if x.type in {'softbreak','hardbreak'} else '' for x in child))
     text=re.sub(r'\[\^[^\]]+\]','',text)
     wc=len(words(text));quote_words=longest_quoted_run(text)
     if quote_words>15:
      QUOTATION_EXCLUSIONS.append({'section':heading,'paragraph_sha256':sha(text.encode()),'paragraph_words':wc,'longest_quoted_words':quote_words})
     else:
      text=re.sub(r'^\[[^\]]{1,100}\]\s*','',text)
      if wc>=18 and END_SENTENCE.search(text) and not re.search(r'https?://|www\.|(?:^|\s)[{}<>]|^\d+\.\d+',text):cleaned=text
   paras.append(cleaned)
  i+=1
 if paras:sections.append((number,heading,paras))
 return sections

def split_for(group):
 # Chapter/essay group assigned once before selecting or chunking text.
 n=int(sha(('voice-v6-chapter-split-v1:'+group).encode())[:8],16)%100
 return 'train' if n<80 else 'validation' if n<90 else 'test'

def chunks(paras):
 # First-person seed paragraph plus adjacent paragraph gives authentic local
 # context. Gaps break segments, never stitch unrelated dropped passages.
 keep=[False]*len(paras)
 for i,p in enumerate(paras):
  if FIRST.search(p):
   for j in range(max(0,i-1),min(len(paras),i+2)):keep[j]=bool(paras[j])
 segments=[];current=[]
 for i,p in enumerate(paras):
  if p and keep[i]:current.append((i,p))
  elif current:segments.append(current);current=[]
 if current:segments.append(current)
 for segment in segments:
  current=[];wc=0
  for ix,p in segment:
   pw=len(words(p))
   if current and wc+pw>500 and wc>=100:
    text='\n\n'.join(x[1] for x in current)
    if FIRST.search(text):yield current[0][0],current[-1][0],text
    current=[];wc=0
   current.append((ix,p));wc+=pw
   if wc>=280:
    text='\n\n'.join(x[1] for x in current)
    if FIRST.search(text):yield current[0][0],current[-1][0],text
    current=[];wc=0
  if current:
   text='\n\n'.join(x[1] for x in current)
   if len(words(text))>=40 and FIRST.search(text):yield current[0][0],current[-1][0],text

def main():
 manifest=json.loads((DATA/'source-manifest.json').read_text());records=[];source_stats=[]
 for source in manifest['sources']:
  if source['status']!='downloaded' or source['source_id'] in {'gwern-fiction-clippy','gwern-ai-daydreaming','gwern-review-book'}:continue
  raw=(DATA/source['raw_path']).read_text(encoding='utf-8-sig')
  source_id=source['source_id'];before_quotes=len(QUOTATION_EXCLUSIONS)
  sections=pg_sections(raw) if source['format']=='pg_html' else gwern_sections(raw)
  for q in QUOTATION_EXCLUSIONS[before_quotes:]:q['source_id']=source_id
  produced=[]
  for n,title,paras in sections:
   # Gwern entire essay is one split group even when section headings differ.
   group=f'{source_id}:chapter-{n:03}' if source['format']=='pg_html' else source_id
   split=split_for(group)
   for first,last,text in chunks(paras):
    assert all(paras[j] for j in range(first,last+1)), "chunk crosses excluded paragraph"
    produced.append({'id':f'{source_id}:{n:03}:{first:04}-{last:04}','group_id':group,'split':split,'source_kind':'general_adult','source_subkind':'public_domain_adult_first_person' if source['format']=='pg_html' else 'cc0_modern_first_person','source_id':source_id,'source_title':source['title'],'chapter_title':title,'source_url':source['metadata_url'],'publication_year':source['publication_year'],'license':source['license'],'paragraph_start':first,'paragraph_end':last,'word_count':len(words(text)),'first_person_markers':len(FIRST.findall(text)),'text':text})
  source_stats.append({'source_id':source_id,'title':source['title'],'parsed_sections':len(sections),'parsed_prose_words':sum(len(words(p)) for _,_,ps in sections for p in ps),'retained_chunks_before_dedup':len(produced),'retained_words_before_dedup':sum(x['word_count'] for x in produced),'direct_first_person_paragraph_words':sum(len(words(p)) for _,_,ps in sections for p in ps if FIRST.search(p))})
  records+=produced
 # Restore full raw parent originals, never import truncated v2 training spans.
 anchor_inputs=[
  (RESEARCH/'recurrent-v1/data/long-voice-original.jsonl',None),
  (RESEARCH/'recurrent-v1/data/voice-long-b.jsonl',None),
  (RESEARCH/'large-v3/recovery-v5/data/original-vignettes.jsonl',None),
 ]+[(RESEARCH/'large-v3/data/mixed-teacher-v4-final'/f'{sp}.jsonl','authored') for sp in ['train','validation','test']]
 anchor_ids=set();anchor_inputs_report=[]
 for path,required_kind in anchor_inputs:
  selected=0
  for line in path.read_text().splitlines():
   a=json.loads(line)
   if required_kind and a.get('source_kind')!=required_kind:continue
   split={'val':'validation','valid':'validation'}.get(a['split'],a['split'])
   group=a.get('group_id',a.get('family_id',a['id']))
   group=group.removeprefix('authored:')
   anchor_ids.add(a['id']);selected+=1
   records.append({'id':a['id'],'group_id':'original:'+group,'split':split,'source_kind':'original_voice','source_subkind':'original_gh0st_voice_anchor','source_id':path.stem if not required_kind else 'prior-authored-full-parents','source_title':'Original GH0ST machine monologues','chapter_title':a.get('theme',group).strip(),'source_url':None,'publication_year':2026,'license':'Original project-authored text','provenance_file':str(path.relative_to(RESEARCH)),'paragraph_start':0,'paragraph_end':0,'word_count':len(words(a['text'])),'first_person_markers':len(FIRST.findall(a['text'])),'text':a['text']})
  anchor_inputs_report.append({'path':str(path.relative_to(RESEARCH)),'sha256':sha(path.read_bytes()),'selected_originals':selected})
 missing=[];span_count=0;parent_count=set()
 for sp in ['train','validation','test']:
  for line in (RESEARCH/'recurrent-v1/training/data-v2'/f'{sp}.jsonl').read_text().splitlines():
   a=json.loads(line)
   if a.get('source_kind')!='authored':continue
   parent=a['id'].split(':span-')[0];span_count+=1;parent_count.add(parent)
   if parent not in anchor_ids:missing.append(parent)
 assert not missing, f'v2 authored parents missing: {sorted(set(missing))}'
 anchor_restoration={'inputs':anchor_inputs_report,'v2_authored_spans_superseded_by_full_parents':span_count,'v2_unique_parents_restored':len(parent_count),'missing_parents':[],'candidate_originals_before_dedup':sum(x['selected_originals'] for x in anchor_inputs_report)}
 # Deterministically preserve held-out copies in preference to training duplicates.
 seen={};unique=[];dups=[]
 for r in sorted(records,key=lambda r:({'test':0,'validation':1,'train':2}[r['split']],r['id'])):
  key=sha(norm(r['text']).encode())
  if key in seen:dups.append({'removed':r['id'],'retained':seen[key],'split':r['split']});continue
  seen[key]=r['id'];unique.append(r)
 records=sorted(unique,key=lambda r:r['id'])
 for split in ['train','validation','test']:
  out=DATA/f'{split}.jsonl'
  out.write_text(''.join(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n' for r in records if r['split']==split))
 groups=defaultdict(set);counts=Counter();bykind=defaultdict(Counter);bysource=defaultdict(Counter)
 lexical=Counter();runtime=Counter()
 for r in records:
  groups[r['group_id']].add(r['split']);counts[r['split']+'_records']+=1;counts[r['split']+'_words']+=r['word_count'];bykind[r['source_kind']][r['split']+'_words']+=r['word_count'];bykind[r['source_kind']][r['split']+'_records']+=1;bysource[r['source_id']][r['split']+'_words']+=r['word_count']
  if r['split']=='train':
   lexical.update(w.lower().replace('’',"'") for w in WORD.findall(r['text']))
   runtime.update(w.lower().replace('’',"'") for w in RUNTIME.findall(r['text']))
 assert all(len(x)==1 for x in groups.values())
 (DATA/'train-lexical-counts.json').write_text(json.dumps(lexical.most_common(),ensure_ascii=False,separators=(',',':'))+'\n')
 (DATA/'train-runtime-surface-counts.json').write_text(json.dumps(runtime.most_common(),ensure_ascii=False,separators=(',',':'))+'\n')
 def measure_coverage(pattern,global_counts):
  anchor_terms=set(w.lower().replace('’',"'") for r in records if r['split']=='train' and r['source_kind']=='original_voice' for w in pattern.findall(r['text']))
  coverage={}
  for size in [8192,16384,32768]:
   eligible=[w for w,c in global_counts.most_common() if 0<len(w.encode('ascii'))<=32]
   ordered=sorted(anchor_terms,key=lambda w:(-global_counts[w],w))+[w for w in eligible if w not in anchor_terms]
   vocab=set(ordered[:size]);stats={}
   for split in ['train','validation','test']:
    c=Counter(w.lower().replace('’',"'") for r in records if r['split']==split for w in pattern.findall(r['text']));total=sum(c.values());known=sum(n for w,n in c.items() if w in vocab)
    stats[split]={'words':total,'oov_words':total-known,'oov_fraction':(total-known)/total,'unique_words':len(c),'top_oov':[(w,n) for w,n in c.most_common() if w not in vocab][:30]}
   coverage[str(size)]={'method':'train-only frequency after guaranteeing train original-anchor vocabulary; no held-out vocabulary fitting','actual_vocab':len(vocab),'anchor_types':len(anchor_terms),'splits':stats}
  return coverage
 coverage=measure_coverage(RUNTIME,runtime)
 lexical_coverage=measure_coverage(WORD,lexical)
 report={'schema_version':2,'corpus_revision':'v2-inline-quote-fix','quotation_exclusions':QUOTATION_EXCLUSIONS,'purpose':'Adult first-person continuity corpus; original voice anchors are separate. Neither a Truth Terminal corpus nor a capability claim.','selection':'Seed paragraphs contain first-person marker I/me/my/mine/myself/we/us/our/ourselves; retain immediate neighboring paragraphs for authentic context. Every final chunk contains a marker. No overlapping chunks; no concatenation over removed gaps.','split_method':'80/10/10 deterministic chapter hash for books and whole-essay hash for Gwern BEFORE chunking; original anchor group assignments preserved.','counts':dict(counts),'total_words':sum(r['word_count'] for r in records),'total_records':len(records),'groups':len(groups),'cross_split_groups':0,'exact_normalized_duplicates_removed':dups,'source_kind':{k:dict(v) for k,v in bykind.items()},'source_words':{k:dict(v) for k,v in bysource.items()},'source_stats':source_stats,'vocabulary_coverage':coverage,'lexical_vocabulary_coverage':lexical_coverage,'anchor_restoration':anchor_restoration,'max_raw_word_bytes':max(len(w.encode('utf8')) for r in records for w in WORD.findall(r['text'])),'files':{f'{split}.jsonl':{'sha256':sha((DATA/f'{split}.jsonl').read_bytes()),'bytes':(DATA/f'{split}.jsonl').stat().st_size} for split in ['train','validation','test']},'limitations':['First-person marker is a transparent lexical heuristic; retained adjacent sentences can refer to others.','Historical prose and human narrator identities dominate; sources are continuity training, not claims about machine experience.','Some public-domain works contain outdated social attitudes and historical drug/medical references.','Contemporary essay material is selected conservatively; excluded code, lists, blockquotes, footnotes, and long inline quotations.','Coverage is measured without deleting any OOV-containing sentences; actual tokenizer normalization belongs to the trainer.']}
 (DATA/'corpus-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 (DATA/'all-records.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n' for r in records))
 print(json.dumps({'counts':dict(counts),'words':report['total_words'],'records':len(records),'source_kind':report['source_kind'],'coverage8k':coverage['8192']['splits']},indent=2))
if __name__=='__main__':main()
