from pathlib import Path
from collections import defaultdict
import json,hashlib,decimal
b=Path('/workspace/gl3/testnet/withdrawal-recovery/evidence')
p=b/'child-stack.json';data=p.read_bytes();d=json.loads(data);groups=defaultdict(list)
for t in d['transactions']:groups[t['category']].append(t)
summary={}
for k,ts in groups.items():
 gas=sum(int(t['gasUsed'])for t in ts);poster=sum(int(t['l1PosterGasUsed'])for t in ts);compute=sum(int(t['l2ComputeGasUsed'])for t in ts);fee=sum(int(t['gasUsed'])*int(t['effectiveGasPrice'])for t in ts)
 summary[k]={'transactionCount':len(ts),'actualGasUsed':str(gas),'actualParentPosterGasUsed':str(poster),'actualL2ComputeGasUsed':str(compute),'actualPrivateFakeETHFeeWei':str(fee),'labels':[t['label']for t in ts],'receipts':[{'label':t['label'],'transactionHash':t['hash'],'blockNumber':t['blockNumber'],'gasUsed':str(t['gasUsed']),'gasUsedForL1':str(t['l1PosterGasUsed']),'l2ComputeGasUsed':str(t['l2ComputeGasUsed'])}for t in ts]}
selected=[t for t in d['transactions']if t['category']in('bootstrap','deployment','rollup-creation')]
r={'schema':'gh0st.gl3.base.factory-gas-rehearsal.v1','scope':'ACTUAL_ISOLATED_NITRO4663_PARENT_REHEARSAL_NOT_ROBINHOOD_QUOTE','sourceChildStackSHA256':hashlib.sha256(data).hexdigest(),'actualParentChainId':str(d['parent']['chainId']),'childChainId':str(d['childChainId']),'officialRoot':d['provenance']['machineRoot'],'contractsCommit':d['provenance']['nitroContractsCommit'],'groups':summary,'factoryAndRollup':{'transactionCount':len(selected),'actualGasUsed':str(sum(int(t['gasUsed'])for t in selected)),'actualParentPosterGasUsed':str(sum(int(t['l1PosterGasUsed'])for t in selected)),'actualL2ComputeGasUsed':str(sum(int(t['l2ComputeGasUsed'])for t in selected)),'actualPrivateFakeETHFeeWei':str(sum(int(t['gasUsed'])*int(t['effectiveGasPrice'])for t in selected))},'pricerUsed':'FIXTURE_ONLY LocalUnitRatePricer; production candidate differs','ownerConfiguration':'Fixture owner/validator/poster configuration is part of createRollup params; production custody/bond values unselected','RobinhoodGasQuote':False,'doesNotInclude':'Production price-pricer delta, new operator wallets, licenses, funded collateral, later owner configuration and recurring batch posting','realPublicTransactions':0}
out=Path('/workspace/gl3/durable/base-launch/factory-gas-rehearsal.json');out.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r['factoryAndRollup']));print(json.dumps({k:dict(transactionCount=v['transactionCount'],gasUsed=v['actualGasUsed'])for k,v in summary.items()}))
