"""Regenerate or verify the two frozen selected source crates from local templates.
No network access, external source tree or model-data mutation is needed.
"""
from pathlib import Path
import argparse,hashlib
p=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--write',action='store_true');args=parser.parse_args()
s=(p/'baseline.rs').read_text()
a=s.index(' let mut sum=0i64;for i in 0..128{');b=s.index('\n#[inline(always)] unsafe fn recurrent(',a);end=s.rfind('}',a,b)
old=s[a:end]
term=lambda index:f'{{let w=i64::from_le(core::ptr::read_unaligned(weights.add(({index})*8).cast::<i64>()));let product=w.wrapping_mul(*packed.add({index})).wrapping_add(1i64<<41);sum+=(product<<1)>>43;}}'
body=' let mut sum=0i64;let mut i=0;while i<128 {\n'+'\n'.join(term(f'i+{j}')for j in range(32))+'\n i+=32;}\n sum\n'
fixed=s[:a]+body+s[end:]
marker='// Fixed-seed benchmark entrypoint for an isolated official Stylus meter.'
seed=fixed[:fixed.index(marker)]+(p/'seed-wrapper.rs').read_text()
outputs={'32/src/lib.rs':fixed,'32-seeds/src/lib.rs':seed,'32/Cargo.toml':(p/'Cargo.fixed.toml').read_text(),'32-seeds/Cargo.toml':(p/'Cargo.seed.toml').read_text()}
for name,content in outputs.items():
 f=p/name
 if args.write:f.parent.mkdir(parents=True,exist_ok=True);f.write_text(content)
 else:assert f.read_text()==content,'Source mismatch: '+name
 print(name,hashlib.sha256(content.encode()).hexdigest())
