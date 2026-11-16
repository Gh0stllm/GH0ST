"""Compare every logit against the independent full-model NumPy oracle.

This local host provides already-verified model input bytes and no runtime
imports. It is not a blockchain node or fraud-proving implementation.
"""
from pathlib import Path
import argparse
import ctypes
import hashlib
import importlib.util
import json
import platform
import time
import numpy as np
import wasmtime

HERE=Path(__file__).resolve().parent
CACHE=HERE/".cache"

class Native:
    def __init__(self,blob):
        self.lib=ctypes.CDLL(str(CACHE/("libruntime.dylib" if platform.system()=="Darwin" else "libruntime.so")))
        for name in ["gh_model_ptr","gh_logits_ptr","gh_checkpoint_ptr"]:
            getattr(self.lib,name).restype=ctypes.c_size_t
        self.lib.gh_checkpoint_restore.argtypes=[ctypes.c_uint32,ctypes.c_void_p]
        ctypes.memmove(self.lib.gh_model_ptr(),blob,len(blob))
        assert self.lib.gh_seal_model()==0
        assert self.lib.gh_reset()==0
    def call(self,name,*args):return getattr(self.lib,name)(*args)
    def checkpoint(self):
        n=self.call("gh_checkpoint_export")
        return ctypes.string_at(self.call("gh_checkpoint_ptr"),n)
    def logits(self):
        return np.ctypeslib.as_array((ctypes.c_int32*50257).from_address(self.call("gh_logits_ptr"))).copy()

class Wasm:
    def __init__(self,blob):
        config=wasmtime.Config();config.wasm_simd=False;config.wasm_relaxed_simd=False
        self.engine=wasmtime.Engine(config);self.store=wasmtime.Store(self.engine)
        self.module=wasmtime.Module.from_file(self.engine,str(CACHE/"runtime.wasm"))
        assert not self.module.imports,"Runtime must have zero external imports"
        self.instance=wasmtime.Instance(self.store,self.module,[]);self.exports=self.instance.exports(self.store)
        self.memory=self.exports["memory"]
        self.memory.write(self.store,blob,self.call("gh_model_ptr"))
        assert self.call("gh_seal_model")==0
        assert self.call("gh_reset")==0
    def call(self,name,*args):return self.exports[name](self.store,*args)
    def checkpoint(self):
        n=self.call("gh_checkpoint_export");p=self.call("gh_checkpoint_ptr")
        return bytes(self.memory.read(self.store,p,p+n))
    def logits(self):
        p=self.call("gh_logits_ptr")
        return np.frombuffer(bytes(self.memory.read(self.store,p,p+50257*4)),dtype="<i4").copy()
    def restore(self,body,expected):
        p=self.call("gh_checkpoint_ptr");cap=self.call("gh_checkpoint_capacity")
        assert len(body)+64<=cap
        self.memory.write(self.store,body,p)
        digest_ptr=p+cap-32;self.memory.write(self.store,expected,digest_ptr)
        return self.call("gh_checkpoint_restore",len(body),digest_ptr)

def decode(ids,tokenizer):
    vocabulary=json.loads(tokenizer.read_text())["model"]["vocab"]
    inverse={v:k for k,v in vocabulary.items()}
    bs=list(range(33,127))+list(range(161,173))+list(range(174,256));cs=list(bs);extra=0
    for b in range(256):
        if b not in bs:bs.append(b);cs.append(256+extra);extra+=1
    byte_decoder={chr(c):b for b,c in zip(bs,cs)}
    return bytes(byte_decoder[c] for token in ids for c in inverse[token]).decode("utf8",errors="replace")

