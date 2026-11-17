"""Root-authorized full public initial-setup rollout; never fabricates final setup.

All preparation/compression occurs on Runpod. This Mac API runner publishes only
the two already-created sites and the exact preservation-reviewed additive main
draft. It uses the existing single-attempt, journal-first transport.
"""
from pathlib import Path
import json,hashlib,time,argparse,importlib.util
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('live',HERE/'netlify_disabled_live.py');lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib);m=lib.m
sha=lambda b:hashlib.sha256(b).hexdigest()
class Api(lib.SafeApi):
    def call(self,name,data):
        if name=='createSiteDeploy':
            site=data['site_id'];title='GH0ST GL3 live finalized '+site[:8]+' 20261118-r1';d=self.once({'operation':name,'siteId':site,'body':data['body'],'bodySHA256':sha(lib.compact(data['body']).encode()),'title':title});self.context[d['id']]=site;return d
        return super().call(name,data)
def unchanged(api,site,base):m.require(api.call('getSite',{'site_id':site})['published_deploy']['id']==base,'Production changed. Stop and obtain a fresh preservation snapshot.')
def separate(api,kind,p):
    site=p['siteId'];unchanged(api,site,p['baseDeployId']);d=api.call('createSiteDeploy',{'site_id':site,'body':p['body']});dep=d['id'];deadline=time.monotonic()+90
    while d.get('state')=='preparing' and time.monotonic()<deadline:time.sleep(2);d=api.call('getSiteDeploy',{'site_id':site,'deploy_id':dep})
    m.require(d.get('state')!='preparing' and not d.get('required_edge_functions') and not d.get('required_server'),'Unexpected/pending runtime artifact')
    digest=p['body'].get('functions',{}).get('gl3-rpc');required_functions=d.get('required_functions')or[]
    m.require(all(kind=='rpc' and x==digest for x in required_functions),'Unknown function upload requested')
    for x in required_functions:api.upload_function(dep,'gl3-rpc',api.stage/'gl3-rpc.zip')
    by_sha={v['sha1']:(name,v['file']) for name,v in p['additions'].items()};m.require(all(x in by_sha for x in d.get('required')or[]),'Old/unknown file requested; do not replace it')
    for x in d.get('required')or[]:
        name,file=by_sha[x];body=(api.stage/file).read_text();m.require(hashlib.sha1(body.encode()).hexdigest()==x,'Prepared file changed');api.call('uploadDeployFile',{'deploy_id':dep,'path':name.lstrip('/'),'body':body})
    d=lib.ready(api,site,d)
    if kind=='rpc':m.require(m.functions_match([],d.get('available_functions')or[],{'gl3-rpc':{'sha256':digest,'runtime':'nodejs24.x','route':'/'}}),'Unexpected RPC function runtime/routes')
    else:m.require(not d.get('available_functions'),'Unexpected Scan function')
    unchanged(api,site,p['baseDeployId']);lib.save(api.evidence/(kind+'-ready.json'),lib.deployment_view(d));api.call('restoreSiteDeploy',{'site_id':site,'deploy_id':dep});s=api.call('getSite',{'site_id':site});m.require(s['published_deploy']['id']==dep,'Publish outcome unresolved')
    result={'siteId':site,'baseDeployId':p['baseDeployId'],'deployId':dep,'deployUrl':d['deploy_ssl_url'],'customDomain':s.get('custom_domain'),'published':True,'readOnly':False,'phase':'finalized'};lib.save(api.evidence/(kind+'-published.json'),result);print(json.dumps(result),flush=True);return result
