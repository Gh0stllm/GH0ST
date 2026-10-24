"""Independent exact GRU plus128x64 adaptive-output reference."""
import argparse,json,hashlib,os,subprocess
from pathlib import Path
import numpy as np
H,V,Q=224,8192,1024
def trunc(x):
    x=np.asarray(x,dtype=np.int64);return np.where(x>=0,x//Q,-((-x)//Q))
_draws={}
def entropy(seed,index,stage):
    key=(seed,index//256)
    if key not in _draws:
        script="import{AbiCoder,keccak256}from'ethers';const c=AbiCoder.defaultAbiCoder(),s=process.argv[1],n=Number(process.argv[2]);process.stdout.write(JSON.stringify(Array.from({length:256},(_,i)=>[0,1].map(j=>keccak256(c.encode(['bytes32','uint256','uint256'],[s,n+i,j]))))));"
        node=os.environ.get('NODE_BINARY','/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
        _draws[key]=json.loads(subprocess.check_output([node,'--input-type=module','-e',script,seed,str(key[1]*256)],cwd=Path(__file__).resolve().parents[5]))
    return int(_draws[key][index%256][stage],16)
class Reference:
    def __init__(self,folder):
        p=Path(folder);read=lambda n:np.frombuffer((p/n).read_bytes(),dtype='>i2').astype(np.int64)
        self.emb=read('original-embedding.bin').reshape(8193,H);self.wx=read('original-wx.bin').reshape(672,H);self.bh=read('original-bh.bin')
        if (p/'original-domain.bin').exists():self.bh=self.bh+read('original-domain.bin').reshape(2,672)[0]
        c=read('core.bin');self.wh=c[:150528].reshape(672,H);self.wf=c[150528:].reshape(672,6)
        groups=read('groups.bin').reshape(128,225);words=read('words.bin').reshape(8192,225)
        self.gw,self.gb=groups[:,:H],groups[:,H];self.ww,self.wb=words[:,:H],words[:,H]
        self.delta=np.frombuffer((p/'sigmoid-delta.bin').read_bytes(),dtype='>u2').astype(np.int64)
        self.exp=np.frombuffer((p/'exp-q32.bin').read_bytes(),dtype='>u8').astype(np.int64)
        self.vocab=json.loads((p/'vocabulary.json').read_text())
    def sigmoid(self,x):
        at=np.minimum(256,(np.abs(x)+32)//64);return (32768+np.where(x>=0,self.delta[at],-self.delta[at])+32)//64
    def sample(self,scores,seed,index,stage,temp):
        scaled=(int(scores.max())-scores)*1024//temp;at=np.minimum(256,(scaled+32)//64);weights=self.exp[at]
        draw=entropy(seed,index,stage)%int(weights.sum());original=draw
        for i,w in enumerate(weights):
            if draw<int(w):return i,weights.tolist(),original
            draw-=int(w)
        raise AssertionError('unreachable')
    def step(self,previous,hidden,features,seed,index,temp=256,scalar=True):
        hidden=np.asarray(hidden,dtype=np.int64);features=np.asarray(features,dtype=np.int64)
        x=trunc(self.wx@self.emb[previous]+self.wf@features+self.bh*1024);r=trunc(self.wh@hidden)
        if scalar:
            for i in range(672):
                val=sum(int(w)*int(v)for w,v in zip(self.wx[i],self.emb[previous]))+sum(int(w)*int(v)for w,v in zip(self.wf[i],features))+int(self.bh[i])*1024
                assert int(x[i])==int(trunc(val));assert int(r[i])==int(trunc(sum(int(w)*int(v)for w,v in zip(self.wh[i],hidden))))
        reset=self.sigmoid(x[:H]+r[:H]);update=self.sigmoid(x[H:2*H]+r[H:2*H]);candidate=2*self.sigmoid(2*(x[2*H:]+trunc(reset*r[2*H:])))-Q
        new=trunc(update*hidden+(Q-update)*candidate)
        gs=trunc(self.gw@new+self.gb*Q);group,gweights,gdraw=self.sample(gs,seed,index,0,temp)
        ws=trunc(self.ww[group*64:(group+1)*64]@new+self.wb[group*64:(group+1)*64]*Q);within,wweights,wdraw=self.sample(ws,seed,index,1,temp)
        if scalar:
            for weights,bias,score in [*zip(self.gw,self.gb,gs),*zip(self.ww[group*64:(group+1)*64],self.wb[group*64:(group+1)*64],ws)]:
                assert int(score)==int(trunc(sum(int(w)*int(v)for w,v in zip(weights,new))+int(bias)*Q))
        token=group*64+within
        return {'token':token,'hidden':new.tolist(),'scores':gs.tolist()+ws.tolist(),'text':self.vocab[token],
                'terminal':self.vocab[token].endswith(('.','!','?')),'group':group,'within':within,'group_weights':gweights,'word_weights':wweights,'group_draw':gdraw,'word_draw':wdraw}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    model=Reference(a.model_dir);report=json.loads(a.report.read_text());results=[]
    for row in report['swaps']:
        expected=model.step(int(row['before']['context'][5]),row['before']['hidden'],row['features'],report['seed'],row['sampleIndex'],report['temperatureQ10'])
        assert expected['token']==row['token'];assert expected['hidden']==list(map(int,row['after']['hidden']));assert expected['scores']==list(map(int,row['branchScores']));assert expected['text']==row['text'];assert expected['terminal']==row['terminal']
        results.append({k:expected[k]for k in ['token','group','within','group_weights','word_weights','group_draw','word_draw']})
    result={'status':'PASS','steps':len(results),'all224_hidden_match':True,'all192_evaluated_logits_match':True,'all_unfused_input_recurrent_and_head_scalar_checks_pass':True,'report_sha256':hashlib.sha256(a.report.read_bytes()).hexdigest(),'sampling':results}
    a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k!='sampling'}))
