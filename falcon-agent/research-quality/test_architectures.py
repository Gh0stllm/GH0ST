"""Local-only full-weight genesis and authenticated-streaming experiments.

No public RPC option. No private keys. Neither experiment is a full LLM.
"""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import numpy as np
import requests
from eth_abi import encode, decode
from eth_utils import keccak
from lossless import original, top7_encode, top7_decode

ROOT=Path(__file__).resolve().parent
BASE=0x1000000000000000000000000000000000000000
SHARD=24575
CHUNK=4096


def address(i): return "0x"+(BASE+i).to_bytes(20,"big").hex()
def calldata(sig,types=(),values=()): return "0x"+(keccak(text=sig)[:4]+encode(types,values)).hex()


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--original",required=True,type=Path)
    p.add_argument("--cache",required=True,type=Path)
    p.add_argument("--anvil",required=True,type=Path)
    args=p.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    raw,tensors=original(args.original)
    artifact=json.loads((ROOT/"compiled.json").read_text());contracts=artifact["contracts"]
    report={"status":"running","environment":"local Anvil Cancun; not an Orbit rollup or Base/RH deployment",
            "public_transactions_broadcast":0,"public_eth_spent":"0","compiler":artifact["compiler"],
            "weight_bytes":len(raw),"weight_sha256":hashlib.sha256(raw).hexdigest(),"checks":[],"decoder":[],"streaming":[]}
    def save(): (ROOT/"architecture-results.json").write_text(json.dumps(report,indent=2)+"\n")
    def check(name,condition=True):
        assert condition,name
        report["checks"].append({"name":name,"passed":True})
    # Model weights are code in genesis, not submitted in transactions. Every
    # shard respects the ordinary 24 KiB EIP-170 size for portability.
    shard_hashes=[]
    genesis=args.cache/"model-genesis.json"
    with genesis.open("w") as out:
        out.write('{"config":{"chainId":31337},"nonce":"0x0","timestamp":"0x0","gasLimit":"0x1000000","difficulty":"0x1","alloc":{')
        for i,offset in enumerate(range(0,len(raw),SHARD)):
            runtime=b"\0"+raw[offset:offset+SHARD]
            shard_hashes.append(keccak(runtime))
            if i:out.write(",")
            out.write(json.dumps(address(i))+':'+json.dumps({"balance":"0x0","nonce":"0x1","code":"0x"+runtime.hex()}))
        out.write("}}")
    report["genesis"]={"shards":len(shard_hashes),"payload_bytes":len(raw),"runtime_bytes":len(raw)+len(shard_hashes),
                       "weight_deployment_transactions":0,"weight_transaction_gas":0,
                       "genesis_sha256":hashlib.sha256(genesis.read_bytes()).hexdigest(),
                       "limitations":"New chain initial state, NOT possible for ordinary deployments on existing RH/Base; chain launch, availability, infrastructure and inference not costed."}
    save(); print(json.dumps(report["genesis"]),flush=True)
    session=requests.Session();session.trust_env=False
    log=(args.cache/"anvil-genesis.log").open("w")
    child=subprocess.Popen([str(args.anvil.resolve()),"--host","127.0.0.1","--port","18551","--chain-id","31337","--hardfork","cancun","--gas-limit","16777216","--init",str(genesis.resolve()),"--silent"],stdout=log,stderr=log)
    def rpc(method,params=()):
        response=session.post("http://127.0.0.1:18551",json={"jsonrpc":"2.0","id":1,"method":method,"params":list(params)},timeout=60).json()
        if "error" in response:raise RuntimeError(str(response["error"]))
        return response["result"]
    try:
        for _ in range(600):
            if child.poll() is not None:raise RuntimeError("Anvil startup failed: "+(args.cache/"anvil-genesis.log").read_text()[-2000:])
            try:
                check("local chain identity",int(rpc("eth_chainId"),16)==31337);break
            except requests.ConnectionError:time.sleep(.05)
        else:raise RuntimeError("Anvil failed to start")
        check("genesis has no transactions",rpc("eth_getBlockByNumber",["0x0",False])["transactions"]==[])
        account=rpc("eth_accounts")[0]
        def tx(payload,success=True):
            h=rpc("eth_sendTransaction",[{"from":account,"gas":hex(16000000),**payload}])
            for _ in range(300):
                receipt=rpc("eth_getTransactionReceipt",[h])
                if receipt is not None:break
                time.sleep(.02)
            else:raise AssertionError("No receipt")
            assert (int(receipt["status"],16)==1)==success,receipt
            return receipt
        def deploy(name,types=(),values=()):
            receipt=tx({"data":"0x"+contracts[name]["evm"]["bytecode"]["object"]+encode(types,values).hex()})
            return receipt["contractAddress"],int(receipt["gasUsed"],16)
        def call(target,sig,types=(),values=(),returns=()):
            r=rpc("eth_call",[{"to":target,"data":calldata(sig,types,values)},"latest"])
            return decode(returns,bytes.fromhex(r[2:])) if returns else r
        def reject(label,target,sig,types,values):
            try:call(target,sig,types,values)
            except RuntimeError:check(label)
            else:raise AssertionError(label+" accepted")
        reader,gas=deploy("GenesisReader");report["genesis"]["reader_deployment_gas"]=gas
        for start in range(0,len(shard_hashes),128):
            count=min(128,len(shard_hashes)-start);expected=bytes(32)
            for h in shard_hashes[start:start+count]:expected=keccak(expected+h)
            result=call(reader,"digest(address,uint256,uint256)",["address","uint256","uint256"],[address(0),start,count],["bytes32"])[0]
            assert result==expected,(start,result.hex(),expected.hex())
        check("all genesis shard code hashes verified",True)
        report["genesis"]["all_shard_hashes_verified"]=len(shard_hashes)
        for i in [0,len(shard_hashes)//2,len(shard_hashes)-1]:
            expected=raw[i*SHARD:i*SHARD+min(8192,len(raw)-i*SHARD)]
            got=call(reader,"read(address,uint256,uint256)",["address","uint256","uint256"],[address(i),0,len(expected)],["bytes"])[0]
            check("genesis readable sample "+str(i),got==expected)
        print("Full-model genesis code hashes verified",flush=True);save()
        decoder,gas=deploy("Top7Decoder");report["decoder_deployment_gas"]=gas
        # Real-model blocks plus all 65536 possible BF16 bit patterns. These
        # tests cover NaNs, +/-zero, subnormals and all bit-boundary positions.
        samples=[("model_"+str(offset),raw[offset:offset+8192]) for offset in [0,(len(raw)//2)//8192*8192,(len(raw)-1)//8192*8192]]
        samples += [("exhaustive_bf16_"+str(i),np.arange(i,i+4096,dtype=np.uint16).astype("<u2").tobytes()) for i in range(0,65536,4096)]
        for label,block in samples:
            blob=top7_encode(block);check(label+" Python roundtrip",top7_decode(blob)==block)
            result=call(decoder,"decode(bytes)",["bytes"],[blob],["bytes"])[0]
            check(label+" EVM exact roundtrip",result==block)
            if label.startswith("model_"):
                receipt=tx({"to":decoder,"data":calldata("commit(bytes)",["bytes"],[blob])})
                check(label+" EVM committed hash",call(decoder,"last()",returns=["bytes32"])[0]==keccak(block))
                runtime=b"\0"+blob
                init=b"\x61"+len(runtime).to_bytes(2,"big")+bytes.fromhex("80600c6000396000f3")+runtime
                shard=tx({"data":"0x"+init.hex()})
                check(label+" stored compressed bytes",rpc("eth_getCode",[shard["contractAddress"],"latest"])=="0x"+runtime.hex())
                stored=tx({"to":decoder,"data":calldata("commitStored(address,uint256,uint256)",["address","uint256","uint256"],[shard["contractAddress"],0,len(blob)])})
                check(label+" stored decode hash",call(decoder,"last()",returns=["bytes32"])[0]==keccak(block))
                report["decoder"].append({"sample":label,"original_bytes":len(block),"compressed_bytes":len(blob),"gas_including_calldata_and_result_storage":int(receipt["gasUsed"],16),"stored_compressed_shard_deployment_gas":int(shard["gasUsed"],16),"decode_stored_gas_with_same_result_sstore":int(stored["gasUsed"],16)})
        blob=top7_encode(raw[:8192])
        for label,bad in [("short header",b"\0"*14),("truncated block",blob[:-1]),("trailing data",blob+b"\0"),("count over limit",(4097).to_bytes(4,"big")+blob[4:])]:
            reject("decoder rejects "+label,decoder,"decode(bytes)",["bytes"],[bad])
        print(json.dumps({"decoder_gas":report["decoder"],"decoder_deployment":gas}),flush=True);save()
        # Domain-separated, position-bound full-model Merkle tree.
        leaves=[]
        for index,offset in enumerate(range(0,len(raw),CHUNK)):
            data=raw[offset:offset+CHUNK]
            leaves.append(keccak(b"\0"+index.to_bytes(4,"big")+len(data).to_bytes(4,"big")+data))
        count=len(leaves);size=1<<(count-1).bit_length()
        leaves += [keccak(b"\x02"+i.to_bytes(4,"big")) for i in range(count,size)]
        levels=[leaves]
        while len(levels[-1])>1:
            row=levels[-1];levels.append([keccak(b"\x01"+row[i]+row[i+1]) for i in range(0,len(row),2)])
        root=levels[-1][0]
        auth,gas=deploy("AuthenticatedWeights",["bytes32","uint256"],[root,len(raw)])
        report["streaming_deployment_gas"]=gas
        report["merkle"]={"root":"0x"+root.hex(),"leaves":count,"depth":len(levels)-1,"chunk_bytes":CHUNK,
                          "scope":"Authenticates all original weights. Contract does not store their data and is not a full inference engine."}
        for index in [0,count//2,count-1]:
            data=raw[index*CHUNK:(index+1)*CHUNK];pos=index;proof=[]
            for row in levels[:-1]:proof.append(row[pos^1]);pos//=2
            x=((np.arange(len(data)//2,dtype=np.int64)*17)%511-255).astype("<i2")
            expected=0
            for word,a in zip(np.frombuffer(data,dtype="<u2"),x):
                w=int(word)
                if w&32767==0:continue
                e=(w>>7)&255;assert 6<=e<=200
                expected+=(-1 if w&32768 else 1)*(128+(w&127))*(1<<(e-6))*int(a)
            sig="dot(uint32,bytes,bytes32[],bytes)";types=["uint32","bytes","bytes32[]","bytes"];values=[index,data,proof,x.tobytes()]
            got=call(auth,sig,types,values,["int256"])[0]
            check("authenticated exact dot "+str(index),got==expected)
            vtx=tx({"to":auth,"data":calldata("verify(uint32,bytes,bytes32[])",types[:3],values[:3])})
            receipt=tx({"to":auth,"data":calldata("commitDot(uint32,bytes,bytes32[],bytes)",types,values)})
            check("authenticated committed dot "+str(index),call(auth,"last()",returns=["int256"])[0]==expected)
            report["streaming"].append({"chunk":index,"weight_bytes":len(data),"proof_bytes":32*len(proof),"verify_transaction_gas":int(vtx["gasUsed"],16),"dot_transaction_gas":int(receipt["gasUsed"],16),"exact_integer_reference":True})
            corrupted=bytes([data[0]^1])+data[1:]
            reject("modified weight "+str(index),auth,sig,types,[index,corrupted,proof,x.tobytes()])
            reject("wrong position "+str(index),auth,sig,types,[index+1,data,proof,x.tobytes()])
            reject("wrong proof "+str(index),auth,sig,types,[index,data,[bytes(32)]+proof[1:],x.tobytes()])
            reject("truncated weights "+str(index),auth,sig,types,[index,data[:-2],proof,x.tobytes()])
            reject("truncated proof "+str(index),auth,sig,types,[index,data,proof[:-1],x.tobytes()])
        report["raw_model_calldata_gas_4_16_excluding_proofs"]=16*len(raw)-12*raw.count(0)
        report["status"]="passed";save();print(json.dumps({k:v for k,v in report.items() if k!="checks"}),flush=True)
    finally:
        child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait()
        log.close();save()


if __name__=="__main__":main()
