#!/usr/bin/env python3
"""Offline-only bounded retry control; does not change the on-chain sampler."""
import argparse,json
from pathlib import Path
import numpy as np
from screen_gru import GRUModel
from screen_checkpoint import canonical,copy_matches,metrics,sha


def generate(model,seed,count=96,temperature=0.25):
    previous=8192;hidden=np.zeros(224,dtype=np.float32)
    features=np.asarray([.125,.25,.125,.5,-1,-1],dtype=np.float32)
    words=[];ids=[];norm=[];seen4=set();retries=[];zeros=[];sat=[]
    for index in range(count):
        hidden=model.step(previous,hidden,features)
        blocked=False
        for attempt in range(8):
            # First proposal is exactly the standard word-index draw. Retry
            # proposals use disjoint high-bit seeds and the same word index.
            draw_seed=seed if attempt==0 else seed^((1<<255)+attempt)
            token=model.sample(hidden,draw_seed,index,temperature)
            word=model.vocab[token];key=tuple((norm+[canonical(word)])[-4:])
            blocked=len(key)==4 and key in seen4
            if not blocked:break
        words.append(word);ids.append(token);norm.append(canonical(word))
        if len(norm)>=4:seen4.add(tuple(norm[-4:]))
        if attempt or blocked:retries.append({'word_index':index,'attempts':attempt+1,'exhausted':blocked})
        previous=token
        zeros.append(float(np.mean(hidden==0)));sat.append(float(np.mean(np.abs(hidden)>=.999)))
    return {'seed':seed,'temperature_q10':round(temperature*1024),'prompt':'','text':' '.join(words),'token_ids':ids,
            'retry_events':retries,'metrics':metrics(words,{'mean_zero_fraction':float(np.mean(zeros)),'mean_saturated_fraction':float(np.mean(sat))})}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists();a.output.mkdir(parents=True)
    model=GRUModel(a.checkpoint,a.data);rows=[generate(model,s) for s in [0,42]];copy_matches(rows,a.data)
    report={'status':'OFFLINE_DIAGNOSTIC_REQUIRES_HUMAN_REVIEW','source':model.source,'script_sha256':sha(Path(__file__)),
            'runtime_status':'Not implemented in EVM; additional gas unmeasured.',
            'policy':'Reject already-seen normalized four-word sequence; at most8tree samples from same hidden per word. If all fail, emit last candidate and mark exhausted. No state reset or invented punctuation.',
            'retry_entropy':'Attempt0 uses normal seed/index. Attempt1..7 uses seed XOR (2^255+attempt) with the same index in normal Keccak(seed,index).',
            'outputs':rows}
    (a.output/'raw-outputs.json').write_text(json.dumps(report,indent=2)+'\n')
    (a.output/'raw-outputs.txt').write_text('\n\n'.join(f"SEED {r['seed']} / T256 / bounded4gramretry\n{r['text']}" for r in rows)+'\n')
    print(json.dumps({'output':str(a.output),'retries':[len(r['retry_events']) for r in rows]}))


if __name__=='__main__':main()
