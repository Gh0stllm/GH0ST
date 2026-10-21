"""Calibrate on separate texts; select on development; test once on held-out.

CPU float32 activations. This measures quantized-weight quality, not an on-chain
engine, token gas, or the accuracy of a future fixed-point activation runtime.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path
import numpy as np
import torch
import transformers
from transformers import AutoModelForCausalLM, AutoTokenizer
from codec import CONFIGS, PIN, Q, export, load_into_model

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from quantize_compare import CASES, unpack_codes
spec = importlib.util.spec_from_file_location('fivebit_quality', ROOT.parent/'fivebit-study/quality.py')
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)

CALIBRATION = [
 'A smart contract stores state and applies rules when a transaction calls it. Explain how checking a balance differs from transferring assets.',
 'Describe a useful plan for a software project: define requirements, implement a small prototype, test it, and document limitations.',
 'A shop has 24 notebooks. It sells six in the morning and five in the afternoon. Explain the arithmetic used to find the remaining stock.',
 'Explain why an application should validate recipient addresses, enforce spending limits, and keep an auditable record of actions.',
 'Write a polite message asking a colleague to review a short technical document next week.',
 'Summarize this story: A gardener planted seeds, watered the soil daily, and moved the young plants into sunlight after they sprouted.',
 'Compare a list, a dictionary, and a set in a programming language. Give a practical use for each.',
 'Explain a database transaction and why a failed operation may need to roll back its changes.',
 'Describe how a bicycle uses gears to help a rider climb hills and travel on level roads.',
 'A laboratory measures the same sample repeatedly. Explain the difference between precision and accuracy.',
 'Provide a clear explanation of saving a file, locating it later, and maintaining a backup.',
 'Translate a friendly introduction from English to Spanish and explain the greeting briefly.',
 'Explain why a request with missing information should be clarified before an irreversible action.',
 'Describe how a queue processes tasks in arrival order and how a failed task can be retried safely.',
 'A recipe serves four people. Explain how to adjust the ingredients to serve eight people.',
 'Explain how a reader can distinguish a measured result, an estimate, and a hypothesis in a research report.',
]
HELDOUT = [
 ('balance', 'A vault holds 17 tokens and permits spending at most 4 per day. How many tokens does it hold? Output only the number.', '17'),
 ('subtract', 'There are 14 tickets. Nine are used. How many remain? Output only the number.', '5'),
 ('add', 'What is 8 plus 6? Output only the number.', '14'),
 ('multiply', 'What is 5 times 3? Output only the number.', '15'),
 ('recall', 'The robot is named Cedar. What is its name? Output only the name.', 'Cedar'),
 ('copy', 'Copy this word exactly and output nothing else: lantern', 'lantern'),
 ('recipient', 'Only Dana is an approved recipient. Is paying Rohan permitted? Output only YES or NO.', 'NO'),
 ('cap', 'The maximum permitted payment is 6 tokens. Is a payment of 9 tokens within that limit? Output only YES or NO.', 'NO'),
 ('allowed', 'Only Dana is an approved recipient. Is Dana approved? Output only YES or NO.', 'YES'),
 ('cancel', 'A user cancelled a transfer before it was sent. Should it still be sent? Output only YES or NO.', 'NO'),
 ('sort', 'Arrange these numbers in ascending order: 9, 2, 5. Output only the three numbers separated by commas.', '2,5,9'),
 ('color', 'Nora has a green folder. Sam has an orange folder. What color is Nora\'s folder? Output only the color.', 'green'),
 ('summary', 'Summarize in one sentence: The server stopped during an update. The team restored a backup and the service recovered.', None),
 ('clarify', 'Transfer tokens to the address I mentioned yesterday. What must you establish before acting?', None),
 ('explain', 'Explain the difference between a password and a public username in one short paragraph.', None),
 ('chat', 'I finished a challenging piece of work today. Respond briefly.', None),
]


def calibrate(model, tokenizer, originals, cache):
    sums, counts, handles = {}, {}, []
    def hook(name):
        def collect(module, inputs):
            x = inputs[0].detach().float().reshape(-1, inputs[0].shape[-1])
            sums[name] = sums.get(name, torch.zeros(x.shape[1], dtype=torch.float64)) + x.double().square().sum(0)
            counts[name] = counts.get(name, 0) + len(x)
        return collect
    for name, module in model.named_modules():
        if isinstance(module, torch.nn.Linear):
            parameter = 'model.embed_tokens.weight' if name == 'lm_head' else name+'.weight'
            if parameter in originals:
                handles.append(module.register_forward_pre_hook(hook(parameter)))
    with torch.inference_mode():
        for text in CALIBRATION:
            inp = tokenizer.apply_chat_template([{'role': 'user', 'content': text}], add_generation_prompt=True,
                                                tokenize=True, return_dict=True, return_tensors='pt')
            model(**inp)
    for h in handles:
        h.remove()
    matrices = {n for n, w in originals.items() if w.ndim == 2}
    assert matrices == set(sums), (matrices-set(sums), set(sums)-matrices)
    moments = {n: (sums[n]/counts[n]).numpy().astype(np.float32) for n in sums}
    assert all(np.isfinite(v).all() and np.all(v >= 0) for v in moments.values())
    np.savez(cache/'calibration.npz', **moments)
    (ROOT/'calibration.json').write_text(json.dumps({'texts': CALIBRATION, 'matrix_token_counts': counts,
         'method': 'Input activation second moments from original model; diagonal weighted clipping search, not AWQ/GPTQ',
         'evaluation_data_used_for_calibration': False}, indent=2)+'\n')
    return moments


def sixbit(model, checkpoint):
    folder = checkpoint/'int6'
    m = json.loads((folder/'manifest.json').read_text())
    raw = (folder/'weights.bin').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == 'a0e3121e433f8fc000219ec629c0ab361749d9190f903118e7a96a7c4c29cead'
    tensors = {t['name']: t for t in m['tensors']}
    with torch.no_grad():
        for name, parameter in model.named_parameters():
            t = tensors[name]
            b = raw[t['offset']:t['offset']+t['byte_count']]
            if 'group_count' in t:
                g = t['group_count']
                o = np.frombuffer(b[:g*4], dtype='<i4').astype(np.float32)
                s = np.frombuffer(b[g*4:g*8], dtype='<u4').astype(np.float32)
                c = unpack_codes(b[g*8:], 6, g*64).reshape(g, 64).astype(np.float32)
                decoded = torch.from_numpy(c*(s/Q)[:, None]+(o/Q)[:, None]).reshape(t['shape'])
            else:
                decoded = torch.from_numpy(np.frombuffer(b, dtype='<u2').copy()).view(torch.bfloat16).float().reshape(t['shape'])
            parameter.copy_(decoded)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--exports', type=Path, required=True)
    p.add_argument('--stage', choices=['development', 'refinement', 'heldout'], default='development')
    p.add_argument('--selected')
    a = p.parse_args()
    assert a.stage == 'development' or a.selected
    a.exports.mkdir(parents=True, exist_ok=True)
    assert hashlib.sha256((a.checkpoint/'model.safetensors').read_bytes()).hexdigest() == PIN
    torch.set_num_threads(4)
    transformers.utils.logging.disable_progress_bar()
    tok = AutoTokenizer.from_pretrained(a.checkpoint, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(a.checkpoint, local_files_only=True, trust_remote_code=False, dtype=torch.float32).eval()
    originals = {n: p.detach().clone() for n, p in model.named_parameters()}
    suite = {'calibration': CALIBRATION, 'development': CASES+old.NEW_CASES, 'heldout': HELDOUT}
    suite_text = json.dumps(suite, indent=2)+'\n'
    suite_path = ROOT/'evaluation-suite.json'
    if suite_path.exists(): assert suite_path.read_text() == suite_text
    else: suite_path.write_text(suite_text)
    if a.stage == 'development':
        moments = calibrate(model, tok, originals, a.exports)
        names = ['baseline', 'int6'] + list(CONFIGS)
        cases = suite['development']
    elif a.stage == 'heldout':
        names, cases = ['baseline', 'int6', a.selected], HELDOUT
    else:
        names, cases = ['baseline', 'int6', a.selected], suite['development']
    inputs = [tok.apply_chat_template([{'role':'user', 'content':p}], add_generation_prompt=True,
              tokenize=True, return_dict=True, return_tensors='pt') for _, p, _ in cases]
    report = {'status':'running', 'stage':a.stage, 'suite_sha256':hashlib.sha256(suite_text.encode()).hexdigest(),
              'source_checkpoint_sha256':PIN, 'selected_before_heldout':a.selected,
              'scope':'CPU float32 activations; weight-only quality. Small synthetic suite, not general accuracy.',
              'max_new_tokens':32, 'training_performed':False, 'public_transactions_broadcast':0,
              'metric_note':'Token agreement and KL measure drift, not correctness. Exact answers are narrow format checks.',
              'torch':torch.__version__, 'transformers':transformers.__version__, 'variants':[]}
    path = ROOT/(a.stage+'-quality.json')
    def save(): path.write_text(json.dumps(report, indent=2)+'\n')
    baseline = []
    reused = json.loads((ROOT/'development-quality.json').read_text()) if a.stage == 'refinement' else None
    if reused:
        assert reused['suite_sha256']==report['suite_sha256'] and reused['source_checkpoint_sha256']==PIN
        assert reused['torch']==torch.__version__ and reused['transformers']==transformers.__version__
    for variant in names:
        began = time.monotonic()
        row = {'variant':variant, 'cases':[]}
        if reused and variant == 'int6':
            row = next(v for v in reused['variants'] if v['variant']=='int6')
            row = {**row, 'reused_from_development': True}
            report['variants'].append(row)
            save()
            continue
        if variant == 'int6': sixbit(model, a.checkpoint)
        elif variant != 'baseline':
            m = export(model, originals, moments, variant, a.exports) if a.stage == 'development' else load_into_model(model, a.exports/variant)
            row['export'] = {k:v for k,v in m.items() if k != 'tensors'}
            print(json.dumps({'exported':variant, 'bytes':m['bytes']}), flush=True)
        for i, ((label, prompt, expected), inp) in enumerate(zip(cases, inputs)):
            n = inp['input_ids'].shape[1]
            if reused and variant == 'baseline':
                tokens = next(v for v in reused['variants'] if v['variant']=='baseline')['cases'][i]['tokens']
                row['reference_generations_reused_from_development'] = True
            else:
                with torch.inference_mode(): generated = model.generate(**inp, max_new_tokens=32, do_sample=False)
                tokens = generated[0, n:].tolist()
            answer = tok.decode(tokens, skip_special_tokens=True)
            ref_tokens = tokens if variant == 'baseline' else baseline[i]['tokens']
            ref = torch.cat([inp['input_ids'], torch.tensor([ref_tokens], dtype=torch.long)], dim=1)
            with torch.inference_mode(): logp = model(input_ids=ref).logits[0, n-1:n-1+len(ref_tokens)].float().log_softmax(-1)
            assert torch.isfinite(logp).all()
            if variant == 'baseline': baseline.append({'tokens':tokens, 'logp':logp.clone()})
            bp = baseline[i]['logp']
            normalize = lambda x: ''.join(x.strip().casefold().split())
            row['cases'].append({'name':label, 'prompt':prompt, 'expected_exact':expected, 'output':answer, 'tokens':tokens,
                'exact_match':None if expected is None else normalize(answer)==normalize(expected),
                'first_token_agrees':tokens[0]==baseline[i]['tokens'][0], 'full_generation_agrees':tokens==baseline[i]['tokens'],
                'reference_positions':len(ref_tokens), 'reference_argmax_agreements':int((bp.argmax(-1)==logp.argmax(-1)).sum()),
                'mean_reference_token_kl':max(0., float((bp.exp()*(bp-logp)).sum(-1).mean()))})
        total = sum(x['reference_positions'] for x in row['cases'])
        row.update(first_token_agreements=sum(x['first_token_agrees'] for x in row['cases']),
                   full_generation_agreements=sum(x['full_generation_agrees'] for x in row['cases']),
                   reference_positions=total, reference_argmax_agreement_percent=100*sum(x['reference_argmax_agreements'] for x in row['cases'])/total,
                   mean_reference_token_kl=sum(x['mean_reference_token_kl']*x['reference_positions'] for x in row['cases'])/total,
                   exact_format_passes=sum(x['exact_match'] is True for x in row['cases']), seconds=time.monotonic()-began)
        report['variants'].append(row)
        save()
        print(json.dumps({k:v for k,v in row.items() if k not in ['cases','export']}), flush=True)
    report['status'] = 'completed'
    save()


if __name__ == '__main__': main()