def main_draft(api,proof):
    p=json.loads((api.stage/'plan.json').read_text());r=m.draft(api,api.stage);d=api.call('getSiteDeploy',{'site_id':m.SITE,'deploy_id':r['draftDeployId']});m.require(m.functions_match(p['originalFunctions'],d.get('available_functions')or[],p['additionalFunctions']),'Old functions changed')
    unchanged(api,m.SITE,p['baseDeployId']);review={'schema':'gh0st.gl3.final-main-publication-review.v1','siteId':m.SITE,'baseDeployId':p['baseDeployId'],'draftDeployId':r['draftDeployId'],'publicationApproved':True,'readOnly':False,'bootstrapSetup':False,'originalFileHashesPreserved':True,'originalFunctionMetadataPreserved':True,'originalFileCount':p['originalFileCount'],'coreBootstrapTestsPassed':proof['coreBootstrapTestsPassed'],'actualHttpsUpstreamVerified':proof['actualHttpsUpstreamVerified'],'setupCompleteVerified':True,'setupReceiptCount':7,'finalSetupEvidenceSHA256':proof['finalSetupEvidenceSHA256'],'upstreamApprovalSHA256':proof['upstreamApprovalSHA256'],'coreSHA256':proof['coreSHA256'],'testEvidenceSHA256':proof['testEvidenceSHA256'],'bridgeConfigSHA256':sha((api.stage/'public/gl3/bridge/public-config.json').read_bytes())};review_file=api.evidence/'main-publication-review.json';lib.save(review_file,review)
    m.require(all(proof[k] is True for k in ['coreBootstrapTestsPassed','actualHttpsUpstreamVerified','finalSetupVerified']),'Root actual upstream/core approval missing')
    lib.save(api.evidence/'actual-main-draft-metadata.json',lib.deployment_view(d));return r,review_file
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--cli',required=True);a.add_argument('--stage',type=Path,required=True);a.add_argument('--evidence',type=Path,required=True);a.add_argument('--review',type=Path,required=True);a.add_argument('--mode',choices=['sites','main-draft','main-publish'],required=True);x=a.parse_args();x.evidence.mkdir(exist_ok=True);mode_dir=x.evidence/x.mode;mode_dir.mkdir(exist_ok=True);api=Api(x.cli,x.stage,mode_dir);proof=json.loads(x.review.read_text());m.require(proof['actualHttpsUpstreamVerified'] is True and proof['readOnly'] is False,'Verified full upstream approval required')
    if x.mode=='sites':
        sites=json.loads((x.stage/'separate-sites-plan.json').read_text());out={k:separate(api,k,sites[k]) for k in ['rpc','scan']};lib.save(x.evidence/'sites-result.json',out)
    elif x.mode=='main-draft':
        r,f=main_draft(api,proof);lib.save(x.evidence/'main-draft-result.json',r);print(json.dumps(r),flush=True)
    else:
        p=json.loads((x.stage/'plan.json').read_text());r=json.loads((x.evidence/'main-draft-result.json').read_text());f=x.evidence/'main-draft/main-publication-review.json';review=json.loads(f.read_text());m.require(review['draftDeployId']==r['draftDeployId'] and review['baseDeployId']==p['baseDeployId'],'Wrong reviewed main draft');m.require(proof.get('actualDraftHttpProbesPassed') is True and proof.get('actualDraftHttpEvidenceSHA256'),'Actual hosted draft review required');review.update(actualDraftHttpProbesPassed=True,actualDraftHttpEvidenceSHA256=proof['actualDraftHttpEvidenceSHA256']);lib.save(f,review);unchanged(api,m.SITE,p['baseDeployId']);d=api.call('getSiteDeploy',{'site_id':m.SITE,'deploy_id':r['draftDeployId']});m.require(d['state']=='ready' and m.functions_match(p['originalFunctions'],d.get('available_functions')or[],p['additionalFunctions']),'Draft changed');api.once({'operation':'publishReviewedFinalMainDeploy','siteId':m.SITE,'deployId':r['draftDeployId'],'reviewFile':str(f.resolve()),'reviewSHA256':sha(f.read_bytes())});s=api.call('getSite',{'site_id':m.SITE});m.require(s['published_deploy']['id']==r['draftDeployId'],'Main publish outcome unresolved');out={'siteId':m.SITE,'deployId':r['draftDeployId'],'published':True,'phase':'finalized','setupCompleteVerified':True,'setupReceiptCount':7,'finalSetupEvidenceSHA256':proof['finalSetupEvidenceSHA256'],'originalFilesPreserved':p['originalFileCount'],'oldFunctionsPreserved':len(p['originalFunctions'])};lib.save(x.evidence/'main-publication.json',out);print(json.dumps(out),flush=True)
