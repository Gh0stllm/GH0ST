#!/usr/bin/env python3
"""Bounded primary-source acquisition. No training, chain, or external writes."""
from pathlib import Path
import concurrent.futures, datetime, hashlib, html, json, re, urllib.request, urllib.error
BASE=Path(__file__).resolve().parents[1]
RAW=BASE/'data/raw'; LICENSE=BASE/'data/licenses'
RAW.mkdir(parents=True,exist_ok=True); LICENSE.mkdir(parents=True,exist_ok=True)
PG=[(205,'Walden',1854),(600,'Notes from the Underground',1864),(1026,'The Diary of a Nobody',1892),(921,'De Profundis',1905),(2040,'Confessions of an English Opium-Eater',1821),(1463,'The Private Papers of Henry Ryecroft',1903),(849,'The Idle Thoughts of an Idle Fellow',1886),(130,'Orthodoxy',1908),(14658,'The Road',1907),(308,'Three Men in a Boat',1889),(534,'An Inland Voyage',1878),(535,'Travels with a Donkey in the Cevennes',1879),(3176,'The Innocents Abroad',1869),(3177,'Roughing It',1872),(470,'Heretics',1905)]
GWERN=['about','me','culture-is-not-about-esthetics','spaced-repetition','dnb-faq','silk-road','mistakes','choosing-software','sunk-cost','on-really-trying','improvement','book-writing','writing','readings','nicotine','melatonin','modafinil','creatine','lithium','socks','tool-ai','subculture','death-note-anonymity','fiction/clippy','rotten','review/book','narrowing','ai-daydreaming']
STAMP=datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def get(url,max_bytes=6_000_000):
 req=urllib.request.Request(url,headers={'User-Agent':'GH0ST local corpus research (bounded primary-source retrieval)'})
 with urllib.request.urlopen(req,timeout=45) as r:
  data=r.read(max_bytes+1)
  if len(data)>max_bytes: raise ValueError('source exceeds bounded size')
  return data,r.geturl()
def save(url,path,max_bytes=6_000_000):
 if path.exists():return path.read_bytes(),url
 b,actual=get(url,max_bytes);path.write_bytes(b);return b,actual
def pg(item):
 i,expected,year=item; sid=f'pg-{i}'
 try:
  meta,_=save(f'https://www.gutenberg.org/ebooks/{i}',RAW/f'{sid}-metadata.html',500_000)
  s=meta.decode('utf-8'); title=html.unescape(re.search(r'<meta property="og:title" content="([^"]+)',s).group(1))
  if expected.lower().split(' in the ')[0] not in title.lower():raise ValueError(f'title mismatch expected {expected}: {title}')
  if 'Public domain in the USA.' not in s:raise ValueError('public domain statement absent')
  matches=re.findall(r'href="([^"]+)"[^>]*type="text/html"',s)
  if not matches:matches=re.findall(r'href="([^"]+\.html)"',s)
  matches=[u for u in matches if 'images' in u or f'/{i}/' in u]
  url='https://www.gutenberg.org'+matches[0] if matches[0].startswith('/') else matches[0]
  body,actual=save(url,RAW/f'{sid}.html')
  txt,txtactual=save(f'https://www.gutenberg.org/ebooks/{i}.txt.utf-8',RAW/f'{sid}.txt')
  text=txt.decode('utf-8-sig'); end=re.search(r'\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK',text,re.I)
  license_text=text[end.start():] if end else text[-30000:]
  (LICENSE/f'{sid}-license.txt').write_text(license_text)
  return {'source_id':sid,'title':title,'publication_year':year,'domain':'historical adult first-person memoir, travel, or essay','format':'pg_html','url':actual,'metadata_url':f'https://www.gutenberg.org/ebooks/{i}','raw_path':f'raw/{sid}.html','raw_sha256':sha(body),'plain_text_url':txtactual,'plain_text_sha256':sha(txt),'license':'Public domain in the USA (Project Gutenberg metadata); preserve full PG terms','license_path':f'licenses/{sid}-license.txt','metadata_sha256':sha(meta),'retrieved_at':STAMP,'status':'downloaded'}
 except Exception as e:return {'source_id':sid,'status':'error','error':str(e)}
def gwern(slug):
 sid='gwern-'+slug.replace('/','-')
 try:
  b,actual=save(f'https://gwern.net/{slug}.md',RAW/f'{sid}.md',2_000_000)
  s=b.decode('utf-8')
  if not s.startswith('---\n'):raise ValueError('not source Markdown')
  title=re.search(r'^title:\s*(.*)$',s,re.M)
  created=re.search(r'^created:\s*(\d{4})',s,re.M)
  return {'source_id':sid,'title':title.group(1).strip('"') if title else slug,'publication_year':int(created.group(1)) if created else None,'domain':'contemporary authored first-person essays','format':'gwern_md','url':actual,'metadata_url':f'https://gwern.net/{slug}','raw_path':f'raw/{sid}.md','raw_sha256':sha(b),'license':'CC0 for Gwern original prose; third-party quotations and code excluded by parser','license_url':'https://gwern.net/about#license','license_path':'licenses/gwern-cc0-license-excerpt.txt','retrieved_at':STAMP,'status':'downloaded'}
 except Exception as e:return {'source_id':sid,'status':'error','error':str(e)}
if __name__=='__main__':
 about,_=save('https://gwern.net/about.md',LICENSE/'gwern-license-source.md',500_000)
 if 'creativecommons.org/public-domain/cc0/' not in about.decode():raise RuntimeError('CC0 source statement absent')
 paragraph=next(x for x in about.decode().split('\n\n') if x.startswith('This site is licensed under'))
 (LICENSE/'gwern-cc0-license-excerpt.txt').write_text('Source: https://gwern.net/about#license\nFull source SHA-256: '+sha(about)+'\n\n'+paragraph+'\n')
 work=[('pg',i) for i in PG]+[('gwern',s) for s in GWERN]
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
  futs={ex.submit(pg if kind=='pg' else gwern,item):(kind,item) for kind,item in work}
  for f in concurrent.futures.as_completed(futs):
   r=f.result();results.append(r);print(r['source_id'],r['status'],r.get('title',r.get('error')),flush=True)
 results.sort(key=lambda r:r['source_id'])
 (BASE/'data/source-manifest.json').write_text(json.dumps({'retrieved_at':STAMP,'sources':results},indent=2)+'\n')
 print('downloaded',sum(x['status']=='downloaded' for x in results),'of',len(results),flush=True)
