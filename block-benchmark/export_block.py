"""Offline quantization/export of the complete first block of pinned LFM.

Derived model data is modified by int4 row quantization and fixed-point packing.
The original LFM Open License at ../LFM-LICENSE.txt applies to the derived data.
"""
import hashlib
import inspect
import json
import math
from pathlib import Path
import numpy as np
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers.models.lfm2 import modeling_lfm2
from transformers.utils import logging
from reference import Q, S, SIG, MATRICES, pack, block

ROOT = Path(__file__).resolve().parent


def main():
    logging.disable_progress_bar()
    torch.set_num_threads(4)
    lock = json.loads((ROOT.parent/'model-lock.json').read_text())
    tokenizer = AutoTokenizer.from_pretrained(lock['model_id'], revision=lock['revision'], local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(lock['model_id'], revision=lock['revision'],
        trust_remote_code=False, local_files_only=True, dtype=torch.float32, attn_implementation='eager').eval()
    layer = model.model.layers[0]
    assert not layer.is_attention_layer and not layer.conv.bias
    folder = ROOT/'data'; folder.mkdir(exist_ok=True)
    manifest = {'model':lock, 'layer':0, 'type':'complete convolution decoder block',
        'modified_data_notice':'Derived from Liquid AI weights; modified by int4 per-row quantization, Q24 scales and Q16/Q24 coefficient packing. LFM Open License v1.0 applies.',
        'precision':{'activations':'signed int32 Q16, overflow rejected','weights':'symmetric per-row signed int4 [-7,7]',
                     'scales':'signed int32 Q24','rounding':'offline ties-to-even; runtime signed division truncates toward zero',
                     'norm':'integer square root, eps_Q32=42950','silu':'Q30 sigmoid LUT on [-16,16], step 1/64, linear interpolation'},
        'matrices':[], 'shards':[]}
    matrices=[]
    for name, rows, cols, chunk in MATRICES:
        weight=layer.get_submodule(name).weight.detach().numpy().astype(np.float64)
        assert weight.shape==(rows,cols)
        scale=np.maximum(np.max(np.abs(weight),axis=1)/7,1/S)
        quant=np.clip(np.rint(weight/scale[:,None]),-7,7).astype(np.int64)
        scales=np.rint(scale*S).astype(np.int64)
        matrices.append((quant,scales))
        start=len(manifest['shards'])
        for row in range(0,rows,chunk):
            payload=b''
            for j in range(row,row+chunk):
                packed=((quant[j,::2]&15)|((quant[j,1::2]&15)<<4)).astype(np.uint8).tobytes()
                payload+=int(scales[j]).to_bytes(4,'big',signed=True)+packed
            filename=f'matrix-{start+row//chunk:03d}.bin'
            (folder/filename).write_bytes(payload)
            manifest['shards'].append({'file':filename,'matrix':name,'row':row,'rows':chunk,
                'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()})
        manifest['matrices'].append({'name':name,'rows':rows,'columns':cols,'rows_per_step':chunk,
            'first_shard':start,'shard_count':rows//chunk})
    gamma=np.rint(np.concatenate([layer.operator_norm.weight.detach().numpy(),
                                  layer.ffn_norm.weight.detach().numpy()])*Q).astype(np.int64)
    conv=np.rint(layer.conv.conv.weight[:,0,:].detach().numpy().astype(np.float64)*S).astype(np.int64)
    lut=np.rint(np.array([1/(1+math.exp(-(-16+i/64))) for i in range(2049)])*SIG).astype(np.int64)
    for filename,arr in [('norm.bin',gamma),('conv.bin',conv.reshape(-1)),('sigmoid.bin',lut)]:
        payload=pack(arr);(folder/filename).write_bytes(payload)
        manifest['shards'].append({'file':filename,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()})
    ids=tokenizer.apply_chat_template([{'role':'user','content':'Set my goal to learn Solidity.'}],
        add_generation_prompt=True,tokenize=True,return_tensors='pt',return_dict=True)['input_ids'][0,:3].tolist()
    with torch.inference_mode():
        embeds=model.model.embed_tokens(torch.tensor([ids]))
        fp=layer(embeds)[0].numpy().astype(np.float64)
    history=[np.zeros(1024,dtype=np.int64),np.zeros(1024,dtype=np.int64)]
    cases=[]
    for i,token in enumerate(ids):
        x=np.rint(embeds[0,i].numpy().astype(np.float64)*Q).astype(np.int64)
        stages,history=block(x,history,matrices,gamma,conv,lut)
        np.savez_compressed(folder/f'token-{i}-reference.npz',**stages,history_old=history[0],history_prev=history[1],float32_output=fp[i])
        (folder/f'token-{i}-input.bin').write_bytes(pack(x))
        y=stages['output']/Q; err=y-fp[i]
        cases.append({'token_index':i,'token_id':token,'cosine_similarity':float(y@fp[i]/(np.linalg.norm(y)*np.linalg.norm(fp[i]))),
            'relative_l2_error':float(np.linalg.norm(err)/np.linalg.norm(fp[i])),
            'max_absolute_error':float(np.max(np.abs(err))),
            'stage_max_absolute_q16':{k:int(np.max(np.abs(v))) for k,v in stages.items()},
            'output_sha256':hashlib.sha256(pack(stages['output'])).hexdigest()})
    manifest.update(token_ids=ids,cases=cases, matrix_multiply_accumulates_per_token=sum(r*c for _,r,c,_ in MATRICES),
        depthwise_convolution_multiply_accumulates_per_token=3072,
        total_shard_payload_bytes=sum(x['bytes'] for x in manifest['shards']),
        transformers_source_sha256=hashlib.sha256(inspect.getsource(modeling_lfm2).encode()).hexdigest())
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:manifest[k] for k in ['token_ids','matrix_multiply_accumulates_per_token','total_shard_payload_bytes','cases']},indent=2))


if __name__=='__main__':main()
