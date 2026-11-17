"""Runpod-only source preparation. No Netlify, DNS, keys, services or transfers."""
from pathlib import Path
import json,hashlib,shutil,zipfile,sys,importlib.util
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('a',HERE/'netlify_additive.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def prepare(config_path,main_snapshot,separate_snapshots,output):
    m.require(sys.platform=='linux','Preparation/compression runs on Runpod only')
    c=json.loads(config_path.read_text());m.require(c.get('enabled') is True and c.get('readOnly') is False,'Explicit full public profile required')
    m.require((c.get('networkPhase')=='initial-setup' and c.get('bootstrapSetup') is True) or (c.get('networkPhase')=='finalized' and c.get('bootstrapSetup') is False and c.get('setupIncomplete') is False and len(c.get('finalSetup',{}).get('setupReceiptTxHashes',[]))==7),'Actual authorized setup phase required')
    plan=m.prepare(json.loads(main_snapshot.read_text()),config_path,output)
    stages=json.loads((output/'separate-sites-plan.json').read_text());snapshots=json.loads(separate_snapshots.read_text());main_additions=plan['additions']
    for kind,site in [('rpc','cda71aa3-eb0f-40be-ac67-d24c7545a703'),('scan','60e107a7-2bda-498a-8790-b757a2321a5e')]:
        snap=snapshots[kind];m.require(snap['siteId']==site,'Wrong separate site')
        old_names={f['n'] for f in snap['availableFunctions']};m.require(old_names==({'gl3-rpc'} if kind=='rpc' else set()),'Unknown existing function; stop')
        entry=stages[kind];entry['baseDeployId']=snap['deployId'];entry['originalFiles']=snap['files'];entry['oldFunctions']=snap['availableFunctions'];files=dict(snap['files'])
        if kind=='rpc':
            landing=output/'rpc-index.html';landing.write_bytes((HERE/'rpc/public/index.html').read_bytes());d=hashlib.sha1(landing.read_bytes()).hexdigest();additions={'/index.html':{'sha1':d,'file':'rpc-index.html'}}
        else:additions={k.removeprefix('/gl3/scan'):v for k,v in main_additions.items() if k.startswith('/gl3/scan/')}
        for name,v in additions.items():files[name]=v['sha1']
        entry['additions']=additions;entry['body']['files']=files;entry['body']['draft']=True;entry['readOnly']=False;entry['networkPhase']=c['networkPhase']
        m.require(all(files[k]==v for k,v in snap['files'].items() if k not in additions),'Unknown static file changed')
    stages['status']='full-initial-setup-prepared-not-published';(output/'separate-sites-plan.json').write_text(json.dumps(stages,indent=2)+'\n');return {'main':plan,'separate':stages}
if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('config',type=Path);p.add_argument('main_snapshot',type=Path);p.add_argument('separate_snapshots',type=Path);p.add_argument('output',type=Path);a=p.parse_args();r=prepare(a.config,a.main_snapshot,a.separate_snapshots,a.output);print(json.dumps({'prepared':True,'mainFiles':len(r['main']['body']['files']),'mainOriginalFiles':r['main']['originalFileCount'],'fullPublic':True,'mainPublished':False}))
