"""GRU exact Q10 independent reference, recomputing unfused input dot products."""
import argparse,hashlib,importlib.util,json
from pathlib import Path
import numpy as np
H,V,Q=224,8192,1024
base=Path(__file__).resolve().parents[2]/'evm/reference.py'
spec=importlib.util.spec_from_file_location('recurrent_entropy',base);common=importlib.util.module_from_spec(spec);spec.loader.exec_module(common)
def trunc(x):
    x=np.asarray(x,dtype=np.int64);return np.where(x>=0,x//Q,-((-x)//Q))
class Reference:
    def __init__(self,folder):
        p=Path(folder);read=lambda name:np.frombuffer((p/name).read_bytes(),dtype='>i2').astype(np.int64)
        self.embedding=read('original-embedding.bin').reshape(V+1,H);self.wx=read('original-wx.bin').reshape(3*H,H);self.bh=read('original-bh.bin')
        core=read('core.bin');self.wh=core[:3*H*H].reshape(3*H,H);self.wf=core[3*H*H:].reshape(3*H,6)
        nodes=read('nodes.bin').reshape(V-1,H+1);self.nodes,self.bias=nodes[:,:H],nodes[:,H]
        self.words=json.loads((p/'vocabulary.json').read_text());self.delta=np.frombuffer((p/'sigmoid-delta.bin').read_bytes(),dtype='>u2').astype(np.int64)
    def sigmoid(self,x):
        index=np.minimum(256,(np.abs(x)+32)//64);prob=32768+np.where(x>=0,self.delta[index],-self.delta[index]);return (prob+32)//64
    def step(self,previous,hidden,features,seed,index,temperature=256,scalar=False):
        hidden=np.asarray(hidden,dtype=np.int64);features=np.asarray(features,dtype=np.int64)
        assert hidden.shape==(H,) and (np.abs(hidden)<=1024).all() and features.shape==(6,) and (np.abs(features)<=4096).all()
        x=trunc(self.wx@self.embedding[previous]+self.wf@features+self.bh*Q);rproj=trunc(self.wh@hidden)
        if scalar:
            for i in range(3*H):
                total=sum(int(w)*int(v)for w,v in zip(self.wx[i],self.embedding[previous]))+sum(int(w)*int(v)for w,v in zip(self.wf[i],features))+int(self.bh[i])*Q
                assert int(x[i])==int(trunc(total));assert int(rproj[i])==int(trunc(sum(int(w)*int(v)for w,v in zip(self.wh[i],hidden))))
        reset=self.sigmoid(x[:H]+rproj[:H]);update=self.sigmoid(x[H:2*H]+rproj[H:2*H])
        candidate=2*self.sigmoid(2*(x[2*H:]+trunc(reset*rproj[2*H:])))-Q
        next=trunc(update*hidden+(Q-update)*candidate)
        entropy=common.random_bits(seed,index);node=0;scores=[]
        for depth in range(13):
            score=int(trunc(self.nodes[node]@next+self.bias[node]*Q));at=min(256,(abs(score)*1024//temperature+32)//64)
            prob=32768+int(self.delta[at]) if score>=0 else 32768-int(self.delta[at]);node=node*2+1+int(((entropy>>(16*depth))&65535)<prob);scores.append(score)
        token=node-(V-1);return {'token':token,'hidden':next.tolist(),'scores':scores,'text':self.words[token],'terminal':self.words[token].endswith(('.','!','?'))}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    model=Reference(a.model_dir);report=json.loads(a.report.read_text())
    for i,row in enumerate(report['swaps']):
        pred=model.step(int(row['before']['context'][5]),row['before']['hidden'],row['features'],report['seed'],row['sampleIndex'],report['temperatureQ10'],scalar=True)
        assert pred['token']==row['token'];assert pred['hidden']==list(map(int,row['after']['hidden']));assert pred['scores']==list(map(int,row['branchScores']));assert pred['text']==row['text'];assert pred['terminal']==row['terminal']
    result={'status':'PASS','steps':len(report['swaps']),'all224_hidden_match':True,'all13_scores_match':True,'all_unfused_input_and_recurrent_scalar_checks_pass':True,'report_sha256':hashlib.sha256(a.report.read_bytes()).hexdigest()}
    a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
