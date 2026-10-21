"""One user-authorized fee replacement of absent GH0ST batch-2 transactions."""
import os,json,fcntl,time
from pathlib import Path
import sys
sys.path.insert(0,'falcon-agent/fourbit-study')
import deploy as d
live=Path('/workspace/scratch/be1e363a306a/gh0st-rh-live');path=live/'fourbit-state.json'
lock=path.with_suffix('.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
rpc=d.RPC(os.environ['GH0ST_RH_RPC_URL']);s=json.loads(path.read_text());old=s['active_bundle']
d.require(int(rpc('eth_chainId'),16)==4663,'Wrong chain')
d.require(old is not None and len(old['transactions'])==25,'Wrong active batch')
d.require([e['name'] for e in old['transactions']]==[f'fourbit-weights-{i:04d}'for i in range(24,49)],'Wrong job sequence')
jobs=d.jobs(Path('/workspace/scratch/be1e363a306a/gh0st-model-cache/fourbit-study/affine64_s12z4/weights.bin'),s,Path('/workspace/scratch/be1e363a306a/gh0st-model-cache/fourbit-creation'));jm={j['name']:j for j in jobs}
# Reconcile every original hash before a different signature can be created.
absent=[]
for start in range(0,25,2):
 group=old['transactions'][start:start+2]
 replies=rpc.batch([call for e in group for call in [('eth_getTransactionReceipt',[e['hash']]),('eth_getTransactionByHash',[e['hash']])]])
 for i,e in enumerate(group):
  a,b=replies[2*i:2*i+2]
  d.require('result'in a and 'result'in b,'Incomplete old-hash reconciliation')
  if a['result'] is not None:
   if e['hash']not in {x['hash']for x in s['receipts']}:s['receipts'].append(d.receipt_row(rpc,s['sender'],e,jm[e['name']],a['result']))
  else:
   d.require(b['result'] is None,'An original transaction is pending; do not replace it')
   absent.append(e['hash'])
s['receipts'].sort(key=lambda x:x['nonce']);d.save(path,s)
existing={x['hash']for x in s['receipts']};entries=[{k:v for k,v in e.items()if k not in ['hash','submission','last_retry']}for e in old['transactions']if e['hash']not in existing]
d.require(entries,'Original batch already complete')
nonce=int(rpc('eth_getTransactionCount',[s['sender'],'latest']),16)
d.require(int(rpc('eth_getTransactionCount',[s['sender'],'pending']),16)==nonce==entries[0]['nonce'],'Nonce is not clean')
balance=int(rpc('eth_getBalance',[s['sender'],'latest']),16);reserve=2000000000000000;cap=balance-reserve
market=int(rpc('eth_gasPrice'),16);price=min(d.bump(market),cap//sum(e['gas_limit']for e in entries))
d.require(price>=market,'Wallet cannot cover all remaining contracts at current fee with reserve')
for e in entries:e.update(gas_price_wei=price,maximum_fee_wei=e['gas_limit']*price)
maximum=sum(e['maximum_fee_wei']for e in entries);d.require(maximum<=cap,'Fee cap exceeded')
d.check_submission_sizes(4663,entries,jm)
key=Path(os.environ['GH0ST_SIGNER_FILE']);d.require(key.stat().st_mode&0o077==0 and not key.resolve().is_relative_to(d.REPO),'Unsafe signer location')
account=d.Account.from_key(key.read_text().strip());d.require(account.address==s['sender'],'Wrong signer')
raw=d.signed_bundle(account,4663,entries,jm);del account
s.setdefault('superseded_bundles',[]).append(dict(old,superseded_at_utc=d.now(),reason='User explicitly withdrew the lowest-fee requirement and instructed immediate deployment',absent_transaction_and_receipt_hashes=absent))
bundle={'created_at_utc':d.now(),'maximum_fee_wei':maximum,'fee_cap_wei':cap,'reserve_wei':reserve,'transactions':entries,'fixed_gas_price_ceiling_wei':price,'gas_price_policy':'User-authorized current-fee replacement; wallet reserve retained','replaces_original_created_at_utc':old['created_at_utc']}
s['active_bundle']=bundle
report={'started_at_utc':d.now(),'status':'broadcasting','chain_id':4663,'sender':s['sender'],'weights_sha256':d.PIN,'batch_limit':25,'http_group_size':4,'atomic':False,'max_batch_fee_eth':d.eth(cap),'signed_gas_price_ceiling_wei':price,'user_authorized_fee_override':True,'original_absent_hashes':absent}
# Persist the new signed hashes and archived old journal before the first send.
d.require(int(rpc('eth_getTransactionCount',[s['sender'],'pending']),16)==nonce,'Nonce changed before broadcast');d.save(path,s)
print(json.dumps({'fee_override_journaled':len(entries),'new_price_wei':price,'market_price_wei':market,'batch_maximum_fee_eth':d.eth(maximum),'reserve_eth':d.eth(reserve)}),flush=True)
try:
 for start in range(0,len(entries),4):
  outstanding=[e for e in entries if e['hash']not in{x['hash']for x in s['receipts']}]
  d.require(int(rpc('eth_getBalance',[s['sender'],'latest']),16)>=sum(e['maximum_fee_wei']for e in outstanding)+reserve,'Reserve would be breached')
  d.require(int(rpc('eth_chainId'),16)==4663,'Chain changed')
  d.broadcast_group(rpc,s,entries[start:start+4],raw,jm,path,120)
  print(json.dumps({'batch_progress':min(start+4,len(entries)),'batch_contracts':len(entries)}),flush=True)
 d.verify_saved(rpc,s,jm)
 s['batches'].append(dict(bundle,completed_at_utc=d.now(),status='batch_complete_paused'));s['active_bundle']=None;d.save(path,s)
 report['status']='batch_complete_paused'
except Exception as error:
 report.update(status='stopped',stop_reason=str(error)if isinstance(error,RuntimeError)else type(error).__name__)
finally:
 rows=[x for x in s['receipts']if 27<=x['nonce']<=51]
 report.update(finished_at_utc=d.now(),batch_contracts=len(rows),batch_receipts=rows,batch_gas_used=sum(x['gas_used']for x in rows),batch_fee_eth=d.eth(sum(x['fee_wei']for x in rows)),unresolved_bundle=s['active_bundle'])
 try:report['after']=d.snapshot(rpc,s['sender'],d.jobs(Path('/workspace/scratch/be1e363a306a/gh0st-model-cache/fourbit-study/affine64_s12z4/weights.bin'),s,Path('/workspace/scratch/be1e363a306a/gh0st-model-cache/fourbit-creation')),s,25,reserve,d.limits(rpc,False),price,True,12000000)
 except Exception:report['after_snapshot_unavailable']=True
 d.save(live/'batch-0002-fee-override.json',report)
 print(json.dumps({k:report[k]for k in ['status','batch_contracts','batch_gas_used','batch_fee_eth']}),flush=True)
