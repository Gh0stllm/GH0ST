"""Runpod-only byte-preserving HTML augmentation. No Netlify mutations/auth."""
from pathlib import Path
import base64,concurrent.futures,hashlib,json,re,sys,urllib.request

HERE=Path(__file__).resolve().parent
MODULE='/gh0st-network-wallet.mjs'
STYLESHEET='/gh0st-network-wallet.css'
TAG=('\n<script type="module" src="/gh0st-network-wallet.mjs" integrity="sha256-'+base64.b64encode(hashlib.sha256((HERE/MODULE.lstrip('/')).read_bytes()).digest()).decode()+'"></script>\n').encode()
ROADMAP_CSP="default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'"
SITES={'main':'1460fb0c-b81d-4624-aac5-b78658310ce0','rpc':'cda71aa3-eb0f-40be-ac67-d24c7545a703','scan':'60e107a7-2bda-498a-8790-b757a2321a5e'}
sha1=lambda b:hashlib.sha1(b).hexdigest()
sha256=lambda b:hashlib.sha256(b).hexdigest()

def inject(raw):
    if b'\x00' in raw:raise ValueError('Non-ASCII-compatible HTML encoding')
    if MODULE.encode() in raw:raise ValueError('Existing wallet module reference; obtain fresh reviewed update')
    closing=list(re.finditer(br'</body\s*>',raw,re.I))
    position=closing[-1].start() if closing else len(raw)
    result=raw[:position]+TAG+raw[position:]
    assert result.count(TAG)==1 and result.replace(TAG,b'',1)==raw
    return result,('before-closing-body' if closing else 'before-implicit-body-end')

def function_payload(functions):
    # Exact digest reuse, with the same public config mapping already used by
    # the accepted additive-deployment helper. Runtime/stream mode is verified
    # on the resulting draft; no function bundle is uploaded or rebuilt.
    digests,configs={},{}
    for f in functions:
        assert re.fullmatch('[a-f0-9]{64}',f['d'])
        assert f['n'] in ['live-stats','watcher-scans','gl3-rpc']
        digests[f['n']]=f['d']
        c={out:f[key] for key,out in [('dn','display_name'),('g','generator'),('bd','build_data'),('p','priority'),('rgo','region'),('mo','memory')] if f.get(key) is not None}
        if 'ro' in f:c['routes']=[{out:r[key] for key,out in [('p','pattern'),('l','literal'),('e','expression'),('m','methods'),('ps','prefer_static')] if r.get(key) is not None} for r in f['ro']]
        configs[f['n']]=c
    return digests,configs

def functions_equal(expected,actual):
    # Invocation/runtime and all source/execution config, including overrides,
    # are acceptance-critical. Per-deployment generated instance IDs/timestamps
    # and vendor telemetry IDs are not source/configuration fields.
    ignored={'id','a','c','oid'}
    norm=lambda rows:{f['n']:{k:v for k,v in f.items() if k not in ignored and v is not None} for f in rows}
    return norm(expected)==norm(actual)

def fetch_html(item):
    key,snapshot,path=item
    url=snapshot['deployUrl']+path
    if not re.fullmatch(r'https://[a-f0-9]{24}--[a-z0-9-]+\.netlify\.app',snapshot['deployUrl']):raise ValueError('Not immutable Netlify permalink')
    request=urllib.request.Request(url,headers={'User-Agent':'GH0ST-exact-preservation/1.0'})
    with urllib.request.urlopen(request,timeout=25) as response:
        raw=response.read(2*1024*1024+1)
        if len(raw)>2*1024*1024:raise ValueError('HTML exceeds bounded download size')
    if sha1(raw)!=snapshot['files'][path]:
        # Explicit root-reviewed exception: this historical index is processed
        # by Netlify before serving. Preserve the exact currently served page,
        # not an invented copy of unavailable original build-input bytes.
        if not (key=='main' and path=='/index.html' and snapshot['files'][path]=='a1fe5398bdcb47a668897dcae094258ff58ee5fe' and sha1(raw)=='31122bdf7a01d22662904154d45b43dad64e4ade'):
            raise ValueError('Served HTML differs from original manifest: '+key+path)
    return key,path,raw

