"""Negative codec/model tests; expected checkpoint roots here are test fixtures."""
from pathlib import Path
import hashlib
import json
import shutil
import struct
import tempfile
import argparse
from prepare_model import prepare
from test_runtime import Wasm, CACHE, HERE

blob=(CACHE/"model.bin").read_bytes()
w=Wasm(blob)
body=w.checkpoint()
passed=[]
def reject(name,changes):
    data=bytearray(body)
    for offset,kind,value in changes:struct.pack_into(kind,data,offset,value)
    before=w.checkpoint()
    assert w.restore(data,hashlib.sha256(data).digest())<0
    assert w.checkpoint()==before
    passed.append(name)

reject("phase4 cannot address head16",[(40,"<I",4),(44,"<I",0),(48,"<I",16)])
reject("phase1 cannot resume layer1",[(40,"<I",1),(44,"<I",1)])
reject("phase1 cannot resume a row cursor",[(40,"<I",1),(52,"<I",1)])
reject("context64 rejected",[(56,"<I",64)])
reject("wrong model binding rejected",[(8,"<I",0)])

# A fixture-authorized but numerically hostile state must fault, not wrap into
# a successful inference. Production expected roots must come from chain state.
data=bytearray(body)
struct.pack_into("<I",data,40,2)
struct.pack_into("<q",data,80,(1<<63)-1)
struct.pack_into("<q",data,88,(1<<63)-1)
assert w.restore(data,hashlib.sha256(data).digest())==0
assert w.call("gh_advance",0,64)==-6 and w.call("gh_phase")==12
assert w.call("gh_advance",0,64)<0
passed.append("signed arithmetic overflow fails closed without a token")

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--export-dir',type=Path,default=HERE.parents[4]/"output/arc-tinystories-20261025/tinystories3746k")
source=parser.parse_args().export_dir
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);shutil.copytree(source/"data",root/"data")
    path=root/"data/manifest.json";original=json.loads(path.read_text())
    bad=json.loads(json.dumps(original));bad["architecture"]["layers"]=7
    path.write_text(json.dumps(bad))
    try:prepare(root)
    except ValueError:passed.append("self-consistent architecture downgrade rejected")
    else:raise AssertionError("accepted changed architecture")
    bad=json.loads(json.dumps(original));bad["tensors"][0]["width"]=63
    path.write_text(json.dumps(bad))
    try:prepare(root)
    except ValueError:passed.append("changed tensor layout rejected")
    else:raise AssertionError("accepted changed tensor layout")
    bad=json.loads(json.dumps(original));tensor=bad["tensors"][0]
    data_path=root/"data"/tensor["file"];changed=bytearray(data_path.read_bytes());changed[-1]^=1
    data_path.write_bytes(changed);tensor["sha256"]=hashlib.sha256(changed).hexdigest()
    path.write_text(json.dumps(bad))
    try:prepare(root)
    except ValueError:passed.append("forged matching per-tensor checksum fails pinned flat-model hash")
    else:raise AssertionError("accepted forged model")

report={"scope":"Local malformed-input and checked-arithmetic tests, not production authorization or fraud proofs",
    "passed":len(passed),"checks":passed,"expectedHashesAreTestFixtures":True}
(HERE/"boundary-evidence.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report,indent=2))
