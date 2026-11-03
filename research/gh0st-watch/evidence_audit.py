"""Small Qwen trial: interpret execution observations without labels or source.
No claim of new bug discovery. Run after run_evm_witness.cjs.
"""
import argparse, hashlib, json, time
from pathlib import Path

TARGET = {
    'withdraw': 'Did the attacker receive more than their deposit on reentry?',
    'authorization': 'Did payment through the intermediary increase the recipient balance?',
    'mint': 'Did the ordinary caller successfully increase their balance by minting?',
    'replay': 'Did the second use of the identical signature increase points again?',
    'token_return': 'Did the false-return deposit create credit without moving tokens?',
    'underflow': 'Did burning one from zero wrap the balance to a large number?',
}
GRAMMAR = 'root ::= "yes" | "no" | "unknown"'
SHA = 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'

def trace_prompt(row, missing=False):
    evidence = 'No execution observations available.' if missing else json.dumps(row['observations'], separators=(',', ':'))
    return ('<|im_start|>system\nAnswer only from this test run. Receipt 1 means success, 0 means reverted. '
            'Answer yes, no or unknown.<|im_end|>\n<|im_start|>user\n' + TARGET[row['family']] + '\n' +
            evidence + '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n')

def main():
    from llama_cpp import Llama, LlamaGrammar, __version__
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--model', required=True)
    ap.add_argument('--traces', default='audit-evm-witnesses.json')
    ap.add_argument('--output', default='audit-evidence-results.json')
    a = ap.parse_args()
    with open(a.model,'rb') as f:
        assert hashlib.file_digest(f,'sha256').hexdigest() == SHA
    llm = Llama(model_path=a.model,n_ctx=2048,n_batch=64,n_threads=4,n_threads_batch=4,n_gpu_layers=0,verbose=False,seed=42)
    g = LlamaGrammar.from_string(GRAMMAR,verbose=False)
    data = {'scope':'native CPU; interpretation of family-specific EVM observations, not source auditing',
            'model_sha256':SHA,'llama_cpp_python':__version__,'grammar':GRAMMAR,'temperature':0,'seed':42,'runs':[]}
    rows = json.loads(Path(a.traces).read_text())['runs']
    for row,missing in [(r,False) for r in rows] + [(next(r for r in rows if r['family']==f),True) for f in TARGET]:
        llm.reset(); p=trace_prompt(row,missing);start=time.perf_counter()
        out=llm.create_completion(prompt=p,max_tokens=4,temperature=0,seed=42,grammar=g)
        expected='unknown' if missing else ('yes' if row['witness'] else 'no')
        answer=out['choices'][0]['text'].strip()
        data['runs'].append(dict(case=row['id'],split=row['split'],missing=missing,prompt=p,expected=expected,
                                 answer=answer,correct=answer==expected,usage=out['usage'],seconds=time.perf_counter()-start))
    Path(a.output).write_text(json.dumps(data,indent=2)+'\n'); llm.close()
if __name__=='__main__':main()
