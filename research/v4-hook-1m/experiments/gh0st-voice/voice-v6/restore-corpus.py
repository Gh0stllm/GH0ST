#!/usr/bin/env python3
"""Restore the compressed corpus files after checkout (never downloads)."""
from pathlib import Path
import gzip,hashlib,json
here=Path(__file__).resolve().parent
for item in json.loads((here/'compressed-files.json').read_text()):
 src=here/item['compressed'];target=here/item['restored']
 raw=gzip.decompress(src.read_bytes())
 assert len(raw)==item['bytes']and hashlib.sha256(raw).hexdigest()==item['sha256']
 if target.exists():assert target.read_bytes()==raw,'Refusing to overwrite different content: '+str(target)
 else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
 print(target.relative_to(here))
