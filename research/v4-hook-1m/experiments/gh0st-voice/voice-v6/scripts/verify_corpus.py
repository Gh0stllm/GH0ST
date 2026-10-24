#!/usr/bin/env python3
"""Read-only structural checks for the frozen v6 corpus; never calls a network."""
from pathlib import Path
from collections import Counter,defaultdict
import hashlib,json,re
BASE=Path(__file__).resolve().parents[1];D=BASE/'data'
WORD=re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")
PATTERNS={'html_tag':r'<[^>]+>','pandoc_list_marker':r'#\.','footnote_marker':r'\[\^[^\]]+\]','credential_prefix':r'\b(?:nfp_|ghp_|github_pat_|sk-[A-Za-z0-9]{16,})','64_hex_key':r'0x[a-fA-F0-9]{64}'}
def sha(b):return hashlib.sha256(b).hexdigest()
def main():
 report=json.loads((D/'corpus-report.json').read_text());rows=[];groups=defaultdict(set);dups=defaultdict(list);intervals=defaultdict(list);issues=[];counts=Counter()
 for split in ['train','validation','test']:
  path=D/f'{split}.jsonl';actual=sha(path.read_bytes())
  if actual!=report['files'][path.name]['sha256']:issues.append('file hash mismatch '+path.name)
  for line in path.read_text().splitlines():
   r=json.loads(line);rows.append(r);groups[r['group_id']].add(split);counts[split+'_records']+=1;counts[split+'_words']+=len(WORD.findall(r['text']))
   if r['split']!=split:issues.append('wrong split '+r['id'])
   canonical=' '.join(w.lower().replace('’',"'")for w in WORD.findall(r['text']));dups[canonical].append(r['id'])
   if r['source_kind']=='general_adult':
    if r['first_person_markers']<1:issues.append('missing first-person marker '+r['id'])
    key=(r['source_id'],r['id'].rsplit(':',2)[-2]);intervals[key].append((r['paragraph_start'],r['paragraph_end'],r['id']))
   if r['source_id'].startswith('gwern-'):
    runs=[]
    for pat in [r'"([^"]+)"',r'“([^”]+)”',r"(?<!\w)'(.+?)'(?!\w)",r"‘(.+?)’(?!\w)"]:
     runs.extend(re.findall(pat,r['text'],re.S))
    if max((len(WORD.findall(t)) for t in runs),default=0)>15:issues.append('long Gwern inline quote '+r['id'])
   if r['source_id'].startswith('pg-'):
    if re.match(r'^[^A-Za-z]*[a-z]',r['text']):issues.append('lowercase book fragment '+r['id'])
    if re.search(r'\b(?:knowed|drawed)\b',r['text'],re.I):issues.append('flagged dialect '+r['id'])
   for name,pattern in PATTERNS.items():
    if re.search(pattern,r['text']):issues.append(name+' '+r['id'])
 for group,splits in groups.items():
  if len(splits)>1:issues.append('cross-split group '+group)
 for text,ids in dups.items():
  if len(ids)>1:issues.append('exact duplicate '+' / '.join(ids))
 for key,items in intervals.items():
  items.sort()
  for a,b in zip(items,items[1:]):
   if a[1]>=b[0]:issues.append('overlapping paragraph interval '+a[2]+' '+b[2])
 if dict(counts)!=report['counts']:issues.append('counts mismatch')
 evidence={'status':'PASS' if not issues else 'FAIL','records':len(rows),'words':sum(len(WORD.findall(r['text']))for r in rows),'group_count':len(groups),'normalized_exact_duplicate_groups':sum(len(v)>1 for v in dups.values()),'no_overlapping_paragraph_ranges':not any('overlapping' in x for x in issues),'patterns_checked':PATTERNS,'issues':issues,'files':report['files'],'scope':'Structural corpus audit only; not model quality or factual verification.'}
 (D/'verification.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence,indent=2))
 if issues:raise SystemExit(1)
if __name__=='__main__':main()
