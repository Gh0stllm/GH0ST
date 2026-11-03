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

def fact_text(row):
    """Render only recorded fields. No expected labels, witness flag, fixture name or verdict."""
    o=row['observations']; family=row['family']
    def receipt(key):
        return {0:'reverted',1:'succeeded'}[o[key]]
    if family=='withdraw':
        return f"Attacker deposited {o['attackerDeposit']} wei and received {o['receivedAfterReentry']} wei total."
    if family=='mint':
        return f"Ordinary caller mint {receipt('ordinaryCallerReceipt')}. Its balance increased by {o['balanceIncrease']}."
    if family=='authorization':
        return f"Payment via intermediary {receipt('ownerViaIntermediaryReceipt')}. Recipient received {o['recipientIncrease']} wei."
    if family=='replay':
        return f"First redemption: {o['firstCredit']} points. Identical second redemption {receipt('secondIdenticalSignatureReceipt')}. Final: {o['pointsAfterSecond']} points."
    if family=='token_return':
        return f"Token returned false. Deposit {receipt('falseReturnDepositReceipt')}. Credit increased by {o['creditIncrease']}; {o['tokensMoved']} tokens moved."
    if family=='underflow':
        return f"Balance before: {o['initial']}. Burn one {receipt('burnOneReceipt')}. Balance after: {o['after']}."
    raise ValueError(family)

def trace_prompt(row, missing=False, form="raw"):
    evidence = 'No execution observations available.' if missing else json.dumps(row['observations'], separators=(',', ':'))
    if form=='facts':
        if not missing: evidence=fact_text(row)
        return ('<|im_start|>system\nAnswer yes, no or unknown from the observations.<|im_end|>\n<|im_start|>user\n'
                + evidence + '\n' + TARGET[row['family']] + '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n')
    return ('<|im_start|>system\nAnswer only from this test run. Receipt 1 means success, 0 means reverted. '
            'Answer yes, no or unknown.<|im_end|>\n<|im_start|>user\n' + TARGET[row['family']] + '\n' +
            evidence + '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n')

def main():
    from llama_cpp import Llama, LlamaGrammar, __version__
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--model', required=True)
    ap.add_argument('--traces', default='audit-evm-witnesses.json')
    ap.add_argument('--output', default='audit-evidence-results.json')
    ap.add_argument('--format',choices=['raw','facts'],default='raw')
    a = ap.parse_args()
    with open(a.model,'rb') as f:
        assert hashlib.file_digest(f,'sha256').hexdigest() == SHA
    llm = Llama(model_path=a.model,n_ctx=2048,n_batch=64,n_threads=4,n_threads_batch=4,n_gpu_layers=0,verbose=False,seed=42)
    g = LlamaGrammar.from_string(GRAMMAR,verbose=False)
    data = {'scope':'native CPU; interpretation of family-specific EVM observations, not source auditing',
            'format':a.format,'model_sha256':SHA,'llama_cpp_python':__version__,'grammar':GRAMMAR,'temperature':0,'seed':42,'runs':[]}
    rows = json.loads(Path(a.traces).read_text())['runs']
    for row,missing in [(r,False) for r in rows] + [(next(r for r in rows if r['family']==f),True) for f in TARGET]:
        llm.reset(); p=trace_prompt(row,missing,a.format);start=time.perf_counter()
        out=llm.create_completion(prompt=p,max_tokens=4,temperature=0,seed=42,grammar=g)
        expected='unknown' if missing else ('yes' if row['witness'] else 'no')
        answer=out['choices'][0]['text'].strip()
        data['runs'].append(dict(case=row['id'],split=row['split'],missing=missing,prompt=p,expected=expected,
                                 answer=answer,correct=answer==expected,usage=out['usage'],seconds=time.perf_counter()-start))
    Path(a.output).write_text(json.dumps(data,indent=2)+'\n'); llm.close()
if __name__=='__main__':main()
