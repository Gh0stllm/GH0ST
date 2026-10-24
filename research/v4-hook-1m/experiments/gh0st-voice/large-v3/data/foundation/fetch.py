from pathlib import Path
import urllib.request,hashlib,json,concurrent.futures,subprocess
out=Path(__file__).resolve().parent/'raw';out.mkdir(exist_ok=True)
books=[(972,"The Devil's Dictionary","Ambrose Bierce"),(1017,'The Soul of Man under Socialism','Oscar Wilde'),(8092,'Tremendous Trifles','G. K. Chesterton'),(5116,'Pragmatism','William James'),(205,'Walden and Civil Disobedience','Henry David Thoreau')]
def get(row):
 i,title,author=row;url=f'https://www.gutenberg.org/cache/epub/{i}/pg{i}.txt'
 b=subprocess.check_output(['/usr/bin/curl','--fail','--silent','--show-error','--location','--max-time','30',url])
 assert b'PROJECT GUTENBERG' in b.upper() and len(b)>10000
 (out/f'pg{i}.txt').write_bytes(b)
 return {'id':i,'title':title,'author':author,'url':url,'metadata_url':f'https://www.gutenberg.org/ebooks/{i}','bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'source_status':'Project Gutenberg metadata identifies public domain in the USA. Original license/header/footer preserved in raw download.'}
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:rows=list(pool.map(get,books))
(out.parent/'source-manifest.json').write_text(json.dumps({'purpose':'Small foundation-prose mixture for coherent English, not GH0ST identity claims or source factuality endorsement.','books':rows},indent=2)+'\n')
print(json.dumps([{'id':r['id'],'bytes':r['bytes']} for r in rows]))
