"""Lightweight authenticated API transport. Source preparation/tests run on Runpod.

Only the separately guarded wallet draft/file/restore operations can mutate.
Every mutation has a durable intent. Unknown outcomes are reconciled, never
retried or replaced automatically. Does not update site settings/environments.
"""
from pathlib import Path
import argparse,concurrent.futures,hashlib,importlib.util,json,os,subprocess,threading,time
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('wallet_prepare',HERE/'prepare.py');prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
sha=lambda b:hashlib.sha256(b).hexdigest()
def save(path,value):
    raw=(json.dumps(value,indent=2)+'\n').encode();tmp=path.with_suffix('.tmp')
    with open(tmp,'xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
def view(d):return{k:d.get(k) for k in ['id','site_id','state','title','deploy_ssl_url','required','required_functions','required_edge_functions','required_server','available_functions','function_schedules']}
class API:
    def __init__(self,cli,plan,evidence):self.cli=cli;self.plan=plan;self.p=json.loads(plan.read_text());self.e=evidence;self.e.mkdir(parents=True,exist_ok=True);self.lock=threading.Lock();self.n=0
    def read(self,op,data):
        p=subprocess.run(['node',self.cli,'api',op,'--data',json.dumps(data)],capture_output=True,text=True,timeout=55)
        if p.returncode:raise RuntimeError('Read-only Netlify request failed; response withheld')
        return json.loads(p.stdout)
    def once(self,operation,**kwargs):
        with self.lock:self.n+=1;n=self.n
        i={'operation':operation,'siteId':self.p['siteId'],'planPath':str(self.plan.resolve()),'planSHA256':sha(self.plan.read_bytes()),**kwargs}
        f=self.e/f'intent-{n:03d}-{operation}.json';assert not f.exists(),'Existing intent requires reconciliation'
        event={'state':'intent','UTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'input':i};save(f,event)
        p=subprocess.run(['node',str(HERE/'netlify-wallet-once.mjs'),self.cli],input=json.dumps(i),capture_output=True,text=True,timeout=55)
        if p.returncode==0:
            x=json.loads(p.stdout) if p.stdout.strip() else {};event.update(state='responded',response=view(x) if x.get('id') else {'acknowledged':True});save(f,event);return x
        event.update(state='uncertain',diagnostic=p.stderr[-1000:]);save(f,event)
        if operation=='createWalletDraft':
            title='GH0ST GL3 add-network wallet '+self.p['siteKey']+' '+self.p['baseDeployId'];ds=self.read('listSiteDeploys',{'site_id':self.p['siteId'],'page':1,'per_page':25});matches=[d for d in ds if d.get('title')==title]
            if len(matches)==1:event.update(state='reconciled',response=view(matches[0]));save(f,event);return matches[0]
        elif operation=='uploadWalletFile':
            d=self.read('getSiteDeploy',{'site_id':self.p['siteId'],'deploy_id':kwargs['deployId']})
            if d.get('required') is not None and self.p['changes'][kwargs['path']]['SHA1'] not in d['required']:event.update(state='reconciled',response={'digestNoLongerRequired':True});save(f,event);return{}
        elif operation=='publishWalletDraft':
            s=self.read('getSite',{'site_id':self.p['siteId']})
            if s['published_deploy']['id']==kwargs['deployId']:event.update(state='reconciled',response=view(s['published_deploy']));save(f,event);return s['published_deploy']
        raise RuntimeError('Unresolved mutation; preserve the intent, do not retry this runner')
    def cas(self):assert self.read('getSite',{'site_id':self.p['siteId']})['published_deploy']['id']==self.p['baseDeployId'],'Production changed; no overwrite'
    def ready(self,d):
        deadline=time.monotonic()+180
        while d['state']!='ready' and time.monotonic()<deadline:
            assert d['state']!='error','Draft failed; production untouched';time.sleep(1);d=self.read('getSiteDeploy',{'site_id':self.p['siteId'],'deploy_id':d['id']})
        assert d['state']=='ready','Still pending; continue exact existing draft'
        return d
    def verify(self,d):
        assert prepare.functions_equal(self.p['originalFunctions'],d.get('available_functions')or[]),'Function metadata changed; do not publish'
        assert self.p['originalSchedules']==(d.get('function_schedules')or[]),'Schedules changed'
        assert not d.get('required_functions') and not d.get('required_edge_functions') and not d.get('required_server'),'Existing runtime artifact not reusable'
    def draft(self):
        self.cas();d=self.once('createWalletDraft');save(self.e/'created.json',view(d));dep=d['id'];deadline=time.monotonic()+90
        while d['state']=='preparing' and time.monotonic()<deadline:time.sleep(1);d=self.read('getSiteDeploy',{'site_id':self.p['siteId'],'deploy_id':dep})
        assert d['state']!='preparing' and not d.get('required_functions') and not d.get('required_edge_functions') and not d.get('required_server'),'Unknown runtime upload required'
        by_sha={x['SHA1']:k for k,x in self.p['changes'].items()};required=d.get('required')or[];assert all(h in by_sha for h in required),'Old asset unexpectedly needed; do not upload substitute'
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda h:self.once('uploadWalletFile',deployId=dep,path=by_sha[h]),required))
        d=self.ready(self.read('getSiteDeploy',{'site_id':self.p['siteId'],'deploy_id':dep}));self.verify(d);self.cas();save(self.e/'ready.json',view(d))
        r={'siteId':self.p['siteId'],'siteKey':self.p['siteKey'],'baseDeployId':self.p['baseDeployId'],'draftDeployId':dep,'draftUrl':d['deploy_ssl_url'],'planSHA256':sha(self.plan.read_bytes()),'originalFunctionsAndSchedulesPreserved':True,'published':False};save(self.e/'draft-result.json',r);return r
    def publish(self,review):
        r=json.loads(review.read_text());self.cas();d=self.read('getSiteDeploy',{'site_id':self.p['siteId'],'deploy_id':r['draftDeployId']});assert d['state']=='ready';self.verify(d)
        self.once('publishWalletDraft',deployId=r['draftDeployId'],reviewFile=str(review.resolve()),reviewSHA256=sha(review.read_bytes()))
        s=self.read('getSite',{'site_id':self.p['siteId']});assert s['published_deploy']['id']==r['draftDeployId'],'Ambiguous publication; no retry'
        out={'published':True,'siteId':self.p['siteId'],'baseDeployId':self.p['baseDeployId'],'deployId':r['draftDeployId'],'url':s['ssl_url'],'moduleSHA256':self.p['moduleSHA256'],'unchangedFunctionsAndSchedules':True};save(self.e/'publication.json',out);return out
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--cli',required=True);a.add_argument('--plan',type=Path,required=True);a.add_argument('--evidence',type=Path,required=True);a.add_argument('command',choices=['draft','publish']);a.add_argument('--review',type=Path);v=a.parse_args();api=API(v.cli,v.plan,v.evidence)
    print(json.dumps(api.draft() if v.command=='draft' else api.publish(v.review)))
