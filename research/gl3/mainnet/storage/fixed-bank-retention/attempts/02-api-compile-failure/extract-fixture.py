"""Copy tiny exact windows from verified immutable Runpod image artifacts."""
from pathlib import Path
import hashlib,json,struct,platform

if platform.system()!="Linux":raise SystemExit("Runpod only")
root=Path('/root/gl3-fixed-bank-retention');out=root/'fixture';out.mkdir(parents=True,exist_ok=True)
pre=Path('/root/gl3-checkpoint-prototype/45b6e6a04e4548a3bdd9ffe31d84d62b/fixture/image.bin')
post=Path('/root/bounded-restore/final-state-export/export/memory.bin')
delta=Path('/root/bounded-restore/final-state-export/export/final-delta.bin')
def sha(p):return hashlib.file_digest(Path(p).open('rb'),'sha256').hexdigest()
expected={pre:'3cab2f8a2133c5b762a1744a290a8f5db150209e7c706adf9374d66b7ece3446',post:'26ade604551c291ab4d6e2194dbf45a4cfb8f895d914443d3740ac55422a92f7',delta:'8abd2b02f3f3f708f3f5d94242587493dd2bde6c888a4ec023119c8e1a1973ab'}
for p,h in expected.items():
    if sha(p)!=h:raise SystemExit('immutable source hash mismatch: '+str(p))
body=delta.read_bytes()
if body[:4]!=b'GSD1' or len(body)!=44+36*struct.unpack_from('<I',body,40)[0]:raise SystemExit('invalid final delta')
indices=sorted({struct.unpack_from('<I',body,i)[0]//4096 for i in range(44,len(body),36)})[:4]
if len(indices)<4:raise SystemExit('need four actual changing pages')
files={};changed=0
with pre.open('rb') as a,post.open('rb') as b:
    for slot,index in enumerate(indices):
        a.seek(index*4096);before=a.read(4096);b.seek(index*4096);after=b.read(4096)
        if len(before)!=4096 or len(after)!=4096:raise SystemExit('incomplete source page')
        changed+=before!=after
        for tag,data in [('preterminal',before),('completed',after)]:
            name=f'{tag}-{slot}.bin';(out/name).write_bytes(data);files[name]={'bytes':len(data),'SHA256':hashlib.sha256(data).hexdigest()}
globals_path=Path('/root/bounded-restore/final-state-export/export/globals.json');g=json.loads(globals_path.read_text());normalized=json.dumps(g,sort_keys=True,separators=(',',':')).encode();(out/'globals.json').write_bytes(normalized)
files['globals.json']={'bytes':len(normalized),'SHA256':hashlib.sha256(normalized).hexdigest()}
report={'scope':'Four exact changing memory pages from real preterminal/completed first-decision states; no engine execution or whole-VM acceptance','sourcePreterminalImage':str(pre),'sourcePreterminalSHA256':expected[pre],'sourceCompletedImage':str(post),'sourceCompletedSHA256':expected[post],'sourceMemoryBytes':post.stat().st_size,'sourceFinalDeltaSHA256':expected[delta],'sourceGlobalsSHA256':sha(globals_path),'portableModuleSHA256':'1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc','sampleMemoryPageIndices':indices,'samplePages':len(indices),'changingSamplePages':changed,'files':files,'fullMemoryOrTTValidatedByPrototype':False,'selectedMachineChanged':False,'allExecutionOnRunpod':True}
(out/'fixture.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'pages':indices,'changing':changed,'fixtureBytes':sum(v['bytes'] for v in files.values())}))
