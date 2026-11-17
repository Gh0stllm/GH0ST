"""Release root's temporary observational hold only after exact current-case audit.

No process is signalled here. Root's capped observer owns any pause/resume.
"""
from pathlib import Path
import json,platform,time
assert platform.system()=='Linux'
root=Path('/root/full-lifecycle-audit');audit=root/'strict-current'
while True:
 try:
  report=json.loads((audit/'strict-audit.json').read_text())
  if not report['passed']:time.sleep(.1);continue
  assert report['runID']=='current-lifecycle-39353-b9d894'
  assert report['targetBound'] and report['refundExact'] and report['terminalInputBytesVerified']
  manifest=json.loads(Path('/root/full-lifecycle/evidence/terminal-input-manifest.json').read_text())
  assert report['terminalInputSHA256']==manifest['SHA256'] and report['moduleRoot']==manifest['moduleRoot']
  assert report['terminal']==manifest['expectedEndState']
  states=json.loads((audit/'edge-state-snapshot.json').read_text())['edges']
  intervals=[]
  for proof in report['boundOneStepEvents']:
   links=[x for x in proof['path'] if x['kind']=='subchallenge-claim']
   assert links,'Winning proof has no actual block-to-machine claim link'
   edge=states[links[0]['from']]
   assert edge['level']=='0'
   # This exact fixture's parent assertion is the genesis-finished state
   # (batch 1 / position 0); genesis block number is zero.
   claim=next(x for x in report['claims'] if x['hash']==report['pair']['honest'])
   assert claim['before'][0][1]==['1','0']
   assert int(edge['endHeight'])==manifest['blockNumber']
   assert int(edge['startHeight'])==manifest['blockNumber']-1
   intervals.append({'edge':links[0]['from'],'startHeight':edge['startHeight'],'endHeight':edge['endHeight'],'terminalBlockNumber':manifest['blockNumber']})
  assert intervals
  passed={'passed':True,'runID':report['runID'],'terminalTransitionBound':True,'terminalIntervals':intervals,'strictAuditPassed':True,'exactEdgeCollateralRefund':True,'completeAssertionBondSettlementAudited':False,'holdReleaseAuthorizedByRoot':True,'asOfUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
  (root/'terminal-path-and-release.json').write_text(json.dumps(passed,indent=2)+'\n')
  (root/'release-hold').touch()
  break
 except Exception as e:
  (root/'release-check-error.json').write_text(json.dumps({'passed':False,'error':str(e),'asOfUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},indent=2)+'\n')
  time.sleep(.25)
