#!/usr/bin/env python3
"""Public metadata only. Never reads effective configuration, passwords or keys."""
from pathlib import Path
import os,json,hashlib,datetime
assert os.uname().nodename=='42456c02ced1'
N=Path('/workspace/gl3/same-day-mainnet/node');P=N.parent/'deployment-packet/receipt-derived';M=Path('/workspace/gl3/mainnet');O=N/'private-start-draft'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(Path(p).read_text())
def write(n,v):
 p=O/n
 with p.open('x')as f:json.dump(v,f,indent=2);f.write('\n')
 return {'path':str(p),'SHA256':sha(p)}
standaloneNode=Path('/workspace/gl3/durable/node-standalone/node-v24.22.3/node');assert sha(standaloneNode)=='a7ec1b37e6ff9d187e4198c5b6df9a4eb1c74dd31804fb3bac55cc4ceca1ac01'
packet=load(P/'packet.json');assert packet['passed']and sha(P/'packet.json')=='959914132458be96045f357b9a3d9dc6f6a7941cc7edc2c345536ba6cb0782ca'
for k in ['profile','deploymentManifest','fundingManifest','genesis','chainInfo']:
 a=packet['bindings'][k];assert sha(a['path'])==a['SHA256']
renderPath=M/'identities/config-rendered.json';render=load(renderPath);assert render['schema']=='gh0st.gl3.operator-config-rendered.v1'and render['privateConfigs']is True
assert render['genesisSHA256']==packet['bindings']['genesis']['SHA256']and render['chainInfoSHA256']==packet['bindings']['chainInfo']['SHA256']
for k in ['genesisSHA256','chainInfoSHA256','nodeEffectiveSHA256','backendEffectiveSHA256']:assert len(render[k])==64 and all(c in '0123456789abcdef'for c in render[k])
check=load(N/'host-reset-01/test-exit.json');assert check['actualExitCode']==0 and check['hostname']==os.uname().nodename
for n in ['operator_pair.py','test_operator_pair.py','backend-auth-probe.cjs']:assert sha(N/n)==check['sourceSHA256'][n]
# References below are not opened; the root-operated adapter verifies actual private bytes later.
records={'renderReceipt':{'path':str(renderPath),'SHA256':sha(renderPath)},'deploymentManifest':packet['bindings']['deploymentManifest'],'fundingManifest':packet['bindings']['fundingManifest'],'nodeConfig':{'path':str(M/'config/node.effective.json'),'SHA256':render['nodeEffectiveSHA256']},'backendConfig':{'path':str(M/'config/validator.effective.json'),'SHA256':render['backendEffectiveSHA256']},'chainInfo':{'path':str(M/'config/chain-info.json'),'SHA256':render['chainInfoSHA256']},'genesis':{'path':str(M/'config/genesis.json'),'SHA256':render['genesisSHA256']}}
profile=load(packet['bindings']['profile']['path']);profile['status']='RENDER_BOUND_PRIVATE_START_REVIEW_PENDING';profile['nodeConfig'].update(path=records['nodeConfig']['path'],SHA256=render['nodeEffectiveSHA256'],chainInfoPath=records['chainInfo']['path'],chainInfoSHA256=render['chainInfoSHA256'],genesisPath=records['genesis']['path']);profile['review'].update(privateBootstrapStartApproved=False,publicActivationApproved=False)
O.mkdir(mode=0o755,exist_ok=True);records['profile']=write('production-profile.render-bound.json',profile)
approval={'schema':'gh0st.gl3.private-start-approval.draft.v1','operatorReviewed':False,'privateBootstrapStartApproved':False,'publicActivationApproved':False,'licenseConfirmed':False,'boundedFundingApproved':False,'boundedValidatorAllowanceVerified':False,'boundedValidatorAllowanceManifestSHA256':None,'supervisorSourceSHA256':sha(N/'operator_pair.py'),'backendProbeSHA256':sha(N/'backend-auth-probe.cjs'),'runtimeWrapperSHA256':sha(N.parent/'ops/infra-prepare/runtime-exec.sh'),'standaloneNodePath':str(standaloneNode),'standaloneNodeSHA256':sha(standaloneNode),'hostname':os.uname().nodename,'sourcePacketSHA256':sha(P/'packet.json'),'instructions':'Root must independently verify bounded100000GH0ST allowance, actual runtime and approvals. This draft grants no startup or public activation.'}
approval.update({k+'SHA256':v['SHA256']for k,v in records.items()})
records['approval']=write('private-start-approval.draft.json',approval)
bundle={'schema':'gh0st.gl3.private-service-bundle.v1',**records,'stateDir':str(M/'run/pair'),'backendProbeSHA256':approval['backendProbeSHA256']}
br=write('service-bundle.draft.json',bundle)
write('binding-manifest.json',{'schema':'gh0st.gl3.public-start-draft-bindings.v1','createdUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'host':os.uname().nodename,'records':records,'serviceBundle':br,'sourceSHA256':sha(__file__),'postResetTestReceiptSHA256':sha(N/'host-reset-01/test-exit.json'),'publicRendererReceiptSHA256':sha(renderPath),'runtimePins':{'standaloneNodePath':str(standaloneNode),'standaloneNodeSHA256':sha(standaloneNode),'wrapperPath':str(N.parent/'ops/infra-prepare/runtime-exec.sh'),'wrapperSHA256':approval['runtimeWrapperSHA256'],'rootReportedVersion':'v24.22.3','NodeJSExecutionByThisAssembler':False},'privateConfigurationBytesRead':0,'secretFilesRead':0,'servicesStarted':0,'transactionsSubmitted':0,'privateBootstrapStartApproved':False})
print(json.dumps({'draftPrepared':True,'path':str(O),'bundle':br,'privateBootstrapStartApproved':False,'privateConfigurationBytesRead':0,'servicesStarted':0,'transactionsSubmitted':0}))
