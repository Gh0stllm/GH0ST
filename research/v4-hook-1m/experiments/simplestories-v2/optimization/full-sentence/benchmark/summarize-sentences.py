"""Summarize one-transaction natural-sentence tests without treating diagnostic runs as passes."""
from pathlib import Path
import argparse,hashlib,json
d=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument("report")
parser.add_argument("--out",default="sentence-result-summary.json")
a=parser.parse_args()
path=d/a.report
x=json.loads(path.read_text())
assert x["status"]=="COMPLETE"
normal=[p for p in x["probes"] if p["kind"]=="v4_sentence" and p["mode"]=="NORMAL_32M" and p["label"].endswith("_normal")]
diagnostic=[p for p in x["probes"] if p["kind"]=="v4_sentence" and p["mode"]=="LOCAL_ABOVE_CAP" and p["label"].endswith("_diagnostic")]
summary={
 "schema_version":1,"model":x["repository"],"revision":x["revision"],
 "parameters":x["architecture"]["parameters"],"scope":"Local Anvil only; no fork, wallet key or mainnet access.",
 "transaction_gas_ceiling":32000000,"variant":x["variant"],"sentence_design":x["sentenceDesign"],
 "normal_sentence_tests":normal,"diagnostic_sentence_tests":diagnostic,
 "fully_generated_sentences_fitting_32M":[p for p in normal if p["status"]==1 and p.get("generatedTextIsStandaloneSentence") and p.get("naturallyTerminated") and int(p["transactionGasLimit"])==32000000],
 "exact_prefix_parity_cases":x["checks"]["fullPrefixParityCases"],"checks":x["checks"],
 "data_storage":x["dataInjection"],"artifact_sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
 "limitations":[
  "A normal pass requires a complete naturally terminated output and actual v4 settlement in one 32M-capped transaction.",
  "Higher-limit controls quantify failed normal tests; their success is not a 32M pass.",
  "Outputs are unchanged Q12 greedy predictions from the pretrained model, not inserted sentences.",
  "The finite tested prompts do not establish a gas bound for every possible generated sentence.",
  "Injected data and executable-weight deployment costs are excluded."
 ]}
(d/a.out).write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps({"variant":summary["variant"],"passing":len(summary["fully_generated_sentences_fitting_32M"]),"normal":[{"fixture":p["fixture"],"status":p["status"],"gas":p["gasUsed"],"text":p.get("text")}for p in normal]},indent=2))

