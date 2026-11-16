"""Copy only verified official machine artifacts to the private local cache."""
from pathlib import Path
import hashlib,tarfile,subprocess,shutil
r=Path(__file__).resolve().parent;node=(r/'../node').resolve();a=node/'.cache/official-machines-layer.tar.gz'
if not a.exists():subprocess.run(['python3',str(node/'official-machine-root.py')],check=True)
assert hashlib.sha256(a.read_bytes()).hexdigest()=='f772eaa7929d2587bf080df6719bfca524a5803eabe6d3423760a15f46ae6b5b'
root='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97';out=r/'.cache/official-machines';prefix='home/user/target/machines/'+root+'/'
with tarfile.open(a) as archive:
 for m in archive.getmembers():
  if m.isfile() and m.name.startswith(prefix):
   dest=out/root/m.name[len(prefix):];assert dest.resolve().is_relative_to(out.resolve());dest.parent.mkdir(parents=True,exist_ok=True)
   with archive.extractfile(m) as src,dest.open('wb') as dst:shutil.copyfileobj(src,dst)
latest=out/'latest'
if latest.exists() or latest.is_symlink():assert latest.is_symlink() and latest.readlink()==Path(root)
else:latest.symlink_to(root)
assert (latest/'module-root.txt').read_text().strip()==root
print('Verified standard machine files prepared; no container or prover execution.')
