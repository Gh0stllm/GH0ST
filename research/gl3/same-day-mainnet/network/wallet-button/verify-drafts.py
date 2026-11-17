"""Runpod-only actual HTTPS byte/config verification; never publishes anything."""
from pathlib import Path
import base64,concurrent.futures,hashlib,json,sys,time,urllib.request
from html.parser import HTMLParser
from prepare import functions_equal
assert sys.platform=='linux'
stage=Path(sys.argv[1]);metadata=json.loads(Path(sys.argv[2]).read_text());out=Path(sys.argv[3]);out.mkdir(exist_ok=False)
class Tags(HTMLParser):
 def __init__(self):super().__init__();self.scripts=[];self.csp=[]
 def handle_starttag(self,t,attrs):
  a=dict(attrs)
  if t=='script' and a.get('src')=='/gh0st-network-wallet.mjs':self.scripts.append(a)
  if t=='meta' and a.get('http-equiv','').lower()=='content-security-policy':self.csp.append(a.get('content'))
plans={k:json.loads((stage/k/'plan.json').read_text()) for k in metadata}
for k,d in metadata.items():
 p=plans[k];assert d['site_id']==p['siteId'] and d['state']=='ready'
 assert functions_equal(p['originalFunctions'],d.get('available_functions')or[])
 assert p['originalSchedules']==(d.get('function_schedules')or[])
def check(item):
 key,path,c=item;p=plans[key];url=metadata[key]['deploy_ssl_url']+path
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'GH0ST-wallet-draft-verification/1.0'}),timeout=25) as response:
  raw=response.read(2*1024*1024+1);status=response.status;mime=response.headers.get('content-type','')
 assert status==200 and len(raw)<=2*1024*1024
 actual=hashlib.sha256(raw).hexdigest();r={'site':key,'path':path,'status':status,'bytes':len(raw),'mime':mime,'SHA256':actual,'expectedSHA256':c['SHA256'],'exact':actual==c['SHA256']}
 if not r['exact']:
  q=out/key/path.lstrip('/');q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(raw)
 if path.endswith('.html'):
  parser=Tags();parser.feed(raw.decode('utf-8'));assert len(parser.scripts)==1
  assert parser.scripts[0].get('integrity')=='sha256-'+base64.b64encode(bytes.fromhex(p['moduleSHA256'])).decode()
  if path=='/roadmap/index.html':assert p['roadmapCSPAdjustment']['replacement'] in parser.csp
 elif path.endswith('.mjs'):assert 'javascript' in mime
 elif path.endswith('.css'):assert 'text/css' in mime
 return r
tasks=[(key,path,c) for key,p in plans.items() for path,c in p['changes'].items()]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(check,tasks))
r={'passed':all(x['exact'] for x in rows),'observedUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'assets':len(rows),'checks':rows,'allOriginalFunctionsAndSchedulesPreserved':True,'walletRequestsPerformed':False,'publicMutationPerformed':False}
(out/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'passed':r['passed'],'assets':len(rows),'mismatches':[x for x in rows if not x['exact']]}));assert r['passed']
