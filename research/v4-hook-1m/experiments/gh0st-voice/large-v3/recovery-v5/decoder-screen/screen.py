#!/usr/bin/env python3
"""Local fixed-model decoding controls; no training, phrase bank, network, or chain."""
import collections,hashlib,json,re,sys,time
from pathlib import Path
import torch

HERE=Path(__file__).resolve().parent
V3=HERE.parents[1]
sys.path.insert(0,str(V3/'training-teacher'))
from common import RESEARCH,load_model,save,sha

STOP=set('a an the i me my mine you your yours he him his she her hers it its we us our ours they them their theirs this that these those am is are was were be been being have has had do does did can could will would shall should may might must and or but if then than as at by for from in into of on to up with not no yes so just very one'.split())
SETTINGS=[
 {'name':'greedy','k':1,'temperature':1.},
 {'name':'baseline-k8-t080','k':8,'temperature':.8},
 {'name':'k8-t050','k':8,'temperature':.5},
 {'name':'k32-t070','k':32,'temperature':.7},
 {'name':'k8-t080-content-penalty115','k':8,'temperature':.8,'penalty':1.15},
 {'name':'k16-t065-content-penalty120-ngram3','k':16,'temperature':.65,'penalty':1.2,'ngram':3},
 {'name':'k16-t070-content-penalty115-wordlimit2','k':16,'temperature':.7,'penalty':1.15,'word_limit':2},
 {'name':'greedy-ngram3-wordlimit2','k':1,'temperature':1.,'ngram':3,'word_limit':2},
]

def words_of(ids,vocab):
    words=[]
    for token in ids:
        s=vocab[token]
        if s.startswith('##'):
            if words:words[-1]+=s[2:]
        elif s.isalpha():words.append(s)
    return words

def banned_ngram(ids,n):
    if len(ids)<n-1:return []
    prefix=tuple(ids[-(n-1):])
    return list({ids[i+n-1] for i in range(len(ids)-n+1) if tuple(ids[i:i+n-1])==prefix})

@torch.no_grad()
def generate(model,tok,setting,vocab):
    ids=[[],[]];seeds=[0,42];generators=[torch.Generator().manual_seed(x) for x in seeds]
    inputs=torch.full((2,1),3,dtype=torch.long);cache=None;actions=[collections.Counter(),collections.Counter()]
    content={i for i,s in enumerate(vocab) if s.isalpha() and s not in STOP}
    for step in range(128):
        attention=torch.full((1,1,1,step+1),torch.finfo(torch.float32).min);attention[:,:,:,-64:]=0
        result=model(input_ids=inputs,attention_mask=attention,past_key_values=cache,use_cache=True,
                     position_ids=torch.full((2,1),step,dtype=torch.long));cache=result.past_key_values
        following=[]
        for index,row in enumerate(result.logits[:,-1].float()):
            row=row.clone();row[0]=-float('inf')
            if setting.get('penalty'):
                recent=list(set(ids[index][-64:])&content)
                if recent:
                    values=row[recent];p=setting['penalty'];row[recent]=torch.where(values<0,values*p,values/p)
                    actions[index]['penalized_candidates']+=len(recent)
            if setting.get('ngram'):
                banned=banned_ngram(ids[index],setting['ngram']);row[banned]=-float('inf');actions[index]['blocked_ngram_candidates']+=len(banned)
            if setting.get('word_limit'):
                counts=collections.Counter(words_of(ids[index],vocab)[-32:])
                banned=[i for i in content if counts[vocab[i]]>=setting['word_limit']]
                row[banned]=-float('inf');actions[index]['blocked_recent_word_candidates']+=len(banned)
            values,choices=torch.topk(row,setting['k'])
            if not torch.isfinite(values).any():raise ValueError('All candidates blocked')
            token=int(choices[0] if setting['k']==1 else choices[torch.multinomial(torch.softmax(values/setting['temperature'],0),1,generator=generators[index])])
            ids[index].append(token);following.append(token)
        inputs=torch.tensor(following)[:,None]
    outputs=[]
    for index,tokens in enumerate(ids):
        grams=collections.Counter(tuple(tokens[i:i+4]) for i in range(len(tokens)-3));words=words_of(tokens,vocab);content_words=[w for w in words if w not in STOP]
        counts=collections.Counter(content_words)
        outputs.append({'seed':seeds[index],'tokens':tokens,'text':tok.decode(tokens,skip_special_tokens=True),
                        'eos_positions':[i for i,t in enumerate(tokens) if t==1],
                        'repeated4_fraction':sum(n-1 for n in grams.values())/125,
                        'most_common_content_words':counts.most_common(5),'control_actions':dict(actions[index])})
    return outputs


def main():
    torch.set_num_threads(2)
    models={'pretrained':RESEARCH/'experiments/simplestories-v2/model-cache',
            'teacher4m':V3/'runs/teacher-v4-final-4m/checkpoint-003126',
            'tone-teacher-best':V3/'tone-finish/ablation-200/teacher4m/checkpoint-000100',
            'tone-original-best':V3/'tone-finish/ablation-200/original/checkpoint-000200'}
    report={'scope':'FP32 local two-seed128-token no-reset decoder screen. EOS is recorded and fed back. No grammar guarantee, training, phrase bank, network or gas test.',
            'window':64,'initial_tokens':[3],'settings':SETTINGS,'runner_sha256':sha(Path(__file__)),
            'common_sha256':sha(V3/'training-teacher/common.py'),'word_control':'Only complete alphabetic vocabulary tokens are limited; WordPiece continuations can still form unseen words. Function words are exempt.','results':[]}
    started=time.monotonic()
    for label,path in models.items():
        model,tok=load_model(path);model.eval();vocab=[tok.convert_ids_to_tokens(i) for i in range(4019)]
        for setting in SETTINGS:
            outputs=generate(model,tok,setting,vocab)
            row={'model':label,'weight_sha256':sha(path/'model.safetensors'),'setting':setting,'outputs':outputs}
            report['results'].append(row);save(HERE/'results.json',report)
            print(json.dumps({'model':label,'setting':setting['name'],'repeat4':[x['repeated4_fraction'] for x in outputs]}),flush=True)
        del model
    report['status']='COMPLETE';report['elapsed_seconds']=time.monotonic()-started;save(HERE/'results.json',report)
    text=[]
    for row in report['results']:
        for output in row['outputs']:text.extend([f"MODEL {row['model']} | SETTING {row['setting']['name']} | SEED {output['seed']}",output['text'],''])
    (HERE/'all-outputs.txt').write_text('\n'.join(text))


if __name__=='__main__':main()
