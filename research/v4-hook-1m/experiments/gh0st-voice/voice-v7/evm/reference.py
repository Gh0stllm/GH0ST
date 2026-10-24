"""Independent integer two-GRU128, lexical head and punctuation reference."""
import argparse,json,hashlib,os,subprocess
from pathlib import Path
import numpy as np
H,V,Q=128,8192,1024
def trunc(x):
    x=np.asarray(x,dtype=np.int64);return np.where(x>=0,x//Q,-((-x)//Q))
_draws={}
def entropy(seed,index,stage):
    key=(seed,index//256)
    if key not in _draws:
        script="import{AbiCoder,keccak256}from'ethers';const c=AbiCoder.defaultAbiCoder(),s=process.argv[1],n=Number(process.argv[2]);process.stdout.write(JSON.stringify(Array.from({length:256},(_,i)=>[0,1,2].map(j=>keccak256(c.encode(['bytes32','uint256','uint256'],[s,n+i,j]))))));"
        node=os.environ.get('NODE_BINARY','/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
        _draws[key]=json.loads(subprocess.check_output([node,'--input-type=module','-e',script,seed,str(key[1]*256)],cwd=Path(__file__).resolve().parents[4]))
    return int(_draws[key][index%256][stage],16)
class Reference:
    def __init__(self,folder):
        p=Path(folder);read=lambda n:np.frombuffer((p/n).read_bytes(),dtype='>i2').astype(np.int64)
        self.emb=read('original-embedding-weight.bin').reshape(8193,H);self.pe=read('original-punct_embedding-weight.bin').reshape(5,H)
        self.wx1=read('original-wx1.bin').reshape(384,H);self.bh1=read('original-bh1.bin')+read('original-domain-weight.bin').reshape(2,384)[0]
        c=read('core.bin');self.wh1=c[:49152].reshape(384,H);self.wx2=c[49152:98304].reshape(384,H);self.wh2=c[98304:147456].reshape(384,H);self.wf=c[147456:149760].reshape(384,6);self.bh2=c[149760:]
        groups=read('groups.bin').reshape(128,129);words=read('words.bin').reshape(8192,129)
        self.gw,self.gb=groups[:,:H],groups[:,H];self.ww,self.wb=words[:,:H],words[:,H]
        punct=read('punctuation.bin');ph=punct[:645].reshape(5,129);self.pw,self.pb=ph[:,:H],ph[:,H];self.wpb=punct[645:41605].reshape(8192,5)
        self.delta=np.frombuffer((p/'sigmoid-delta.bin').read_bytes(),dtype='>u2').astype(np.int64)
        self.exp=np.frombuffer((p/'exp-q32.bin').read_bytes(),dtype='>u8').astype(np.int64);self.vocab=json.loads((p/'vocabulary.json').read_text())
    def sigmoid(self,x):
        at=np.minimum(256,(np.abs(x)+32)//64);return (32768+np.where(x>=0,self.delta[at],-self.delta[at])+32)//64
    def sample(self,scores,seed,index,stage,temp):
        at=np.minimum(256,((int(scores.max())-scores)*1024//temp+32)//64);weights=self.exp[at];draw=entropy(seed,index,stage)%int(weights.sum())
        for i,w in enumerate(weights):
            if draw<int(w):return i
            draw-=int(w)
        raise AssertionError('unreachable')
    def cell(self,x,r,old):
        reset=self.sigmoid(x[:H]+r[:H]);update=self.sigmoid(x[H:2*H]+r[H:2*H]);candidate=2*self.sigmoid(2*(x[2*H:]+trunc(reset*r[2*H:])))-Q
        return trunc(update*old+(Q-update)*candidate)
    def step(self,previous,previous_punct,hidden,features,seed,index,temp=512,scalar=True):
        h=np.asarray(hidden,dtype=np.int64);f=np.asarray(features,dtype=np.int64)
        x1=trunc(self.wx1@self.emb[previous]+self.wx1@self.pe[previous_punct]+self.wf@f+self.bh1*Q);r1=trunc(self.wh1@h[:H]);h1=self.cell(x1,r1,h[:H])
        x2=trunc(self.wx2@h1+self.bh2*Q);r2=trunc(self.wh2@h[H:]);h2=self.cell(x2,r2,h[H:]);new=np.concatenate([h1,h2])
        gs=trunc(self.gw@h2+self.gb*Q);g=self.sample(gs,seed,index,0,temp);ws=trunc(self.ww[g*64:(g+1)*64]@h2+self.wb[g*64:(g+1)*64]*Q);w=self.sample(ws,seed,index,1,temp);token=g*64+w
        ps=trunc(self.pw@h2+(self.pb+self.wpb[token])*Q);punct=self.sample(ps,seed,index,2,temp)
        if scalar:
            dot=lambda a,b:sum(int(u)*int(v)for u,v in zip(a,b))
            for i in range(384):
                assert int(x1[i])==int(trunc(dot(self.wx1[i],self.emb[previous])+dot(self.wx1[i],self.pe[previous_punct])+dot(self.wf[i],f)+int(self.bh1[i])*Q))
                assert int(r1[i])==int(trunc(dot(self.wh1[i],h[:H])))
                assert int(x2[i])==int(trunc(dot(self.wx2[i],h1)+int(self.bh2[i])*Q))
                assert int(r2[i])==int(trunc(dot(self.wh2[i],h[H:])))
            for matrix,bias,scores in [(self.gw,self.gb,gs),(self.ww[g*64:(g+1)*64],self.wb[g*64:(g+1)*64],ws),(self.pw,self.pb+self.wpb[token],ps)]:
                for a,b,c in zip(matrix,bias,scores):assert int(c)==int(trunc(dot(a,h2)+int(b)*Q))
        return {'token':token,'punct':punct,'hidden':new.tolist(),'scores':gs.tolist()+ws.tolist()+ps.tolist(),'text':self.vocab[token]+['',',','.','!','?'][punct],'terminal':punct>=2,'group':g,'within':w}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    ref=Reference(a.model_dir);report=json.loads(a.report.read_text());rows=[]
    for row in report['swaps']:
        expected=ref.step(int(row['before']['context'][5]),int(row['before']['context'][6]),row['before']['hidden'],row['features'],report['seed'],row['sampleIndex'],report['temperatureQ10'])
        assert expected['token']==row['token'];assert expected['punct']==row['punct'];assert expected['hidden']==list(map(int,row['after']['hidden']));assert expected['scores']==list(map(int,row['branchScores']));assert expected['text']==row['text'];assert expected['terminal']==row['terminal'];rows.append({k:expected[k]for k in ('token','punct','group','within')})
    result={'status':'PASS','steps':len(rows),'all256_hidden_match':True,'all197_logits_match':True,'scalar_checks':True,'punctuation_is_neural_not_forced':True,'report_sha256':hashlib.sha256(a.report.read_bytes()).hexdigest(),'rows':rows}
    a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
