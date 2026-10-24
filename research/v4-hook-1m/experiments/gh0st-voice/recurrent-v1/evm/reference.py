"""Independent exact Q10 scalar/NumPy checker for the recurrent word hook."""
import argparse
import hashlib
import json
from pathlib import Path
import os
import subprocess
import numpy as np
try:
    from Crypto.Hash import keccak
except ImportError:
    keccak = None

_entropy_blocks = {}


def random_bits(seed, index):
    if keccak is not None:
        payload=bytes.fromhex(seed.removeprefix("0x"))+int(index).to_bytes(32,"big")
        return int.from_bytes(keccak.new(digest_bits=256,data=payload).digest(),"big")
    # Use the project's existing ethers Keccak, never SHA3-256 (a different hash).
    # Batch one block for efficient repeated stream generation without pycryptodome.
    block=int(index)//256; key=(seed,block)
    if key not in _entropy_blocks:
        node=os.environ.get("NODE_BINARY","/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
        script="import {keccak256,concat,zeroPadValue,toBeHex} from 'ethers';const seed=process.argv[1],start=Number(process.argv[2]);process.stdout.write(JSON.stringify(Array.from({length:256},(_,i)=>keccak256(concat([seed,zeroPadValue(toBeHex(start+i),32)])))));"
        values=json.loads(subprocess.check_output([node,"--input-type=module","-e",script,seed,str(block*256)],cwd=Path(__file__).resolve().parents[4]))
        _entropy_blocks[key]=[int(value,16)for value in values]
    return _entropy_blocks[key][int(index)%256]

H, V, Q = 265, 8192, 1024


def trunc(value):
    value = np.asarray(value, dtype=np.int64)
    return np.where(value >= 0, value // Q, -((-value) // Q))


class Reference:
    def __init__(self, folder):
        folder = Path(folder)
        self.words = json.loads((folder / "vocabulary.json").read_text())
        assert len(self.words) == V
        self.embedding = np.frombuffer((folder / "embeddings.bin").read_bytes(), dtype=">i2").astype(np.int64).reshape(V+1, H)
        core = np.frombuffer((folder / "core.bin").read_bytes(), dtype=">i2").astype(np.int64)
        self.wx = core[:H*H].reshape(H,H); self.wh = core[H*H:2*H*H].reshape(H,H)
        self.wf = core[2*H*H:2*H*H+H*6].reshape(H,6); self.bh = core[-H:]
        nodes = np.frombuffer((folder / "nodes.bin").read_bytes(), dtype=">i2").astype(np.int64).reshape(V-1,H+1)
        self.nodes, self.bias = nodes[:,:H], nodes[:,H]
        self.table = np.frombuffer((folder / "sigmoid-delta.bin").read_bytes(), dtype=">u2").astype(np.int64)
        assert len(self.table) == 257

    def step(self, previous, hidden, features, seed, index, temperature=256, scalar_check=False):
        assert 0<=previous<=V and 64<=temperature<=4096
        hidden, features = np.asarray(hidden,dtype=np.int64), np.asarray(features,dtype=np.int64)
        assert hidden.shape==(H,) and features.shape==(6,)
        assert (hidden>=0).all() and (hidden<=8192).all() and (np.abs(features)<=4096).all()
        embedded = self.embedding[previous]
        pre = self.wx@embedded + self.wh@hidden + self.wf@features + self.bh*Q
        result = np.clip(trunc(pre),0,8192)
        if scalar_check:
            scalar = []
            for i in range(H):
                total = sum(int(w)*int(x) for w,x in zip(self.wx[i],embedded))
                total += sum(int(w)*int(x) for w,x in zip(self.wh[i],hidden))
                total += sum(int(w)*int(x) for w,x in zip(self.wf[i],features))+int(self.bh[i])*Q
                n = total//Q if total>=0 else -((-total)//Q)
                scalar.append(max(0,min(8192,n)))
            assert scalar == result.tolist()
        entropy = random_bits(seed,index); node=0;scores=[];probs=[];draws=[]
        for depth in range(13):
            score=int(trunc(self.nodes[node]@result+self.bias[node]*Q))
            if scalar_check:
                total=sum(int(w)*int(x)for w,x in zip(self.nodes[node],result))+int(self.bias[node])*Q
                assert score==(total//Q if total>=0 else -((-total)//Q))
            at=min(256,(abs(score)*1024//temperature+32)//64)
            probability=32768+int(self.table[at]) if score>=0 else 32768-int(self.table[at])
            draw=(entropy>>(16*depth))&65535
            scores.append(score);probs.append(probability);draws.append(draw)
            node=node*2+1+int(draw<probability)
        token=node-(V-1)
        return {"token":token,"hidden":result.tolist(),"scores":scores,"text":self.words[token],
                "terminal":self.words[token].endswith((".","!","?")),"probabilities":probs,"draws":draws}


def main():
    p=argparse.ArgumentParser();p.add_argument("--model-dir",type=Path,required=True);p.add_argument("--report",type=Path,required=True);p.add_argument("--out",type=Path,required=True);a=p.parse_args()
    ref=Reference(a.model_dir);report=json.loads(a.report.read_text());rows=[]
    for i,row in enumerate(report["swaps"]):
        expected=ref.step(int(row["before"]["context"][5]),row["before"]["hidden"],row["features"],report["seed"],row["sampleIndex"],report["temperatureQ10"],scalar_check=i<2)
        assert expected["token"]==row["token"],("token",i)
        assert expected["hidden"]==list(map(int,row["after"]["hidden"])),("hidden",i)
        assert expected["scores"]==list(map(int,row["branchScores"])),("scores",i)
        assert expected["text"]==row["text"] and expected["terminal"]==row["terminal"]
        assert int(row["after"]["context"][4])==i+1 and int(row["sampleIndex"])==i
        rows.append({"swap":i+1,"token":row["token"],"word":row["text"],"all265_hidden_values_match":True,"all13_branch_scores_match":True})
    result={"status":"PASS","scope":"Independent NumPy Q10 reference; first two steps additionally checked with scalar Python sums",
            "report_sha256":hashlib.sha256(a.report.read_bytes()).hexdigest(),"steps":len(rows),"rows":rows}
    a.out.write_text(json.dumps(result,indent=2)+"\n");print(json.dumps({"status":"PASS","steps":len(rows),"scalar_steps":min(2,len(rows))}))

if __name__=="__main__":main()
