#!/usr/bin/env python3
"""Frozen two-seed BOS diagnostic for adaptive-head temperature calibration."""
import argparse,json
from pathlib import Path
from sample_fp32 import Adaptive
from screen_checkpoint import copy_matches,sha


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--mixed-control',action='store_true');a=p.parse_args();assert not a.output.exists();a.output.mkdir(parents=True)
    model=Adaptive(a.checkpoint,a.data);rows=[];original=model.choose
    settings=[(512,512),(1024,1024)]
    if a.mixed_control:settings.append((1024,512))
    for group_t,word_t in settings:
        def choose(logits,seed,index,stage,temperature):
            return original(logits,seed,index,stage,(group_t if stage==0 else word_t)/1024)
        model.choose=choose
        for seed in [0,42]:
            row=model.generate(seed,128,word_t,0);row['group_temperature_q10']=group_t;row['word_temperature_q10']=word_t
            row['group0_share']=sum(t//64==0 for t in row['token_ids'])/len(row['token_ids'])
            rows.append(row)
    copy_matches(rows,a.data)
    result={'status':'DIAGNOSTIC_REQUIRES_HUMAN_REVIEW','source':model.provenance,'script_sha256':sha(Path(__file__)),
            'scope':'Same two BOS seeds/features,128 words; compare group0 share, naturally emitted endings and grammar. Mixed control is offline only unless separately implemented.','outputs':rows}
    (a.output/'raw-outputs.json').write_text(json.dumps(result,indent=2)+'\n')
    (a.output/'raw-outputs.txt').write_text('\n\n'.join(f"seed{r['seed']} / groupT{r['group_temperature_q10']} / wordT{r['word_temperature_q10']} / group0share{r['group0_share']:.3f}\n{r['text']}"for r in rows)+'\n')
    print(json.dumps({'output':str(a.output),'summary':[{'seed':r['seed'],'group_t':r['group_temperature_q10'],'word_t':r['word_temperature_q10'],'group0_share':r['group0_share'],'sentence_ends':r['metrics']['natural_sentence_ends']}for r in rows]}))


if __name__=='__main__':main()
