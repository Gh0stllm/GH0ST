"""Runpod-only preparation of the live-Whispers-derived GL3 frontend."""
from pathlib import Path
import argparse,shutil,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--assets',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();assert not a.out.exists();d=a.out/'l3';d.mkdir(parents=True)
for n in ['index.html','style.css','whispers-theme.css','app.mjs','core.mjs','layer-controller.mjs','whispers-layers.mjs','block-observation.mjs']:shutil.copyfile(a.source/n,d/n)
(d/'fonts').mkdir();(d/'assets').mkdir()
for n in ['grotesk.woff2','mono.woff2','editorial.woff2']:shutil.copyfile(a.assets/'fonts'/n,d/'fonts'/n)
shutil.copyfile(a.assets/'gh0st-mark.svg',d/'assets/gh0st-mark.svg');shutil.copyfile(a.assets/'FONT-LICENSES.txt',d/'fonts/FONT-LICENSES.txt')
(d/'_headers').write_text('/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cache-Control: public, max-age=0, must-revalidate\n')
assert hashlib.sha256((d/'whispers-theme.css').read_bytes()).hexdigest()=='1687c08eae121f47eec78a45800f37586a579c4e3dedfde88e6a7da1c59292dc'
m={'l3':{'/'+str(f.relative_to(d)):{'sha1':hashlib.sha1(f.read_bytes()).hexdigest(),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size}for f in sorted(d.rglob('*'))if f.is_file()}};(a.out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps({'passed':True,'files':len(m['l3']),'bytes':sum(x['bytes']for x in m['l3'].values()),'originalWhispersCSSExact':True}))
