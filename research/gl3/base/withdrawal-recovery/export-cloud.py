"""Export only reviewed public fixture evidence; keep ephemeral signing material private."""
from pathlib import Path
import hashlib,json,platform,tarfile
assert platform.system()=='Linux'
r=Path('/workspace/gl3/testnet/withdrawal-recovery');e=r/'evidence';out=r/'export';out.mkdir(exist_ok=True)
allow=['parent-public-config.json','child-public-config.json','resources.csv','preflight-identities.json','runtime-context.json','actual-exit.json','controller-result.json','source-manifest.json','process.json','base-withdrawal-report.json','recovery-before.json','cli-primary-actual-exit.json','recovery-and-storage.json','token-storage-witness.json','source-snapshot.json','root-stack.json','child-stack.json','parent-genesis-generator.log','child-genesis-generator.log','runner.log','parent.log','child.log','geth.log']
secrets=[]
p=e/'source-wallets.private.json'
if p.exists():
 for x in json.loads(p.read_text()).values():secrets+=[x['privateKey'].encode(),x['privateKey'][2:].encode()]
manifest=[]
for name in allow:
 p=e/name
 if not p.exists():continue
 b=p.read_bytes();assert all(k not in b for k in secrets),'Generated private key leaked into '+name
 (out/name).write_bytes(b);manifest.append({'path':name,'bytes':len(b),'SHA256':hashlib.sha256(b).hexdigest()})
for p in (r/'genesis-build').glob('*.json'):
 b=p.read_bytes();assert all(k not in b for k in secrets)
 name='genesis-build-'+p.name;(out/name).write_bytes(b);manifest.append({'path':name,'bytes':len(b),'SHA256':hashlib.sha256(b).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'files':manifest,'privateConfigKeysAndDBsExcluded':True,'generatedPrivateKeyScanPassed':True},indent=2)+'\n')
a=r/'base-withdrawal-evidence.tar.gz'
with tarfile.open(a,'w:gz') as t:
 for p in sorted(out.iterdir()):t.add(p,arcname=p.name)
print(json.dumps({'path':str(a),'bytes':a.stat().st_size,'SHA256':hashlib.sha256(a.read_bytes()).hexdigest()}))
