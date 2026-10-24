#!/usr/bin/env python3
"""Full-document known-target NLL: one BOS, native context, no random crops."""
import argparse,collections,hashlib,json,sys,time
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from safetensors.torch import load_file

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'training'))
from model import VoiceModel,V,H,G,W,BOS,UNK
from engine import packed_groups


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--split',choices=['validation','test'],default='validation')
    p.add_argument('--selected-candidate',action='store_true',help='Required before opening final heldout test')
    p.add_argument('--device',choices=['cpu','mps'],default='cpu');p.add_argument('--batch-size',type=int,default=16)
    a=p.parse_args();assert not a.output.exists()
    if a.split=='test' and not a.selected_candidate:raise ValueError('Select the candidate before evaluating final test documents')
    if a.device=='mps' and not torch.backends.mps.is_available():raise ValueError('MPS unavailable')
    torch.set_num_threads(2);device=torch.device(a.device)
    datafile=a.data/f'{a.split}.jsonl';rows=[json.loads(line)for line in datafile.open()]
    rows.sort(key=lambda r:(len(r['token_ids']),r['id']))
    counts=json.loads((a.data/'counts.json').read_text());frequencies=sum(np.asarray(v)for v in counts.values())
    model=VoiceModel(frequencies);model.load_state_dict(load_file(a.checkpoint/'model.safetensors'));model.to(device).eval()
    results=[];totals=collections.defaultdict(lambda:collections.Counter());start=time.monotonic()
    with torch.inference_mode():
        for begin in range(0,len(rows),a.batch_size):
            part=rows[begin:begin+a.batch_size];batch=len(part);width=max(len(r['token_ids'])for r in part)
            x=np.zeros((batch,width),dtype=np.int64);y=np.zeros_like(x);real=np.zeros_like(x,dtype=bool);domains=np.zeros_like(x)
            for i,row in enumerate(part):
                ids=np.asarray(row['token_ids'],dtype=np.int64);n=len(ids);y[i,:n]=ids;x[i,0]=BOS;x[i,1:n]=ids[:-1]
                real[i,:n]=True;domains[i,:]=int(row['domain'])
            mask=real&(y<V);reset=np.zeros_like(real);reset[:,0]=True
            features=np.tile(np.array([.125,.25,.125,.5,-1,-1],dtype=np.float32),(batch,width,1))
            tensor=lambda v:torch.from_numpy(v).to(device)
            hidden=model(tensor(x),tensor(features),tensor(reset),tensor(domains));flat=hidden.reshape(-1,H)
            target=tensor(np.minimum(y,V-1).reshape(-1));target_group=target//W
            loss=F.cross_entropy(F.linear(flat,model.groups.weight,model.group_bias.weight[:,0]),target_group,reduction='none')
            indices,valid,groups=packed_groups(y);ix=tensor(indices);gr=tensor(groups);valid_tensor=tensor(valid)
            logits=torch.bmm(flat[ix],model.words.weight.reshape(G,W,H)[gr].transpose(1,2))+model.word_bias.weight.reshape(G,1,W)[gr]
            conditional=F.cross_entropy(logits.transpose(1,2),target[ix]%W,reduction='none')*valid_tensor
            loss=loss.scatter_add(0,ix.reshape(-1),conditional.reshape(-1)).reshape(batch,width)
            loss=(loss*tensor(mask.astype(np.float32))).cpu().numpy();hidden_cpu=hidden.cpu().numpy()
            for i,row in enumerate(part):
                n=len(row['token_ids']);known=int(mask[i,:n].sum());unknown=n-known;nll=float(loss[i,:n].sum())
                h=hidden_cpu[i,:n];domain=str(row['domain']);stats=totals[domain]
                stats.update(documents=1,total_words=n,known_targets=known,unknown_targets=unknown,nll_sum=nll,
                             saturated_values=int((np.abs(h)>=.999).sum()),hidden_values=h.size)
                results.append({'id':row['id'],'domain':int(domain),'length':n,'known_targets':known,'unknown_targets':unknown,
                                'nll_sum':nll,'known_target_nll':nll/known if known else None,'hidden_abs_max':float(np.abs(h).max())})
    summary={d:{**dict(s),'known_target_nll':s['nll_sum']/s['known_targets'],
                'known_target_fraction':s['known_targets']/s['total_words'],
                'saturation_fraction':s['saturated_values']/s['hidden_values']}for d,s in totals.items()}
    report={'status':'COMPLETE','checkpoint':str(a.checkpoint),'weights_sha256':sha(a.checkpoint/'model.safetensors'),
            'data_sha256':sha(datafile),'vocabulary_sha256':sha(a.data/'vocabulary.json'),'script_sha256':sha(Path(__file__)),
            'split':a.split,'device':a.device,'batch_size':a.batch_size,'elapsed_seconds':time.monotonic()-start,
            'method':'Each complete source document starts with BOS once; no random crop or internal state reset. Padding excluded. All unknown inputs retained; unknown targets masked. Nominal features fixed for every word.',
            'limitations':'Teacher-forced known-target likelihood is not free-generation coherence or a language quality pass.',
            'domains':summary,'documents':results}
    a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'output':str(a.output),'domains':summary,'elapsed_seconds':report['elapsed_seconds']}))


if __name__=='__main__':main()
