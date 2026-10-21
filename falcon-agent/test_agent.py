"""Meaningful local integration tests. Scripted engine, NOT Falcon inference.

Starts its own isolated Anvil; no external RPC argument, signing key or public tx.
"""
import argparse
import json
import subprocess
import time
from pathlib import Path

import requests
from eth_abi import encode, decode
from eth_utils import keccak, to_checksum_address

ROOT = Path(__file__).resolve().parent
ZERO = "0x"+"00"*20


def calldata(sig, types=(), values=()):
    return "0x"+(keccak(text=sig)[:4]+encode(types,values)).hex()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--anvil",type=Path,required=True)
    args=parser.parse_args()
    artifact=json.loads((ROOT/"compiled.json").read_text())
    contracts=artifact["contracts"]
    report={"status":"running","environment":"local Anvil Cancun, chain 31337",
        "compiler":artifact["compiler"],"engine":"ScriptedEngine TEST FIXTURE; no LLM inference",
        "public_transactions_broadcast":0,"public_eth_spent":"0","checks":[],"gas":{},
        "limitations":["Agent controller and action policies only; Falcon inference is not implemented.",
                       "Local gas receipts are not Robinhood/Base receipts; exclude real inference and weight deployment."]}
    session=requests.Session();session.trust_env=False
    child=subprocess.Popen([str(args.anvil.resolve()),"--host","127.0.0.1","--port","18547",
        "--chain-id","31337","--hardfork","cancun","--gas-limit","16777216","--silent"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    def rpc(method,params=()):
        r=session.post("http://127.0.0.1:18547",json={"jsonrpc":"2.0","id":1,"method":method,"params":list(params)},timeout=30).json()
        if "error" in r:raise RuntimeError(str(r["error"]))
        return r["result"]
    def save(): (ROOT/"agent-test-results.json").write_text(json.dumps(report,indent=2)+"\n")
    try:
        for _ in range(100):
            try:
                assert int(rpc("eth_chainId"),16)==31337
                break
            except requests.ConnectionError:time.sleep(.05)
        else:raise RuntimeError("Local Anvil did not start")
        accounts=rpc("eth_accounts");owner,recipient,owner2,keeper=accounts[:4]
        def tx(payload,expect_success=True):
            h=rpc("eth_sendTransaction",[{"from":owner,"gas":hex(15000000),"gasPrice":hex(10**9),**payload}])
            receipt=None
            for _ in range(100):
                receipt=rpc("eth_getTransactionReceipt",[h])
                if receipt is not None:break
                time.sleep(.01)
            assert receipt is not None, "Receipt not mined"
            assert bool(int(receipt["status"],16))==expect_success,receipt
            return receipt
        def deploy(name,types=(),values=()):
            r=tx({"data":"0x"+contracts[name]["evm"]["bytecode"]["object"]+encode(types,values).hex()})
            return to_checksum_address(r["contractAddress"]),int(r["gasUsed"],16)
        def call(target,sig,types=(),values=(),returns=(),sender=owner):
            raw=rpc("eth_call",[{"from":sender,"to":target,"data":calldata(sig,types,values)},"latest"])
            return decode(returns,bytes.fromhex(raw[2:])) if returns else raw
        def mutate(target,sig,types=(),values=(),sender=owner):
            return tx({"to":target,"data":calldata(sig,types,values),"from":sender})
        def reject(label,target,sig,types=(),values=(),sender=owner):
            try:call(target,sig,types,values,sender=sender)
            except RuntimeError:report["checks"].append({"name":label,"passed":True})
            else:raise AssertionError(label+" unexpectedly accepted")
        def check(label,ok=True):
            assert ok,label
            report["checks"].append({"name":label,"passed":True})
        def scalar(target,sig,typ="uint256"):return call(target,sig,returns=[typ])[0]
        def balance(address):return int(rpc("eth_getBalance",[address,"latest"]),16)
        engine,engine_gas=deploy("ScriptedEngine")
        model=keccak(text="TEST_FIXTURE_NOT_FALCON")
        factory,factory_gas=deploy("AgentFactory",["address","bytes32"],[engine,model])
        report["gas"]["fixture_engine_deployment_excluded_from_agent_total"]=engine_gas
        report["gas"]["factory_and_shared_agent_implementation_deployment"]=factory_gas
        def create(sender):
            receipt=mutate(factory,"create()",sender=sender)
            topic="0x"+keccak(text="Created(address,address)").hex()
            event=next(x for x in receipt["logs"] if x["topics"][0]==topic)
            address=to_checksum_address("0x"+event["topics"][1][-40:])
            return address,int(receipt["gasUsed"],16)
        agent,clone_gas=create(owner);other,other_gas=create(owner2)
        report["gas"]["first_agent_clone_and_initialization"]=clone_gas
        report["gas"]["second_agent_clone_and_initialization"]=other_gas
        report["gas"]["factory_implementation_and_one_agent_excluding_engine"]=factory_gas+clone_gas
        check("45-byte EIP-1167 runtime",len(bytes.fromhex(rpc("eth_getCode",[agent,"latest"])[2:]))==45)
        check("owner isolation",scalar(agent,"owner()","address").lower()==owner.lower() and scalar(other,"owner()","address").lower()==owner2.lower())
        reject("initialization cannot be repeated",agent,"initialize(address,address,bytes32)",["address","address","bytes32"],[keeper,engine,model],keeper)
        implementation=scalar(factory,"implementation()","address")
        reject("implementation cannot be initialized",implementation,"initialize(address,address,bytes32)",["address","address","bytes32"],[owner,engine,model])
        reject("unauthorized policy edit",agent,"setRecipient(address,bool)",["address","bool"],[recipient,True],keeper)
        mutate(agent,"setRecipient(address,bool)",["address","bool"],[recipient,True])
        tx({"to":agent,"value":hex(10**17)})
        OPEN="open(bytes,uint96,uint96,uint8,uint16)";OT=["bytes","uint96","uint96","uint8","uint16"]
        params=[b"Read balance, save a note, send an allowed payment, then reply.",5*10**15,3*10**15,3,64]
        reject("unauthorized run creation",agent,OPEN,OT,params,keeper)
        reject("cross-agent owner cannot open",other,OPEN,OT,[b"hi",0,0,1,32],owner)
        reject("token bound",agent,OPEN,OT,[b"hi",0,0,1,257])
        reject("action bound",agent,OPEN,OT,[b"hi",0,0,9,32])
        reject("funded budget bound",agent,OPEN,OT,[b"hi",10**18,0,1,32])
        report["gas"]["open_with_fixture"]=int(mutate(agent,OPEN,OT,params)["gasUsed"],16)
        reject("policy frozen during run",agent,"setRecipient(address,bool)",["address","bool"],[recipient,False])
        reject("owner withdrawal blocked during run",agent,"withdraw(address,uint256)",["address","uint256"],[owner,1])
        reject("concurrent run blocked",agent,OPEN,OT,params)
        reject("zero work blocked",agent,"drive(uint8)",["uint8"],[0])
        reject("oversized work blocked",agent,"drive(uint8)",["uint8"],[33])
        mutate(agent,"drive(uint8)",["uint8"],[1],keeper)
        check("unfinished inference does not act",scalar(agent,"actions()","uint8")==0 and scalar(agent,"status()","uint8")==1)
        def output(kind,recipient_=ZERO,amount=0,text=b"",done=True):
            j=scalar(agent,"job()")
            mutate(engine,"set(uint256,bool,uint8,address,uint96,bytes)",["uint256","bool","uint8","address","uint96","bytes"],[j,done,kind,recipient_,amount,text])
            return j
        def drive():return mutate(agent,"drive(uint8)",["uint8"],[1],keeper)
        output(1)
        report["gas"]["balance_action_and_next_job_with_fixture"]=int(drive()["gasUsed"],16)
        observation=scalar(agent,"observation()","bytes")
        check("balance observation comes from on-chain balance",decode(["uint8","uint256","uint96"],observation)==(1,10**17,5*10**15))
        output(3,text=b"Recurring bill paid by authorized agent.")
        drive()
        check("persistent note",scalar(agent,"note()","bytes")==b"Recurring bill paid by authorized agent.")
        output(2,recipient,3*10**15)
        before=balance(recipient)
        report["gas"]["native_transfer_and_next_job_with_fixture"]=int(drive()["gasUsed"],16)
        check("authorized transfer changes recipient balance exactly",balance(recipient)-before==3*10**15)
        check("budget tracks transfer",scalar(agent,"spent()","uint96")==3*10**15)
        output(0,text=b"Payment completed. Your note is saved.")
        report["gas"]["final_reply_with_fixture"]=int(drive()["gasUsed"],16)
        check("persistent final reply",scalar(agent,"status()","uint8")==2 and scalar(agent,"reply()","bytes")==b"Payment completed. Your note is saved.")
        reject("completed output cannot be replayed",agent,"drive(uint8)",["uint8"],[1],keeper)
        check("other agent state unchanged",scalar(other,"runId()","uint64")==0 and scalar(other,"note()","bytes")==b"")
        # Independent policy failures; actual reverting transaction checks atomicity.
        mutate(agent,OPEN,OT,[b"policy test",5*10**15,3*10**15,2,32])
        output(2,keeper,1)
        reject("non-allowlisted transfer blocked",agent,"drive(uint8)",["uint8"],[1],keeper)
        output(2,recipient,4*10**15)
        reject("per-transfer cap enforced",agent,"drive(uint8)",["uint8"],[1],keeper)
        output(255)
        reject("unknown action rejected",agent,"drive(uint8)",["uint8"],[1],keeper)
        output(0,recipient,1,b"misleading reply")
        reject("reply cannot smuggle transfer fields",agent,"drive(uint8)",["uint8"],[1],keeper)
        output(3,text=b"x"*257)
        reject("note size enforced",agent,"drive(uint8)",["uint8"],[1],keeper)
        output(2,recipient,3*10**15);drive()
        j=output(2,recipient,3*10**15)
        before=(balance(agent),balance(recipient),scalar(agent,"spent()","uint96"),call(engine,"steps(uint256)",["uint256"],[j],["uint256"])[0])
        tx({"to":agent,"data":calldata("drive(uint8)",["uint8"],[1]),"from":keeper},expect_success=False)
        after=(balance(agent),balance(recipient),scalar(agent,"spent()","uint96"),call(engine,"steps(uint256)",["uint256"],[j],["uint256"])[0])
        check("cumulative budget failure rolls back engine steps and balances",before==after)
        reject("unauthorized cancellation",agent,"cancel()",sender=keeper)
        mutate(agent,"cancel()")
        check("owner can cancel invalid model output",scalar(agent,"status()","uint8")==3)
        mutate(agent,OPEN,OT,[b"loop test",0,0,1,32]);output(1);drive();output(1)
        reject("action loop limit enforced",agent,"drive(uint8)",["uint8"],[1],keeper)
        mutate(agent,"cancel()")
        # Recipient failure leaves a recoverable run with no consumed allowance.
        reverting,_=deploy("RevertingRecipient")
        mutate(agent,"setRecipient(address,bool)",["address","bool"],[reverting,True])
        mutate(agent,OPEN,OT,[b"failed payment",100,100,1,32]);output(2,reverting,100)
        tx({"to":agent,"data":calldata("drive(uint8)",["uint8"],[1]),"from":keeper},expect_success=False)
        check("failed transfer preserves allowance",scalar(agent,"spent()","uint96")==0)
        mutate(agent,"cancel()")
        reenter,_=deploy("ReenteringRecipient")
        mutate(reenter,"setTarget(address)",["address"],[agent])
        mutate(agent,"setRecipient(address,bool)",["address","bool"],[reenter,True])
        mutate(agent,OPEN,OT,[b"reentry test",100,100,1,32]);output(2,reenter,100);drive()
        check("recipient reentry is rejected",scalar(reenter,"blocked()","bool"))
        output(0,text=b"done");drive()
        # Mutating code is a local-only adversarial test, never an external RPC.
        mutate(agent,OPEN,OT,[b"code pin test",0,0,1,32])
        original_code=rpc("eth_getCode",[engine,"latest"])
        rpc("anvil_setCode",[engine,"0x00"])
        reject("changed engine code rejected",agent,"drive(uint8)",["uint8"],[1],keeper)
        rpc("anvil_setCode",[engine,original_code])
        mutate(agent,"cancel()")
        before=balance(recipient)
        mutate(agent,"withdraw(address,uint256)",["address","uint256"],[recipient,100])
        check("owner withdrawal after cancellation",balance(recipient)==before+100)
        report["status"]="passed";report["passed_checks"]=len(report["checks"])
        report["runtime_bytes"]={k:len(v["evm"]["deployedBytecode"]["object"])//2 for k,v in contracts.items()}
        print(json.dumps({"status":report["status"],"passed_checks":report["passed_checks"],"gas":report["gas"]}),flush=True)
    except Exception as exc:
        report["status"]="failed";report["error"]=repr(exc)
        raise
    finally:
        save();child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait()


if __name__=="__main__":main()
