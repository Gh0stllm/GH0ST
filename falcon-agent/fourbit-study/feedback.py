"""Calibration-only second-order rounding feedback, with unchanged bit budget.

Uses the inverse-Hessian/Cholesky principle described in GPTQ
(https://arxiv.org/abs/2210.17323). This is a small custom implementation with
static quantizer records, per-row calibration-loss fallback, and an unchanged
tied embedding. It is not the authors' complete model-specific pipeline.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import torch
from codec import PIN, Q, decode, encode
from quality import CALIBRATION

ROOT=Path(__file__).resolve().parent


def collect(checkpoint, output):
    from transformers import AutoTokenizer, AutoModelForCausalLM
    tok=AutoTokenizer.from_pretrained(checkpoint,local_files_only=True,trust_remote_code=False)
    model=AutoModelForCausalLM.from_pretrained(checkpoint,local_files_only=True,trust_remote_code=False,dtype=torch.float32).eval()
    grams,counts,handles={},{},[]
    def hook(name):
        def save(module, inputs):
            x=inputs[0].detach().float().reshape(-1,inputs[0].shape[-1])
            if name not in grams:grams[name]=torch.zeros((x.shape[1],x.shape[1]))
            grams[name].addmm_(x.T,x)
            counts[name]=counts.get(name,0)+len(x)
        return save
    for name,module in model.named_modules():
        if isinstance(module,torch.nn.Linear) and name!='lm_head':
            handles.append(module.register_forward_pre_hook(hook(name+'.weight')))
    with torch.inference_mode():
        for prompt in CALIBRATION:
            inp=tok.apply_chat_template([{'role':'user','content':prompt}],add_generation_prompt=True,tokenize=True,return_dict=True,return_tensors='pt')
            model(**inp)
    for h in handles:h.remove()
    np.savez(output,**{n:(g/counts[n]).numpy() for n,g in grams.items()})
    print(json.dumps({'covariances':len(grams),'tokens_per_matrix':sorted(set(counts.values()))}),flush=True)


def refine(checkpoint, exports, variant, covariance):
    from safetensors.torch import load_file
    source=load_file(checkpoint/'model.safetensors')
    folder=exports/variant
    original=json.loads((folder/'manifest.json').read_text())
    raw=(folder/'weights.bin').read_bytes()
    assert hashlib.sha256(raw).hexdigest()==original['sha256']
    data=bytearray(raw)
    grams=np.load(covariance)
    report={'status':'running','source_variant':variant,'source_sha256':original['sha256'],
            'damping_fraction':.01,'activation_order':True,'static_scale_and_zero_records':True,
            'tied_embedding':'Kept from clipped source; output-head covariance alone does not model its input role.',
            'evaluation_prompts_used':False,'layers':[]}
    for t in original['tensors']:
        if not t['matrix'] or t['name']=='model.embed_tokens.weight':continue
        codes,s,z,unit=decode(raw[t['offset']:t['offset']+t['byte_count']])
        rows,cols=t['shape'];group=raw[t['offset']+8]
        weight=source[t['name']].float()
        h=torch.from_numpy(grams[t['name']].copy()).double()
        assert torch.isfinite(h).all()
        h=(h+h.T)*.5
        normalizer=max(float(h.diagonal().mean()),1e-12)
        h/=normalizer
        h.diagonal().add_(.01)
        order=h.diagonal().argsort(descending=True)
        ordered=h[order][:,order]
        upper=torch.linalg.cholesky(torch.cholesky_inverse(torch.linalg.cholesky(ordered)),upper=True).float()
        current=weight[:,order].clone()
        scale=torch.from_numpy((s*unit/Q).astype(np.float32)).reshape(rows,-1)
        zero=torch.from_numpy(z).reshape(rows,-1)
        new=torch.empty((rows,cols),dtype=torch.uint8)
        # Each column's rounding residual is spread only to unrounded columns.
        for k,logical in enumerate(order.tolist()):
            scale_column=scale[:,logical//group]
            zero_column=zero[:,logical//group]
            q=(torch.round(current[:,k]/scale_column)+zero_column).clamp(0,15)
            new[:,logical]=q.to(torch.uint8)
            rounded=(q-zero_column)*scale_column
            residual=(current[:,k]-rounded)/upper[k,k]
            if k+1<cols:current[:,k+1:]-=residual[:,None]*upper[k,k+1:][None,:]
        old_dequant=torch.from_numpy(((codes-z[:,None])*(s*unit)[:,None]).astype(np.float32)/Q).reshape(rows,cols)
        new_codes=new.numpy().reshape(-1,group).astype(np.int64)
        new_dequant=torch.from_numpy(((new_codes-z[:,None])*(s*unit)[:,None]).astype(np.float32)/Q).reshape(rows,cols)
        # Independent quadratic objective check; retain a whole original row if
        # this compensation increased its regularized calibration error.
        old_error=(old_dequant-weight).double();new_error=(new_dequant-weight).double()
        old_loss=(old_error*(old_error@h)).sum(1)
        new_loss=(new_error*(new_error@h)).sum(1)
        keep=new_loss<=old_loss
        result=np.where(keep.numpy()[:,None],new.numpy(),codes.reshape(rows,cols)).reshape(-1,group)
        header=raw[t['offset']:t['offset']+16]
        blob=encode(result,s,z,group,header[9],bool(header[10]),unit)
        assert len(blob)==t['byte_count']
        data[t['offset']:t['offset']+t['byte_count']]=blob
        t['sha256']=hashlib.sha256(blob).hexdigest()
        report['layers'].append({'name':t['name'],'rows_refined':int(keep.sum()),'rows':rows,
            'regularized_calibration_error_before':float(old_loss.sum()),
            'regularized_calibration_error_after':float(torch.minimum(old_loss,new_loss).sum())})
        if len(report['layers'])%20==0:print(json.dumps({'refined_matrices':len(report['layers'])}),flush=True)
    output=exports/(variant+'_feedback');output.mkdir(exist_ok=True)
    original.update(variant=variant+'_feedback',format_variant=variant,sha256=hashlib.sha256(data).hexdigest(),
                    quantization='Activation-weighted clipping plus inverse-Hessian rounding feedback',
                    source_export_sha256=report['source_sha256'])
    original.pop('relative_matrix_weight_squared_error',None)
    (output/'weights.bin').write_bytes(data)
    (output/'manifest.json').write_text(json.dumps(original,indent=2)+'\n')
    report.update(status='completed',variant=original['variant'],bytes=len(data),sha256=original['sha256'])
    (ROOT/'feedback-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='layers'}),flush=True)


def main():
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--exports',type=Path,required=True);p.add_argument('--variant');p.add_argument('--collect',action='store_true')
    a=p.parse_args();torch.set_num_threads(4)
    assert hashlib.sha256((a.checkpoint/'model.safetensors').read_bytes()).hexdigest()==PIN
    covariance=a.exports/'covariance.npz'
    if a.collect:collect(a.checkpoint,covariance)
    if a.variant:refine(a.checkpoint,a.exports,a.variant,covariance)


if __name__=='__main__':main()
