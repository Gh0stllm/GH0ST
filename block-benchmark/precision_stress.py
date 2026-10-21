"""CPU integer-reference first-block precision sweep over diverse input tokens.

This extends numerical coverage, but does not execute these extra tokens in EVM.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers.utils import logging
from reference import Q, S, MATRICES, unpack, pack, block

ROOT = Path(__file__).resolve().parent
TEXTS = [
    'My learning goal is Solidity. Create a task to read the documentation, then test a contract and review the result. '
    'Task 7 is pending and task 42 is complete. Tell me what remains to be done. ',
    'A smart contract stores state and executes deterministic instructions. A transaction pays for computation. '
    'We need to compare model arithmetic, memory, input tokenization and output decoding. ',
    'Numbers: 0, 1, 7, 42, 128, 1024, -17, 999999. Words: Cedar, Mumbai, Tokyo, Solidity. '
    'Quotes: "hello world". JSON: {"action":"complete_task","task_id":7}. ',
    'こんにちは。 Bonjour. Hola. مرحبا. नमस्ते. Please summarize the task list and ask which goal to choose. '
    'The user changed the goal from learning Rust to learning Solidity. ',
]


def main():
    logging.disable_progress_bar(); torch.set_num_threads(4)
    lock = json.loads((ROOT.parent/'model-lock.json').read_text())
    tok = AutoTokenizer.from_pretrained(lock['model_id'], revision=lock['revision'], local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(lock['model_id'], revision=lock['revision'], local_files_only=True,
        trust_remote_code=False, dtype=torch.float32, attn_implementation='eager').eval()
    layer = model.model.layers[0]
    gamma = unpack((ROOT/'data/norm.bin').read_bytes())
    conv = unpack((ROOT/'data/conv.bin').read_bytes()).reshape(1024,3)
    lut = unpack((ROOT/'data/sigmoid.bin').read_bytes())
    report = {'model': lock, 'started_at': datetime.now(timezone.utc).isoformat(),
        'scope': 'CPU integer reference for layer zero; all later layers excluded',
        'sequence_count': 4, 'tokens_per_sequence': 64, 'texts_repeated_before_tokenization': TEXTS,
        'variants': [], 'original_three_fixture_hashes_unchanged': None}
    for bits in [4,8]:
        matrices = []
        for name,rows,cols,chunk in MATRICES:
            weight = layer.get_submodule(name).weight.detach().numpy().astype(np.float64)
            limit = (1<<(bits-1))-1
            scale = np.maximum(np.max(np.abs(weight),axis=1)/limit,1/S)
            quant = np.clip(np.rint(weight/scale[:,None]),-limit,limit).astype(np.int64)
            matrices.append((quant,np.rint(scale*S).astype(np.int64)))
        variant = {'bits':bits,'cases':[],'overflows':[]}
        if bits == 4:
            history = [np.zeros(1024,dtype=np.int64),np.zeros(1024,dtype=np.int64)]
            checks = []
            manifest = json.loads((ROOT/'manifest.json').read_text())
            for i in range(3):
                x = unpack((ROOT/f'data/token-{i}-input.bin').read_bytes())
                stages,history = block(x,history,matrices,gamma,conv,lut)
                checks.append(hashlib.sha256(pack(stages['output'])).hexdigest()==manifest['cases'][i]['output_sha256'])
            assert all(checks)
            report['original_three_fixture_hashes_unchanged'] = checks
        for sequence,text in enumerate(TEXTS):
            ids = tok(text*3,add_special_tokens=False,return_tensors='pt')['input_ids'][:,:64]
            assert ids.shape[-1] == 64
            with torch.inference_mode():
                embeddings = model.model.embed_tokens(ids)
                floating = layer(embeddings)[0].numpy().astype(np.float64)
            history = [np.zeros(1024,dtype=np.int64),np.zeros(1024,dtype=np.int64)]
            for index in range(64):
                x = np.rint(embeddings[0,index].numpy().astype(np.float64)*Q).astype(np.int64)
                try:
                    stages,history = block(x,history,matrices,gamma,conv,lut)
                    y = stages['output']/Q; fp = floating[index]
                    variant['cases'].append({'sequence':sequence,'position':index,'token_id':int(ids[0,index]),
                        'relative_l2_error':float(np.linalg.norm(y-fp)/np.linalg.norm(fp)),
                        'cosine_similarity':float(y@fp/(np.linalg.norm(y)*np.linalg.norm(fp))),
                        'max_absolute_error':float(np.max(np.abs(y-fp))),
                        'maximum_absolute_stage_integer':max(int(np.max(np.abs(v))) for v in stages.values())})
                except OverflowError as exc:
                    variant['overflows'].append({'sequence':sequence,'position':index,'error':str(exc)})
                    break
        for metric in ['relative_l2_error','cosine_similarity','maximum_absolute_stage_integer']:
            values = [c[metric] for c in variant['cases']]
            variant[metric] = {'mean':float(np.mean(values)),'min':min(values),'max':max(values)}
        report['variants'].append(variant)
        print(json.dumps({k:v for k,v in variant.items() if k!='cases'}),flush=True)
    report.update(status='complete',finished_at=datetime.now(timezone.utc).isoformat())
    (ROOT.parent/'results/precision-stress.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__ == '__main__': main()
