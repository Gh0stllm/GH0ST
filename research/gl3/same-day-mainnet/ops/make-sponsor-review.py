"""Prepare exact sponsor review on Runpod. No signing or network writes."""
from pathlib import Path
import argparse,json,hashlib,sys
p=argparse.ArgumentParser();p.add_argument('--sponsor',required=True);p.add_argument('--delegated',required=True);p.add_argument('--out',required=True);a=p.parse_args();assert sys.platform=='linux'
s=Path(a.sponsor).read_bytes();d=Path(a.delegated).read_bytes();plan=json.loads(s);delegated=json.loads(d)
sha=lambda b:hashlib.sha256(b).hexdigest()
assert plan['delegatedPlanSHA256']==sha(d) and len(plan['actions'])==4 and len(delegated['actions'])==27
assert plan['coldOwner']=='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6'
assert plan['delegatedSigner']=='0x1E0a95665dc872899eb89018455ef44B27108FCd'
review={**plan,'schema':'gh0st.gl3.cold-sponsor-plan.v1','owner':plan['coldOwner'],'childChainId':4663001,'deployer':plan['delegatedSigner'],'sourceSponsorPlanSHA256':sha(s),'delegatedPlanJSON':d.decode(),'totals':{**plan['totals'],'ETHSentToOperatorsWei':plan['totals']['ETHSentWei'],'GH0STSentToValidatorUnits':plan['totals']['GH0STSentUnits']}}
Path(a.out).write_text(json.dumps(review,indent=2)+'\n');print(json.dumps({'reviewSHA256':sha(Path(a.out).read_bytes()),'delegatedPlanSHA256':sha(d),'fundingActions':4,'delegatedActions':27,'signatures':0,'transactionsSubmitted':0}))
