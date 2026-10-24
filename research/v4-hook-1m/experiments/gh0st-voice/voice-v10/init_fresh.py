"""Reproduce the full-width random control without inherited widened weights."""
import argparse,hashlib,json,sys
from pathlib import Path
import numpy as np
import torch
from safetensors.torch import save_file

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'voice-v8/training'))
from model import VoiceModel

def main():
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--seed',type=int,default=741200);a=p.parse_args()
    assert not a.out.exists();a.out.mkdir(parents=True)
    counts=json.loads((a.data/'counts.json').read_text())['all']
    torch.set_num_threads(2);torch.manual_seed(a.seed)
    model=VoiceModel(np.asarray(counts)+.25,hidden=384)
    save_file({k:v.detach().contiguous()for k,v in model.state_dict().items()},a.out/'model.safetensors')
    report={'initialization':'fresh random full-width H384, no inherited widened weights',
            'parameters':sum(p.numel()for p in model.parameters()),'seed':a.seed,
            'source_sha256':hashlib.sha256((HERE.parent/'voice-v8/training/model.py').read_bytes()).hexdigest(),
            'weights_sha256':hashlib.sha256((a.out/'model.safetensors').read_bytes()).hexdigest(),'mainnet_actions':0}
    (a.out/'config.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if __name__=='__main__':main()
