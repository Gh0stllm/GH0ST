import json,sys,collections
from pathlib import Path
import torch
HERE=Path(__file__).resolve().parent;R=HERE.parents[1];V3=R.parent
sys.path.insert(0,str(V3/'training-teacher'));sys.path.insert(0,str(R/'decoder-screen'))
from common import load_model,sha,save
from screen import STOP,words_of

@torch.no_grad()
def generate(model,tok,setting,seed):
    start=tok.encode('i',add_special_tokens=False);assert start==[40]
    vocab=[tok.convert_ids_to_tokens(i) for i in range(4019)];content={i for i,w in enumerate(vocab) if w.isalpha() and w not in STOP}
    banned={}
    if setting!='baseline':
        for word in ['boy','girl','dragon','princess','prince','king','queen','owl','forest','lily','mia','leo','samuel']:
            t=tok.encode(word,add_special_tokens=False)
            if len(t)==1 and t[0]!=0 and not vocab[t[0]].startswith('##'):banned[word]=t[0]
    ids=[];inputs=torch.tensor([start]);cache=None;g=torch.Generator().manual_seed(seed)
    for step in range(128):
        mask=torch.full((1,1,1,step+1),torch.finfo(torch.float32).min);mask[:,:,:,-64:]=0
        out=model(input_ids=inputs,attention_mask=mask,past_key_values=cache,use_cache=True,position_ids=torch.tensor([[step]]));cache=out.past_key_values
        row=out.logits[0,-1].clone();row[0]=-float('inf');row[list(banned.values())]=-float('inf')
        if setting.endswith('controls'):
            seen=list(set(ids[-64:])&content)
            if seen:
                values=row[seen];row[seen]=torch.where(values<0,values*1.15,values/1.15)
            counts=collections.Counter(words_of(ids,vocab)[-32:]);row[[i for i in content if counts[vocab[i]]>=2]]=-float('inf')
        k=16 if setting.endswith('controls') else 8;temp=.7 if setting.endswith('controls') else .8
        values,choices=torch.topk(row,k);n=int(choices[torch.multinomial(torch.softmax(values/temp,0),1,generator=g)])
        ids.append(n);inputs=torch.tensor([[n]])
    return {'setting':setting,'seed':seed,'banned_whole_token_ids':banned,'tokens':ids,'text':tok.decode(start+ids,skip_special_tokens=True),'eos_positions':[i for i,x in enumerate(ids) if x==1]}

torch.set_num_threads(2);result={'scope':'Final GPU checkpoint weights, local CPU FP32 inference. Single-token i40,128newtokens,64attention,noEOSstop. No training or mainnet changes.','runner_sha256':sha(Path(__file__)),'models':[]}
for name in ['gpu-top2-voice-2m','gpu-body-voice-2m']:
    path=R/'runs'/name/'checkpoint-000282';m,t=load_model(path);m.eval();settings=['baseline','genre-only','genre-controls'] if 'top2' in name else ['baseline','genre-controls']
    row={'name':name,'weights_sha256':sha(path/'model.safetensors'),'tokenizer_sha256':sha(path/'tokenizer.json'),'outputs':[generate(m,t,s,z) for s in settings for z in [0,42]]};result['models'].append(row);del m
save(HERE/'results.json',result)
lines=[]
for m in result['models']:
    for x in m['outputs']:lines.extend([m['name']+' | '+x['setting']+' | '+str(x['seed']),x['text'],''])
(HERE/'all-outputs.txt').write_text('\n'.join(lines));print('\n'.join(lines))