def main(export_dir):
    descriptor=json.loads((HERE/"model-descriptor.json").read_text());blob=(CACHE/"model.bin").read_bytes()
    assert hashlib.sha256(blob).hexdigest()==descriptor["flatModelSHA256"]
    spec=importlib.util.spec_from_file_location("independent_tinystories_reference",HERE/"reference_oracle.py")
    reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
    oracle=reference.IntegerNeo(export_dir/"data")
    native=Native(blob);wasm=Wasm(blob)
    # Wrong weights cannot initialize an executable job.
    ptr=wasm.call("gh_model_ptr");wasm.memory.write(wasm.store,bytes([blob[0]^1]),ptr)
    assert wasm.call("gh_seal_model")==-1
    assert wasm.call("gh_begin",7454)==-1
    wasm.memory.write(wasm.store,blob,ptr);assert wasm.call("gh_seal_model")==0
    assert wasm.call("gh_reset")==0
    assert wasm.call("gh_begin",50257)==-1
    prompt=[7454,2402,257,640] # GPT-2 tokenization of Once upon a time
    generated=[];records=[];checks={"wrongModelRejected":True,"invalidTokenRejected":True}
    t0=time.perf_counter()
    for token_index in range(6):
        token=prompt[token_index] if token_index<len(prompt) else generated[-1]
        expected=oracle.step(token)
        assert native.call("gh_begin",token)==0 and wasm.call("gh_begin",token)==0
        start_state=wasm.checkpoint()
        assert wasm.call("gh_begin",token)==-1
        assert wasm.call("gh_advance",wasm.call("gh_step"),0)==-1
        assert wasm.call("gh_advance",wasm.call("gh_step"),513)==-1
        assert wasm.checkpoint()==start_state
        started=time.perf_counter();chunks=0;restored=False
        while wasm.call("gh_phase")!=11:
            step=wasm.call("gh_step");rows=[1,17,64,512][step%4]
            if step:
                before=wasm.checkpoint()
                assert wasm.call("gh_advance",step-1,rows)==-1
                assert wasm.checkpoint()==before
            assert native.call("gh_advance",step,rows)==0
            assert wasm.call("gh_advance",step,rows)==0
            chunks+=1
            if token_index==0 and chunks==100:
                body=wasm.checkpoint();assert body==native.checkpoint()
                saved=hashlib.sha256(body).digest();new=Wasm(blob)
                corrupt=bytearray(body);corrupt[-1]^=1;before=new.checkpoint()
                assert new.restore(corrupt,saved)<0 and new.checkpoint()==before
                assert new.restore(body,saved)==0 and new.checkpoint()==body
                wasm=new;restored=True
                checks["nativeWasmCanonicalMidSearchCheckpointEqual"]=True
                checks["corruptCheckpointRejectedWithoutStateMutation"]=True
                checks["freshInstanceResumeSucceeded"]=True
        n=native.logits();w=wasm.logits()
        assert np.array_equal(n,expected),f"Native logit mismatch at token{token_index}: {np.where(n!=expected)[0][:5]}"
        assert np.array_equal(w,expected),f"Wasm logit mismatch at token{token_index}: {np.where(w!=expected)[0][:5]}"
        assert native.checkpoint()==wasm.checkpoint()
        best=int(np.argmax(expected));assert native.call("gh_best_token")==best and wasm.call("gh_best_token")==best
        if token_index>=len(prompt)-1:generated.append(best)
        records.append({"position":token_index,"inputToken":token,"nextToken":best,"allLogitsCompared":50257,
            "logitsI32LESHA256":hashlib.sha256(w.astype("<i4").tobytes()).hexdigest(),
            "chunkCalls":chunks,"freshInstanceRestore":restored,
            "checkpointSHA256":hashlib.sha256(wasm.checkpoint()).hexdigest(),
            "localPairedExecutionSeconds":round(time.perf_counter()-started,6)})
    tokenizer=export_dir/"tokenizer.json"
    if not tokenizer.exists():tokenizer=export_dir.parent/"quality/tinystories1m/tokenizer.json"
    text=decode(prompt+generated,tokenizer) if tokenizer.exists() else None
    checks.update({"staleStepRejectedWithoutStateMutation":True,"invalidWorkRejectedWithoutStateMutation":True,
        "fullNativeWasmOracleLogitsEqual":True,"finalCanonicalStateEqual":True})
    report={"scope":"Local full pretrained INT8/Q12 model execution, native and generic Wasm against independent NumPy oracle; not on-chain execution or fraud proof",
        "model":descriptor["model"],"parameters":3745984,"weightsBytes":len(blob),
        "modelSHA256":descriptor["flatModelSHA256"],"modelWeightsInProgramCode":False,
        "layersExecutedPerToken":8,"vocabularyLogitsPerToken":50257,
        "positionsCompared":len(records),"totalLogitsCompared":len(records)*50257,
        "promptTokenIds":prompt,"generatedTokenIds":generated,"decodedText":text,
        "tokenizerSHA256":hashlib.sha256(tokenizer.read_bytes()).hexdigest() if tokenizer.exists() else None,
        "checks":checks,"records":records,"localWallSeconds":round(time.perf_counter()-t0,6),
        "runtimeExternalImports":[],"serverRented":False,"chainBooted":False,
        "fraudProofExecuted":False,"largeLLMOrChessStrengthChanged":False,
        "limitations":["INT8/Q12 differs from FP32; context64","Small-model test does not establish7B/70B support",
          "Model loaded as validated input bytes; on-chain paged storage and Nitro integration remain separate work",
          "Checkpoint expected hash must come from authenticated chain state; checksum alone is not authorization"]}
    (HERE/"test-evidence.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({k:report[k] for k in ["scope","positionsCompared","totalLogitsCompared","generatedTokenIds","decodedText","checks","localWallSeconds"]},indent=2))

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--export-dir",type=Path,default=HERE.parents[4]/"output/arc-tinystories-20261025/tinystories3746k")
    main(p.parse_args().export_dir)
