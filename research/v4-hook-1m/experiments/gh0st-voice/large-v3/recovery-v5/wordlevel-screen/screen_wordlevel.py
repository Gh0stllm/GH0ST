#!/usr/bin/env python3
"""Read-only decoding screen of a completed word-level snapshot."""
import argparse,json,sys,time
from pathlib import Path
import torch
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'decoder-screen'))
from screen import generate
from common import load_model,sha,save

def main():
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',type=Path,default=HERE.parent/'runs/wordlevel-4m/checkpoint-001000');p.add_argument('--wait-seconds',type=float,default=30);a=p.parse_args()
    deadline=time.monotonic()+a.wait_seconds
    while not (a.checkpoint/'training-metadata.json').exists():
        if time.monotonic()>=deadline:raise TimeoutError('Completed snapshot not available in bounded wait')
        time.sleep(.2)
    torch.set_num_threads(2);before=sha(a.checkpoint/'model.safetensors');model,tok=load_model(a.checkpoint);model.eval()
    assert json.loads((a.checkpoint/'tokenizer.json').read_text())['model']['type']=='WordLevel'
    vocab=[tok.convert_ids_to_tokens(i) for i in range(4019)]
    settings=[{'name':'baseline-k8-t080','k':8,'temperature':.8},
              {'name':'k16-t070-content-penalty115-wordlimit2','k':16,'temperature':.7,'penalty':1.15,'word_limit':2},
              {'name':'k16-t065-content-penalty120-ngram3','k':16,'temperature':.65,'penalty':1.2,'ngram':3}]
    report={'checkpoint':str(a.checkpoint.resolve()),'weights_sha256':before,'tokenizer_sha256':sha(a.checkpoint/'tokenizer.json'),
            'runner_sha256':sha(Path(__file__)),'decoder_sha256':sha(HERE.parent/'decoder-screen/screen.py'),
            'scope':'Two seeds,128newtokens,64token attention,quote3. Full raw FP32 outputs; no training changes or chain activity. EOS does not stop generation.',
            'results':[]}
    text=[]
    for setting in settings:
        outputs=generate(model,tok,setting,vocab);report['results'].append({'setting':setting,'outputs':outputs})
        for output in outputs:
            text.extend([f"SETTING {setting['name']} | SEED {output['seed']}",output['text'],''])
            print(json.dumps({'setting':setting['name'],**output}),flush=True)
    assert before==sha(a.checkpoint/'model.safetensors')
    name=a.checkpoint.name;save(HERE/f'{name}-results.json',report);(HERE/f'{name}-all-outputs.txt').write_text('\n'.join(text))

if __name__=='__main__':main()
