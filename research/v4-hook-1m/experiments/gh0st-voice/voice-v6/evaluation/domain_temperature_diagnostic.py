#!/usr/bin/env python3
"""Matched-seed domain/temperature screen, without touching heldout prompts."""
import argparse,json
from pathlib import Path
from sample_fp32 import Adaptive
from screen_checkpoint import copy_matches,sha


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists();a.output.mkdir(parents=True)
    model=Adaptive(a.checkpoint,a.data);rows=[]
    for domain in [0,1]:
        for temperature in [512,1024]:
            for seed in [0,42]:
                row=model.generate(seed,128,temperature,domain)
                row['group0_share']=sum(t//64==0 for t in row['token_ids'])/len(row['token_ids'])
                rows.append(row)
    copy_matches(rows,a.data)
    result={'status':'DIAGNOSTIC_REQUIRES_HUMAN_REVIEW','source':model.provenance,'script_sha256':sha(Path(__file__)),
            'scope':'Matched BOS seeds,128 words, domains0/1 and joint-stage temperatures512/1024. No heldout prefixes used.','outputs':rows}
    (a.output/'raw-outputs.json').write_text(json.dumps(result,indent=2)+'\n')
    (a.output/'raw-outputs.txt').write_text('\n\n'.join(f"domain{r['domain']} / seed{r['seed']} / T{r['temperature_q10']} / group0share{r['group0_share']:.3f}\n{r['text']}"for r in rows)+'\n')
    print(json.dumps({'output':str(a.output),'summary':[{'domain':r['domain'],'seed':r['seed'],'temperature':r['temperature_q10'],'group0_share':r['group0_share'],'sentence_ends':r['metrics']['natural_sentence_ends'],'hidden':r['metrics']['hidden']}for r in rows]}))


if __name__=='__main__':main()
