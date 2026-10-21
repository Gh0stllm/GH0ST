"""Model standard-Cancun storage costs, separately from measured receipts.

No network use; chain-specific L1 data charges and runtime remain excluded.
"""
import argparse
import hashlib
import json
from pathlib import Path
from lossless import original

ROOT=Path(__file__).resolve().parent


def layout(data,limit):
    total=0;maximum=0;count=0
    for offset in range(0,len(data),limit):
        runtime=b"\0"+data[offset:offset+limit]
        init=b"\x61"+len(runtime).to_bytes(2,"big")+bytes.fromhex("80600c6000396000f3")+runtime
        words=(len(runtime)+31)//32
        gas=53000+16*len(init)-12*init.count(0)+2*((len(init)+31)//32)+18+6*words+words*words//512+200*len(runtime)
        total+=gas;maximum=max(maximum,gas);count+=1
    return {"payload_limit":limit,"shards":count,"modeled_weight_shard_deployment_gas":total,"maximum_shard_gas":maximum}


def main():
    p=argparse.ArgumentParser();p.add_argument("--original",required=True,type=Path);p.add_argument("--cache",required=True,type=Path);a=p.parse_args()
    results=json.loads((ROOT/"lossless-results.json").read_text());assert results["status"]=="completed"
    report={"environment":"Standard Cancun gas model; not a current Base or Robinhood quote",
            "excludes":["tokenizer","model metadata/index","inference engine","agent","L1 data and chain-specific fees","runtime decompression"],"rows":[],"gas_budgets":[]}
    raw,_=original(a.original)
    for name,data in [("original_bf16",raw)]+[(x["name"],None) for x in results["experiments"]]:
        if data is None:
            x=next(x for x in results["experiments"] if x["name"]==name)
            data=(a.cache/(name+".bin")).read_bytes()
            assert hashlib.sha256(data).hexdigest()==x["sha256"] and len(data)==x["bytes"]
        report["rows"].append({"name":name,"payload_bytes":len(data),"code_deposit_gas_only":200*len(data),"layouts":[layout(data,24575),layout(data,61439)]})
    for gas in [1000000,10000000,100000000,999000000]:
        report["gas_budgets"].append({"gas":gas,"maximum_code_bytes_before_all_overhead":gas//200,"bits_per_model_parameter":(gas//200)*8/results["parameters"]})
    (ROOT/"cost-results.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))


if __name__=="__main__":main()
