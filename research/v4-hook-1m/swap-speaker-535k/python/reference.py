#!/usr/bin/env python3
"""Independent integer reference for the exported 534,751-parameter model."""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
V,H,Q=8192,32,1024


def trunc(a):
    return np.where(a>=0,a//Q,-((-a)//Q))


class Reference:
    def __init__(self):
        model=ROOT/'model'
        self.vocabulary=json.loads((model/'vocabulary.json').read_text())
        self.embeddings=np.frombuffer((model/'embeddings.bin').read_bytes(),dtype='>i2').astype(np.int64).reshape(V+1,H)
        core=np.frombuffer((model/'core.bin').read_bytes(),dtype='>i2').astype(np.int64)
        self.wx=core[:1024].reshape(H,H);self.wh=core[1024:2048].reshape(H,H)
        self.wf=core[2048:2240].reshape(H,6);self.bh=core[2240:]
        nodes=np.frombuffer((model/'nodes.bin').read_bytes(),dtype='>i2').astype(np.int64).reshape(V-1,H+1)
        self.nodes,self.bias=nodes[:,:H],nodes[:,H]

    def step(self,previous,state,features):
        state=np.asarray(state,dtype=np.int64);features=np.asarray(features,dtype=np.int64)
        assert 0<=previous<=V and np.all((state>=0)&(state<=8192)) and np.all(np.abs(features)<=4096)
        hidden=np.clip(trunc(self.wx@self.embeddings[previous]+self.wh@state+self.wf@features+self.bh*Q),0,8192)
        node,scores=0,[]
        for _ in range(13):
            score=int(trunc(np.asarray(self.nodes[node]@hidden+self.bias[node]*Q)))
            scores.append(score);node=node*2+1+(score>0)
        token=node-(V-1)
        return token,hidden.tolist(),scores

    def generate(self,previous,state,features,limit=12):
        tokens=[];ended=False
        for _ in range(limit):
            previous,state,_=self.step(previous,state,features)
            tokens.append(previous)
            if self.vocabulary[previous].endswith(('.', '!', '?')):ended=True;break
        text=' '.join(self.vocabulary[token] for token in tokens)
        if not ended:text+='.'
        return {'next_previous':previous,'next_state':state,'tokens':tokens,'text':text,'ended_naturally':ended}


def main():
    ref=Reference();rng=np.random.default_rng(466360)
    fixtures=[];generations=[]
    for regime,(low,high) in enumerate([(0,40),(50,180),(200,900)]):
        previous,state=V,[0]*H
        for sample in range(6):
            move,ewma,old=rng.integers(low,high+1,3)
            features=[int(move*4),int(ewma*4),int(abs(move-old)*4),int(rng.integers(0,1025)),1024,1024]
            before_previous,before_state=previous,state.copy()
            generated=ref.generate(previous,state,features)
            generations.append({'regime':regime,'previous_token':before_previous,'state':before_state,'features':features,**generated})
            for token in generated['tokens']:
                predicted,hidden,scores=ref.step(previous,state,features)
                assert predicted==token
                if len(fixtures)<24:fixtures.append({'previous_token':previous,'state':state,'features':features,'token':token,'next_state':hidden,'scores':scores})
                previous,state=predicted,hidden
            if not generated['ended_naturally']:previous,state=V,[0]*H
    # Signed extremes and maximum state activate boundary arithmetic paths.
    for features,state in [([-4096]*6,[8192]*H),([4096]*6,[0]*H)]:
        token,hidden,scores=ref.step(V,state,features)
        fixtures.append({'previous_token':V,'state':state,'features':features,'token':token,'next_state':hidden,'scores':scores})
    (ROOT/'reports/integer-fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n')
    (ROOT/'reports/generated-sentences.json').write_text(json.dumps(generations,indent=2)+'\n')
    print(json.dumps({'parameters':534751,'samples':len(generations),'natural_completions':sum(g['ended_naturally'] for g in generations),'examples':[g['text'] for g in generations[:6]]},indent=2))


if __name__=='__main__':main()