def prepare(snapshots,output):
    assert sys.platform=='linux','All preparation runs on Runpod'
    assert set(snapshots)==set(SITES) and not output.exists()
    module=(HERE/MODULE.lstrip('/')).read_bytes()
    assert len(module)<32000
    output.mkdir(parents=True)
    tasks=[]
    for key,s in snapshots.items():
        assert s['siteId']==SITES[key] and MODULE not in s['files'] and STYLESHEET not in s['files']
        assert (key!='main' or len(s['files'])>650)
        expected={'main':{'live-stats','watcher-scans','gl3-rpc'},'rpc':{'gl3-rpc'},'scan':set()}[key]
        assert {f['n'] for f in s['availableFunctions']}==expected
        for path in s['files']:
            if path.lower().endswith('.html'):tasks.append((key,s,path))
    originals={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for key,path,raw in pool.map(fetch_html,tasks):originals[key,path]=raw
    plans={}
    for key,s in snapshots.items():
        stage=output/key;stage.mkdir()
        files=dict(s['files']);changes={}
        for path in sorted(p for p in s['files'] if p.lower().endswith('.html')):
            raw=originals[key,path];new,placement=inject(raw);csp=None
            if key=='main' and path=='/roadmap/index.html':
                replacement=ROADMAP_CSP+"; script-src 'sha256-"+base64.b64encode(hashlib.sha256(module).digest()).decode()+"'"
                assert new.count(ROADMAP_CSP.encode())==1
                new=new.replace(ROADMAP_CSP.encode(),replacement.encode(),1)
                csp={'original':ROADMAP_CSP,'replacement':replacement,'scope':'Only the exact SRI-matched wallet module hash is allowed. All other existing directives remain identical.'}
            p=stage/'uploads'/path.lstrip('/');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(new)
            files[path]=sha1(new);changes[path]={'originalSHA1':s['files'][path],'baselineSHA1':sha1(raw),'baselineKind':'manifest-original' if sha1(raw)==s['files'][path] else 'root-reviewed-Netlify-processed-current-index','SHA1':sha1(new),'SHA256':sha256(new),'file':str(p.relative_to(output)),'placement':placement,'baselineBytes':len(raw),'bytes':len(new),'onlyExactTagAdded':csp is None,'onlyDeclaredEditsAdded':True,'CSPAdjustment':csp}
        p=stage/'uploads'/MODULE.lstrip('/');p.write_bytes(module);files[MODULE]=sha1(module)
        changes[MODULE]={'SHA1':sha1(module),'SHA256':sha256(module),'file':str(p.relative_to(output)),'bytes':len(module),'newModule':True}
        css=(HERE/STYLESHEET.lstrip('/')).read_bytes();p=stage/'uploads'/STYLESHEET.lstrip('/');p.write_bytes(css);files[STYLESHEET]=sha1(css)
        changes[STYLESHEET]={'SHA1':sha1(css),'SHA256':sha256(css),'file':str(p.relative_to(output)),'bytes':len(css),'newStylesheet':True}
        digests,config=function_payload(s['availableFunctions'])
        untouched={p:h for p,h in s['files'].items() if not p.lower().endswith('.html')}
        assert all(files[p]==h for p,h in untouched.items())
        plan={'schema':'gh0st.gl3.wallet-button-deployment.v1','siteId':s['siteId'],'siteKey':key,'baseDeployId':s['deployId'],'snapshotSHA256':sha256(json.dumps(s,sort_keys=True,separators=(',',':')).encode()),'changes':changes,'originalFiles':s['files'],'originalFunctions':s['availableFunctions'],'originalSchedules':s['functionSchedules'],'body':{'draft':True,'files':files,'functions':digests,'functions_config':config,'function_schedules':s['functionSchedules']},'originalNonHTMLFilesPreserved':True,'allHTMLBaselineBytesPreservedOutsideDeclaredEdits':True,'allOriginalHTMLBytesPreservedOutsideExactTag':key!='main','processedIndexBoundary':{'path':'/index.html','manifestSHA1':'a1fe5398bdcb47a668897dcae094258ff58ee5fe','servedBaselineSHA1':'31122bdf7a01d22662904154d45b43dad64e4ade','scope':'Root authorized using exact current Netlify-processed served index as the deliberately changed HTML input; no original-build-input byte-preservation claim for this one file.'} if key=='main' else None,'roadmapCSPAdjustment':changes.get('/roadmap/index.html',{}).get('CSPAdjustment'),'HTMLPages':len(changes)-2,'moduleSHA256':sha256(module),'stylesheetSHA256':sha256(css),'publicMutationPerformed':False}
        (stage/'plan.json').write_text(json.dumps(plan,indent=2)+'\n');plans[key]=plan
    proof={'prepared':True,'sites':{k:{'baseDeployId':p['baseDeployId'],'HTMLPages':p['HTMLPages'],'existingNonHTMLCount':len(p['originalFiles'])-p['HTMLPages'],'onlyDeclaredEditsAdded':True,'roadmapExactHashCSPAdded':k=='main','originalFunctionCount':len(p['originalFunctions'])} for k,p in plans.items()},'moduleSHA256':sha256(module),'transactionsSigned':0,'publicMutationPerformed':False}
    (output/'preparation.json').write_text(json.dumps(proof,indent=2)+'\n')
    return proof

if __name__=='__main__':print(json.dumps(prepare(json.loads(Path(sys.argv[1]).read_text()),Path(sys.argv[2]))))
