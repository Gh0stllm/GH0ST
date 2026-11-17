"""Bounded disabled-site publications and main-site draft. Never publish main.

Requires the already authenticated CLI; no stored credential discovery. Static
preparation/compression must have happened on Runpod before invoking this tool.
Each mutation is journaled first and makes one HTTP attempt. Ambiguity is resolved
by readback or stops; this runner never creates a replacement site/deployment.
"""
from pathlib import Path
import hashlib,json,subprocess,time,os,argparse,importlib.util
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('additive',HERE/'netlify_additive.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
RPC='cda71aa3-eb0f-40be-ac67-d24c7545a703';SCAN='60e107a7-2bda-498a-8790-b757a2321a5e'
sha=lambda b:hashlib.sha256(b).hexdigest()
compact=lambda x:json.dumps(x,separators=(',',':'),ensure_ascii=False)
def save(p,x):
    b=(json.dumps(x,indent=2)+'\n').encode();tmp=p.with_suffix('.tmp');fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:os.write(fd,b);os.fsync(fd)
    finally:os.close(fd)
    os.replace(tmp,p);fd=os.open(p.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def deployment_view(d):
    keys=['id','site_id','state','title','created_at','published_at','deploy_ssl_url','required','required_functions','required_edge_functions','required_server','available_functions']
    return {k:d.get(k) for k in keys}
class SafeApi(m.Cli):
    def __init__(self,cli,stage,evidence):super().__init__(cli);self.stage=stage;self.evidence=evidence;self.context={};self.sequence=0
    def once(self,request):
        self.sequence+=1;record=self.evidence/f'intent-{self.sequence:03d}-{request["operation"]}.json'
        m.require(not record.exists(),'Existing intent requires reconciliation, not a fresh runner')
        view={k:v for k,v in request.items() if k!='body'}
        if 'body' in request:view['bodySHA256']=sha(compact(request['body']).encode()) if isinstance(request['body'],dict) else sha(request['body'].encode())
        event={'state':'intent','UTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'request':view};save(record,event)
        p=subprocess.run(['node',str(HERE/'netlify_once.mjs'),self.cli],input=compact(request),capture_output=True,text=True,timeout=55)
        if p.returncode==0:
            d=json.loads(p.stdout) if p.stdout.strip() else None;event.update(state='responded',response=deployment_view(d) if isinstance(d,dict) and d.get('id') else {'acknowledged':True});save(record,event);return d
        event['state']='uncertain';event['transportDiagnostic']=p.stderr.strip();save(record,event)
        if request['operation']=='createSiteDeploy':
            ds=super().call('listSiteDeploys',{'site_id':request['siteId'],'page':1,'per_page':25});matches=[d for d in ds if d.get('title')==request['title']]
            if len(matches)==1:event.update(state='reconciled',response=deployment_view(matches[0]));save(record,event);return matches[0]
        elif request['operation'] in ['restoreSiteDeploy','publishReviewedInitialMainDeploy','publishReviewedFinalMainDeploy']:
            s=super().call('getSite',{'site_id':request['siteId']})
            if (s.get('published_deploy')or{}).get('id')==request['deployId']:event['state']='reconciled';save(record,event);return s['published_deploy']
        elif request['operation'] in ['uploadDeployFile','uploadDeployFunction']:
            d=super().call('getSiteDeploy',{'site_id':request['siteId'],'deploy_id':request['deployId']});required=d.get('required_functions' if request['operation']=='uploadDeployFunction' else 'required')
            digest=request.get('expectedSHA256') or request.get('expectedSHA1')
            if required is not None and digest not in required:event['state']='reconciled';save(record,event);return {'reconciled':True}
        elif request['operation']=='updatePublicSiteProtection':
            s=super().call('getSite',{'site_id':request['siteId']})
            if s.get('sso_login') is False:event['state']='reconciled';save(record,event);return s
        raise RuntimeError('Netlify outcome unresolved. Preserve intents and reconcile; no automatic retry.')
    def call(self,name,data):
        if name=='createSiteDeploy':
            site=data['site_id'];m.require(data['body']['draft'] is True,'Only draft creation');title='GH0ST GL3 disabled '+site[:8]+' 20261117-r1'
            d=self.once({'operation':name,'siteId':site,'body':data['body'],'bodySHA256':sha(compact(data['body']).encode()),'title':title});self.context[d['id']]=site;return d
        if name=='uploadDeployFile':
            dep=data['deploy_id'];site=self.context[dep];content=data['body'];return self.once({'operation':name,'siteId':site,'deployId':dep,'path':data['path'],'body':content,'expectedSHA1':hashlib.sha1(content.encode()).hexdigest()})
        if name=='restoreSiteDeploy':
            m.require(data['site_id'] in [RPC,SCAN],'Main-site publication forbidden');return self.once({'operation':name,'siteId':data['site_id'],'deployId':data['deploy_id']})
        return super().call(name,data)
    def upload_function(self,deploy_id,name,file):
        return self.once({'operation':'uploadDeployFunction','siteId':self.context[deploy_id],'deployId':deploy_id,'name':name,'file':str(file.resolve()),'expectedSHA256':sha(file.read_bytes())})
def ready(api,site,d):
    deadline=time.monotonic()+180
    while d.get('state')!='ready' and time.monotonic()<deadline:
        m.require(d.get('state')!='error','Deployment errored; preserve intent');time.sleep(2);d=api.call('getSiteDeploy',{'site_id':site,'deploy_id':d['id']})
    m.require(d.get('state')=='ready','Deployment is not ready; reconcile this exact id');return d
def separate(api,kind,p):
    site=p['siteId'];before=api.call('getSite',{'site_id':site});m.require(not before.get('published_deploy'),'An existing production deploy needs explicit review')
    d=api.call('createSiteDeploy',{'site_id':site,'body':p['body']});dep=d['id'];deadline=time.monotonic()+90
    while d.get('state')=='preparing' and time.monotonic()<deadline:time.sleep(2);d=api.call('getSiteDeploy',{'site_id':site,'deploy_id':dep})
    m.require(d.get('state')!='preparing' and not d.get('required_edge_functions') and not d.get('required_server'),'Unknown/pending runtime artifact')
    if kind=='rpc':
        digest=p['body']['functions']['gl3-rpc'];m.require(all(x==digest for x in d.get('required_functions')or[]),'Unknown function requested')
        for x in d.get('required_functions')or[]:api.upload_function(dep,'gl3-rpc',api.stage/'gl3-rpc.zip')
        additions=p['additions']
    else:
        m.require(not d.get('required_functions'),'Static scan requested unknown functions');main=json.loads((api.stage/'plan.json').read_text());additions={k.removeprefix('/gl3/scan'):v for k,v in main['additions'].items() if k.startswith('/gl3/scan/')}
    by_sha={v['sha1']:(k,v['file']) for k,v in additions.items()}
    m.require(all(x in by_sha for x in d.get('required')or[]),'Unknown existing file requested')
    for x in d.get('required')or[]:
        path,file=by_sha[x];body=(api.stage/file).read_text();m.require(hashlib.sha1(body.encode()).hexdigest()==x,'Prepared file changed');api.call('uploadDeployFile',{'deploy_id':dep,'path':path.lstrip('/'),'body':body})
    d=ready(api,site,d)
    if kind=='rpc':m.require(m.functions_match([],d.get('available_functions')or[],{'gl3-rpc':{'sha256':digest,'runtime':'nodejs24.x','route':'/'}}),'RPC function metadata differs')
    else:m.require(not d.get('available_functions'),'Unexpected scan function')
    save(api.evidence/(kind+'-ready-deploy.json'),deployment_view(d))
    api.call('restoreSiteDeploy',{'site_id':site,'deploy_id':dep});current=api.call('getSite',{'site_id':site});m.require(current['published_deploy']['id']==dep,'Publication outcome requires reconciliation')
    receipt={'siteId':site,'deployId':dep,'deployUrl':d['deploy_ssl_url'],'customDomain':current.get('custom_domain'),'published':True,'enabled':False,'upstream':None};save(api.evidence/(kind+'-publication.json'),receipt);print(json.dumps(receipt),flush=True);return receipt
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--cli',required=True);a.add_argument('--stage',type=Path,required=True);a.add_argument('--evidence',type=Path,required=True);args=a.parse_args();args.evidence.mkdir(exist_ok=True)
    api=SafeApi(args.cli,args.stage,args.evidence);plan=json.loads((args.stage/'plan.json').read_text());m.require(plan['body']['draft'] is True and plan['additionalFunctions'].get('gl3-rpc'),'Fallback must remain enabled in draft manifest')
    c=json.loads((args.stage/'public/gl3/bridge/public-config.json').read_text());m.require(c['enabled'] is False and not c.get('rpcUpstreamHttpsUrl'),'Disabled config required')
    sites=json.loads((args.stage/'separate-sites-plan.json').read_text());out={}
    for kind in ['rpc','scan']:out[kind]=separate(api,kind,sites[kind])
    out['mainDraft']=m.draft(api,args.stage);save(args.evidence/'main-draft.json',out['mainDraft']);print(json.dumps(out['mainDraft']),flush=True)
    current=api.call('getSite',{'site_id':m.SITE});m.require(current['published_deploy']['id']==plan['baseDeployId'],'Main production changed; do not activate anything')
    out['mainProductionUnchanged']=True;save(args.evidence/'operation-result.json',out)
